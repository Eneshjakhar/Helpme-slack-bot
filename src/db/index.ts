import type { Logger } from 'pino';
import { DataSource } from 'typeorm';
import { LinkEntity, LinkStateEntity, UserCoursesEntity, UserLinkEntity, UserPrefsEntity, ChatbotInteractionEntity, ChatbotQuestionEntity } from './entities.js';

let dataSource: any = null;

export async function getDatabaseConnection(): Promise<any> {
  if (!dataSource) throw new Error('db not initialized');
  return dataSource;
}

export async function ensureDb(logger: Logger): Promise<void> {
  const dbPath = process.env.DATABASE_PATH || './data/data.db';
  try {
    dataSource = new DataSource({
      type: 'sqlite',
      database: dbPath,
      synchronize: true,
      logging: false,
      entities: [LinkEntity, UserLinkEntity, LinkStateEntity, UserCoursesEntity, UserPrefsEntity, ChatbotInteractionEntity, ChatbotQuestionEntity],
    });
    await dataSource.initialize();
    logger.info({ path: dbPath }, 'DB ready');
  } catch (e: any) {
    logger.error({ err: e?.message || e, path: dbPath }, 'DB init failed');
    throw e;
  }
}

export async function saveLink(teamId: string, userId: string, p: { helpmeUserChatToken: string | null }): Promise<void> {
  if (!dataSource) throw new Error('db not initialized');
  const repo = dataSource.getRepository(LinkEntity);
  const row = new LinkEntity();
  row.teamId = teamId;
  row.userId = userId;
  row.createdAt = new Date().toISOString();
  await repo.save(row);
}


export type LinkState = {
  stateId: string;
  teamId: string;
  userId: string;
  channelId?: string | null;
  redirectUri?: string | null;
  createdAt: string;
  expiresAt: string;
};

export async function createLinkState(params: {
  stateId: string;
  teamId: string;
  userId: string;
  channelId?: string | null;
  redirectUri?: string | null;
  ttlSeconds?: number;
}): Promise<LinkState> {
  if (!dataSource) throw new Error('db not initialized');
  const repo = dataSource.getRepository(LinkStateEntity);
  const now = new Date();
  const ttl = Math.max(1, Number(params.ttlSeconds ?? 600));
  const expires = new Date(now.getTime() + ttl * 1000);
  const entity = new LinkStateEntity();
  entity.stateId = params.stateId;
  entity.teamId = params.teamId;
  entity.userId = params.userId;
  entity.channelId = params.channelId ?? null;
  entity.redirectUri = params.redirectUri ?? null;
  entity.createdAt = now.toISOString();
  entity.expiresAt = expires.toISOString();
  await repo.save(entity);
  return { stateId: entity.stateId, teamId: entity.teamId, userId: entity.userId, channelId: entity.channelId, redirectUri: entity.redirectUri, createdAt: entity.createdAt, expiresAt: entity.expiresAt };
}

export async function consumeLinkState(stateId: string): Promise<LinkState | null> {
  if (!dataSource) throw new Error('db not initialized');
  const repo = dataSource.getRepository(LinkStateEntity);
  const row = await repo.findOne({ where: { stateId } });
  if (!row) return null;
  await repo.delete({ stateId });
  const now = new Date();
  if (new Date(row.expiresAt).getTime() < now.getTime()) return null;
  return { stateId: row.stateId, teamId: row.teamId, userId: row.userId, channelId: row.channelId, redirectUri: row.redirectUri, createdAt: row.createdAt, expiresAt: row.expiresAt };
}

export async function saveUserLink(params: { teamId: string; userId: string; helpmeUserId: number; helpmeEmail: string; helpmeName: string; organizationId: number | null; helpmeUserChatToken?: string | null; }): Promise<void> {
  if (!dataSource) throw new Error('db not initialized');
  const repo = dataSource.getRepository(UserLinkEntity);
  const row = await repo.findOne({ where: { teamId: params.teamId, userId: params.userId } }) ?? new UserLinkEntity();
  row.teamId = params.teamId;
  row.userId = params.userId;
  row.helpmeUserId = params.helpmeUserId;
  row.helpmeEmail = params.helpmeEmail;
  row.helpmeName = params.helpmeName;
  row.organizationId = params.organizationId;
  if (typeof params.helpmeUserChatToken !== 'undefined') row.helpmeUserChatToken = params.helpmeUserChatToken;
  row.updatedAt = new Date().toISOString();
  if (!row.createdAt) row.createdAt = new Date().toISOString();
  await repo.save(row);
}

export async function saveUserCourses(params: { teamId: string; userId: string; courses: Array<{ id: number; name: string }>; fetchedAt?: Date; }): Promise<void> {
  if (!dataSource) throw new Error('db not initialized');
  const repo = dataSource.getRepository(UserCoursesEntity);
  const row = (await repo.findOne({ where: { teamId: params.teamId, userId: params.userId } })) ?? new UserCoursesEntity();
  row.teamId = params.teamId;
  row.userId = params.userId;
  row.coursesJson = JSON.stringify(params.courses ?? []);
  row.fetchedAt = (params.fetchedAt ?? new Date()).toISOString();
  await repo.save(row);
}

