import 'dotenv/config';
import SlackBolt from '@slack/bolt';
import type { App as SlackApp } from '@slack/bolt';
import pino from 'pino';
import express from 'express';
import { registerAskCommand } from './commands/ask.js';
import { registerLinkCommand } from './commands/link.js';
import { ensureDb, saveLink, createLinkState, getUserLinkInfo, consumeLinkState, saveUserLink } from './db/index.js';
import axios from 'axios';

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
    ex.use(express.urlencoded({ extended: true }));
    
    ex.get('/healthz', (_req, res) => res.json({ ok: true }));
    
    // OAuth callback endpoint (for HelpMe integration)
    ex.get('/link/callback', async (req, res) => {
      try {
        const state = String(req.query.state || '');
        const code = String(req.query.code || '');
        
        logger.info({ state, code: code.substring(0, 8) + '...' }, 'OAuth callback received (HTTP mode)');
        
        if (!state || !code) {
          return res.status(400).send(`
            <html>
              <head><title>Missing Parameters</title></head>
              <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                <h1>Missing Parameters</h1>
                <p>OAuth callback is missing required state or code parameters.</p>
                <p>Please try the linking process again from Slack.</p>
              </body>
            </html>
          `);
        }

        // Wait longer for HelpMe to fully process the OAuth code
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Exchange code with HelpMe (per new HelpMe contract)
        const helpMeBaseUrl = process.env.HELPME_BASE_URL || process.env.HELP_ME_BASE_URL || 'http://localhost:3002';
        const exchangeUrl = `${helpMeBaseUrl}/api/v1/auth/slack/exchange`;

        // HelpMe expects only { code }
        const exchangeBody = { code };

        logger.info({ url: exchangeUrl, code: code.substring(0, 8) + '...' }, 'Exchanging OAuth code with HelpMe');

        const response = await axios.post(exchangeUrl, exchangeBody, {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
        });

        const payload = response.data;
        logger.info('HelpMe OAuth exchange successful (HTTP mode)');

        return res.status(200).send(`
          <html>
            <head>
              <title>✅ Linked Successfully!</title>
              <style>
                body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                .success { background: #d4edda; color: #155724; padding: 20px; border-radius: 8px; margin: 20px 0; }
                .info { background: #d1ecf1; color: #0c5460; padding: 15px; border-radius: 8px; }
              </style>
            </head>
            <body>
              <h1>✅ Successfully Linked!</h1>
              <div class="success">
                <h2>Welcome, ${payload.name || 'User'}!</h2>
                <p>Your Slack account is now linked to HelpMe.</p>
                <p><strong>Email:</strong> ${payload.email}</p>
              </div>
              <div class="info">
                <h3>What's Next?</h3>
                <p>You can now use these commands in Slack:</p>
                <ul style="text-align: left; display: inline-block;">
                  <li><code>/ask &lt;question&gt;</code> - Ask questions</li>
                  <li><code>/courses</code> - See your enrolled courses</li>
                  <li><code>/unlink</code> - Unlink your account</li>
                </ul>
              </div>
              <p>You can close this window and return to Slack.</p>
            </body>
          </html>
        `);

      } catch (error: any) {
        logger.error('Error in OAuth callback (HTTP mode)', error);
        
        const errorMessage = error?.response?.data?.message || error?.message || 'Unknown error';
        
        return res.status(400).send(`
          <html>
            <head><title>Linking Failed</title></head>
            <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
              <h1>Linking Failed</h1>
              <p>Could not complete linking: ${errorMessage}</p>
              <p>Please run <code>/link</code> again in Slack.</p>
            </body>
          </html>
        `);
      }
    });

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
      await saveLink(teamId, userId, { helpmeUserChatToken: helpmeUserToken });
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
    ex.use(express.urlencoded({ extended: true }));
    
    ex.get('/healthz', (_req, res) => res.json({ ok: true }));
    
    // OAuth callback endpoint (for HelpMe integration)
    ex.get('/link/callback', async (req, res) => {
      try {
        const state = String(req.query.state || '');
        const code = String(req.query.code || '');
        
        logger.info({ state, code: code.substring(0, 8) + '...' }, 'OAuth callback received');
        
        if (!state || !code) {
          return res.status(400).send(`
            <html>
              <head><title>Missing Parameters</title></head>
              <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                <h1>Missing Parameters</h1>
                <p>OAuth callback is missing required state or code parameters.</p>
                <p>Please try the linking process again from Slack.</p>
              </body>
            </html>
          `);
        }

        // Try to consume the link state
        const linkState = await consumeLinkState(state);
        if (!linkState) {
          return res.status(400).send(`
            <html>
              <head><title>Invalid State</title></head>
              <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                <h1>Invalid or Expired State</h1>
                <p>This linking session has expired or is invalid.</p>
                <p>Please run <code>/link</code> again in Slack to start a new linking session.</p>
              </body>
            </html>
          `);
        }

        // Exchange code with HelpMe (per new HelpMe contract)
        const helpMeBaseUrl = process.env.HELPME_BASE_URL || process.env.HELP_ME_BASE_URL || 'http://localhost:3000';
        const exchangeUrl = `${helpMeBaseUrl.replace(':3000', ':3002')}/api/v1/auth/slack/exchange`;

        // HelpMe expects only { code }
        const exchangeBody = { code };

        logger.info({ url: exchangeUrl, code: code.substring(0, 8) + '...' }, 'Exchanging OAuth code with HelpMe');

        // Small delay and retry to avoid race where HelpMe hasn't persisted the code yet
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        let response;
        let lastErr: any;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            if (attempt > 1) await sleep(300 * (attempt - 1));
            response = await axios.post(exchangeUrl, exchangeBody, {
              timeout: 10000,
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
              },
            });
            logger.info({ attempt }, 'Exchange successful');
            break;
          } catch (e: any) {
            lastErr = e;
            const msg = e?.response?.data?.message || e?.message || '';
            logger.info({ attempt, msg }, 'Exchange attempt failed');
            if (!msg.includes('Invalid or expired code') || attempt === 3) {
              throw e;
            }
          }
        }

        const payload = response?.data;
        logger.info('HelpMe OAuth exchange successful');

        // Save user link
        // Align with HelpMe payload: chatToken preferred
        const extractedToken = (payload as any)?.chatToken;
        await saveUserLink({
          teamId: linkState.teamId,
          userId: linkState.userId,
          helpmeUserId: payload.userId,
          helpmeEmail: payload.email,
          helpmeName: payload.name || payload.firstName + ' ' + payload.lastName || payload.email.split('@')[0],
          organizationId: payload.organizationId || null,
          helpmeUserChatToken: extractedToken,
        });

        // Save courses if provided
        if (payload.courses && Array.isArray(payload.courses)) {
          const { saveUserCourses } = await import('./db/index.js');
          await saveUserCourses({
            teamId: linkState.teamId,
            userId: linkState.userId,
            courses: payload.courses
          });
        }

        logger.info('OAuth linking completed successfully');

        return res.status(200).send(`
          <html>
            <head>
              <title>✅ Linked Successfully!</title>
              <style>
                body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                .success { background: #d4edda; color: #155724; padding: 20px; border-radius: 8px; margin: 20px 0; }
                .info { background: #d1ecf1; color: #0c5460; padding: 15px; border-radius: 8px; }
              </style>
            </head>
            <body>
              <h1>✅ Successfully Linked!</h1>
              <div class="success">
                <h2>Welcome, ${payload.name || 'User'}!</h2>
                <p>Your Slack account is now linked to HelpMe.</p>
                <p><strong>Email:</strong> ${payload.email}</p>
              </div>
              <div class="info">
                <h3>What's Next?</h3>
                <p>You can now use these commands in Slack:</p>
                <ul style="text-align: left; display: inline-block;">
                  <li><code>/ask &lt;question&gt;</code> - Ask questions</li>
                  <li><code>/courses</code> - See your enrolled courses</li>
                  <li><code>/unlink</code> - Unlink your account</li>
                </ul>
              </div>
              <p>You can close this window and return to Slack.</p>
            </body>
          </html>
        `);

      } catch (error: any) {
        logger.error('Error in OAuth callback', error);
        
        const errorMessage = error?.response?.data?.message || error?.message || 'Unknown error';
        const statusCode = error?.response?.status || 500;
        
        return res.status(400).send(`
          <html>
            <head><title>Linking Failed</title></head>
            <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
              <h1>Linking Failed</h1>
              <p>Could not complete linking: ${errorMessage}</p>
              <p>Status: ${statusCode}</p>
              <p>Please run <code>/link</code> again in Slack.</p>
            </body>
          </html>
        `);
      }
    });

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
      await saveLink(teamId, userId, { helpmeUserChatToken: helpmeUserToken });
      logger.info({ route: 'link_callback_socket', teamId, userId, tokenLen: String(helpmeUserToken).length }, 'Link saved');
      return res.json({ ok: true });
    });
    const port = Number(process.env.PORT || 3109);
    ex.listen(port, () => logger.info({ port }, 'HTTP aux server listening'));
  }

  registerAskCommand(app, logger);
  registerLinkCommand(app, logger);
  
  // Register about-me command
  const { registerAboutMeCommand } = await import('./commands/aboutMe.js');
  registerAboutMeCommand(app, logger);
  
  // Register default-course command
  const { registerDefaultCourseCommand } = await import('./commands/defaultCourse.js');
  registerDefaultCourseCommand(app, logger);
  
  // Register courses command
  const { registerCoursesCommand } = await import('./commands/courses.js');
  registerCoursesCommand(app, logger);
  
  // Register unlink command
  const { registerUnlinkCommand } = await import('./commands/unlink.js');
  registerUnlinkCommand(app, logger);
  
  // Register chatbot history command
  const { registerChatbotHistoryCommand } = await import('./commands/chatbotHistory.js');
  registerChatbotHistoryCommand(app, logger);
  
  // Register chatbot settings command
  const { registerChatbotSettingsCommand } = await import('./commands/chatbotSettings.js');
  registerChatbotSettingsCommand(app, logger);
  
  // Register chatbot models command
  const { registerChatbotModelsCommand } = await import('./commands/chatbotModels.js');
  registerChatbotModelsCommand(app, logger);

  // Register upload file command
  const { registerUploadFileCommand } = await import('./commands/uploadFile.js');
  registerUploadFileCommand(app, logger);

  // Register chatbot thread command
  const { registerChatbotThreadCommand } = await import('./commands/chatbotThread.js');
  registerChatbotThreadCommand(app, logger);





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
  console.error(err);
  process.exit(1);
});

process.on('uncaughtException', (err: any) => {
  const message = String(err?.message || err || '');
  if (message.includes("Unhandled event 'server explicit disconnect'") ||
      message.includes('too_many_websockets') ||
      message.includes('EADDRINUSE')) {
    logger.warn({ err: message }, 'Expected error; ignoring');
    return;
  }
  logger.error({ err: message }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason: any) => {
  const message = String((reason as any)?.message || reason || '');
  if (message.includes("Unhandled event 'server explicit disconnect'") ||
      message.includes('too_many_websockets') ||
      message.includes('EADDRINUSE')) {
    logger.warn({ err: message }, 'Expected error; ignoring');
    return;
  }
  logger.error({ err: message }, 'Unhandled rejection');
  process.exit(1);
});


