import { describe, expect, it } from 'vitest';
import { addPlayer, advanceBots, applyAction, createGame, createPlayer, GameError, HAZARDS, publicRoom, TREASURE_VALUES } from '../src/shared/engine';
import type { Card, Choice, GameMode, GameState, HazardType, Player, RoomAction } from '../src/shared/types';

const fixedRandom = () => 0.999999;
const treasure = (value: number, suffix = ''): Card => ({ id: `test-t-${value}-${suffix}`, kind: 'treasure', value });
const hazard = (type: HazardType, suffix = ''): Card => ({ id: `test-h-${type}-${suffix}`, kind: 'hazard', hazard: type });
const relic = (value: number, suffix = ''): Card => ({ id: `test-r-${value}-${suffix}`, kind: 'relic', value });

function lobby(mode: GameMode = 'relics', count = 3): GameState {
  let state = createGame('ABCDEF', createPlayer('p0', 'Александр', 0), mode);
  for (let i = 1; i < count; i += 1) state = addPlayer(state, createPlayer(`p${i}`, `Игрок ${i + 1}`, i));
  return state;
}
function ready(state: GameState): GameState {
  for (const player of state.players) state = applyAction(state, player.id, { type: 'ready', ready: true });
  return state;
}
function started(mode: GameMode = 'relics', count = 3): GameState {
  return applyAction(ready(lobby(mode, count)), 'p0', { type: 'start' }, fixedRandom);
}
function choose(state: GameState, playerId: string, choice: Choice): GameState {
  return applyAction(state, playerId, { type: 'choose', choice, round: state.round, turn: state.turn });
}
function chooseAll(state: GameState, choice: Choice): GameState {
  const ids = state.players.filter((p) => p.status === 'exploring').map((p) => p.id);
  for (const id of ids) state = choose(state, id, choice);
  return state;
}
/** A controlled, already-revealed decision state for exact edge-case checks. */
function scenario(cards: Card[], mode: GameMode = 'relics', count = 3): GameState {
  const state = started(mode, count);
  state.deck = cards;
  state.trail = [];
  state.turn = 1;
  state.players.forEach((p) => { p.loot = 0; });
  state.events = [];
  return state;
}
function expectGameError(fn: () => unknown, code: string): void {
  try { fn(); throw new Error(`Expected ${code}`); }
  catch (error) { expect(error).toBeInstanceOf(GameError); expect((error as GameError).code).toBe(code); }
}

// A deterministic generator lets complete games exercise legal state transitions.
function seeded(seed: number): () => number {
  let n = seed >>> 0;
  return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 0x1_0000_0000; };
}

describe('official deck and editions', () => {
  it('contains exactly the fifteen printed treasure values and three dangers of each type', () => {
    const state = started('classic');
    const cards = [...state.deck, ...state.trail.map((e) => e.card)];
    expect(cards).toHaveLength(30);
    expect(cards.filter((c) => c.kind === 'treasure').map((c) => c.kind === 'treasure' ? c.value : 0)).toEqual([...TREASURE_VALUES.slice(1), TREASURE_VALUES[0]]);
    for (const type of HAZARDS) expect(cards.filter((c) => c.kind === 'hazard' && c.hazard === type)).toHaveLength(3);
    expect(state.turn).toBe(1);
    expect(state.trail).toHaveLength(1);
    expect(state.decisions).toEqual({});
    expect(state.players.every((p) => p.status === 'exploring')).toBe(true);
  });
  it('modern relic mode begins with only the five-point relic and adds one per expedition', () => {
    let state = started('relics');
    expect([...state.deck, ...state.trail.map((e) => e.card)].filter((c) => c.kind === 'relic')).toEqual([expect.objectContaining({ value: 5 })]);
    state = chooseAll(state, 'return');
    state = applyAction(state, 'p0', { type: 'nextRound' }, fixedRandom);
    expect([...state.deck, ...state.trail.map((e) => e.card)].filter((c) => c.kind === 'relic').map((c) => c.kind === 'relic' ? c.value : 0).sort((a, b) => a - b)).toEqual([5, 7]);
  });
  it('legacy begins with all five identical unvalued relics', () => {
    const state = started('legacy');
    expect(state.deck.length + state.trail.length).toBe(35);
    const relics = [...state.deck, ...state.trail.map((e) => e.card)].filter((c) => c.kind === 'relic');
    expect(relics).toHaveLength(5);
    expect(relics.every((c) => c.kind === 'relic' && c.value === 0)).toBe(true);
  });
});

