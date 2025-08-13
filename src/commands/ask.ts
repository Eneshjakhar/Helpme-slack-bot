import type { App } from '@slack/bolt';
import type { Logger } from 'pino';
import { v4 as uuidv4 } from 'uuid';
import { getUserToken } from '../db/index.js';
import { ChatbotClient } from '../services/chatbotClient.js';
import { safePostMessage } from '../lib/slack.js';

const defaultCourseId = Number(process.env.DEFAULT_COURSE_ID || '0');
const courseIdFromText = (t: string) => {
  const m = t.match(/--course=(\d+)/i);
  return m ? Number(m[1]) : defaultCourseId;
};

export function registerAskCommand(app: App, logger: Logger): void {
  const chatbot = new ChatbotClient(logger);

  app.command('/ask', async ({ ack, body, respond, client }) => {
    await ack();
    const requireLinking = (process.env.REQUIRE_LINKING || '').toLowerCase() === 'true';
    const defaultToken = process.env.DEFAULT_HMS_USER_TOKEN || '';

    const raw = (body.text || '').trim();
    if (!raw) {
      await respond({ response_type: 'ephemeral', text: 'Usage: /ask [--course=ID] <your question>' });
      return;
    }

    const courseId = courseIdFromText(raw);
    const question = raw.replace(/--course=\d+\s*/i, '').trim();
    if (!question) {
      await respond({ response_type: 'ephemeral', text: 'Please include a question.' });
      return;
    }

    if (!courseId || Number.isNaN(courseId) || courseId <= 0) {
      await respond({ response_type: 'ephemeral', text: 'Please specify a course: /ask --course=ID <question> (or set DEFAULT_COURSE_ID in .env)' });
      return;
    }

    await respond({ response_type: 'ephemeral', text: 'Got it — thinking… I’ll post the answer here.' });

    let token: string | null = null;
    if (requireLinking) {
      token = await getUserToken(body.team_id, body.user_id);
      if (!token) {
        await respond({ response_type: 'ephemeral', text: 'Not linked yet. Run `/link` to connect your account.' });
        return;
      }
    } else {
      const stored = await getUserToken(body.team_id, body.user_id);
      token = stored || (defaultToken ? defaultToken : null);
      if (!token) {
        await respond({ response_type: 'ephemeral', text: 'Not linked yet. Run `/link <HMS_API_TOKEN>` or set DEFAULT_HMS_USER_TOKEN in .env.' });
        return;
      }
    }

    const idempotencyKey = uuidv4();

    try {
      const data = await chatbot.ask({
        question,
        courseId,
        userToken: token ?? undefined,
        idempotencyKey,
        slackTeamId: body.team_id,
        slackUserId: body.user_id,
      });

      const text = `*Q:* ${question}\n*A:* ${data?.answer ?? '_No answer returned._'}`;
      await safePostMessage(client, { channel: body.channel_id, text });
    } catch (err: any) {
      if (!requireLinking && err?.code === 400 && /missing api token/i.test(String(err?.msg))) {
        await respond({
          response_type: 'ephemeral',
          text: 'Backend requires a per-user HMS token. Please run /link or simulate linking via the README curl.',
        });
        return;
      }
      if (err?.code === 429) {
        const when = err?.resetAt ? ` (resets ${new Date(err.resetAt).toLocaleString()})` : '';
        await safePostMessage(client, {
          channel: body.channel_id,
          text: `Out of tokens for today${when}.`,
        });
        return;
      }
      await respond({ response_type: 'ephemeral', text: `Error: ${err?.msg || err?.message || 'Unknown error'}` });
    }
  });
}


