import { App, LogLevel } from '@slack/bolt';
import { ChatbotService } from '../services/chatbot.service.js';
import { getDefaultCourse } from '../db/index.js';

export function registerChatbotThreadCommand(app: App, logger: any) {
  // Handle /chatbot-thread command for threaded conversations
  app.command('/chatbot-thread', async ({ command, ack, respond, client }) => {
    await ack();

    const slackUserId = command.user_id;
    const teamId = command.team_id;
    const question = command.text;
    const threadTs = command.thread_ts || command.ts; // Use thread timestamp if in thread, otherwise use command timestamp

    if (!question) {
      await respond({
        text: '❌ Please provide a question. Usage: `/chatbot-thread <your question>`',
        response_type: 'ephemeral'
      });
      return;
    }

    try {
      // Check if user is linked
      const chatbotService = new ChatbotService();
      const userInfo = await chatbotService.getUserInfo(teamId, slackUserId);
      
      if (!userInfo.helpmeUserChatToken) {
        await respond({
          text: '❌ You need to link your account first. Run `/link` to get started.',
          response_type: 'ephemeral'
        });
        return;
      }

      // Get user's default course
      const defaultCourseId = await getDefaultCourse(teamId, slackUserId);
      if (!defaultCourseId) {
        await respond({
          text: '❌ No default course set. Please set a default course with `/default-course`.',
          response_type: 'ephemeral'
        });
        return;
      }

      // Get conversation history from the thread
      const history = await getThreadHistory(client, command.channel_id, threadTs);
      
      logger.info({ 
        threadTs, 
        historyLength: history.length,
        question: question.substring(0, 50) + '...'
      }, 'Processing threaded chatbot question');

      // Ask question with history
      const result = await chatbotService.askQuestion(
        question,
        history,
        userInfo.helpmeUserChatToken,
        defaultCourseId,
        teamId,
        slackUserId
      );

      // Post response in thread
      try {
        await client.chat.postMessage({
          channel: command.channel_id,
          thread_ts: threadTs,
          text: `🤖 **AI Response:**\n\n${result.chatbotResponse.answer}`
        });
      } catch (postError) {
        // If posting to channel fails, respond directly to user
        logger.warn({ postError, channelId: command.channel_id }, 'Failed to post in channel, responding directly');
        await respond({
          text: `🤖 **AI Response:**\n\n${result.chatbotResponse.answer}`,
          response_type: 'ephemeral'
        });
      }

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ err: msg, userId: slackUserId, teamId }, 'Error in chatbot thread command');

      await respond({
        text: `❌ Error: ${msg}`,
        response_type: 'ephemeral'
      });
    }
  });
}

// Helper function to get conversation history from a Slack thread
async function getThreadHistory(client: any, channelId: string, threadTs: string): Promise<any[]> {
  try {
    // Get thread replies
    const threadResponse = await client.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: 50 // Limit to last 50 messages
    });

    if (!threadResponse.ok || !threadResponse.messages) {
      return [];
    }

    // Filter and format messages for chatbot history
    const history = threadResponse.messages
      .filter((msg: any) => {
        // Skip bot messages and the original command
        return !msg.bot_id && !msg.text?.startsWith('/chatbot-thread');
      })
      .map((msg: any) => ({
        role: msg.user ? 'user' : 'assistant',
        content: msg.text || '',
        timestamp: msg.ts
      }))
      .slice(-10); // Keep last 10 messages to avoid context overflow

    return history;
  } catch (error) {
    console.error('Error getting thread history:', error);
    return [];
  }
}