describe('treasure, simultaneous return, and traps', () => {
  it('divides treasure only among explorers, leaving the indivisible remainder', () => {
    let state = scenario([treasure(9), hazard('snake')], 'classic', 5);
    state = chooseAll(state, 'continue');
    expect(state.players.map((p) => p.loot)).toEqual([1, 1, 1, 1, 1]);
    expect(state.trail[0].remaining).toBe(4);
    expect(state.players.every((p) => p.bank === 0)).toBe(true);
  });
  it('pools trail remainders before dividing among simultaneous returners', () => {
    let state = scenario([treasure(7)], 'classic');
    state.trail = [1, 2, 3].map((n) => ({ card: treasure(n), remaining: 1 }));
    state.players.forEach((p) => { p.loot = 5; });
    const original = structuredClone(state);
    state = choose(state, 'p0', 'return');
    expect(state.players.map((p) => p.bank)).toEqual([0, 0, 0]);
    state = choose(state, 'p1', 'return');
    state = choose(state, 'p2', 'continue');
    expect(state.players.map((p) => p.bank)).toEqual([6, 6, 0]);
    expect(state.players.map((p) => p.loot)).toEqual([0, 0, 12]);
    expect(state.trail.reduce((sum, e) => sum + e.remaining, 0)).toBe(1);
    expect(original.players.map((p) => p.bank)).toEqual([0, 0, 0]);
  });
  it('returning players leave before the next danger is revealed and keep banked points', () => {
    let state = scenario([hazard('snake', 'second')], 'classic');
    state.trail = [{ card: hazard('snake', 'first'), remaining: 0 }];
    state.players.forEach((p) => { p.bank = 10; p.loot = 6; });
    state.roundStartScores = { p0: 10, p1: 10, p2: 10 };
    state = choose(state, 'p0', 'return');
    state = choose(state, 'p1', 'continue');
    state = choose(state, 'p2', 'continue');
    expect(state.phase).toBe('roundEnd');
    expect(state.players.map((p) => p.bank)).toEqual([16, 10, 10]);
    expect(state.players.map((p) => p.loot)).toEqual([0, 0, 0]);
    expect(state.players.map((p) => p.status)).toEqual(['camp', 'lost', 'lost']);
    expect(state.retiredHazards).toEqual([hazard('snake', 'second')]);
    expect(state.roundResult?.gains).toEqual({ p0: 6, p1: 0, p2: 0 });
    expect(state.roundResult?.lost).toEqual({ p0: 0, p1: 6, p2: 6 });
  });
  it('matches non-adjacent dangers and permanently removes only one copy', () => {
    let state = scenario([hazard('snake', 'a'), treasure(13), hazard('snake', 'b'), hazard('snake', 'c')], 'classic');
    state = chooseAll(state, 'continue');
    state = chooseAll(state, 'continue');
    state = chooseAll(state, 'continue');
    expect(state.phase).toBe('roundEnd');
    expect(state.retiredHazards).toHaveLength(1);
    state = applyAction(state, 'p0', { type: 'nextRound' }, fixedRandom);
    const all = [...state.deck, ...state.trail.map((e) => e.card)];
    expect(all.filter((c) => c.kind === 'hazard' && c.hazard === 'snake')).toHaveLength(2);
    expect(all.some((c) => c.id === 'test-h-snake-b')).toBe(false);
    expect(state.players.every((p) => p.status === 'exploring')).toBe(true);
  });
  it('all returners finish the round without drawing or removing a danger', () => {
    const original = scenario([hazard('snake')], 'classic');
    const state = chooseAll(original, 'return');
    expect(state.deck).toEqual(original.deck);
    expect(state.phase).toBe('roundEnd');
    expect(state.retiredHazards).toHaveLength(0);
    expect(state.roundResult?.reason).toBe('escaped');
  });
});

