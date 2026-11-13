import { addPlayer, advanceBots, applyAction, createGame, createPlayer, publicRoom, GameError } from '../shared/engine';
import type { GameMode, RoomAction } from '../shared/types';
import { cleanup, RoomRepository, type RoomRecord, type StoredRoom } from './repository';

export interface Env { DB: D1Database; ASSETS?: Fetcher; ROOM_TTL_HOURS?: string; DISABLE_RATE_LIMIT?: string }
class HttpError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'BAD_REQUEST') { super(message); }
}
const CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const MODES = new Set<GameMode>(['classic', 'relics', 'legacy']);
const json = (data: unknown, status = 200, extra?: HeadersInit) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra },
});
const randomHex = (size = 32) => Array.from(crypto.getRandomValues(new Uint8Array(size)), v => v.toString(16).padStart(2, '0')).join('');
async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), v => v.toString(16).padStart(2, '0')).join('');
}
function roomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), v => alphabet[v % 32]).join('');
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new HttpError('Нужен JSON-запрос.', 415, 'CONTENT_TYPE');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError('Пустой запрос.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 8192) { await reader.cancel(); throw new HttpError('Слишком большой запрос.', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const result: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result as Record<string, unknown>;
  } catch { throw new HttpError('Не удалось прочитать запрос.'); }
}
function profile(data: Record<string, unknown>): { name: string; avatar: number } {
  if (typeof data.name !== 'string') throw new HttpError('Введите имя исследователя.');
  const name = data.name.normalize('NFC').trim().replace(/\s+/g, ' ');
  if ([...name].length < 2 || [...name].length > 20 || /[\p{Cc}\p{Cf}]/u.test(name)) {
    throw new HttpError('Имя: от 2 до 20 символов, без невидимых знаков.');
  }
  const avatar = data.avatar ?? 0;
  if (typeof avatar !== 'number' || !Number.isInteger(avatar) || avatar < 0 || avatar > 7) {
    throw new HttpError('Выберите значок исследователя.');
  }
  return { name, avatar };
}
function mode(value: unknown): GameMode {
  if (typeof value !== 'string' || !MODES.has(value as GameMode)) throw new HttpError('Неизвестные правила.');
  return value as GameMode;
}
function parseAction(input: unknown): RoomAction {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError('Неизвестное действие.');
  const a = input as Record<string, unknown>;
  switch (a.type) {
    case 'ready':
      if (typeof a.ready !== 'boolean') break;
      return { type: 'ready', ready: a.ready };
    case 'start': case 'nextRound': case 'addBot': case 'rematch': case 'leave':
      return { type: a.type };
    case 'setMode': return { type: 'setMode', mode: mode(a.mode) };
    case 'removePlayer':
      if (typeof a.playerId !== 'string' || a.playerId.length > 80) break;
      return { type: 'removePlayer', playerId: a.playerId };
    case 'choose':
      if ((a.choice !== 'return' && a.choice !== 'continue') || !Number.isSafeInteger(a.turn) || !Number.isSafeInteger(a.round)) break;
      return { type: 'choose', choice: a.choice, turn: a.turn as number, round: a.round as number };
  }
  throw new HttpError('Некорректное действие.');
}
async function tokenHash(request: Request): Promise<string | null> {
  const header = request.headers.get('authorization');
  if (!header) return null;
  if (!/^Bearer [a-f0-9]{64}$/.test(header)) throw new HttpError('Сессия недействительна.', 401, 'INVALID_SESSION');
  return digest(header.slice(7));
}
function identity(room: StoredRoom, hash: string | null, required: boolean): string | null {
  if (hash) {
    for (const [id, secret] of Object.entries(room.members)) {
      if (secret.tokenHash === hash && room.game.players.some(p => p.id === id && !p.isBot)) return id;
    }
    throw new HttpError('Место больше не связано с этой сессией. Войдите заново.', 401, 'INVALID_SESSION');
  }
  if (required) throw new HttpError('Сначала присоединитесь к экспедиции.', 401, 'SESSION_REQUIRED');
  return null;
}
async function readRoom(repository: RoomRepository, code: string): Promise<RoomRecord> {
  if (!CODE.test(code)) throw new HttpError('Неверный код комнаты.', 404, 'ROOM_NOT_FOUND');
  const record = await repository.read(code);
  if (!record) throw new HttpError('Комната не найдена. Проверьте код: неактивные комнаты хранятся 7 дней.', 404, 'ROOM_NOT_FOUND');
  return record;
}
async function rateLimit(request: Request, env: Env, repository: RoomRepository, group: string, max: number, seconds = 60): Promise<void> {
  if (env.DISABLE_RATE_LIMIT === 'true') return;
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const epoch = Math.floor(Date.now() / (seconds * 1000));
  const ipHash = (await digest(ip)).slice(0, 24);
  const count = await repository.countRequest(`${group}:${ipHash}:${epoch}`, (epoch + 2) * seconds * 1000);
  if (count > max) throw new HttpError('Слишком много запросов. Подождите минуту и повторите.', 429, 'RATE_LIMITED');
}
function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new HttpError('Запрос с другого сайта отклонён.', 403, 'ORIGIN_MISMATCH');
  }
}

