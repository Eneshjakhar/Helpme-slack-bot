import type { App } from '@slack/bolt';
import type { Logger } from 'pino';
import { createLinkState } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';

export function registerLinkCommand(app: App, logger: Logger): void {
  app.command('/link', async ({ ack, body, respond }) => {
    await ack();
    
    const slackUserId = body.user_id;
    const teamId = body.team_id;
    
    // Check if user is already linked (we'll implement this check)
    const { isUserLinked } = await import('../db/index.js');
    const isLinked = await isUserLinked(teamId, slackUserId);
    
    if (isLinked) {
      await respond({
        text: '✅ You are already linked to HelpMe! You can use `/ask` to ask questions.',
        response_type: 'ephemeral'
      });
      return;
    }
    
    const helpMeBaseUrl = process.env.HELPME_BASE_URL || process.env.HELP_ME_BASE_URL || 'http://localhost:3000';
    const appBaseUrl = process.env.APP_BASE_URL || 'http://localhost:3109';

    logger.info({ 
      helpMeBaseUrl, 
      appBaseUrl, 
      env: {
        HELPME_BASE_URL: process.env.HELPME_BASE_URL,
        HELP_ME_BASE_URL: process.env.HELP_ME_BASE_URL,
        APP_BASE_URL: process.env.APP_BASE_URL
      }
    }, 'Environment variables for link command');
    
    // Generate unique state for OAuth flow
    const state = uuidv4();
    const redirectUri = `${appBaseUrl.replace(/\/$/, '')}/link/callback`;
    
    // Create link state for tracking
    const ttlSeconds = Math.min(600, Math.max(60, Number(process.env.LINK_STATE_TTL_SECONDS || 600)));
    await createLinkState({
      stateId: state,
      teamId: teamId,
      userId: slackUserId,
      channelId: body.channel_id,
      redirectUri,
      ttlSeconds,
    });

    // Build HelpMe OAuth URL
    const helpmeUrl = new URL(`${helpMeBaseUrl}/api/v1/auth/slack/start`);
    helpmeUrl.searchParams.set('state', state);
    helpmeUrl.searchParams.set('redirect_uri', redirectUri);
    
    // Add organization ID if configured
    const orgId = process.env.DEFAULT_ORG_ID || process.env.HELPME_ORG_ID;
    if (orgId) {
      helpmeUrl.searchParams.set('oid', orgId);
    }

    logger.info({ 
      userId: slackUserId, 
      teamId, 
      state: state.substring(0, 8) + '...',
      url: helpmeUrl.toString() 
    }, 'Link command initiated');

    await respond({
      text: `🔗 To link your Slack account with HelpMe, please click the link below:\n\n${helpmeUrl.toString()}\n\nThis will redirect you to HelpMe where you can log in and authorize the connection.`,
      response_type: 'ephemeral'
    });
  });
}


