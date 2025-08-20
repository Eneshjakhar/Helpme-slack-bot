import type { App } from '@slack/bolt';
import type { Logger } from 'pino';
import { getUserCourses, getDefaultCourse } from '../db/index.js';
import axios from 'axios';

export function registerAskCommand(app: App, logger: Logger): void {
  app.command('/ask', async ({ ack, body, respond, client }) => {
    logger.info('Ask command received');
    await ack();
    
    try {
      const teamId = body.team_id;
      const userId = body.user_id;
      const text = body.text || '';
      
      // Parse the command text to extract question and optional course
      const parts = text.split('--course=');
      let question = parts[0].trim();
      let courseIdentifier = parts[1]?.trim();
      
      if (!question) {
        await respond({ 
          response_type: 'ephemeral', 
          text: 'Please provide a question. Usage: `/ask your question` or `/ask your question --course=COURSE_ID`' 
        });
        return;
      }
      
      // Get user's courses to resolve course names/IDs
      const cached = await getUserCourses(teamId, userId);
      if (!cached) {
        await respond({ 
          response_type: 'ephemeral', 
          text: 'No courses found. Please run `/link` to connect your account first.' 
        });
        return;
      }
      
      // Resolve course ID
      let courseId: number;
      if (courseIdentifier) {
        // User specified a course
        const resolved = resolveCourseId(courseIdentifier, cached.courses);
        if (!resolved) {
          await respond({ 
            response_type: 'ephemeral', 
            text: `Course "${courseIdentifier}" not found. Available courses: ${cached.courses.map(c => c.name).join(', ')}` 
          });
          return;
        }
        courseId = resolved;
      } else {
        // Use default course
        const defaultCourse = await getDefaultCourse(teamId, userId);
        if (!defaultCourse) {
          await respond({ 
            response_type: 'ephemeral', 
            text: 'No default course set. Please use `/ask your question --course=COURSE_ID` or set a default course with `/default-course`.' 
          });
          return;
        }
        courseId = defaultCourse;
      }
      
      // Get course name for display
      const course = cached.courses.find(c => c.id === courseId);
      const courseName = course?.name || `Course ${courseId}`;
      
      // Send initial response
      await respond({ 
        response_type: 'ephemeral', 
        text: `🤔 Asking about *${courseName}*...` 
      });
      
      // Get user link data and validate
      const { getUserLinkData } = await import('../db/index.js');
      const userLink = await getUserLinkData(teamId, userId);
      if (!userLink) {
        await respond({
          response_type: 'ephemeral',
          text: '❌ You need to link your account first. Run `/link` to get started.'
        });
        return;
      }
      
      const userToken = userLink.helpmeUserChatToken;
      if (!userToken) {
        await respond({
          response_type: 'ephemeral',
          text: 'Your account is linked but no chat token was found. Please run `/link` again to refresh your token.'
        });
        return;
      }
      
      // Call HelpMe chatbot API
      const helpMeBaseUrl = process.env.HELPME_BASE_URL || process.env.HELP_ME_BASE_URL || 'http://localhost:3000';
      const chatbotResponse = await axios.post(
        `${helpMeBaseUrl}/api/v1/chatbot/query`,
        {
          query: question,
          type: 'slack'
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'HMS-API-KEY': process.env.HELPME_CHATBOT_API_KEY || '',
            'HMS-API-TOKEN': userToken
          }
        }
      );
      
      // Format the response
      const responseText = chatbotResponse.data.response || chatbotResponse.data.answer;
      const sourceDocs = chatbotResponse.data.sourceDocuments || [];
      
      let formattedResponse = `*Question:* ${question}\n*Course:* ${courseName}\n\n*Answer:*\n${responseText}`;
      
      if (sourceDocs.length > 0) {
        formattedResponse += '\n\n*Sources:*\n';
        sourceDocs.forEach((doc: any, index: number) => {
          const docName = doc.metadata?.name || doc.docName || 'Unknown document';
          const pageInfo = doc.metadata?.loc?.pageNumber ? ` (p. ${doc.metadata.loc.pageNumber})` : '';
          formattedResponse += `${index + 1}. ${docName}${pageInfo}\n`;
        });
      }
      
      await respond({ 
        response_type: 'ephemeral', 
        text: formattedResponse 
      });
      
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ err: msg }, 'Error in ask command');
      await respond({ 
        response_type: 'ephemeral', 
        text: `Request failed: ${msg}` 
      });
    }
  });
}

function resolveCourseId(identifier: string, courses: Array<{ id: number; name: string }>): number | null {
  // Try exact match first
  const exactMatch = courses.find(c => c.name.toLowerCase() === identifier.toLowerCase());
  if (exactMatch) return exactMatch.id;
  
  // Try partial match
  const partialMatch = courses.find(c => c.name.toLowerCase().includes(identifier.toLowerCase()));
  if (partialMatch) return partialMatch.id;
  
  // Try numeric ID
  const numericId = parseInt(identifier);
  if (!isNaN(numericId)) {
    const numericMatch = courses.find(c => c.id === numericId);
    if (numericMatch) return numericId;
  }
  
  return null;
}
