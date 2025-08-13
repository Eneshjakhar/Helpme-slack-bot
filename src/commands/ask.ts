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

  async function ensureDmChannel(client: any, userId: string): Promise<string> {
    const opened = await client.conversations.open({ users: userId });
    return opened.channel.id as string;
  }

  app.command('/ask', async ({ ack, body, respond, client }) => {
    await ack();
    const requireLinking = (process.env.REQUIRE_LINKING || '').toLowerCase() === 'true';
    const defaultToken = process.env.DEFAULT_HMS_USER_TOKEN || '';

    const raw = (body.text || '').trim();
    // Always offer a modal for better UX; prefill from typed text if present
    const prefillCourse = courseIdFromText(raw);
    const prefillQuestion = raw.replace(/--course=\d+\s*/i, '').trim();
    try {
      await client.views.open({
        trigger_id: body.trigger_id,
        view: {
          type: 'modal',
          callback_id: 'ask_modal',
          private_metadata: JSON.stringify({ channel_id: body.channel_id, team_id: body.team_id, user_id: body.user_id }),
          title: { type: 'plain_text', text: 'Ask ChatBot' },
          submit: { type: 'plain_text', text: 'Ask' },
          close: { type: 'plain_text', text: 'Cancel' },
          blocks: [
            {
              type: 'input',
              block_id: 'course_block',
              optional: false,
              element: {
                type: 'plain_text_input',
                action_id: 'course_input',
                initial_value: prefillCourse > 0 ? String(prefillCourse) : '',
                placeholder: { type: 'plain_text', text: 'e.g., 304' },
              },
              label: { type: 'plain_text', text: 'Course ID' },
            },
            {
              type: 'input',
              block_id: 'question_block',
              optional: false,
              element: {
                type: 'plain_text_input',
                action_id: 'question_input',
                multiline: true,
                initial_value: prefillQuestion || '',
                placeholder: { type: 'plain_text', text: 'Type your question...' },
              },
              label: { type: 'plain_text', text: 'Question' },
            },
          ],
        },
      });
    } catch (e: any) {
      logger.error({ err: e?.data || e?.message || e }, 'Failed to open modal');
      await respond({ response_type: 'ephemeral', text: 'Could not open the Ask modal. Try again.' });
    }
    return;

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

  // Handle modal submission
  app.view('ask_modal', async ({ ack, body, view, client }) => {
    const meta = JSON.parse((view as any).private_metadata || '{}');
    const channelId = meta.channel_id as string;
    const teamId = (body as any)?.team?.id || meta.team_id;
    const userId = (body as any)?.user?.id || meta.user_id;
    try {
      const values = (view as any).state.values as any;
      const courseRaw = values?.course_block?.course_input?.value as string;
      const question = values?.question_block?.question_input?.value as string;

      const parsedCourseId = Number(courseRaw || (process.env.DEFAULT_COURSE_ID || '0'));
      const errors: Record<string, string> = {};
      if (!question || String(question).trim().length === 0) {
        errors['question_block'] = 'Please enter a question.';
      }
      if (!parsedCourseId || Number.isNaN(parsedCourseId) || parsedCourseId <= 0) {
        errors['course_block'] = 'Enter a valid numeric course ID (> 0).';
      }
      if (Object.keys(errors).length > 0) {
        await ack({ response_action: 'errors', errors });
        return;
      }
      await ack({
        response_action: 'update',
        view: {
          type: 'modal',
          callback_id: 'ask_modal_done',
          title: { type: 'plain_text', text: 'Ask ChatBot' },
          close: { type: 'plain_text', text: 'Close' },
          blocks: [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: 'Submitted. I will post the answer in the original channel.' },
            },
          ],
        },
      });

      const requireLinking = (process.env.REQUIRE_LINKING || '').toLowerCase() === 'true';
      const defaultToken = process.env.DEFAULT_HMS_USER_TOKEN || '';
      let token: string | null = null;
      if (requireLinking) {
        token = await getUserToken(teamId, userId);
        if (!token) {
          if (String(channelId).startsWith('D')) {
            await client.chat.postMessage({ channel: channelId, text: 'Not linked yet. Run `/link` to connect your account.' });
          } else {
            await client.chat.postEphemeral({ channel: channelId, user: userId, text: 'Not linked yet. Run `/link` to connect your account.' });
          }
          return;
        }
      } else {
        const stored = await getUserToken(teamId, userId);
        token = stored || (defaultToken ? defaultToken : null);
        if (!token) {
          if (String(channelId).startsWith('D')) {
            await client.chat.postMessage({ channel: channelId, text: 'Not linked yet. Run `/link <HMS_API_TOKEN>` or set DEFAULT_HMS_USER_TOKEN in .env.' });
          } else {
            await client.chat.postEphemeral({ channel: channelId, user: userId, text: 'Not linked yet. Run `/link <HMS_API_TOKEN>` or set DEFAULT_HMS_USER_TOKEN in .env.' });
          }
          return;
        }
      }

      const idempotencyKey = uuidv4();
      const data = await chatbot.ask({
        question,
        courseId: parsedCourseId,
        userToken: token ?? undefined,
        idempotencyKey,
        slackTeamId: teamId,
        slackUserId: userId,
      });

      const text = `*Q:* ${question}\n*A:* ${data?.answer ?? '_No answer returned._'}`;
      await safePostMessage(client, { channel: channelId, text });
    } catch (err: any) {
      const msg = String(err?.msg || err?.message || 'Unknown error');
      if (err?.code === 429) {
        const when = err?.resetAt ? ` (resets ${new Date(err.resetAt).toLocaleString()})` : '';
        await safePostMessage(client, { channel: channelId, text: `Out of tokens for today${when}.` });
        return;
      }
      if (err?.code === 401 || /invalid api token/i.test(msg)) {
        const help = 'Your HMS token seems invalid. Run `/link` to update it or set DEFAULT_HMS_USER_TOKEN in .env, then retry.';
        await client.chat.postEphemeral({ channel: channelId, user: userId, text: help });
        return;
      }
      await safePostMessage(client, { channel: channelId, text: `Error: ${msg}` });
      logger.error({ err: err?.data || err?.message || err }, 'ask_modal failed');
    }
  });
}


