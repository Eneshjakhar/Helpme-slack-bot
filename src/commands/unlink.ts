import type { App } from '@slack/bolt';
import type { Logger } from 'pino';
import { isUserLinked, deleteUserLink } from '../db/index.js';

export function registerUnlinkCommand(app: App, logger: Logger): void {
  app.command('/unlink', async ({ ack, body, respond }) => {
    await ack();
    
    const slackUserId = body.user_id;
    const teamId = body.team_id;
    
    logger.info({ userId: slackUserId, teamId }, 'Unlink command received');
    
    // Check if user is linked
    const isLinked = await isUserLinked(teamId, slackUserId);
    if (!isLinked) {
      await respond({
        text: '❌ Your account is not linked to HelpMe.',
        response_type: 'ephemeral'
      });
      return;
    }
    
    try {
      // Remove the link
      await deleteUserLink(teamId, slackUserId);
      
      logger.info({ userId: slackUserId, teamId }, 'User unlinked successfully');
      
      await respond({
        text: '✅ Your Slack account has been unlinked from HelpMe. Run `/link` to link again.',
        response_type: 'ephemeral'
      });
      
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ err: msg, userId: slackUserId, teamId }, 'Error in unlink command');
      await respond({
        text: 'Sorry, I encountered an error while unlinking your account. Please try again.',
        response_type: 'ephemeral'
      });
    }
  });
}
