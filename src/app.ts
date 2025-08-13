import 'dotenv/config';
import SlackBolt from '@slack/bolt';
import type { App as SlackApp } from '@slack/bolt';
import pino from 'pino';
import express from 'express';
import { registerAskCommand } from './commands/ask.js';
import { registerLinkCommand } from './commands/link.js';
import { ensureDb, saveLink } from './db/index.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const { App, ExpressReceiver, LogLevel } = SlackBolt as unknown as {
  App: any;
  ExpressReceiver: any;
  LogLevel: any;
};

function makeBoltLogger(l: pino.Logger): any {
  return {
    debug: (m: any) => l.debug(m),
    info: (m: any) => l.info(m),
    warn: (m: any) => l.warn(m),
    error: (m: any) => l.error(m),
    setLevel: () => {},
    getLevel: () => LogLevel.INFO,
    setName: () => {},
  };
}

async function bootstrap() {
  await ensureDb(logger);

  const mode = (process.env.DELIVERY_MODE || 'SOCKET').toUpperCase();
  let app: SlackApp;

  if (mode === 'HTTP') {
    const receiver = new ExpressReceiver({
      signingSecret: process.env.SLACK_SIGNING_SECRET!,
      endpoints: '/slack/events',
    });

    const ex = receiver.app as express.Express;
    ex.use(express.json());
    ex.get('/healthz', (_req, res) => res.json({ ok: true }));
    ex.post('/link/callback', async (req, res) => {
      const secret = req.header('X-HelpMe-Link-Secret');
      if (secret !== process.env.LINK_SHARED_SECRET) {
        logger.warn({ route: 'link_callback_http' }, 'Unauthorized link callback');
        return res.status(401).json({ error: 'UNAUTHORIZED' });
      }
      const { teamId, userId, helpmeUserToken } = req.body || {};
      if (!teamId || !userId || !helpmeUserToken) {
        logger.warn({ route: 'link_callback_http', bodyKeys: Object.keys(req.body || {}) }, 'Invalid link payload');
        return res.status(400).json({ error: 'INVALID' });
      }
      await saveLink(teamId, userId, { helpmeUserToken });
      logger.info({ route: 'link_callback_http', teamId, userId, tokenLen: String(helpmeUserToken).length }, 'Link saved');
      return res.json({ ok: true });
    });

    app = new App({
      token: process.env.SLACK_BOT_TOKEN!,
      signingSecret: process.env.SLACK_SIGNING_SECRET!,
      receiver,
      logger: makeBoltLogger(logger),
    });
  } else {
    app = new App({
      token: process.env.SLACK_BOT_TOKEN!,
      appToken: process.env.SLACK_APP_TOKEN!,
      signingSecret: process.env.SLACK_SIGNING_SECRET!,
      socketMode: true,
      logger: makeBoltLogger(logger),
    });

    // small aux server for health+link
    const ex = express();
    ex.use(express.json());
    ex.get('/healthz', (_req, res) => res.json({ ok: true }));
    ex.post('/link/callback', async (req, res) => {
      const secret = req.header('X-HelpMe-Link-Secret');
      if (secret !== process.env.LINK_SHARED_SECRET) {
        logger.warn({ route: 'link_callback_socket' }, 'Unauthorized link callback');
        return res.status(401).json({ error: 'UNAUTHORIZED' });
      }
      const { teamId, userId, helpmeUserToken } = req.body || {};
      if (!teamId || !userId || !helpmeUserToken) {
        logger.warn({ route: 'link_callback_socket', bodyKeys: Object.keys(req.body || {}) }, 'Invalid link payload');
        return res.status(400).json({ error: 'INVALID' });
      }
      await saveLink(teamId, userId, { helpmeUserToken });
      logger.info({ route: 'link_callback_socket', teamId, userId, tokenLen: String(helpmeUserToken).length }, 'Link saved');
      return res.json({ ok: true });
    });
    const port = Number(process.env.PORT || 3109);
    ex.listen(port, () => logger.info({ port }, 'HTTP aux server listening'));
  }

  registerAskCommand(app, logger);
  registerLinkCommand(app, logger);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  if (mode === 'SOCKET') {
    const startupDelayMs = Number(process.env.SOCKET_START_DELAY_MS || 800);
    if (startupDelayMs > 0) await sleep(startupDelayMs);
  }

  await app.start();
  logger.info(`Slack app started in ${mode} mode`);

  // Graceful shutdown to avoid Socket Mode "too_many_websockets" on reloads
  const shutdown = async (sig: string) => {
    try {
      logger.info({ sig }, 'Stopping Slack app');
      await app.stop();
    } catch (e) {
      logger.warn({ err: e }, 'Error stopping Slack app');
    } finally {
      process.exit(0);
    }
  };
  ['SIGINT', 'SIGTERM', 'SIGUSR2'].forEach((s) => process.once(s, () => void shutdown(s)));
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

process.on('uncaughtException', (err: any) => {
  const message = String(err?.message || err || '');
  if (message.includes("Unhandled event 'server explicit disconnect'")) {
    logger.warn({ err: message }, 'SocketMode explicit disconnect; exiting for clean restart');
    setTimeout(() => process.exit(0), 750);
    return;
  }
  logger.error({ err: message }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason: any) => {
  const message = String((reason as any)?.message || reason || '');
  logger.error({ err: message }, 'Unhandled rejection');
  process.exit(1);
});


