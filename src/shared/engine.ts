import type {
  Card, Choice, GameMode, GameState, HazardCard, HazardType,
  Player, PublicRoom, RelicCard, RoomAction,
} from './types';
import { HAZARD_LABELS } from './types';

/** Exact current IELLO treasure distribution; the repeated values are deliberate. */
export const TREASURE_VALUES = [1, 2, 3, 4, 5, 5, 7, 7, 9, 11, 11, 13, 14, 15, 17] as const;
export const RELIC_VALUES = [5, 7, 8, 10, 12] as const;
export const HAZARDS: readonly HazardType[] = ['snake', 'scorpion', 'lava', 'boulder', 'spikes'];
export type RandomSource = () => number;

export class GameError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, code = 'INVALID_ACTION', status = 400) {
    super(message);
    this.name = 'GameError';
    this.code = code;
    this.status = status;
  }
}

function requireGame(condition: unknown, message: string, code = 'INVALID_ACTION', status = 400): asserts condition {
  if (!condition) throw new GameError(message, code, status);
}

function checkedRandom(random: RandomSource): number {
  const value = random();
  requireGame(Number.isFinite(value) && value >= 0 && value < 1, 'Некорректный источник случайности.', 'INVALID_RANDOM', 500);
  return value;
}

/** Rejection sampling avoids modulo bias when shuffling with the production RNG. */
function randomIndex(limit: number, random?: RandomSource): number {
  if (random) return Math.floor(checkedRandom(random) * limit);
  const maximum = 0x1_0000_0000;
  const threshold = maximum - (maximum % limit);
  const buffer = new Uint32Array(1);
  do { crypto.getRandomValues(buffer); } while (buffer[0] >= threshold);
  return buffer[0] % limit;
}

function randomUnit(random?: RandomSource): number {
  return random ? checkedRandom(random) : crypto.getRandomValues(new Uint32Array(1))[0] / 0x1_0000_0000;
}

function shuffle<T>(items: T[], random?: RandomSource): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1, random);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function validMode(mode: unknown): mode is GameMode {
  return mode === 'classic' || mode === 'relics' || mode === 'legacy';
}

function totalScore(player: Player): number {
  return player.bank + player.relics.reduce((sum, relic) => sum + relic.value, 0);
}

function freshPlayer(player: Player): Player {
  return { ...player, bank: 0, loot: 0, relics: [], status: 'camp', ready: player.isBot };
}

export function createPlayer(id: string, name: string, avatar: number, isBot = false): Player {
  requireGame(typeof id === 'string' && id.length > 0 && id.length <= 100, 'Некорректный игрок.', 'INVALID_PLAYER');
  requireGame(typeof name === 'string', 'Введите имя исследователя.', 'INVALID_NAME');
  const normalizedName = name.normalize('NFC').trim();
  requireGame(normalizedName.length > 0 && Array.from(normalizedName).length <= 24 && !/[\p{Cc}\p{Cf}]/u.test(normalizedName),
    'Имя должно содержать от 1 до 24 символов без управляющих знаков.', 'INVALID_NAME');
  requireGame(Number.isInteger(avatar) && avatar >= 0 && avatar < 8, 'Выберите одного из восьми исследователей.', 'INVALID_AVATAR');
  return { id, name: normalizedName, avatar, isBot, ready: isBot, bank: 0, loot: 0, relics: [], status: 'camp' };
}

export function createGame(code: string, host: Player, mode: GameMode = 'relics'): GameState {
  requireGame(validMode(mode), 'Неизвестная редакция правил.', 'INVALID_MODE');
  requireGame(typeof code === 'string' && code.length > 0, 'Некорректный код комнаты.', 'INVALID_ROOM');
  requireGame(!host.isBot, 'Комнату создаёт живой игрок.', 'INVALID_HOST');
  const normalizedHost = createPlayer(host.id, host.name, host.avatar, false);
  return {
    schemaVersion: 1, code, hostId: host.id, mode, phase: 'lobby', round: 0, turn: 0,
    players: [normalizedHost], deck: [], trail: [], decisions: {}, retiredHazards: [], removedRelics: [],
    relicsClaimed: 0, events: [], roundResult: null, roundStartScores: {},
  };
}

