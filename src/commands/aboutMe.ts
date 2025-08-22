import type { App } from '@slack/bolt';
import type { Logger } from 'pino';
import { getUserLinkInfo, getUserCourses } from '../db/index.js';

export function registerAboutMeCommand(app: App, logger: Logger): void {
  app.command('/about-me', async ({ ack, body, respond, client }) => {
    logger.info('About-me command received');
    await ack();
    
    try {
      const teamId = body.team_id;
      const userId = body.user_id;
      
      logger.info('Getting user link info');
      const link = await getUserLinkInfo(teamId, userId);
      
      if (!link) {
        logger.info('User not linked');
        await respond({ 
          response_type: 'ephemeral', 
          text: 'Not linked yet. Run `/link` to connect your account.' 
        });
        return;
      }
      
      logger.info('Getting user courses');
      const courses = await getUserCourses(teamId, userId);
      const courseLines = (courses?.courses || []).map((c) => `- ${c.name}`).join('\n');
      const coursesText = courseLines || 'No courses available.';
      const text = `*Name:* ${link.helpmeName}\n*Email:* ${link.helpmeEmail}\n*Courses:*\n${coursesText}`;
      
      logger.info('Sending response');
      await respond({ 
        response_type: 'ephemeral', 
        text: text 
      });
      logger.info('Response sent successfully');
    } catch (error) {
      logger.error('Error in about-me command');
      await respond({ 
        response_type: 'ephemeral', 
        text: 'An error occurred while processing your request.' 
      });
    }
  });
}


