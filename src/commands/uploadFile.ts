import type { App } from '@slack/bolt';
import type { Logger } from 'pino';
import { ChatbotService } from '../services/chatbot.service.js';
import { isUserLinked, getDefaultCourse } from '../db/index.js';
import axios from 'axios';

export function registerUploadFileCommand(app: App, logger: Logger): void {
  app.command('/upload-file', async ({ ack, body, client }) => {
    await ack();
    
    const slackUserId = body.user_id;
    const teamId = body.team_id;
    const text = body.text || '';
    
    logger.info({ userId: slackUserId, teamId, text }, 'Upload file command received');
    
    // Check if user is linked
    const isLinked = await isUserLinked(teamId, slackUserId);
    if (!isLinked) {
      await client.chat.postMessage({
        channel: slackUserId,
        text: '❌ You need to link your account first. Run `/link` to get started.'
      });
      return;
    }
    
    // Get user's default course
    const defaultCourseId = await getDefaultCourse(teamId, slackUserId);
    if (!defaultCourseId) {
      await client.chat.postMessage({
        channel: slackUserId,
        text: '❌ No default course set. Please set a default course with `/default-course` first.'
      });
      return;
    }
    
    // Open a modal for file upload
    logger.info({ userId: slackUserId, teamId, triggerId: body.trigger_id }, 'Attempting to open modal');
    try {
      await client.views.open({
        trigger_id: body.trigger_id,
        view: {
          type: 'modal',
          callback_id: 'upload_file_modal',
          title: {
            type: 'plain_text',
            text: 'Upload File for AI'
          },
          submit: {
            type: 'plain_text',
            text: 'Analyze File'
          },
          close: {
            type: 'plain_text',
            text: 'Cancel'
          },
          blocks: [
            {
              type: 'input',
              block_id: 'question_block',
              label: {
                type: 'plain_text',
                text: 'What would you like to know about this file?'
              },
              element: {
                type: 'plain_text_input',
                action_id: 'question_input',
                placeholder: {
                  type: 'plain_text',
                  text: 'e.g., What\'s in this image?'
                },
                multiline: true
              }
            },
            {
              type: 'input',
              block_id: 'file_block',
              label: {
                type: 'plain_text',
                text: 'Upload File'
              },
              element: {
                type: 'file_input',
                action_id: 'file_input',
                filetypes: ['png', 'jpg', 'jpeg', 'gif', 'pdf']
              }
            }
          ]
        }
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ err: msg, userId: slackUserId, teamId }, 'Error opening upload modal');
      
      // Fallback 
      await client.chat.postMessage({
        channel: slackUserId,
        text: `📁 **File Upload Instructions:**

**Step 1:** Upload your file to this channel (drag & drop or use paperclip)

**Step 2:** Run this command with your question:
\`/upload-file What's in this image?\`

**Supported file types:** PNG, JPEG, JPG, GIF, PDF

**Example:** \`/upload-file Analyze this diagram\`

*Note: The file must be uploaded to this channel first, then run the command with your question.*`
      });
    }
  });
  
  // Handle modal submission
  app.view('upload_file_modal', async ({ ack, view, body, client }) => {
    await ack();
    
    const slackUserId = body.user.id;
    const teamId = body.team?.id || '';
    const question = view.state.values.question_block.question_input.value || 'What\'s in this file?';
    const fileId = view.state.values.file_block.file_input.files?.[0]?.id;
    
    if (!fileId) {
      await client.chat.postMessage({
        channel: slackUserId,
        text: '❌ No file selected. Please try again.'
      });
      return;
    }
    
    try {
      // Get file info
      const fileInfo = await client.files.info({ file: fileId });
      const file = fileInfo.file;
      
      if (!file) {
        await client.chat.postMessage({
          channel: slackUserId,
          text: '❌ Could not retrieve file information.'
        });
        return;
      }
      
      // Check if file type is supported
      const supportedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'application/pdf'];
      if (!file.mimetype || !supportedTypes.includes(file.mimetype)) {
        await client.chat.postMessage({
          channel: slackUserId,
          text: `❌ File type not supported. Supported types: ${supportedTypes.join(', ')}`
        });
        return;
      }
      
      // Download file
      const fileUrl = file.url_private_download;
      if (!fileUrl) {
        await client.chat.postMessage({
          channel: slackUserId,
          text: '❌ Could not access file URL.'
        });
        return;
      }
      
      const fileResponse = await axios.get(fileUrl, {
        headers: {
          'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`
        },
        responseType: 'arraybuffer'
      });
      
      // Convert to base64
      const base64File = Buffer.from(fileResponse.data).toString('base64');
      
      // Get user's default course
      const defaultCourseId = await getDefaultCourse(teamId, slackUserId);
      
    // Create form data for file upload as suggested by chatbot repo
      const chatbotApiUrl = process.env.CHATBOT_API_URL || 'http://localhost:3003/chat';
      const chatbotApiKey = process.env.CHATBOT_API_KEY || '';
      
      // Get user token for authentication
      const chatbotService = new ChatbotService();
      const userInfo = await chatbotService.getUserInfo(teamId, slackUserId);
      
      const { default: FormData } = await import('form-data');
      const formData = new FormData();
      formData.append('question', question);
      formData.append('history', JSON.stringify([]));
      
      // Add the file 
      const buffer = Buffer.from(base64File, 'base64');
      formData.append('file', buffer, {
        filename: file.name || 'unknown_file',
        contentType: file.mimetype
      });
      
      const formHeaders = formData.getHeaders();
      
      logger.info({ 
        token: userInfo.helpmeUserChatToken ? 'present' : 'missing',
        tokenLength: userInfo.helpmeUserChatToken?.length || 0
      }, 'Token info for file upload');
      
      // Try different header format - some APIs expect different casing
      const headers = {
        ...formHeaders,
        'HMS-API-KEY': chatbotApiKey,
        'HMS-API-TOKEN': userInfo.helpmeUserChatToken,
        'HMS_API_TOKEN': userInfo.helpmeUserChatToken, // Try underscore version too
        'hms-api-token': userInfo.helpmeUserChatToken, // Try lowercase version
        'X-Slack-User-Id': slackUserId,
        'X-Slack-Team-Id': teamId,
      };
      
      logger.info({ 
        headers: Object.keys(headers),
        tokenValue: userInfo.helpmeUserChatToken
      }, 'Headers being sent');
      
      const chatbotResponse = await axios.post(`${chatbotApiUrl}/chatbot/${defaultCourseId || 1}/ask`, formData, {
        headers,
        timeout: 30000 // 30 second timeout for file processing
      }).catch(error => {
        // Log the actual error response
        if (error.response) {
          logger.error({ 
            status: error.response.status, 
            data: error.response.data,
            headers: error.response.headers 
          }, 'Chatbot API error response');
        }
        throw error;
      });
      
      const result = chatbotResponse.data as { answer: string };
      
      // Post response
      await client.chat.postEphemeral({
        channel: slackUserId,
        user: slackUserId,
        text: `🤖 **AI Analysis of ${file.name || 'file'}:**\n\n${result.answer}`
      });
      
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ err: msg, userId: slackUserId, teamId }, 'Error processing file upload');
      
      await client.chat.postEphemeral({
        channel: slackUserId,
        user: slackUserId,
        text: `❌ Error processing file: ${msg}`
      });
    }
  });
}
