import { type Card, RANK_PLURAL, RANK_WORD, cardId, idRankValue } from './cards';

/**
 * Hand categories, low to high. A higher category always beats a lower one.
 * Scores pack the category and up to five kickers in base 15 so two hands
 * compare with a single number.
 */
export const CATEGORY = {
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  TRIPS: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  QUADS: 7,
  STRAIGHT_FLUSH: 8,
} as const;

export type Category = (typeof CATEGORY)[keyof typeof CATEGORY];

export interface EvalResult {
  score: number;
  category: Category;
  name: string;
  five: Card[];
}

const COMBOS_7: readonly (readonly number[])[] = buildCombos(7);
const COMBOS_6: readonly (readonly number[])[] = buildCombos(6);

function buildCombos(n: number): number[][] {
  const out: number[][] = [];
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      for (let c = b + 1; c < n; c++) {
        for (let d = c + 1; d < n; d++) {
          for (let e = d + 1; e < n; e++) out.push([a, b, c, d, e]);
        }
      }
    }
  }
  return out;
}

function pack(category: number, ranks: number[]): number {
  let score = category;
  for (let i = 0; i < 5; i++) score = score * 15 + (ranks[i] ?? 0);
  return score;
}

export function categoryOf(score: number): Category {
  let value = score;
  for (let i = 0; i < 5; i++) value = Math.floor(value / 15);
  return value as Category;
}

export function unpack(score: number): { category: Category; ranks: number[] } {
  const ranks = [0, 0, 0, 0, 0];
  let value = score;
  for (let i = 4; i >= 0; i--) {
    ranks[i] = value % 15;
    value = Math.floor(value / 15);
  }
  return { category: value as Category, ranks };
}

/** Score a 5-card hand. Rank values are 2..14. */
export function scoreFive(ids: readonly number[]): number {
  const v0 = idRankValue(ids[0]);
  const v1 = idRankValue(ids[1]);
  const v2 = idRankValue(ids[2]);
  const v3 = idRankValue(ids[3]);
  const v4 = idRankValue(ids[4]);
  const values = [v0, v1, v2, v3, v4].sort((a, b) => b - a);

  const s0 = ids[0] & 3;
  const flush = (ids[1] & 3) === s0 && (ids[2] & 3) === s0 && (ids[3] & 3) === s0 && (ids[4] & 3) === s0;

  const counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  counts[v0]++;
  counts[v1]++;
  counts[v2]++;
  counts[v3]++;
  counts[v4]++;

  const unique: number[] = [];
  const quads: number[] = [];
  const trips: number[] = [];
  const pairs: number[] = [];
  for (let rank = 14; rank >= 2; rank--) {
    const count = counts[rank];
    if (!count) continue;
    unique.push(rank);
    if (count === 4) quads.push(rank);
    else if (count === 3) trips.push(rank);
    else if (count === 2) pairs.push(rank);
  }

  let straightHigh = 0;
  if (unique.length === 5) {
    if (unique[0] - unique[4] === 4) straightHigh = unique[0];
    else if (unique[0] === 14 && unique[1] === 5 && unique[2] === 4 && unique[3] === 3 && unique[4] === 2) {
      straightHigh = 5;
    }
  }

  if (flush && straightHigh) return pack(CATEGORY.STRAIGHT_FLUSH, [straightHigh]);
  if (quads.length) return pack(CATEGORY.QUADS, [quads[0], unique.find((rank) => rank !== quads[0]) ?? 0]);
  if (trips.length && pairs.length) return pack(CATEGORY.FULL_HOUSE, [trips[0], pairs[0]]);
  if (flush) return pack(CATEGORY.FLUSH, unique);
  if (straightHigh) return pack(CATEGORY.STRAIGHT, [straightHigh]);
  if (trips.length) {
    const kickers = unique.filter((rank) => rank !== trips[0]);
    return pack(CATEGORY.TRIPS, [trips[0], kickers[0] ?? 0, kickers[1] ?? 0]);
  }
  if (pairs.length >= 2) {
    const kicker = unique.find((rank) => rank !== pairs[0] && rank !== pairs[1]) ?? 0;
    return pack(CATEGORY.TWO_PAIR, [pairs[0], pairs[1], kicker]);
  }
  if (pairs.length === 1) {
    const kickers = unique.filter((rank) => rank !== pairs[0]);
    return pack(CATEGORY.PAIR, [pairs[0], kickers[0] ?? 0, kickers[1] ?? 0, kickers[2] ?? 0]);
  }
  return pack(CATEGORY.HIGH_CARD, values);
}

