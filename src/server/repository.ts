import type { GameState } from '../shared/types';

export interface MemberSecret { tokenHash: string; requests: string[] }
export interface StoredRoom { game: GameState; members: Record<string, MemberSecret> }
export interface RoomRecord { room: StoredRoom; revision: number }
interface RoomRow { state: string; revision: number }

export class RoomRepository {
  constructor(private readonly db: D1Database, private readonly ttlMs: number) {}

  async read(code: string): Promise<RoomRecord | null> {
    const row = await this.db.prepare('SELECT state, revision FROM rooms WHERE code = ? AND expires_at > ?')
      .bind(code, Date.now()).first<RoomRow>();
    return row ? { room: JSON.parse(row.state) as StoredRoom, revision: row.revision } : null;
  }

  async create(room: StoredRoom): Promise<boolean> {
    const now = Date.now();
    const result = await this.db.prepare(
      'INSERT OR IGNORE INTO rooms (code, revision, state, created_at, updated_at, expires_at) VALUES (?, 1, ?, ?, ?, ?)',
    ).bind(room.game.code, JSON.stringify(room), now, now, now + this.ttlMs).run();
    return result.meta.changes === 1;
  }

  // One compare-and-swap includes the entire move, resolved turn and request ID.
  // Concurrent decisions can never overwrite one another or draw two cards.
  async update(code: string, previousRevision: number, room: StoredRoom): Promise<boolean> {
    const now = Date.now();
    const result = await this.db.prepare(
      'UPDATE rooms SET state = ?, revision = revision + 1, updated_at = ?, expires_at = ? WHERE code = ? AND revision = ? AND expires_at > ?',
    ).bind(JSON.stringify(room), now, now + this.ttlMs, code, previousRevision, now).run();
    return result.meta.changes === 1;
  }

  async countRequest(bucket: string, expiresAt: number): Promise<number> {
    const row = await this.db.prepare(
      'INSERT INTO rate_limits (bucket, hits, expires_at) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET hits = hits + 1 RETURNING hits',
    ).bind(bucket, expiresAt).first<{ hits: number }>();
    return row?.hits ?? Number.MAX_SAFE_INTEGER;
  }
}

export async function cleanup(db: D1Database): Promise<void> {
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM rooms WHERE expires_at <= ?').bind(now),
    db.prepare('DELETE FROM rate_limits WHERE expires_at <= ?').bind(now),
  ]);
}
