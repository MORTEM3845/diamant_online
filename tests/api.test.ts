import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import type { PublicRoom, RoomAction, SessionResponse } from '../src/shared/types';

let mf: Miniflare;
beforeAll(async () => {
  const result = await build({ entryPoints: ['src/server/worker.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, target: 'es2022' });
  mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: 'diamant-test', modules: true, script: result.outputFiles[0].text,
    compatibilityDate: '2026-11-13', d1Databases: ['DB'],
    bindings: { DISABLE_RATE_LIMIT: 'true' },
  }] }));
  const db = await mf.getD1Database('DB');
  const migration = await readFile('migrations/0001_rooms.sql', 'utf8');
  for (const statement of migration.split(';').filter(x => x.trim())) await db.prepare(statement).run();
});
afterAll(async () => { if (mf) await mf.dispose(); });

async function request(path: string, method = 'GET', data?: unknown, token?: string, headers: Record<string, string> = {}) {
  const response = await mf.dispatchFetch(`http://localhost${path}`, {
    method, headers: { ...(data ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null, raw: text };
}
async function create(name = 'Александр', practice = false): Promise<SessionResponse> {
  const result = await request('/api/rooms', 'POST', { name, avatar: 0, mode: 'relics', practice });
  expect(result.status, result.raw).toBe(201);
  return result.body;
}
async function action(session: SessionResponse, value: RoomAction, requestId = crypto.randomUUID()) {
  return request(`/api/rooms/${session.code}/action`, 'POST', { action: value, requestId }, session.token);
}
async function threePlayers() {
  const host = await create();
  const p2 = (await request(`/api/rooms/${host.code}/join`, 'POST', { name: 'Мария', avatar: 1 })).body as SessionResponse;
  const p3 = (await request(`/api/rooms/${host.code}/join`, 'POST', { name: 'Никита', avatar: 2 })).body as SessionResponse;
  return [host, p2, p3];
}
async function start(sessions: SessionResponse[]) {
  const ready = await Promise.all(sessions.map(s => action(s, { type: 'ready', ready: true })));
  expect(ready.map(r => r.status)).toEqual(sessions.map(() => 200));
  const started = await action(sessions[0], { type: 'start' });
  expect(started.status, started.raw).toBe(200);
  return started.body.room as PublicRoom;
}

describe('Cloudflare Worker + real local D1', () => {
  it('creates resumable rooms and never exposes tokens or hidden state', async () => {
    const host = await create();
    expect(host.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    const view = await request(`/api/rooms/${host.code}`, 'GET', undefined, host.token);
    expect(view.status).toBe(200);
    expect(view.body.room.youId).toBe(host.playerId);
    for (const word of ['tokenHash', 'members', 'decisions', 'roundStartScores']) expect(view.raw).not.toContain(`"${word}"`);
    expect(view.body.room).not.toHaveProperty('deck');
    const spectator = await request(`/api/rooms/${host.code}`);
    expect(spectator.body.room.youId).toBeNull();
    expect(spectator.body.room.players[0].bank).toBeNull();
    const db = await mf.getD1Database('DB');
    const row = await db.prepare('SELECT state FROM rooms WHERE code=?').bind(host.code).first<{state:string}>();
    expect(row!.state).not.toContain(host.token);
    expect(row!.state).toContain('tokenHash');
  });

  it('protects host actions, stale sessions and cross-origin mutations', async () => {
    const [host, guest] = await threePlayers();
    expect((await action(guest, { type: 'addBot' })).status).toBeGreaterThanOrEqual(400);
    const noToken = await request(`/api/rooms/${host.code}/action`, 'POST', { action: { type: 'start' }, requestId: crypto.randomUUID() });
    expect(noToken.status).toBe(401);
    const fake = await request(`/api/rooms/${host.code}`, 'GET', undefined, '0'.repeat(64));
    expect(fake.status).toBe(401);
    const crossOrigin = await request('/api/rooms', 'POST', { name: 'Пират', avatar: 0 }, undefined, { Origin: 'https://other.example' });
    expect(crossOrigin.status).toBe(403);
  });

  it('keeps simultaneous eight-player joins within the eight-seat limit', async () => {
    const host = await create();
    const responses = await Promise.all(Array.from({ length: 10 }, (_, i) => request(`/api/rooms/${host.code}/join`, 'POST', { name: `Гость ${i}`, avatar: i % 8 })));
    expect(responses.filter(r => r.status === 201)).toHaveLength(7);
    const snapshot = await request(`/api/rooms/${host.code}`, 'GET', undefined, host.token);
    expect(snapshot.body.room.players).toHaveLength(8);
    expect(new Set(snapshot.body.room.players.map((p: { id: string }) => p.id)).size).toBe(8);
  });

  it('resolves concurrent decisions once, hides individual choices, rejects replays', async () => {
    const sessions = await threePlayers();
    const current = await start(sessions);
    const choice: RoomAction = { type: 'choose', choice: 'return', round: current.round, turn: current.turn };
    const first = await action(sessions[0], choice);
    expect(first.status).toBe(200);
    const waiting = await request(`/api/rooms/${sessions[0].code}`, 'GET', undefined, sessions[1].token);
    expect(waiting.body.room.currentDecision).toBeNull();
    expect(waiting.body.room.decidedIds).toContain(sessions[0].playerId);
    expect(waiting.body.room.phase).toBe('decision');
    const results = await Promise.all(sessions.slice(1).map(s => action(s, choice)));
    expect(results.map(r => r.status)).toEqual([200, 200]);
    const final = await request(`/api/rooms/${sessions[0].code}`, 'GET', undefined, sessions[0].token);
    expect(final.body.room.phase).toBe('roundEnd');
    expect(final.body.room.players.every((p: { status: string }) => p.status === 'camp')).toBe(true);
    expect((await action(sessions[0], choice)).status).toBeGreaterThanOrEqual(400);
  });

  it('deduplicates retried commands atomically, even if they arrive together', async () => {
    const host = await create();
    const requestId = crypto.randomUUID();
    const both = await Promise.all([action(host, { type: 'addBot' }, requestId), action(host, { type: 'addBot' }, requestId)]);
    expect(both.map(r => r.status)).toEqual([200, 200]);
    const state = (await request(`/api/rooms/${host.code}`, 'GET', undefined, host.token)).body.room;
    expect(state.players).toHaveLength(2);
  });

  it('lets a guest resume without occupying a second seat', async () => {
    const host = await create();
    const joined = await request(`/api/rooms/${host.code}/join`, 'POST', { name: 'Александр', avatar: 0 }, host.token);
    expect(joined.status).toBe(200);
    expect(joined.body.playerId).toBe(host.playerId);
    expect(joined.body.room.players).toHaveLength(1);
  });

  it('supports five complete practice expeditions and a rematch', async () => {
    const host = await create('Тестировщик', true);
    let room = host.room;
    let decisions = 0;
    for (let expedition = 1; expedition <= 5; expedition++) {
      expect(room.round).toBe(expedition);
      while (room.phase === 'decision') {
        const self = room.players.find(p => p.id === host.playerId)!;
        expect(self.status).toBe('exploring');
        const result = await action(host, { type: 'choose', choice: decisions++ % 2 ? 'return' : 'continue', round: room.round, turn: room.turn });
        expect(result.status, result.raw).toBe(200);
        room = result.body.room;
        expect(decisions).toBeLessThan(200);
      }
      if (expedition < 5) {
        expect(room.phase).toBe('roundEnd');
        const result = await action(host, { type: 'nextRound' });
        expect(result.status, result.raw).toBe(200);
        room = result.body.room;
      }
    }
    expect(room.phase).toBe('finished');
    expect(room.winners.length).toBeGreaterThan(0);
    expect(room.players.every(p => p.score !== null)).toBe(true);
    const rematch = await action(host, { type: 'rematch' });
    expect(rematch.status).toBe(200);
    expect(rematch.body.room.phase).toBe('lobby');
    expect(rematch.body.room.players).toHaveLength(4);
  });

  it('validates malformed input and does not turn API misses into HTML', async () => {
    const invalid = await request('/api/rooms', 'POST', { name: 'x', avatar: 900, mode: 'wrong' });
    expect(invalid.status).toBe(400);
    const unknown = await request('/api/rooms/AAAAAA');
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('ROOM_NOT_FOUND');
    const missing = await request('/api/not-real');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).toContain('application/json');
    const large = await request('/api/rooms', 'POST', { name: 'x'.repeat(10000) });
    expect(large.status).toBe(413);
  });
});
