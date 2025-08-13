import axios, { AxiosInstance } from 'axios';
import type { Logger } from 'pino';

export class ChatbotClient {
  private http: AxiosInstance;

  constructor(private logger: Logger) {
    this.http = axios.create({
      baseURL: process.env.CHATBOT_API_URL,
      timeout: Number(process.env.CHATBOT_TIMEOUT_MS || 30000),
      headers: { 'HMS-API-KEY': process.env.CHATBOT_API_KEY || '' },
    });
  }

  async ask(params: {
    question: string;
    courseId: number;
    idempotencyKey: string;
    userToken?: string;
    slackTeamId?: string;
    slackUserId?: string;
  }) {
    try {
      const headers: Record<string, string> = {
        'Idempotency-Key': params.idempotencyKey,
      };
      if (process.env.CHATBOT_API_KEY) headers['HMS-API-KEY'] = process.env.CHATBOT_API_KEY;
      if (params.userToken) headers['HMS_API_TOKEN'] = params.userToken;
      // Slack headers no longer used since backend Slack route was removed
      const path = `/chatbot/${params.courseId}/ask`;

      const res = await this.http.post(
        path,
        {
          question: params.question,
          history: [],
          source: 'slack',
           // Optional metadata
           slackUserId: params.slackUserId,
           slackTeamId: params.slackTeamId,
        },
        { headers },
      );
      return res.data as { answer?: string };
    } catch (err: any) {
      const code = err?.response?.status ?? 500;
      const body = err?.response?.data;
      const msg = body?.error || body?.message || err.message || 'Unknown error';
      const resetAt = body?.resetAt;
      const shaped = { code, msg, resetAt };
      this.logger.warn({ shaped }, 'ChatBot error');
      throw Object.assign(new Error(msg), shaped);
    }
  }
}