async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '');
  if (!env.DB) throw new HttpError('Хранилище ещё не подключено.', 503, 'DATABASE_UNAVAILABLE');
  const ttlHours = Number(env.ROOM_TTL_HOURS || 168);
  const repository = new RoomRepository(env.DB, (Number.isFinite(ttlHours) && ttlHours > 0 ? ttlHours : 168) * 3_600_000);
  if (request.method === 'POST') assertSameOrigin(request);

  if (path === '/api/health' && request.method === 'GET') {
    await env.DB.prepare('SELECT code FROM rooms LIMIT 1').first();
    return json({ status: 'ok', version: '1.0.0', storage: 'd1' });
  }

  if (path === '/api/rooms' && request.method === 'POST') {
    await rateLimit(request, env, repository, 'create', 20, 3600);
    const data = await body(request);
    const p = profile(data);
    const chosenMode = mode(data.mode ?? 'relics');
    if (data.practice !== undefined && typeof data.practice !== 'boolean') throw new HttpError('Некорректный режим тренировки.');
    const token = randomHex();
    const hash = await digest(token);
    const playerId = crypto.randomUUID();
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = roomCode();
      let game = createGame(code, createPlayer(playerId, p.name, p.avatar), chosenMode);
      if (data.practice === true) {
        for (let i = 0; i < 3; i++) game = applyAction(game, playerId, { type: 'addBot' });
        game = applyAction(game, playerId, { type: 'ready', ready: true });
        game = advanceBots(applyAction(game, playerId, { type: 'start' }));
      }
      const room: StoredRoom = { game, members: { [playerId]: { tokenHash: hash, requests: [] } } };
      if (await repository.create(room)) {
        return json({ code, playerId, token, room: publicRoom(game, playerId, 1) }, 201);
      }
    }
    throw new HttpError('Не удалось создать комнату. Попробуйте ещё раз.', 503);
  }

  const match = /^\/api\/rooms\/([A-Z2-9]{6})(?:\/(join|action))?$/.exec(path);
  if (!match) throw new HttpError('Такого маршрута нет.', 404, 'NOT_FOUND');
  const [, code, endpoint] = match;
  if (!CODE.test(code)) throw new HttpError('Неверный код комнаты.', 404, 'ROOM_NOT_FOUND');

  if (!endpoint && request.method === 'GET') {
    const hash = await tokenHash(request);
    const { room, revision } = await readRoom(repository, code);
    const playerId = identity(room, hash, false);
    const etag = `"${revision}:${playerId ?? 'spectator'}"`;
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'no-store' } });
    return json({ room: publicRoom(room.game, playerId, revision) }, 200, { ETag: etag });
  }

  if (endpoint === 'join' && request.method === 'POST') {
    await rateLimit(request, env, repository, 'join', 40);
    const p = profile(await body(request));
    const existingHash = await tokenHash(request);
    const token = randomHex();
    const hash = await digest(token);
    const playerId = crypto.randomUUID();
    for (let attempt = 0; attempt < 12; attempt++) {
      const { room, revision } = await readRoom(repository, code);
      if (existingHash) {
        const oldId = identity(room, existingHash, true)!;
        return json({ code, playerId: oldId, token: request.headers.get('authorization')!.slice(7), room: publicRoom(room.game, oldId, revision) });
      }
      if (room.game.players.some(x => x.name.toLocaleLowerCase('ru') === p.name.toLocaleLowerCase('ru'))) {
        throw new HttpError('Такое имя уже есть в комнате. Если это вы, вернитесь в том же браузере.', 409, 'NAME_TAKEN');
      }
      room.game = addPlayer(room.game, createPlayer(playerId, p.name, p.avatar));
      room.members[playerId] = { tokenHash: hash, requests: [] };
      if (await repository.update(code, revision, room)) {
        return json({ code, playerId, token, room: publicRoom(room.game, playerId, revision + 1) }, 201);
      }
    }
    throw new HttpError('В комнате много действий. Повторите вход.', 409, 'CONFLICT');
  }

  if (endpoint === 'action' && request.method === 'POST') {
    // Shared NATs can legitimately contain all eight players.
    await rateLimit(request, env, repository, 'action', 360);
    const hash = await tokenHash(request);
    const data = await body(request);
    const action = parseAction(data.action);
    if (typeof data.requestId !== 'string' || !/^[a-zA-Z0-9_-]{12,80}$/.test(data.requestId)) {
      throw new HttpError('Запросу нужен уникальный идентификатор.', 400, 'REQUEST_ID_REQUIRED');
    }
    const requestId = data.requestId;
    for (let attempt = 0; attempt < 12; attempt++) {
      const { room, revision } = await readRoom(repository, code);
      const playerId = identity(room, hash, true)!;
      const member = room.members[playerId];
      if (member.requests.includes(requestId)) return json({ room: publicRoom(room.game, playerId, revision) });
      room.game = advanceBots(applyAction(room.game, playerId, action));
      member.requests = [...member.requests.slice(-31), requestId];
      // Revocation follows the same atomic write as a lobby departure / kick.
      for (const id of Object.keys(room.members)) {
        if (!room.game.players.some(p => p.id === id)) delete room.members[id];
      }
      if (await repository.update(code, revision, room)) {
        const viewer = room.game.players.some(p => p.id === playerId) ? playerId : null;
        return json({ room: publicRoom(room.game, viewer, revision + 1) });
      }
    }
    throw new HttpError('Ход ещё обрабатывается. Повторите действие.', 409, 'CONFLICT');
  }
  throw new HttpError('Метод не поддерживается.', 405, 'METHOD_NOT_ALLOWED');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (new URL(request.url).pathname.startsWith('/api/')) return await api(request, env);
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response('Static assets are not configured.', { status: 503 });
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message, code: error.code }, error.status);
      if (error instanceof GameError) {
        const e = error as Error & { status?: number; code?: string };
        return json({ error: e.message, code: e.code ?? 'INVALID_MOVE' }, e.status ?? 400);
      }
      console.error('diamant:request_failed', error instanceof Error ? error.message : 'unknown');
      return json({ error: 'Не удалось обработать запрос. Партия сохранена; попробуйте ещё раз.', code: 'INTERNAL_ERROR' }, 500);
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(cleanup(env.DB));
  },
} satisfies ExportedHandler<Env>;