export function addPlayer(state: GameState, player: Player): GameState {
  requireGame(state.phase === 'lobby', 'Экспедиция уже началась. Дождитесь новой партии.', 'GAME_STARTED', 409);
  requireGame(state.players.length < 8, 'В комнате уже восемь исследователей.', 'ROOM_FULL', 409);
  requireGame(!state.players.some((entry) => entry.id === player.id), 'Игрок уже находится в комнате.', 'ALREADY_JOINED', 409);
  const next = structuredClone(state);
  next.players.push(createPlayer(player.id, player.name, player.avatar, player.isBot));
  if (!next.hostId && !player.isBot) next.hostId = player.id;
  return next;
}

function log(state: GameState, text: string, kind: GameState['events'][number]['kind'] = 'info'): void {
  state.events.push({ id: (state.events.at(-1)?.id ?? 0) + 1, round: state.round, turn: state.turn, text, kind });
  // All scoring remains in authoritative state; a bounded log keeps room snapshots small.
  if (state.events.length > 160) state.events.splice(0, state.events.length - 160);
}

function baseDeck(): Card[] {
  return [
    ...TREASURE_VALUES.map((value, index): Card => ({ id: `treasure-${index}`, kind: 'treasure', value })),
    ...HAZARDS.flatMap((hazard) => [0, 1, 2].map((copy): HazardCard => ({ id: `hazard-${hazard}-${copy}`, kind: 'hazard', hazard }))),
  ];
}

function beginRound(state: GameState, round: number, random?: RandomSource): void {
  let cards: Card[];
  if (round === 1) {
    cards = baseDeck();
    if (state.mode === 'legacy') {
      // Legacy relics are identical and have no value until someone brings them back.
      cards.push(...RELIC_VALUES.map((_, index): RelicCard => ({ id: `relic-${index}`, kind: 'relic', value: 0 })));
    }
  } else {
    const removed = new Set([
      ...state.retiredHazards.map((card) => card.id), ...state.removedRelics.map((card) => card.id),
      ...state.players.flatMap((player) => player.relics.map((card) => card.id)),
    ]);
    cards = [...state.deck, ...state.trail.map((entry) => entry.card)].filter((card) => !removed.has(card.id));
  }
  if (state.mode === 'relics') cards.push({ id: `relic-${round - 1}`, kind: 'relic', value: RELIC_VALUES[round - 1] });
  state.round = round;
  state.turn = 0;
  state.phase = 'decision';
  state.roundResult = null;
  state.roundStartScores = Object.fromEntries(state.players.map((player) => [player.id, totalScore(player)]));
  state.players.forEach((player) => { player.status = 'exploring'; player.loot = 0; });
  state.deck = shuffle(cards, random);
  state.trail = [];
  state.decisions = {};
  log(state, `Экспедиция ${round} из 5. Все исследователи входят в пещеру.`);
  reveal(state);
}

function finishRound(state: GameState, reason: 'escaped' | 'hazard', hazardCard?: HazardCard): void {
  const lost: Record<string, number> = {};
  for (const player of state.players) {
    lost[player.id] = reason === 'hazard' && player.status === 'exploring' ? player.loot : 0;
    if (reason === 'hazard' && player.status === 'exploring') {
      player.status = 'lost';
      player.loot = 0;
    }
  }
  if (hazardCard) state.retiredHazards.push({ ...hazardCard });
  for (const entry of state.trail) {
    if (entry.card.kind === 'relic' && !entry.claimedBy) state.removedRelics.push({ ...entry.card });
  }
  state.decisions = {};
  state.roundResult = {
    round: state.round, reason, ...(hazardCard ? { hazard: hazardCard.hazard } : {}), lost,
    gains: Object.fromEntries(state.players.map((player) => [player.id, totalScore(player) - (state.roundStartScores[player.id] ?? 0)])),
  };
  state.phase = state.round === 5 ? 'finished' : 'roundEnd';
  log(state, reason === 'hazard'
    ? `Ловушка сработала! ${HAZARD_LABELS[hazardCard!.hazard]}. Оставшиеся в пещере теряют добычу. Одна карта этой опасности удалена из партии.`
    : 'Все вернулись в лагерь. Экспедиция завершена.', reason === 'hazard' ? 'hazard' : 'info');
  if (state.phase === 'finished') log(state, 'Пять экспедиций позади. Сундуки открыты — время считать сокровища!');
}

