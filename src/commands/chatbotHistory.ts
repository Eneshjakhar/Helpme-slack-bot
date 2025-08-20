import type { App } from '@slack/bolt';
import type { Logger } from 'pino';
import { ChatbotService } from '../services/chatbot.service.js';

export function registerChatbotHistoryCommand(app: App, logger: Logger): void {
  app.command('/chatbot-history', async ({ ack, body, respond }) => {
    await ack();
    
    const slackUserId = body.user_id;
    const teamId = body.team_id;
    
    logger.info({ userId: slackUserId, teamId }, 'Chatbot history command received');
    
    try {
      // Get user info and validate they're linked
      const chatbotService = new ChatbotService();
      const userInfo = await chatbotService.getUserInfo(teamId, slackUserId);
      
      // Get all interactions for the user
      const interactions = await chatbotService.getAllInteractionsForUser(teamId, slackUserId);
      
      if (interactions.length === 0) {
        await respond({
          text: '📝 No chatbot history found. Try asking a question with `/ask` to get started!',
          response_type: 'ephemeral'
        });
        return;
      }
      
      // Format the history (limit to last 10 interactions to avoid message length limits)
      const recentInteractions = interactions.slice(0, 10);
      let historyText = `📝 **Your Recent Chatbot History** (showing last ${recentInteractions.length} interactions):\n\n`;
      
      for (const interaction of recentInteractions) {
        const date = new Date(interaction.timestamp).toLocaleDateString();
        const time = new Date(interaction.timestamp).toLocaleTimeString();
        
        historyText += `**${date} at ${time}** (Course ID: ${interaction.questions?.[0]?.metadata?.courseId || 'Unknown'})\n`;
        
        if (interaction.questions && interaction.questions.length > 0) {
          for (const question of interaction.questions) {
            const questionText = question.pageContent.length > 100 
              ? question.pageContent.substring(0, 100) + '...' 
              : question.pageContent;
            
            historyText += `• **Q:** ${questionText}\n`;
            
            if (question.metadata?.answer) {
              const answerText = question.metadata.answer.length > 150 
                ? question.metadata.answer.substring(0, 150) + '...' 
                : question.metadata.answer;
              historyText += `  **A:** ${answerText}\n`;
            }
          }
        }
        historyText += '\n';
      }
      
      if (interactions.length > 10) {
        historyText += `*... and ${interactions.length - 10} more interactions. Use \`/ask\` to continue chatting!*`;
      }
      
      await respond({
        text: historyText,
        response_type: 'ephemeral'
      });
      
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ err: msg, userId: slackUserId, teamId }, 'Error in chatbot history command');
      
      if (msg.includes('not linked')) {
        await respond({
          text: '❌ You need to link your account first. Run `/link` to get started.',
          response_type: 'ephemeral'
        });
      } else {
        await respond({
          text: `❌ Sorry, I encountered an error while fetching your history: ${msg}`,
          response_type: 'ephemeral'
        });
      }
    }
  });
}
