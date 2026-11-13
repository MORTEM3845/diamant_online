export type GameMode = 'classic' | 'relics' | 'legacy';
export type Phase = 'lobby' | 'decision' | 'roundEnd' | 'finished';
export type Choice = 'continue' | 'return';
export type HazardType = 'snake' | 'scorpion' | 'lava' | 'boulder' | 'spikes';
export type TreasureCard = { id: string; kind: 'treasure'; value: number };
export type HazardCard = { id: string; kind: 'hazard'; hazard: HazardType };
export type RelicCard = { id: string; kind: 'relic'; value: number };
export type Card = TreasureCard | HazardCard | RelicCard;
export interface TrailEntry { card: Card; remaining: number; claimedBy?: string }
export interface Player {
  id: string; name: string; avatar: number; isBot: boolean; ready: boolean;
  bank: number; loot: number; relics: RelicCard[];
  status: 'exploring' | 'camp' | 'lost';
}
export interface GameEvent { id: number; round: number; turn: number; text: string; kind: 'info' | 'treasure' | 'hazard' | 'return' | 'relic' }
export interface RoundResult { round: number; reason: 'escaped' | 'hazard' | 'exhausted'; hazard?: HazardType; gains: Record<string, number>; lost: Record<string, number> }
export interface GameState {
  schemaVersion: 1; code: string; hostId: string; mode: GameMode; phase: Phase;
  round: number; turn: number; players: Player[]; deck: Card[]; trail: TrailEntry[];
  decisions: Record<string, Choice>; retiredHazards: HazardCard[];
  removedRelics: RelicCard[]; relicsClaimed: number; events: GameEvent[];
  roundResult: RoundResult | null; roundStartScores: Record<string, number>;
}
export type PublicPlayer = Omit<Player, 'bank'> & { bank: number | null; score: number | null };
export interface PublicRoom {
  code: string; hostId: string; mode: GameMode; phase: Phase; round: number; turn: number;
  version: number; youId: string | null; currentDecision: Choice | null;
  players: PublicPlayer[]; trail: TrailEntry[]; deckRemaining: number;
  retiredHazards: HazardType[]; removedRelicValues: number[];
  decidedIds: string[]; events: GameEvent[]; roundResult: RoundResult | null;
  winners: string[];
}
export type RoomAction =
  | { type: 'ready'; ready: boolean }
  | { type: 'start' }
  | { type: 'choose'; choice: Choice; round: number; turn: number }
  | { type: 'nextRound' }
  | { type: 'addBot' }
  | { type: 'removePlayer'; playerId: string }
  | { type: 'setMode'; mode: GameMode }
  | { type: 'rematch' }
  | { type: 'leave' };
export interface Session { code: string; playerId: string; token: string }
export interface SessionResponse extends Session { room: PublicRoom }
export const MODE_LABELS: Record<GameMode, string> = {
  classic: 'Классика', relics: 'С реликвиями', legacy: 'Редакция 2016',
};
export const HAZARD_LABELS: Record<HazardType, string> = {
  snake: 'Змеи', scorpion: 'Скорпионы', lava: 'Лава', boulder: 'Обвал', spikes: 'Ловушка',
};
