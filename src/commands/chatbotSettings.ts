import type { App } from '@slack/bolt';
import type { Logger } from 'pino';
import { ChatbotService } from '../services/chatbot.service.js';
import { getDefaultCourse, getUserCourses } from '../db/index.js';

export function registerChatbotSettingsCommand(app: App, logger: Logger): void {
  app.command('/chatbot-settings', async ({ ack, body, respond }) => {
    await ack();
    
    const slackUserId = body.user_id;
    const teamId = body.team_id;
    const text = body.text || '';
    
    logger.info({ userId: slackUserId, teamId, text }, 'Chatbot settings command received');
    
    try {
      // Get user info and validate they're linked
      const chatbotService = new ChatbotService();
      const userInfo = await chatbotService.getUserInfo(teamId, slackUserId);
      const userToken = userInfo.helpmeUserChatToken || '';
      
      // Get user's enrolled courses first
      const userCourses = await getUserCourses(teamId, slackUserId);
      if (!userCourses) {
        await respond({
          text: '❌ No course information found. Please run `/courses` to refresh your course data.',
          response_type: 'ephemeral'
        });
        return;
      }
      
      // Debug: Log the actual courses available
      logger.info({ 
        userInput: text.trim(),
        availableCourses: userCourses.courses.map(c => ({ id: c.id, name: c.name }))
      }, 'Chatbot settings course matching debug');
      
      // Parse course input and find the actual course ID
      let courseId: number;
      let courseName: string = '';
      
      if (text.trim()) {
        const userInput = text.trim();
        const inputAsNumber = parseInt(userInput);
        
        if (!isNaN(inputAsNumber)) {
          // User entered a number - check if it matches any course ID
          const foundCourse = userCourses.courses.find((course: { id: number; name: string }) => course.id === inputAsNumber);
          if (foundCourse) {
            courseId = foundCourse.id;
            courseName = foundCourse.name;
          } else {
            await respond({
              text: `❌ Course ID ${inputAsNumber} not found in your enrolled courses. Please use \`/courses\` to see your enrolled courses.`,
              response_type: 'ephemeral'
            });
            return;
          }
        } else {
          // User entered text - try to find by name with comprehensive matching
          const normalizedInput = userInput.replace(/\s+/g, '').toLowerCase();
          
          logger.info({ 
            searchingFor: userInput,
            normalizedInput,
            courses: userCourses.courses.map(c => ({ 
              id: c.id, 
              name: c.name, 
              normalized: c.name.replace(/\s+/g, '').toLowerCase() 
            }))
          }, 'Course search details');
          
          const foundCourse = userCourses.courses.find((course: { id: number; name: string }) => {
            const normalizedCourseName = course.name.replace(/\s+/g, '').toLowerCase();
            
            // Try exact match first
            if (normalizedCourseName === normalizedInput) {
              logger.info({ matchType: 'exact', course: course.name }, 'Course match found');
              return true;
            }
            
            // Try case-insensitive exact match
            if (course.name.toLowerCase() === userInput.toLowerCase()) {
              logger.info({ matchType: 'case-insensitive', course: course.name }, 'Course match found');
              return true;
            }
            
            // Try partial match (both ways)
            if (normalizedCourseName.includes(normalizedInput) || normalizedInput.includes(normalizedCourseName)) {
              logger.info({ matchType: 'partial', course: course.name }, 'Course match found');
              return true;
            }
            
            // Try contains match with original text
            if (course.name.toLowerCase().includes(userInput.toLowerCase()) || userInput.toLowerCase().includes(course.name.toLowerCase())) {
              logger.info({ matchType: 'contains', course: course.name }, 'Course match found');
              return true;
            }
            
            // Try matching course codes like "COSC304" vs "COSC 304"
            const courseCodeMatch = course.name.match(/([A-Z]+)\s*(\d+)/i);
            const inputCodeMatch = userInput.match(/([A-Z]+)\s*(\d+)/i);
            
            if (courseCodeMatch && inputCodeMatch) {
              const courseDept = courseCodeMatch[1].toLowerCase();
              const courseNum = courseCodeMatch[2];
              const inputDept = inputCodeMatch[1].toLowerCase();
              const inputNum = inputCodeMatch[2];
              
              if (courseDept === inputDept && courseNum === inputNum) {
                logger.info({ matchType: 'course-code', course: course.name }, 'Course match found');
                return true;
              }
            }
            
            return false;
          });
          
          if (foundCourse) {
            courseId = foundCourse.id;
            courseName = foundCourse.name;
          } else {
            await respond({
              text: `❌ Course "${userInput}" not found in your enrolled courses. Please use \`/courses\` to see your enrolled courses.`,
              response_type: 'ephemeral'
            });
            return;
          }
        }
      } else {
        // Use default course
        const defaultCourseId = await getDefaultCourse(teamId, slackUserId);
        if (!defaultCourseId) {
          await respond({
            text: '❌ No default course set. Please specify a course ID: `/chatbot-settings <course_id>` or set a default course with `/default-course`.',
            response_type: 'ephemeral'
          });
          return;
        }
        
        const foundCourse = userCourses.courses.find((course: { id: number; name: string }) => course.id === defaultCourseId);
        if (!foundCourse) {
          await respond({
            text: '❌ Your default course is not in your enrolled courses. Please set a new default course with `/default-course`.',
            response_type: 'ephemeral'
          });
          return;
        }
        
        courseId = foundCourse.id;
        courseName = foundCourse.name;
      }
      
      // Get chatbot settings for the course
      const settings = await chatbotService.getChatbotSettings(courseId, userToken);
      
      // Log the response for debugging
      logger.info({ 
        settingsType: typeof settings, 
        settingsKeys: settings && typeof settings === 'object' ? Object.keys(settings) : null,
        settingsPreview: settings ? JSON.stringify(settings).substring(0, 200) : null,
        courseId
      }, 'Settings API response');
      
      // Format the settings display
      let settingsText = `⚙️ **Chatbot Settings for Course ${courseId}${courseName ? ` (${courseName})` : ''}**\n\n`;
      
      if (settings && typeof settings === 'object' && 'metadata' in settings && settings.metadata) {
        const metadata = settings.metadata as any;
        
        // Show actual settings from the API response
        settingsText += `**Model:** ${metadata.modelName || metadata.model || 'Default'}\n`;
        settingsText += `**Temperature:** ${metadata.temperature || 'Default'}\n`;
        settingsText += `**Top K:** ${metadata.topK || 'Default'}\n`;
        settingsText += `**Similarity Threshold:** ${metadata.similarityThresholdDocuments || metadata.similarityThreshold || 'Default'}\n`;
        
        // Add any other relevant settings
        if (metadata.maxTokens) {
          settingsText += `**Max Tokens:** ${metadata.maxTokens}\n`;
        }
        if (metadata.topP) {
          settingsText += `**Top P:** ${metadata.topP}\n`;
        }
        settingsText += '\n';
        
        if (metadata.prompt) {
          const promptPreview = metadata.prompt.length > 200 
            ? metadata.prompt.substring(0, 200) + '...' 
            : metadata.prompt;
          settingsText += `**Prompt:** ${promptPreview}\n\n`;
        }
      } else if (settings && typeof settings === 'object') {
        // Handle different response formats
        const settingsObj = settings as any;
        settingsText += `**Response Format:** ${Object.keys(settingsObj).join(', ')}\n`;
        settingsText += `**Content:** ${settingsObj.pageContent || 'No content'}\n\n`;
        settingsText += '*Settings format may be different than expected. Contact your administrator.*\n\n';
      } else {
        settingsText += '*Using default settings*\n\n';
      }
      
      settingsText += `*To update settings, use the HelpMe web interface or contact your course administrator.*`;
      
      await respond({
        text: settingsText,
        response_type: 'ephemeral'
      });
      
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ err: msg, userId: slackUserId, teamId }, 'Error in chatbot settings command');
      
      if (msg.includes('not linked')) {
        await respond({
          text: '❌ You need to link your account first. Run `/link` to get started.',
          response_type: 'ephemeral'
        });
      } else if (msg.includes('404') || msg.includes('Not Found')) {
        await respond({
          text: `❌ Course not found or you don't have access to course settings.`,
          response_type: 'ephemeral'
        });
      } else {
        await respond({
          text: `❌ Sorry, I encountered an error while fetching settings: ${msg}`,
          response_type: 'ephemeral'
        });
      }
    }
  });
}