function reveal(state: GameState): void {
  const active = state.players.filter((player) => player.status === 'exploring');
  requireGame(active.length > 0, 'В пещере нет исследователей.', 'CORRUPT_STATE', 500);
  // Exhaustion cannot occur with the official deck across five legal expeditions:
  // at least 11 dangers remain before round five, so a duplicate ends the round first.
  const card = state.deck.shift();
  requireGame(card, 'В колоде отсутствует следующая карта.', 'CORRUPT_STATE', 500);
  state.turn += 1;
  const entry = { card, remaining: 0 };
  state.trail.push(entry);
  if (card.kind === 'treasure') {
    const share = Math.floor(card.value / active.length);
    entry.remaining = card.value % active.length;
    active.forEach((player) => { player.loot += share; });
    log(state, `Найдено ${card.value} рубинов: каждому по ${share}, на пути осталось ${entry.remaining}.`, 'treasure');
  } else if (card.kind === 'hazard') {
    const seen = state.trail.filter((tile) => tile.card.kind === 'hazard' && tile.card.hazard === card.hazard).length;
    if (seen >= 2) finishRound(state, 'hazard', card);
    else log(state, `${HAZARD_LABELS[card.hazard]}! Пока путь открыт. Повтор этой опасности завершит экспедицию.`, 'hazard');
  } else {
    log(state, card.value ? `Найдена реликвия ценностью ${card.value}. Её заберёт тот, кто вернётся один.`
      : 'Найдена реликвия. Первые три спасённые реликвии стоят по 5, следующие — по 10.', 'relic');
  }
}

function resolveDecisions(state: GameState): void {
  const active = state.players.filter((player) => player.status === 'exploring');
  if (!active.length || active.some((player) => !state.decisions[player.id])) return;
  const returning = active.filter((player) => state.decisions[player.id] === 'return');
  const continuing = active.filter((player) => state.decisions[player.id] === 'continue');
  // Both lists become public together, never while anyone still has a choice to make.
  log(state, `Решения раскрыты. ${returning.length ? `В лагерь: ${returning.map((p) => p.name).join(', ')}.` : 'Никто не возвращается.'}${continuing.length ? ` Дальше: ${continuing.map((p) => p.name).join(', ')}.` : ''}`);
  if (returning.length) {
    const pool = state.trail.reduce((sum, tile) => sum + tile.remaining, 0);
    const share = Math.floor(pool / returning.length);
    const remainder = pool % returning.length;
    for (const tile of state.trail) tile.remaining = 0;
    if (remainder) {
      const target = state.trail.find((tile) => tile.card.kind === 'treasure');
      requireGame(target, 'Остаток рубинов не привязан к сокровищу.', 'CORRUPT_STATE', 500);
      target.remaining = remainder;
    }
    for (const player of returning) {
      const secured = player.loot + share;
      player.bank += secured;
      player.loot = 0;
      player.status = 'camp';
      log(state, `${player.name} возвращается: ${secured} рубинов в сундук, включая ${share} с тропы.`, 'return');
    }
    if (returning.length === 1) {
      const player = returning[0];
      for (const entry of state.trail) {
        if (entry.card.kind !== 'relic' || entry.claimedBy) continue;
        const value = state.mode === 'legacy' ? (state.relicsClaimed < 3 ? 5 : 10) : entry.card.value;
        const relic: RelicCard = { ...entry.card, value };
        player.relics.push(relic);
        entry.card = { ...relic };
        entry.claimedBy = player.id;
        state.relicsClaimed += 1;
        log(state, `${player.name} спасает реликвию: +${value} очков.`, 'relic');
      }
    }
  }
  state.decisions = {};
  if (!continuing.length) finishRound(state, 'escaped');
  else reveal(state);
}

