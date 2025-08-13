import type { App } from '@slack/bolt';
import type { Logger } from 'pino';
import { saveLink } from '../db/index.js';

export function registerLinkCommand(app: App, _logger: Logger): void {
  app.command('/link', async ({ ack, body, respond }) => {
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
    if (!requireLinking) {
      await respond({ response_type: 'ephemeral', text: 'Linking not required in this environment.' });
      return;
    }
    const team = body.team_id;
    const user = body.user_id;
    const channel = body.channel_id;
    const base = process.env.LINK_PAGE_URL || 'http://localhost:3000/login';
    const port = Number(process.env.PORT || 3109);
    const fallbackBase = `http://localhost:${port}`;
    const publicBase = process.env.PUBLIC_BASE_URL || fallbackBase;
    const callbackUrl = `${publicBase.replace(/\/$/, '')}/link/callback`;
    const returnUrl = `https://slack.com/app_redirect?channel=${encodeURIComponent(channel)}`;
    const linkUrl = `${base}?team=${encodeURIComponent(team)}&user=${encodeURIComponent(user)}&channel=${encodeURIComponent(channel)}&callback=${encodeURIComponent(callbackUrl)}&return=${encodeURIComponent(returnUrl)}`;
    await respond({
      response_type: 'ephemeral',
      text: [
        `To link your account, open: ${linkUrl}`,
        'After signing in, your Slack user will be linked automatically.',
      ].join('\n'),
    });
  });
}