describe('relic ownership and loss', () => {
  it('exactly one returner takes all exposed relics; two take none', () => {
    let state = scenario([treasure(5), hazard('snake')]);
    state.trail = [{ card: relic(5), remaining: 0 }, { card: relic(7), remaining: 0 }];
    state = choose(state, 'p0', 'return');
    state = choose(state, 'p1', 'return');
    state = choose(state, 'p2', 'continue');
    expect(state.players.flatMap((p) => p.relics)).toHaveLength(0);
    state = choose(state, 'p2', 'return');
    expect(state.players[2].relics.map((r) => r.value)).toEqual([5, 7]);
    expect(state.relicsClaimed).toBe(2);
    expect(state.removedRelics).toHaveLength(0);
    expect(state.players[2].bank).toBe(5);
  });
  it('legacy awards by global collection order, including a multi-relic return crossing the threshold', () => {
    let state = scenario([treasure(1)], 'legacy');
    state.relicsClaimed = 2;
    state.trail = [0, 1, 2].map((n) => ({ card: relic(0, String(n)), remaining: 0 }));
    state = choose(state, 'p0', 'return');
    state = choose(state, 'p1', 'continue');
    state = choose(state, 'p2', 'continue');
    expect(state.players[0].relics.map((r) => r.value)).toEqual([5, 10, 10]);
    expect(state.relicsClaimed).toBe(5);
    expect(publicRoom(state, 'p0').players[0].score).toBe(25);
  });
  it('revealed unclaimed relics are removed even when everyone returns voluntarily', () => {
    let state = scenario([treasure(9), relic(7, 'undrawn')]);
    state.trail = [{ card: relic(5, 'exposed'), remaining: 0 }];
    state = chooseAll(state, 'return');
    expect(state.removedRelics).toEqual([relic(5, 'exposed')]);
    state = applyAction(state, 'p0', { type: 'nextRound' }, fixedRandom);
    expect([...state.deck, ...state.trail.map((e) => e.card)].some((c) => c.id === 'test-r-5-exposed')).toBe(false);
    expect([...state.deck, ...state.trail.map((e) => e.card)].some((c) => c.id === 'test-r-7-undrawn')).toBe(true);
  });
  it('claimed relics and exposed lost relics do not re-enter later decks', () => {
    let state = scenario([hazard('snake', 'second')]);
    state.trail = [{ card: relic(5), remaining: 0 }, { card: hazard('snake', 'first'), remaining: 0 }];
    state = choose(state, 'p0', 'return');
    state = choose(state, 'p1', 'continue');
    state = choose(state, 'p2', 'continue');
    state = applyAction(state, 'p0', { type: 'nextRound' }, fixedRandom);
    expect([...state.deck, ...state.trail.map((e) => e.card)].some((c) => c.id === 'test-r-5-')).toBe(false);
    expect(state.players[0].relics).toHaveLength(1);
  });
});

