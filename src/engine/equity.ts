import { type Card, allCards, cardId, cardText, sameCard } from './cards';
import { evaluateIds } from './evaluator';

export interface WeightedCombo {
  cards: [Card, Card];
  /** Solver exports can use fractional weights. Charts use 1. */
  weight: number;
}

export interface EquityResult {
  equity: number;
  win: number;
  tie: number;
  lose: number;
  iterations: number;
  method: 'exact' | 'monte-carlo';
}

interface IdCombo {
  ids: [number, number];
  weight: number;
}

/**
 * Hero equity against a weighted villain range.
 * The river (and the turn, when the range is not huge) is enumerated.
 * Earlier streets use seeded Monte Carlo. Equity counts a tie as half a win.
 */
export function equityVsRange(options: {
  hero: [Card, Card];
  board: Card[];
  range: WeightedCombo[];
  iterations?: number;
  seed?: number;
}): EquityResult {
  const heroIds: [number, number] = [cardId(options.hero[0]), cardId(options.hero[1])];
  const boardIds = options.board.map(cardId);
  const dead = new Set<number>([heroIds[0], heroIds[1], ...boardIds]);
  if (dead.size !== 2 + boardIds.length) throw new Error('Duplicate cards in the hero hand or board');

  let combos = toIdCombos(options.range, dead);
  if (combos.length === 0) combos = randomCombos(dead);

  const deck = allCards()
    .map(cardId)
    .filter((id) => !dead.has(id));
  const need = 5 - boardIds.length;
  if (need < 0) throw new Error('Board has more than 5 cards');

  if (need === 0) return exactRiver(heroIds, boardIds, combos);
  if (need === 1 && combos.length <= 500) return exactTurn(heroIds, boardIds, combos, deck);
  return monteCarlo(heroIds, boardIds, combos, deck, need, options.iterations ?? 1600, options.seed ?? 1);
}

function toIdCombos(range: WeightedCombo[], dead: Set<number>): IdCombo[] {
  const out: IdCombo[] = [];
  for (const combo of range) {
    if (combo.weight <= 0) continue;
    const a = cardId(combo.cards[0]);
    const b = cardId(combo.cards[1]);
    if (a === b || dead.has(a) || dead.has(b)) continue;
    out.push({ ids: [a, b], weight: combo.weight });
  }
  return out;
}

function randomCombos(dead: Set<number>): IdCombo[] {
  const ids = allCards().map(cardId).filter((id) => !dead.has(id));
  const out: IdCombo[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) out.push({ ids: [ids[i], ids[j]], weight: 1 });
  }
  return out;
}

function exactRiver(hero: [number, number], board: number[], combos: IdCombo[]): EquityResult {
  const heroScore = evaluateIds([...hero, ...board]);
  let win = 0;
  let tie = 0;
  let lose = 0;
  let total = 0;
  const villain = [0, 0, board[0], board[1], board[2], board[3], board[4]];
  for (const combo of combos) {
    villain[0] = combo.ids[0];
    villain[1] = combo.ids[1];
    const score = evaluateIds(villain);
    total += combo.weight;
    if (heroScore > score) win += combo.weight;
    else if (heroScore < score) lose += combo.weight;
    else tie += combo.weight;
  }
  return packResult(win, tie, lose, total, combos.length, 'exact');
}

function exactTurn(hero: [number, number], board: number[], combos: IdCombo[], deck: number[]): EquityResult {
  let win = 0;
  let tie = 0;
  let lose = 0;
  let total = 0;
  let samples = 0;
  const heroCards = [hero[0], hero[1], board[0], board[1], board[2], board[3], 0];
  const villain = [0, 0, board[0], board[1], board[2], board[3], 0];
  for (const combo of combos) {
    for (const river of deck) {
      if (river === combo.ids[0] || river === combo.ids[1]) continue;
      heroCards[6] = river;
      villain[0] = combo.ids[0];
      villain[1] = combo.ids[1];
      villain[6] = river;
      const heroScore = evaluateIds(heroCards);
      const villainScore = evaluateIds(villain);
      total += combo.weight;
      samples++;
      if (heroScore > villainScore) win += combo.weight;
      else if (heroScore < villainScore) lose += combo.weight;
      else tie += combo.weight;
    }
  }
  return packResult(win, tie, lose, total, samples, 'exact');
}

function monteCarlo(
  hero: [number, number],
  board: number[],
  combos: IdCombo[],
  deck: number[],
  need: number,
  iterations: number,
  seed: number,
): EquityResult {
  const rng = mulberry32(seed);
  const cumulative: number[] = [];
  let sum = 0;
  for (const combo of combos) {
    sum += combo.weight;
    cumulative.push(sum);
  }
  let win = 0;
  let tie = 0;
  let lose = 0;
  const heroCards = [hero[0], hero[1], 0, 0, 0, 0, 0];
  const villain = [0, 0, 0, 0, 0, 0, 0];
  const available: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const combo = combos[pickIndex(cumulative, sum, rng)];
    available.length = 0;
    for (const id of deck) {
      if (id !== combo.ids[0] && id !== combo.ids[1]) available.push(id);
    }
    for (let k = 0; k < need; k++) {
      const swap = k + Math.floor(rng() * (available.length - k));
      const tmp = available[k];
      available[k] = available[swap];
      available[swap] = tmp;
    }
    for (let k = 0; k < 5; k++) {
      const card = k < board.length ? board[k] : available[k - board.length];
      heroCards[2 + k] = card;
      villain[2 + k] = card;
    }
    villain[0] = combo.ids[0];
    villain[1] = combo.ids[1];
    const heroScore = evaluateIds(heroCards);
    const villainScore = evaluateIds(villain);
    if (heroScore > villainScore) win++;
    else if (heroScore < villainScore) lose++;
    else tie++;
  }
  return packResult(win, tie, lose, iterations, iterations, 'monte-carlo');
}

function pickIndex(cumulative: number[], total: number, rng: () => number): number {
  const target = rng() * total;
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function packResult(
  win: number,
  tie: number,
  lose: number,
  total: number,
  iterations: number,
  method: EquityResult['method'],
): EquityResult {
  if (total <= 0) return { equity: 0, win: 0, tie: 0, lose: 0, iterations: 0, method };
  return {
    equity: (win + tie / 2) / total,
    win: win / total,
    tie: tie / total,
    lose: lose / total,
    iterations,
    method,
  };
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFrom(parts: string[]): number {
  let hash = 2166136261;
  const text = parts.join('|');
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function cardsConflict(cards: Card[]): boolean {
  const seen = new Set<string>();
  for (const card of cards) {
    const key = cardText(card);
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

export function excludes(card: Card, blocked: Card[]): boolean {
  return blocked.some((other) => sameCard(card, other));
}
