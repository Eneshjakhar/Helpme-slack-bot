import { BaseEntity, Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('chat_token_model')
export class ChatTokenModel extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text', unique: true })
  token!: string;

  @Column({ default: 0 })
  used!: number;

  @Column({ default: 30 })
  max_uses!: number;

  // Optional association info for Slack linkage (not enforced here)
  @Column({ type: 'text', name: 'slack_user_id', nullable: true })
  slackUserId?: string | null;

  @Column({ type: 'text', name: 'slack_team_id', nullable: true })
  slackTeamId?: string | null;
}