describe('privacy and action validation', () => {
  it('never exposes deck order, another choice, or another bank before scoring', () => {
    let state = started();
    state.players[0].bank = 27;
    state.players[1].bank = 9;
    state = choose(state, 'p0', 'return');
    const own = publicRoom(state, 'p0', 7);
    const other = publicRoom(state, 'p1');
    const visitor = publicRoom(state, null);
    expect(own.currentDecision).toBe('return');
    expect(other.currentDecision).toBe(null);
    expect(visitor.currentDecision).toBe(null);
    expect(other.decidedIds).toEqual(['p0']);
    expect(other.players[0].bank).toBe(null);
    expect(other.players[0].score).toBe(null);
    expect(other.players[1].bank).toBe(9);
    expect(visitor.players.every((p) => p.bank === null && p.score === null)).toBe(true);
    expect(own.version).toBe(7);
    for (const key of ['deck', 'decisions', 'roundStartScores']) expect(key in own).toBe(false);
    expect(JSON.stringify(other)).not.toContain('27');
    expect(other.events.at(-1)?.text).not.toContain('возвращается');
    other.trail[0].remaining = 999;
    expect(state.trail[0].remaining).not.toBe(999);
  });
  it('locks committed choices, rejects stale requests and camped players', () => {
    let state = started();
    state = choose(state, 'p0', 'return');
    expect(choose(state, 'p0', 'return')).toEqual(state);
    expectGameError(() => choose(state, 'p0', 'continue'), 'CHOICE_LOCKED');
    expectGameError(() => applyAction(state, 'p1', { type: 'choose', choice: 'continue', round: 99, turn: 1 }), 'STALE_TURN');
    state = choose(state, 'p1', 'continue'); state = choose(state, 'p2', 'continue');
    expectGameError(() => choose(state, 'p0', 'continue'), 'NOT_EXPLORING');
  });
  it('restricts host controls, player count, readiness, and joining a running game', () => {
    const state = lobby();
    expectGameError(() => applyAction(state, 'p1', { type: 'start' }), 'HOST_ONLY');
    expectGameError(() => applyAction(state, 'p0', { type: 'start' }), 'NOT_READY');
    expectGameError(() => applyAction(ready(lobby('classic', 2)), 'p0', { type: 'start' }), 'PLAYER_COUNT');
    expectGameError(() => addPlayer(lobby('classic', 8), createPlayer('p8', 'Девятый', 0)), 'ROOM_FULL');
    expectGameError(() => addPlayer(started(), createPlayer('other', 'Новый', 0)), 'GAME_STARTED');
    expectGameError(() => applyAction(started(), 'p0', { type: 'removePlayer', playerId: 'p1' }), 'LOBBY_ONLY');
    expectGameError(() => applyAction(started(), 'p0', { type: 'leave' }), 'GAME_IN_PROGRESS');
    expectGameError(() => applyAction(state, 'outsider', { type: 'ready', ready: true }), 'NOT_A_PLAYER');
  });
  it('resets readiness after rules change and migrates host when leaving the lobby', () => {
    let state = ready(lobby());
    state = applyAction(state, 'p0', { type: 'setMode', mode: 'classic' });
    expect(state.players.every((p) => !p.ready)).toBe(true);
    state = applyAction(state, 'p0', { type: 'leave' });
    expect(state.hostId).toBe('p1');
    expect(state.players.map((p) => p.id)).toEqual(['p1', 'p2']);
  });
  it('rejects invalid input rather than allowing values to reach scoring', () => {
    expectGameError(() => createPlayer('p', '  ', 0), 'INVALID_NAME');
    expectGameError(() => createPlayer('p', 'a\nb', 0), 'INVALID_NAME');
    expectGameError(() => createPlayer('p', 'Имя', 9), 'INVALID_AVATAR');
    expectGameError(() => applyAction(lobby(), 'p0', { type: 'setMode', mode: 'custom' } as unknown as RoomAction), 'INVALID_MODE');
    expectGameError(() => applyAction(ready(lobby()), 'p0', { type: 'start' }, () => 1), 'INVALID_RANDOM');
    expectGameError(() => applyAction(lobby(), 'p0', { type: 'noop' } as unknown as RoomAction), 'UNKNOWN_ACTION');
  });
});

