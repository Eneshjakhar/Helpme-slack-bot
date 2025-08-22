import { 
  createChatbotInteraction,
  createChatbotQuestion,
  getChatbotInteractionsForUser,
  getChatbotQuestionsForInteraction,
  updateChatbotQuestionScore,
  getChatbotInteractionsForCourse,
  getUserLinkInfo,
  getDefaultCourse,
  InteractionResponse,
  ChatbotQuestionResponseChatbotDB,
  ChatbotAskResponseChatbotDB,
  StoredUserLink
} from '../db/index.js';

export class ChatbotService {
  private readonly chatbotApiUrl: string;
  private readonly chatbotApiKey: string;

  constructor() {
    this.chatbotApiUrl = process.env.CHATBOT_API_URL || 'http://localhost:3003/chat';
    this.chatbotApiKey = process.env.CHATBOT_API_KEY || '';
  }

  /**
   * Makes an authenticated request to the chatbot service
   */
  private async makeChatbotRequest(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    endpoint: string,
    userToken: string,
    data?: any,
    timeoutMs?: number,
  ) {
    try {
      const url = new URL(`${this.chatbotApiUrl}/${endpoint}`);
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'HMS-API-KEY': this.chatbotApiKey,
        'HMS_API_TOKEN': userToken,
      };

      const response = await fetch(url, {
        method,
        headers,
        body: data ? JSON.stringify(data) : undefined,
        signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error((error as any).error || `HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Failed to connect to chatbot service');
    }
  }

  /**
   * Creates a new interaction for a user and course
   */
  async createInteraction(
    courseId: number,
    teamId: string,
    userId: string,
  ): Promise<InteractionResponse> {
    const interaction = await createChatbotInteraction({
      courseId,
      teamId,
      userId,
    });

    return {
      id: interaction.id,
      timestamp: new Date(interaction.createdAt),
      questions: []
    };
  }

  /**
   * Creates a new question in the database
   */
  async createQuestion(data: {
    interactionId: number;
    questionText: string;
    responseText: string;
    vectorStoreId: string;
    suggested?: boolean;
    isPreviousQuestion?: boolean;
  }): Promise<ChatbotQuestionResponseChatbotDB> {
    const question = await createChatbotQuestion(data);

    return {
      id: question.vectorStoreId,
      pageContent: question.questionText,
      metadata: {
        answer: question.responseText,
        timestamp: question.createdAt,
        courseId: '1', // Will be updated when we have course info
        verified: false,
        sourceDocuments: [],
        suggested: question.suggested,
        inserted: true
      }
    };
  }

  /**
   * Gets all interactions and questions for a course
   */
  async getInteractionsAndQuestions(courseId: number): Promise<InteractionResponse[]> {
    const interactions = await getChatbotInteractionsForCourse(courseId);
    
    const result: InteractionResponse[] = [];
    
    for (const interaction of interactions) {
      const questions = await getChatbotQuestionsForInteraction(interaction.id);
      const questionResponses: ChatbotQuestionResponseChatbotDB[] = questions.map(q => ({
        id: q.vectorStoreId,
        pageContent: q.questionText,
        metadata: {
          answer: q.responseText,
          timestamp: q.createdAt,
          courseId: courseId.toString(),
          verified: false,
          sourceDocuments: [],
          suggested: q.suggested,
          inserted: true
        }
      }));

      result.push({
        id: interaction.id,
        timestamp: new Date(interaction.createdAt),
        questions: questionResponses
      });
    }

    return result;
  }

  /**
   * Gets all interactions for a specific user
   */
  async getAllInteractionsForUser(teamId: string, userId: string): Promise<InteractionResponse[]> {
    const interactions = await getChatbotInteractionsForUser(teamId, userId);
    
    const result: InteractionResponse[] = [];
    
    for (const interaction of interactions) {
      const questions = await getChatbotQuestionsForInteraction(interaction.id);
      const questionResponses: ChatbotQuestionResponseChatbotDB[] = questions.map(q => ({
        id: q.vectorStoreId,
        pageContent: q.questionText,
        metadata: {
          answer: q.responseText,
          timestamp: q.createdAt,
          courseId: interaction.courseId.toString(),
          verified: false,
          sourceDocuments: [],
          suggested: q.suggested,
          inserted: true
        }
      }));

      result.push({
        id: interaction.id,
        timestamp: new Date(interaction.createdAt),
        questions: questionResponses
      });
    }

    return result;
  }

  /**
   * Updates a question's user score
   */
  async updateQuestionUserScore(questionId: number, userScore: number) {
    const question = await updateChatbotQuestionScore(questionId, userScore);
    if (!question) {
      throw new Error('Question not found');
    }
    return question;
  }

  /**
   * Asks a question to the chatbot and stores the interaction
   */
  async askQuestion(
    question: string,
    history: any[],
    userToken: string,
    courseId: number,
    teamId: string,
    userId: string,
    interactionId?: number,
  ): Promise<{
    chatbotResponse: ChatbotAskResponseChatbotDB;
    interactionId: number;
    questionId: number;
  }> {
    // Make the API call to the chatbot
    const chatbotResponse = await this.makeChatbotRequest('POST', `chatbot/${courseId}/ask`, userToken, {
      question,
      history,
    }) as ChatbotAskResponseChatbotDB;

    // Create or use existing interaction
    let interaction: any;
    if (!interactionId) {
      interaction = await this.createInteraction(courseId, teamId, userId);
      interactionId = interaction.id;
    }

    // Store the question and response in our database
    const questionEntity = await this.createQuestion({
      interactionId: interactionId!,
      questionText: question,
      responseText: chatbotResponse.answer,
      vectorStoreId: chatbotResponse.questionId,
      suggested: false,
      isPreviousQuestion: chatbotResponse.isPreviousQuestion || false,
    });

    return {
      chatbotResponse,
      interactionId: interactionId!,
      questionId: Number(questionEntity.id),
    };
  }

  /**
   * Gets user information and validates they have a chat token
   */
  async getUserInfo(teamId: string, userId: string): Promise<StoredUserLink> {
    const userInfo = await getUserLinkInfo(teamId, userId);
    if (!userInfo) {
      throw new Error('User not linked. Please run `/link` to connect your account.');
    }
    if (!userInfo.helpmeUserChatToken) {
      throw new Error('User chat token not found. Please re-link your account.');
    }
    return userInfo;
  }

  /**
   * Gets the default course for a user
   */
  async getDefaultCourse(teamId: string, userId: string): Promise<number | null> {
    return await getDefaultCourse(teamId, userId);
  }

  /**
   * Validates that a user has a valid chat token
   */
  validateUserToken(user: StoredUserLink): void {
    if (!user.helpmeUserChatToken) {
      throw new Error('User has no chat token. Please re-link your account.');
    }
  }

  /**
   * Gets chatbot settings for a course
   */
  async getChatbotSettings(courseId: number, userToken: string) {
    return await this.makeChatbotRequest('GET', `course-setting/${courseId}`, userToken);
  }

  /**
   * Updates chatbot settings for a course
   */
  async updateChatbotSettings(settings: any, courseId: number, userToken: string) {
    return await this.makeChatbotRequest('PATCH', `course-setting/${courseId}`, userToken, settings);
  }

  /**
   * Resets chatbot settings for a course
   */
  async resetChatbotSettings(courseId: number, userToken: string) {
    return await this.makeChatbotRequest('PATCH', `course-setting/${courseId}/reset`, userToken);
  }

  /**
   * Gets all questions for a course
   */
  async getAllQuestions(courseId: number, userToken: string): Promise<ChatbotQuestionResponseChatbotDB[]> {
    return await this.makeChatbotRequest('GET', `question/${courseId}/all`, userToken) as ChatbotQuestionResponseChatbotDB[];
  }

  /**
   * Adds a new question to the chatbot
   */
  async addQuestion(questionData: any, courseId: number, userToken: string): Promise<ChatbotQuestionResponseChatbotDB> {
    return await this.makeChatbotRequest('POST', `question/${courseId}`, userToken, questionData) as ChatbotQuestionResponseChatbotDB;
  }

  /**
   * Updates an existing question
   */
  async updateQuestion(questionData: any, courseId: number, userToken: string): Promise<ChatbotQuestionResponseChatbotDB> {
    return await this.makeChatbotRequest('PATCH', `question/${courseId}/${questionData.id}`, userToken, questionData) as ChatbotQuestionResponseChatbotDB;
  }

  /**
   * Deletes a question
   */
  async deleteQuestion(questionId: string, courseId: number, userToken: string) {
    return await this.makeChatbotRequest('DELETE', `question/${courseId}/${questionId}`, userToken);
  }

  /**
   * Gets available models
   */
  async getModels(userToken: string) {
    return await this.makeChatbotRequest('GET', 'chatbot/models', userToken);
  }
}
