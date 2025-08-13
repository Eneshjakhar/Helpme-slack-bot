import Database from 'better-sqlite3';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import type { Logger } from 'pino';
import { encrypt, decrypt } from '../utils/crypto.js';

let db: BetterSqlite3Database | null = null;

export async function ensureDb(logger: Logger): Promise<void> {
  const path = process.env.DATABASE_PATH || './data/data.db';
  db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS links (
      team_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      helpme_user_token_enc TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (team_id, user_id)
    );
  `);
  logger.info({ path }, 'DB ready');
}

export async function saveLink(teamId: string, userId: string, p: { helpmeUserToken: string }): Promise<void> {
  if (!db) throw new Error('db not initialized');
  const key = process.env.ENCRYPTION_KEY || '';
  const stmt = db.prepare(`
    INSERT INTO links(team_id, user_id, helpme_user_token_enc)
    VALUES (?, ?, ?)
    ON CONFLICT(team_id, user_id) DO UPDATE SET helpme_user_token_enc=excluded.helpme_user_token_enc
  `);
  stmt.run(teamId, userId, encrypt(p.helpmeUserToken, key));
}

export async function getUserToken(teamId: string, userId: string): Promise<string | null> {
  if (!db) throw new Error('db not initialized');
  const row = db
    .prepare(`SELECT helpme_user_token_enc FROM links WHERE team_id=? AND user_id=?`)
    .get(teamId, userId) as { helpme_user_token_enc: string } | undefined;
  if (!row) return null;
  const key = process.env.ENCRYPTION_KEY || '';
  return decrypt(row.helpme_user_token_enc, key);
}