function bestOf(ids: number[]): { score: number; indexes: number[] } {
  if (ids.length === 5) return { score: scoreFive(ids), indexes: [0, 1, 2, 3, 4] };
  const combos = ids.length === 7 ? COMBOS_7 : COMBOS_6;
  let best = -1;
  let indexes: number[] = [0, 1, 2, 3, 4];
  const five = [0, 0, 0, 0, 0];
  for (const combo of combos) {
    five[0] = ids[combo[0]];
    five[1] = ids[combo[1]];
    five[2] = ids[combo[2]];
    five[3] = ids[combo[3]];
    five[4] = ids[combo[4]];
    const score = scoreFive(five);
    if (score > best) {
      best = score;
      indexes = [combo[0], combo[1], combo[2], combo[3], combo[4]];
    }
  }
  return { score: best, indexes };
}

function rankWordFromValue(value: number, plural = false): string {
  const rank =
    value === 14
      ? 'A'
      : value === 13
        ? 'K'
        : value === 12
          ? 'Q'
          : value === 11
            ? 'J'
            : value === 10
              ? 'T'
              : String(value);
  const table = plural ? RANK_PLURAL : RANK_WORD;
  return table[rank as keyof typeof table] ?? String(value);
}

export function handName(score: number): string {
  const { category, ranks } = unpack(score);
  if (category === CATEGORY.STRAIGHT_FLUSH) {
    if (ranks[0] === 14) return 'Royal flush';
    return `Straight flush, ${rankWordFromValue(ranks[0])} high`;
  }
  if (category === CATEGORY.QUADS) {
    return `Four ${rankWordFromValue(ranks[0], true)}`;
  }
  if (category === CATEGORY.FULL_HOUSE) {
    return `Full house, ${rankWordFromValue(ranks[0], true)} full of ${rankWordFromValue(ranks[1], true)}`;
  }
  if (category === CATEGORY.FLUSH) {
    return `Flush, ${rankWordFromValue(ranks[0])} high`;
  }
  if (category === CATEGORY.STRAIGHT) {
    return `Straight, ${rankWordFromValue(ranks[0])} high`;
  }
  if (category === CATEGORY.TRIPS) {
    return `Three ${rankWordFromValue(ranks[0], true)}`;
  }
  if (category === CATEGORY.TWO_PAIR) {
    return `Two pair, ${rankWordFromValue(ranks[0], true)} and ${rankWordFromValue(ranks[1], true)}`;
  }
  if (category === CATEGORY.PAIR) {
    return `Pair of ${rankWordFromValue(ranks[0], true)}`;
  }
  return `${rankWordFromValue(ranks[0]).replace(/^./, (c) => c.toUpperCase())} high`;
}

export function evaluate(cards: Card[]): EvalResult {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error(`Evaluator needs 5 to 7 cards, received ${cards.length}`);
  }
  const ids = cards.map(cardId);
  const best = bestOf(ids);
  return {
    score: best.score,
    category: categoryOf(best.score),
    name: handName(best.score),
    five: best.indexes.map((index) => cards[index]),
  };
}

export function evaluateIds(ids: number[]): number {
  if (ids.length < 5 || ids.length > 7) {
    throw new Error(`Evaluator needs 5 to 7 cards, received ${ids.length}`);
  }
  return bestOf(ids).score;
}

export function compareScores(a: number, b: number): number {
  return a - b;
}