export function applyAction(state: GameState, actorId: string, action: RoomAction, random?: RandomSource): GameState {
  requireGame(action && typeof action === 'object' && typeof action.type === 'string', 'Некорректное действие.');
  const actor = state.players.find((player) => player.id === actorId);
  requireGame(actor, 'Сначала войдите в комнату.', 'NOT_A_PLAYER', 403);
  const requireHost = () => requireGame(state.hostId === actorId, 'Это действие доступно организатору.', 'HOST_ONLY', 403);
  const requireLobby = () => requireGame(state.phase === 'lobby', 'Это действие доступно только в лобби.', 'LOBBY_ONLY', 409);
  const next = structuredClone(state);
  const current = next.players.find((player) => player.id === actorId)!;
  switch (action.type) {
    case 'ready':
      requireLobby();
      requireGame(typeof action.ready === 'boolean', 'Некорректный статус готовности.');
      current.ready = action.ready;
      break;
    case 'setMode':
      requireHost(); requireLobby();
      requireGame(validMode(action.mode), 'Неизвестная редакция правил.', 'INVALID_MODE');
      if (next.mode !== action.mode) {
        next.mode = action.mode;
        next.players.forEach((player) => { player.ready = player.isBot; });
      }
      break;
    case 'addBot': {
      requireHost(); requireLobby();
      requireGame(next.players.length < 8, 'В комнате уже восемь исследователей.', 'ROOM_FULL', 409);
      const names = ['Элли', 'Бруно', 'Искра', 'Атлас', 'Фокс', 'Мира', 'Тео', 'Нова'];
      const avatar = Array.from({ length: 8 }, (_, index) => index).find((index) => !next.players.some((player) => player.avatar === index)) ?? next.players.length;
      let name = `${names[avatar]} · бот`;
      if (next.players.some((player) => player.name === name)) name = `Исследователь ${next.players.length + 1} · бот`;
      next.players.push(createPlayer(`bot-${crypto.randomUUID()}`, name, avatar, true));
      break;
    }
    case 'removePlayer':
      requireHost(); requireLobby();
      requireGame(action.playerId !== actorId, 'Чтобы выйти, используйте выход из комнаты.', 'CANNOT_KICK_HOST');
      requireGame(next.players.some((player) => player.id === action.playerId), 'Игрок не найден.', 'PLAYER_NOT_FOUND', 404);
      next.players = next.players.filter((player) => player.id !== action.playerId);
      break;
    case 'leave':
      requireGame(next.phase === 'lobby' || next.phase === 'finished', 'Во время партии место сохраняется: вы сможете переподключиться.', 'GAME_IN_PROGRESS', 409);
      next.players = next.players.filter((player) => player.id !== actorId);
      if (next.hostId === actorId) next.hostId = next.players.find((player) => !player.isBot)?.id ?? '';
      break;
    case 'start':
      requireHost(); requireLobby();
      requireGame(next.players.length >= 3 && next.players.length <= 8, 'Для партии нужны от 3 до 8 исследователей. Можно добавить ботов.', 'PLAYER_COUNT', 409);
      requireGame(next.players.every((player) => player.ready || player.isBot), 'Дождитесь готовности всех игроков.', 'NOT_READY', 409);
      beginRound(next, 1, random);
      break;
    case 'choose':
      requireGame(next.phase === 'decision' && current.status === 'exploring', 'Сейчас вы не выбираете действие в пещере.', 'NOT_EXPLORING', 409);
      requireGame(action.round === next.round && action.turn === next.turn, 'Этот ход уже завершён. Обновите состояние комнаты.', 'STALE_TURN', 409);
      requireGame(action.choice === 'continue' || action.choice === 'return', 'Неизвестный выбор.', 'INVALID_CHOICE');
      requireGame(!next.decisions[actorId] || next.decisions[actorId] === action.choice, 'Выбор уже подтверждён и скрыт до общего раскрытия.', 'CHOICE_LOCKED', 409);
      next.decisions[actorId] = action.choice;
      resolveDecisions(next);
      break;
    case 'nextRound':
      // Starting the next expedition changes timing only, so an absent host cannot block it.
      requireGame(!current.isBot, 'Следующую экспедицию начинает живой игрок.', 'HUMAN_ONLY', 403);
      requireGame(next.phase === 'roundEnd' && next.round < 5, 'Следующая экспедиция пока недоступна.', 'WRONG_PHASE', 409);
      beginRound(next, next.round + 1, random);
      break;
    case 'rematch':
      requireHost();
      requireGame(next.phase === 'finished', 'Реванш доступен после завершения партии.', 'WRONG_PHASE', 409);
      next.players = next.players.map(freshPlayer);
      next.phase = 'lobby'; next.round = 0; next.turn = 0;
      next.deck = []; next.trail = []; next.decisions = {}; next.retiredHazards = [];
      next.removedRelics = []; next.relicsClaimed = 0; next.events = [];
      next.roundResult = null; next.roundStartScores = {};
      break;
    default:
      throw new GameError('Неизвестное действие.', 'UNKNOWN_ACTION');
  }
  return next;
}

