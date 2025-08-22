import 'reflect-metadata';
import { Entity, PrimaryColumn, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'links' })
export class LinkEntity {
  @PrimaryColumn({ type: 'text', name: 'team_id' })
  teamId!: string;

  @PrimaryColumn({ type: 'text', name: 'user_id' })
  userId!: string;

  @Column({ type: 'text', name: 'helpme_user_chat_token' })
  helpmeUserChatToken!: string | null;

  @Column({ type: 'text', name: 'created_at', default: () => "datetime('now')" })
  createdAt!: string;
}

@Entity({ name: 'user_links' })
export class UserLinkEntity {
  @PrimaryColumn({ type: 'text', name: 'team_id' })
  teamId!: string;

  @PrimaryColumn({ type: 'text', name: 'user_id' })
  userId!: string;

  @Column({ type: 'integer', name: 'helpme_user_id' })
  helpmeUserId!: number;

  @Column({ type: 'text', name: 'helpme_email' })
  helpmeEmail!: string;

  @Column({ type: 'text', name: 'helpme_name' })
  helpmeName!: string;

  @Column({ type: 'integer', name: 'organization_id', nullable: true })
  organizationId!: number | null;

  @Column({ type: 'text', name: 'helpme_user_chat_token', nullable: true })
  helpmeUserChatToken!: string | null;

  @Column({ type: 'text', name: 'created_at', default: () => "datetime('now')" })
  createdAt!: string;

  @Column({ type: 'text', name: 'updated_at', default: () => "datetime('now')" })
  updatedAt!: string;
}

@Entity({ name: 'link_states' })
export class LinkStateEntity {
  @PrimaryColumn({ type: 'text', name: 'state_id' })
  stateId!: string;

  @Column({ type: 'text', name: 'team_id' })
  teamId!: string;

  @Column({ type: 'text', name: 'user_id' })
  userId!: string;

  @Column({ type: 'text', name: 'channel_id', nullable: true })
  channelId!: string | null;

  @Column({ type: 'text', name: 'redirect_uri', nullable: true })
  redirectUri!: string | null;

  @Column({ type: 'text', name: 'created_at' })
  createdAt!: string;

  @Column({ type: 'text', name: 'expires_at' })
  expiresAt!: string;
}

@Entity({ name: 'user_courses' })
export class UserCoursesEntity {
  @PrimaryColumn({ type: 'text', name: 'team_id' })
  teamId!: string;

  @PrimaryColumn({ type: 'text', name: 'user_id' })
  userId!: string;

  @Column({ type: 'text', name: 'courses_json' })
  coursesJson!: string;

  @Column({ type: 'text', name: 'fetched_at' })
  fetchedAt!: string;
}

@Entity({ name: 'user_prefs' })
export class UserPrefsEntity {
  @PrimaryColumn({ type: 'text', name: 'team_id' })
  teamId!: string;

  @PrimaryColumn({ type: 'text', name: 'user_id' })
  userId!: string;

  @Column({ type: 'integer', name: 'default_course_id', nullable: true })
  defaultCourseId!: number | null;

  @Column({ type: 'text', name: 'created_at', default: () => "datetime('now')" })
  createdAt!: string;

  @Column({ type: 'text', name: 'updated_at', default: () => "datetime('now')" })
  updatedAt!: string;
}

// New entities for chatbot functionality
@Entity({ name: 'chatbot_interactions' })
export class ChatbotInteractionEntity {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ type: 'integer', name: 'course_id' })
  courseId!: number;

  @Column({ type: 'text', name: 'team_id' })
  teamId!: string;

  @Column({ type: 'text', name: 'user_id' })
  userId!: string;

  @Column({ type: 'text', name: 'created_at', default: () => "datetime('now')" })
  createdAt!: string;

  @Column({ type: 'text', name: 'updated_at', default: () => "datetime('now')" })
  updatedAt!: string;
}

@Entity({ name: 'chatbot_questions' })
export class ChatbotQuestionEntity {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ type: 'integer', name: 'interaction_id' })
  interactionId!: number;

  @Column({ type: 'text', name: 'question_text' })
  questionText!: string;

  @Column({ type: 'text', name: 'response_text' })
  responseText!: string;

  @Column({ type: 'text', name: 'vector_store_id' })
  vectorStoreId!: string;

  @Column({ type: 'boolean', name: 'suggested', default: false })
  suggested!: boolean;

  @Column({ type: 'boolean', name: 'is_previous_question', default: false })
  isPreviousQuestion!: boolean;

  @Column({ type: 'integer', name: 'user_score', nullable: true })
  userScore!: number | null;

  @Column({ type: 'text', name: 'created_at', default: () => "datetime('now')" })
  createdAt!: string;

  @Column({ type: 'text', name: 'updated_at', default: () => "datetime('now')" })
  updatedAt!: string;
}