describe('complete games and bots', () => {
  it('finishes after exactly five expeditions and shares equal-score wins', () => {
    let state = started('classic');
    for (let round = 1; round <= 5; round += 1) {
      expect(state.round).toBe(round);
      state = chooseAll(state, 'return');
      if (round < 5) {
        expect(state.phase).toBe('roundEnd');
        state = applyAction(state, 'p0', { type: 'nextRound' }, fixedRandom);
      }
    }
    expect(state.phase).toBe('finished');
    const room = publicRoom(state, null);
    expect(room.winners).toEqual(['p0', 'p1', 'p2']);
    expect(room.players.every((p) => p.score !== null)).toBe(true);
    expectGameError(() => applyAction(state, 'p0', { type: 'nextRound' }), 'WRONG_PHASE');
    state = applyAction(state, 'p0', { type: 'rematch' });
    expect(state.phase).toBe('lobby');
    expect(state.round).toBe(0);
    expect(state.players.every((p) => p.bank === 0 && p.relics.length === 0 && !p.ready)).toBe(true);
  });
  it('lets any seated human start the next expedition so an absent host does not block the game', () => {
    let state = chooseAll(started('classic'), 'return');
    expect(state.phase).toBe('roundEnd');
    state = applyAction(state, 'p1', { type: 'nextRound' }, fixedRandom);
    expect(state.round).toBe(2);
    expect(state.phase).toBe('decision');
    expect(state.hostId).toBe('p0');
    expect(state.trail).toHaveLength(1);
    expectGameError(() => applyAction(state, 'p2', { type: 'nextRound' }), 'WRONG_PHASE');
  });
  it('bots are ready, hide their choices, and finish the expedition when humans have returned', () => {
    let state = createGame('ABCDEF', createPlayer('human', 'Игрок', 0), 'classic');
    state = applyAction(state, 'human', { type: 'addBot' });
    state = applyAction(state, 'human', { type: 'addBot' });
    expect(state.players.filter((p) => p.isBot).every((p) => p.ready)).toBe(true);
    state = applyAction(state, 'human', { type: 'ready', ready: true });
    state = applyAction(state, 'human', { type: 'start' }, fixedRandom);
    state = advanceBots(state, fixedRandom);
    expect(Object.keys(state.decisions)).toHaveLength(2);
    expect(publicRoom(state, 'human').currentDecision).toBe(null);
    state = choose(state, 'human', 'return');
    state = advanceBots(state, fixedRandom);
    expect(state.phase).toBe('roundEnd');
    expect(state.round).toBe(1);
  });
  it('bot choices depend on public facts, never hidden deck order or another pending choice', () => {
    const state = started('classic');
    state.players[1].isBot = true;
    const reordered = structuredClone(state);
    reordered.deck.reverse();
    reordered.decisions = { p0: 'return' };
    const a = advanceBots(state, () => 0.3);
    const b = advanceBots(reordered, () => 0.3);
    expect(a.decisions.p1).toBe(b.decisions.p1);
  });
  it.each<GameMode>(['classic', 'relics', 'legacy'])('conserves card identities and nonnegative balances through seeded full games (%s)', (mode) => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const random = seeded(seed);
      let state = applyAction(ready(lobby(mode, 8)), 'p0', { type: 'start' }, random);
      let steps = 0;
      while (state.phase !== 'finished' && steps < 1000) {
        steps += 1;
        if (state.phase === 'roundEnd') {
          state = applyAction(state, 'p0', { type: 'nextRound' }, random);
        } else {
          const active = state.players.filter((p) => p.status === 'exploring');
          for (const p of active) state = choose(state, p.id, random() < 0.25 ? 'return' : 'continue');
        }
        for (const p of state.players) {
          expect(Number.isInteger(p.bank) && p.bank >= 0).toBe(true);
          expect(Number.isInteger(p.loot) && p.loot >= 0).toBe(true);
        }
        const available = [...state.deck, ...state.trail.map((e) => e.card)];
        expect(new Set(available.map((c) => c.id)).size).toBe(available.length);
        expect(new Set(state.retiredHazards.map((c) => c.id)).size).toBe(state.retiredHazards.length);
        expect(state.players.flatMap((p) => p.relics).length).toBe(state.relicsClaimed);
        if (state.phase === 'decision') {
          const deckIds = new Set(state.deck.map((c) => c.id));
          for (const c of [...state.retiredHazards, ...state.removedRelics, ...state.players.flatMap((p) => p.relics)]) expect(deckIds.has(c.id)).toBe(false);
        }
      }
      expect(state.phase).toBe('finished');
      expect(state.round).toBe(5);
      expect(steps).toBeLessThan(1000);
      const scores = state.players.map((p) => p.bank + p.relics.reduce((n, r) => n + r.value, 0));
      expect(publicRoom(state, null).winners.length).toBe(scores.filter((n) => n === Math.max(...scores)).length);
    }
  });
});