/** Bot strategy receives only information that the ordinary player can observe. */
function botChoice(state: GameState, player: Player, random?: RandomSource): Choice {
  const revealedHazards = new Set(state.trail.flatMap((entry) => entry.card.kind === 'hazard' ? [entry.card.hazard] : []));
  const fatalCards = [...revealedHazards].reduce((sum, type) => sum + 2 - state.retiredHazards.filter((card) => card.hazard === type).length, 0);
  const risk = state.deck.length ? fatalCards / state.deck.length : 1;
  const trailRubies = state.trail.reduce((sum, entry) => sum + entry.remaining, 0);
  const relicCount = state.trail.filter((entry) => entry.card.kind === 'relic' && !entry.claimedBy).length;
  const temperament = [0.7, 1, 1.3][player.avatar % 3];
  const returnChance = Math.min(0.95, Math.max(0.015,
    risk * (1 + player.loot / 8) * temperament + Math.min(0.3, trailRubies / 40) + (relicCount ? 0.26 : 0)));
  return randomUnit(random) < returnChance ? 'return' : 'continue';
}

/** Advances bots until a human decision is required or this expedition ends. */
export function advanceBots(state: GameState, random?: RandomSource): GameState {
  const next = structuredClone(state);
  // Every resolution consumes a card or finishes the round. Never auto-start a round.
  const maximumResolutions = next.deck.length + 1;
  for (let step = 0; step < maximumResolutions && next.phase === 'decision'; step += 1) {
    const active = next.players.filter((player) => player.status === 'exploring');
    for (const player of active) {
      if (player.isBot && !next.decisions[player.id]) next.decisions[player.id] = botChoice(next, player, random);
    }
    if (active.some((player) => !next.decisions[player.id])) return next;
    if (!active.length) return next;
    resolveDecisions(next);
  }
  return next;
}

export function publicRoom(state: GameState, viewerId: string | null, version = 0): PublicRoom {
  const viewer = state.players.some((player) => player.id === viewerId) ? viewerId : null;
  const bestScore = state.phase === 'finished' && state.players.length ? Math.max(...state.players.map(totalScore)) : -1;
  return structuredClone({
    code: state.code, hostId: state.hostId, mode: state.mode, phase: state.phase,
    round: state.round, turn: state.turn, version, youId: viewer,
    currentDecision: viewer ? state.decisions[viewer] ?? null : null,
    players: state.players.map((player) => ({
      ...player,
      bank: player.id === viewer || state.phase === 'finished' ? player.bank : null,
      score: player.id === viewer || state.phase === 'finished' ? totalScore(player) : null,
    })),
    trail: state.trail, deckRemaining: state.deck.length,
    retiredHazards: state.retiredHazards.map((card) => card.hazard),
    removedRelicValues: state.removedRelics.map((card) => card.value),
    decidedIds: Object.keys(state.decisions), events: state.events, roundResult: state.roundResult,
    winners: state.phase === 'finished' ? state.players.filter((player) => totalScore(player) === bestScore).map((player) => player.id) : [],
  });
}