export type StoredUserLink = { teamId: string; userId: string; helpmeUserId: number; helpmeEmail: string; helpmeName: string; organizationId: number | null; helpmeUserChatToken: string | null; createdAt: string; updatedAt: string; };

export async function getUserLinkInfo(teamId: string, userId: string): Promise<StoredUserLink | null> {
  if (!dataSource) throw new Error('db not initialized');
  const repo = dataSource.getRepository(UserLinkEntity);
  const row = await repo.findOne({ where: { teamId, userId } });
  if (!row) return null;
  return { teamId: row.teamId, userId: row.userId, helpmeUserId: row.helpmeUserId, helpmeEmail: row.helpmeEmail, helpmeName: row.helpmeName, helpmeUserChatToken: row.helpmeUserChatToken ?? null, organizationId: row.organizationId ?? null, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export async function isUserLinked(teamId: string, userId: string): Promise<boolean> {
  if (!dataSource) throw new Error('db not initialized');
  const repo = dataSource.getRepository(UserLinkEntity);
  const row = await repo.findOne({ where: { teamId, userId } });
  return row !== null;
}

export async function deleteUserLink(teamId: string, userId: string): Promise<void> {
  if (!dataSource) throw new Error('db not initialized');
  const repo = dataSource.getRepository(UserLinkEntity);
  await repo.delete({ teamId, userId });
}

export async function getUserLinkData(teamId: string, userId: string): Promise<StoredUserLink | null> {
  return await getUserLinkInfo(teamId, userId);
}

export async function getUserCourses(teamId: string, userId: string): Promise<{ courses: Array<{ id: number; name: string }>; fetchedAt: string } | null> {
  if (!dataSource) throw new Error('db not initialized');
  const repo = dataSource.getRepository(UserCoursesEntity);
  const row = await repo.findOne({ where: { teamId, userId } });
  if (!row) return null;
  return { courses: JSON.parse(row.coursesJson || '[]'), fetchedAt: row.fetchedAt };
}

export async function setDefaultCourse(teamId: string, userId: string, courseId: number): Promise<void> {
  if (!dataSource) throw new Error('db not initialized');
  const repo = dataSource.getRepository(UserPrefsEntity);
  const row = (await repo.findOne({ where: { teamId, userId } })) ?? new UserPrefsEntity();
  row.teamId = teamId;
  row.userId = userId;
  row.defaultCourseId = courseId;
  row.updatedAt = new Date().toISOString();
  if (!row.createdAt) row.createdAt = new Date().toISOString();
  await repo.save(row);
}

export async function getDefaultCourse(teamId: string, userId: string): Promise<number | null> {
  if (!dataSource) throw new Error('db not initialized');
  const repo = dataSource.getRepository(UserPrefsEntity);
  const row = await repo.findOne({ where: { teamId, userId } });
  if (!row) return null;
  const v = Number(row.defaultCourseId);
  return Number.isFinite(v) && v > 0 ? v : null;
}


// comes from chatbot db
export interface ChatbotQuestionResponseChatbotDB {
  id: string
  pageContent: string // this is the question
  metadata: {
    answer: string
    timestamp?: string 
    courseId: string
    verified: boolean
    sourceDocuments: SourceDocument[]
    suggested: boolean
    inserted?: boolean
  }
  userScoreTotal?: number
  timesAsked?: number 
  interactionsWithThisQuestion?: InteractionResponse[] 
}

interface Loc {
  pageNumber: number
}

// source document return type (from chatbot db)
export interface SourceDocument {
  id?: string
  metadata?: {
    loc?: Loc
    name: string
    type?: string
    source?: string
    courseId?: string
    fromLMS?: boolean
    apiDocId?: number
  }
  type?: string
  content?: string
  pageContent: string
  docName: string
  docId?: string // no idea if this exists in the actual data EDIT: yes it does, sometimes
  pageNumbers?: number[] 
  pageNumbersString?: string 
  sourceLink?: string
  pageNumber?: number
  key?: string 
}

export interface PreDeterminedQuestion {
  id: string
  pageContent: string
  metadata: {
    answer: string
    courseId: string
    inserted: boolean
    sourceDocuments: SourceDocument[]
    suggested: boolean
    verified: boolean
  }
}

export interface Message {
  type: 'apiMessage' | 'userMessage'
  message: string | void
  verified?: boolean
  sourceDocuments?: SourceDocument[]
  questionId?: string
  thinkText?: string | null
}

export interface ChatbotQueryParams {
  query: string
  type: 'default' | 'abstract'
}

export interface ChatbotAskParams {
  question: string
  history: Message[]
  interactionId?: number
  onlySaveInChatbotDB?: boolean
}

export interface ChatbotAskSuggestedParams {
  question: string
  responseText: string
  vectorStoreId: string
}

export interface AddDocumentChunkParams {
  documentText: string
  metadata: {
    name: string
    type: string
    source?: string
    loc?: Loc
    id?: string
    courseId?: number
  }
  prefix?: string
}

export interface AddDocumentAggregateParams {
  name: string
  source: string
  documentText: string
  metadata?: any
  prefix?: string
}

export interface UpdateDocumentAggregateParams {
  documentText: string
  metadata?: any
  prefix?: string
}

export interface UpdateChatbotQuestionParams {
  id: string
  inserted?: boolean
  sourceDocuments?: SourceDocument[]
  question?: string
  answer?: string
  verified?: boolean
  suggested?: boolean
  selectedDocuments?: {
    docId: string
    pageNumbersString: string
  }[]
}

// this is the response from the backend when new questions are asked
// if question is I don't know, only answer and questionId are returned
export interface ChatbotAskResponse {
  chatbotRepoVersion: ChatbotAskResponseChatbotDB
  helpmeRepoVersion: ChatbotQuestionResponseChatbotDB | null
}

// comes from /ask from chatbot db
export interface ChatbotAskResponseChatbotDB {
  question: string
  answer: string
  questionId: string
  interactionId: number
  sourceDocuments?: SourceDocument[]
  verified: boolean
  courseId: string
  isPreviousQuestion: boolean
}

export interface AddChatbotQuestionParams {
  question: string
  answer: string
  verified: boolean
  suggested: boolean
  sourceDocuments: SourceDocument[]
}

export interface ChatbotSettings {
  id: string
  AvailableModelTypes: Record<string, string>
  pageContent: string
  metadata: ChatbotSettingsMetadata
}

export interface ChatbotSettingsMetadata {
  modelName: string
  prompt: string
  similarityThresholdDocuments: number
  temperature: number
  topK: number
}
export interface ChatbotSettingsUpdateParams {
  modelName?: string
  prompt?: string
  similarityThresholdDocuments?: number
  temperature?: number
  topK?: number
}

export interface InteractionResponse {
  id: number
  timestamp: Date
  questions?: ChatbotQuestionResponseChatbotDB[]
}

export class ChatbotDocument {
  id!: number
  name!: number
  type!: string
  subDocumentIds!: string[]
}

export type GetInteractionsAndQuestionsResponse = {
  helpmeDB: InteractionResponse[]
  chatbotDB: ChatbotQuestionResponseChatbotDB[]
}

export type GetChatbotHistoryResponse = {
  history: InteractionResponse[]
}

// Chatbot database functions
export async function createChatbotInteraction(params: {
  courseId: number;
  teamId: string;
  userId: string;
}): Promise<ChatbotInteractionEntity> {
  if (!dataSource) throw new Error('db not initialized');
  const repo = dataSource.getRepository(ChatbotInteractionEntity);
  const entity = new ChatbotInteractionEntity();
  entity.courseId = params.courseId;
  entity.teamId = params.teamId;
  entity.userId = params.userId;
  entity.createdAt = new Date().toISOString();
  entity.updatedAt = new Date().toISOString();
  return await repo.save(entity);
}

export async function createChatbotQuestion(params: {
  interactionId: number;
  questionText: string;
  responseText: string;
  vectorStoreId: string;
  suggested?: boolean;
  isPreviousQuestion?: boolean;
}): Promise<ChatbotQuestionEntity> {
  if (!dataSource) throw new Error('db not initialized');
  const repo = dataSource.getRepository(ChatbotQuestionEntity);
  const entity = new ChatbotQuestionEntity();
  entity.interactionId = params.interactionId;
  entity.questionText = params.questionText;
  entity.responseText = params.responseText;
  entity.vectorStoreId = params.vectorStoreId;
  entity.suggested = params.suggested || false;
  entity.isPreviousQuestion = params.isPreviousQuestion || false;
  entity.createdAt = new Date().toISOString();
  entity.updatedAt = new Date().toISOString();
  return await repo.save(entity);
}

export async function getChatbotInteractionsForUser(teamId: string, userId: string): Promise<ChatbotInteractionEntity[]> {
  if (!dataSource) throw new Error('db not initialized');
  const repo = dataSource.getRepository(ChatbotInteractionEntity);
  return await repo.find({ 
    where: { teamId, userId },
    order: { createdAt: 'DESC' }
  });
}

export async function getChatbotQuestionsForInteraction(interactionId: number): Promise<ChatbotQuestionEntity[]> {
  if (!dataSource) throw new Error('db not initialized');
  const repo = dataSource.getRepository(ChatbotQuestionEntity);
  return await repo.find({ 
    where: { interactionId },
    order: { createdAt: 'ASC' }
  });
}

export async function updateChatbotQuestionScore(questionId: number, userScore: number): Promise<ChatbotQuestionEntity | null> {
  if (!dataSource) throw new Error('db not initialized');
  const repo = dataSource.getRepository(ChatbotQuestionEntity);
  const question = await repo.findOne({ where: { id: questionId } });
  if (!question) return null;
  question.userScore = userScore;
  question.updatedAt = new Date().toISOString();
  return await repo.save(question);
}

export async function getChatbotInteractionsForCourse(courseId: number): Promise<ChatbotInteractionEntity[]> {
  if (!dataSource) throw new Error('db not initialized');
  const repo = dataSource.getRepository(ChatbotInteractionEntity);
  return await repo.find({ 
    where: { courseId },
    order: { createdAt: 'DESC' }
  });
}

