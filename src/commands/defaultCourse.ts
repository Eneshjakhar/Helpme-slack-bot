import type { App } from '@slack/bolt';
import type { Logger } from 'pino';
import { getUserCourses, setDefaultCourse } from '../db/index.js';

export function registerDefaultCourseCommand(app: App, logger: Logger): void {
  app.command('/default-course', async ({ ack, body, respond, client }) => {
    logger.info('Default-course command received');
    await ack();
    
    try {
      const courseInput = (body.text || '').trim();
      if (!courseInput) {
        await respond({ 
          response_type: 'ephemeral', 
          text: 'Please provide a course. Usage: `/default-course COURSE_ID` or `/default-course "Course Name"`' 
        });
        return;
      }
      
      // Get user's courses to resolve course names/IDs
      const cached = await getUserCourses(body.team_id, body.user_id);
      if (!cached) {
        await respond({ 
          response_type: 'ephemeral', 
          text: 'No courses found. Please run `/link` to connect your account first.' 
        });
        return;
      }
      
      // Resolve course ID
      const resolved = resolveCourseId(courseInput, cached.courses);
      if (!resolved) {
        await respond({ 
          response_type: 'ephemeral', 
          text: `Course "${courseInput}" not found. Available courses: ${cached.courses.map(c => c.name).join(', ')}` 
        });
        return;
      }
      
      // Set default course
      await setDefaultCourse(body.team_id, body.user_id, resolved.id);
      
      await respond({ 
        response_type: 'ephemeral', 
        text: `Default course set to ${resolved.name}` 
      });
      
    } catch (error) {
      logger.error('Error in default-course command');
      await respond({ 
        response_type: 'ephemeral', 
        text: 'An error occurred while setting your default course. Please try again.' 
      });
    }
  });
}

function resolveCourseId(identifier: string, courses: Array<{ id: number; name: string }>): { id: number; name: string } | null {
  // Try exact match first
  const exactMatch = courses.find(c => c.name.toLowerCase() === identifier.toLowerCase());
  if (exactMatch) return exactMatch;
  
  // Try partial match
  const partialMatch = courses.find(c => c.name.toLowerCase().includes(identifier.toLowerCase()));
  if (partialMatch) return partialMatch;
  
  // Try numeric ID
  const numericId = parseInt(identifier);
  if (!isNaN(numericId)) {
    const numericMatch = courses.find(c => c.id === numericId);
    if (numericMatch) return numericMatch;
  }
  
  return null;
}


