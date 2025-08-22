import type { App } from '@slack/bolt';
import type { Logger } from 'pino';
import { ChatbotService } from '../services/chatbot.service.js';

export function registerChatbotModelsCommand(app: App, logger: Logger): void {
  app.command('/chatbot-models', async ({ ack, body, respond }) => {
    await ack();
    
    const slackUserId = body.user_id;
    const teamId = body.team_id;
    
    logger.info({ userId: slackUserId, teamId }, 'Chatbot models command received');
    
    try {
      // Get user info and validate they're linked
      const chatbotService = new ChatbotService();
      const userInfo = await chatbotService.getUserInfo(teamId, slackUserId);
      const userToken = userInfo.helpmeUserChatToken || '';
      
      // Get available models
      const models = await chatbotService.getModels(userToken);
      
      // Log the response for debugging
      logger.info({ 
        modelsType: typeof models, 
        modelsKeys: models && typeof models === 'object' ? Object.keys(models) : null,
        modelsPreview: models ? JSON.stringify(models).substring(0, 200) : null
      }, 'Models API response');
      
      // Show what we get from the chatbot API
      let modelsText = `🤖 **Available AI Models**\n\n`;
      
      if (models && typeof models === 'object') {
        for (const [key, value] of Object.entries(models)) {
          modelsText += `• **${key}:** ${value}\n`;
        }
      } else {
        modelsText += `*No models available*`;
      }
      
      modelsText += `\n*To change the model for a course, use the HelpMe web interface or contact your course administrator.*`;
      
      await respond({
        text: modelsText,
        response_type: 'ephemeral'
      });
      
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ err: msg, userId: slackUserId, teamId }, 'Error in chatbot models command');
      
      if (msg.includes('not linked')) {
        await respond({
          text: 'You need to link your account first. Run `/link` to get started.',
          response_type: 'ephemeral'
        });
      } else {
        await respond({
          text: `Sorry, I encountered an error while fetching models: ${msg}`,
          response_type: 'ephemeral'
        });
      }
    }
  });
}
