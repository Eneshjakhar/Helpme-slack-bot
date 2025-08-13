import type { App } from '@slack/bolt';
import type { Logger } from 'pino';
import { saveLink } from '../db/index.js';

export function registerLinkCommand(app: App, _logger: Logger): void {
  app.command('/link', async ({ ack, body, respond, client }) => {
    await ack();
    const requireLinking = (process.env.REQUIRE_LINKING || '').toLowerCase() === 'true';
    const providedToken = (body.text || '').trim();

    // If user pasted a token: save immediately and confirm
    if (providedToken) {
      if (providedToken.length < 8) {
        await respond({ response_type: 'ephemeral', text: 'That token looks invalid. Please paste a valid HMS API token.' });
        return;
      }
      await saveLink(body.team_id, body.user_id, { helpmeUserToken: providedToken });
      await respond({ response_type: 'ephemeral', text: 'Linked. You can now use /ask.' });
      return;
    }
    // Open a modal to collect the HMS token (works even if linking is optional)
    try {
      await client.views.open({
        trigger_id: body.trigger_id,
        view: {
          type: 'modal',
          callback_id: 'link_modal',
          private_metadata: JSON.stringify({ channel_id: body.channel_id, team_id: body.team_id, user_id: body.user_id }),
          title: { type: 'plain_text', text: 'Link Account' },
          submit: { type: 'plain_text', text: 'Save' },
          close: { type: 'plain_text', text: 'Cancel' },
          blocks: [
            {
              type: 'input',
              block_id: 'token_block',
              optional: false,
              element: {
                type: 'plain_text_input',
                action_id: 'token_input',
                placeholder: { type: 'plain_text', text: 'Paste your HMS API token' },
              },
              label: { type: 'plain_text', text: 'HMS API Token' },
            },
            {
              type: 'section',
              text: { type: 'mrkdwn', text: requireLinking ? 'Linking is required to use /ask.' : 'Linking is optional in this environment.' },
            },
          ],
        },
      });
    } catch (e: any) {
      await respond({ response_type: 'ephemeral', text: 'Could not open the Link modal. Try again.' });
    }
  });

  // Handle link modal submission
  app.view('link_modal', async ({ ack, view, body, client }) => {
    const values = (view as any).state.values as any;
    const token = values?.token_block?.token_input?.value as string;

    const errors: Record<string, string> = {};
    if (!token || token.length < 10) {
      errors['token_block'] = 'Please paste a valid HMS API token (10+ characters).';
    }
    if (Object.keys(errors).length > 0) {
      await ack({ response_action: 'errors', errors });
      return;
    }
    await ack({
      response_action: 'update',
      view: {
        type: 'modal',
        callback_id: 'link_modal_done',
        title: { type: 'plain_text', text: 'Link Account' },
        close: { type: 'plain_text', text: 'Close' },
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: 'Token saved. You can now use /ask.' } },
        ],
      },
    });

    const meta = JSON.parse((view as any).private_metadata || '{}');
    const teamId = (body as any)?.team?.id || meta.team_id;
    const userId = (body as any)?.user?.id || meta.user_id;
    const channelId = meta.channel_id as string;

    await saveLink(teamId, userId, { helpmeUserToken: token });
    if (channelId && userId) {
      if (String(channelId).startsWith('D')) {
        await client.chat.postMessage({ channel: channelId, text: 'Linked. You can now use /ask.' });
      } else {
        await client.chat.postEphemeral({ channel: channelId, user: userId, text: 'Linked. You can now use /ask.' });
      }
    }
  });
}


