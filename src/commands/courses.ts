import type { App } from '@slack/bolt';
import type { Logger } from 'pino';
import { getUserCourses, isUserLinked } from '../db/index.js';

export function registerCoursesCommand(app: App, logger: Logger): void {
  app.command('/courses', async ({ ack, body, respond }) => {
    await ack();
    
    const slackUserId = body.user_id;
    const teamId = body.team_id;
    
    logger.info({ userId: slackUserId, teamId }, 'Courses command received');
    
    // Check if user is linked
    const isLinked = await isUserLinked(teamId, slackUserId);
    if (!isLinked) {
      await respond({
        text: 'You need to link your account first. Run `/link` to get started.',
        response_type: 'ephemeral'
      });
      return;
    }
    
    try {
      // Get user's courses
      const userCourses = await getUserCourses(teamId, slackUserId);
      if (!userCourses) {
        await respond({
          text: '📚 No courses found. You may not be enrolled in any courses yet.',
          response_type: 'ephemeral'
        });
        return;
      }
      
      const courses = userCourses.courses;
      
      if (courses.length === 0) {
        await respond({
          text: '📚 You are not enrolled in any courses yet.',
          response_type: 'ephemeral'
        });
        return;
      }
      
      const courseList = courses.map(course => `• ${course.name} (ID: ${course.id})`).join('\n');
      const fetchedDate = new Date(userCourses.fetchedAt).toLocaleDateString();
      
      await respond({
        text: `📚 **Your Enrolled Courses:**\n\n${courseList}\n\n*Last updated: ${fetchedDate}*`,
        response_type: 'ephemeral'
      });
      
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ err: msg, userId: slackUserId, teamId }, 'Error in courses command');
      await respond({
        text: 'Sorry, I encountered an error while fetching your courses. Please try again.',
        response_type: 'ephemeral'
      });
    }
  });
}
