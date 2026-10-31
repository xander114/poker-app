import { type Card, type Rank, RANKS, SUITS, handKey, rankIndex } from './cards';
import type { Position } from './constants';
import type { WeightedCombo } from './equity';

/**
 * Full-ring 100bb preflop charts.
 *
 * These are simplified, unmixed charts in the style of published 9-max
 * no-limit opening and defense ranges: early positions open in the low
 * teens of hands, the button opens much wider, the small blind is mostly
 * raise-or-fold, and the big blind defends wider. They are not a commercial
 * solver dump and they do not include mixed frequencies.
 *
 * Plug-in point: replace these strings, or the WeightedCombo[] produced by
 * `combosFromRange`, with combo-level weights from a solver export. Every
 * preflop decision reads ranges only through `expandRange` / `combosFromRange`.
 */

export type OpenerGroup = 'EP' | 'MP' | 'CO' | 'BTN' | 'SB';

const cache = new Map<string, Set<string>>();

export function pairsFrom(low: Rank): string {
  const end = rankIndex(low);
  const parts: string[] = [];
  for (let i = end; i >= 0; i--) parts.push(`${RANKS[i]}${RANKS[i]}`);
  return parts.join(',');
}

export function pairsBetween(high: Rank, low: Rank): string {
  const start = rankIndex(high);
  const end = rankIndex(low);
  const parts: string[] = [];
  for (let i = start; i <= end; i++) parts.push(`${RANKS[i]}${RANKS[i]}`);
  return parts.join(',');
}

/** Every suited hand from `high` down to `lowestKicker`, inclusive. */
export function suitedDown(high: Rank, lowestKicker: Rank): string {
  return down(high, lowestKicker, 's');
}

export function offsuitDown(high: Rank, lowestKicker: Rank): string {
  return down(high, lowestKicker, 'o');
}

function down(high: Rank, lowestKicker: Rank, kind: 's' | 'o'): string {
  const start = rankIndex(high) + 1;
  const end = rankIndex(lowestKicker);
  const parts: string[] = [];
  for (let i = start; i <= end; i++) parts.push(`${high}${RANKS[i]}${kind}`);
  return parts.join(',');
}

export function range(...parts: string[]): string {
  return parts
    .flatMap((part) => part.split(','))
    .map((token) => token.trim())
    .filter(Boolean)
    .join(',');
}

export function expandRange(expr: string): Set<string> {
  const hit = cache.get(expr);
  if (hit) return hit;
  const hands = new Set<string>();
  for (const raw of expr.split(',')) {
    const token = raw.trim();
    if (!token) continue;
    for (const hand of expandToken(token)) hands.add(hand);
  }
  cache.set(expr, hands);
  return hands;
}

export function inRange(hand: string, expr: string): boolean {
  if (!expr) return false;
  return expandRange(expr).has(hand);
}

export function comboCount(expr: string): number {
  let total = 0;
  for (const hand of expandRange(expr)) total += hand.length === 2 ? 6 : hand.endsWith('s') ? 4 : 12;
  return total;
}

function expandToken(token: string): string[] {
  if (token.includes('-') && token.endsWith('+') === false) {
    const [left, right] = token.split('-');
    return expandSpan(left, right);
  }
  if (token.endsWith('+')) return expandPlus(token.slice(0, -1));
  return [normalizeHand(token)];
}

function expandPlus(body: string): string[] {
  if (/^([2-9TJQKA])\1$/.test(body)) return pairsFrom(body[0] as Rank).split(',');
  const parsed = parseBroad(body);
  const hands: string[] = [];
  const high = rankIndex(parsed.high);
  const low = rankIndex(parsed.low);
  for (let k = low; k > high; k--) hands.push(`${parsed.high}${RANKS[k]}${parsed.kind}`);
  return hands;
}

function expandSpan(left: string, right: string): string[] {
  const a = parseBroad(left);
  const b = parseBroad(right);
  if (a.high !== b.high || a.kind !== b.kind) {
    throw new Error(`Can't expand range span ${left}-${right}`);
  }
  const start = rankIndex(a.low);
  const end = rankIndex(b.low);
  const [from, to] = start <= end ? [start, end] : [end, start];
  const hands: string[] = [];
  for (let k = from; k <= to; k++) hands.push(`${a.high}${RANKS[k]}${a.kind}`);
  return hands;
}

function parseBroad(token: string): { high: Rank; low: Rank; kind: 's' | 'o' } {
  const match = token.match(/^([2-9TJQKA])([2-9TJQKA])([so])$/);
  if (!match) throw new Error(`Bad hand token: ${token}`);
  return { high: match[1] as Rank, low: match[2] as Rank, kind: match[3] as 's' | 'o' };
}

function normalizeHand(token: string): string {
  if (/^([2-9TJQKA])\1$/.test(token)) return `${token[0]}${token[1]}`;
  const parsed = parseBroad(token);
  if (rankIndex(parsed.high) >= rankIndex(parsed.low)) throw new Error(`Bad hand token: ${token}`);
  return `${parsed.high}${parsed.low}${parsed.kind}`;
}

export function combosFromRange(expr: string, dead: Card[] = []): WeightedCombo[] {
  const hands = expandRange(expr);
  const blocked = new Set(dead.map((card) => `${card.rank}${card.suit}`));
  const combos: WeightedCombo[] = [];
  for (let i = 0; i < RANKS.length; i++) {
    for (let s1 = 0; s1 < SUITS.length; s1++) {
      for (let j = i; j < RANKS.length; j++) {
        for (let s2 = 0; s2 < SUITS.length; s2++) {
          if (i === j && s2 <= s1) continue;
          const a: Card = { rank: RANKS[i], suit: SUITS[s1] };
          const b: Card = { rank: RANKS[j], suit: SUITS[s2] };
          if (blocked.has(`${a.rank}${a.suit}`) || blocked.has(`${b.rank}${b.suit}`)) continue;
          if (!hands.has(handKey(a, b))) continue;
          combos.push({ cards: [a, b], weight: 1 });
        }
      }
    }
  }
  return combos;
}

export function openerGroup(position: Position): OpenerGroup {
  if (position === 'UTG' || position === 'UTG+1' || position === 'UTG+2') return 'EP';
  if (position === 'LJ' || position === 'HJ') return 'MP';
  if (position === 'CO') return 'CO';
  if (position === 'BTN') return 'BTN';
  return 'SB';
}

/** Open sizes in big blinds. SB opens larger; everyone else uses a 2.5bb open. */
export const OPEN_SIZE_BB: Record<Position, number> = {
  UTG: 2.5,
  'UTG+1': 2.5,
  'UTG+2': 2.5,
  LJ: 2.5,
  HJ: 2.5,
  CO: 2.5,
  BTN: 2.5,
  SB: 3,
  BB: 3.5,
};

const UTG_OPEN = range(
  pairsFrom('2'),
  suitedDown('A', 'T'),
  'A5s',
  'A4s',
  suitedDown('K', 'T'),
  'QJs',
  'JTs',
  'T9s',
  '98s',
  offsuitDown('A', 'J'),
  'KQo',
);

const UTG1_OPEN = range(UTG_OPEN, 'A9s', 'A3s', 'K9s', 'QTs', 'J9s', 'T8s', '87s', 'ATo', 'KJo');

const UTG2_OPEN = range(
  UTG1_OPEN,
  'A8s',
  'A7s',
  'A6s',
  'A2s',
  'K8s',
  'Q9s',
  'J8s',
  '97s',
  '76s',
  'KTo',
  'QJo',
);

const LJ_OPEN = range(
  UTG2_OPEN,
  'K7s',
  'K6s',
  'Q8s',
  'T7s',
  '86s',
  '65s',
  'A9o',
  'K9o',
  'QTo',
  'JTo',
  'T9o',
);

const HJ_OPEN = range(
  LJ_OPEN,
  'K5s',
  'K4s',
  'Q7s',
  'J7s',
  '96s',
  '85s',
  '75s',
  '54s',
  'A8o',
  'A7o',
  'K8o',
  'Q9o',
  'J9o',
  '98o',
);

const CO_OPEN = range(
  HJ_OPEN,
  suitedDown('K', '2'),
  suitedDown('Q', '4'),
  suitedDown('J', '5'),
  suitedDown('T', '6'),
  '95s',
  '84s',
  '74s',
  '64s',
  '53s',
  '43s',
  offsuitDown('A', '2'),
  offsuitDown('K', '7'),
  'Q8o',
  'J8o',
  'T8o',
  '97o',
  '87o',
);

const BTN_OPEN = range(
  CO_OPEN,
  suitedDown('Q', '2'),
  suitedDown('J', '2'),
  suitedDown('T', '2'),
  suitedDown('9', '3'),
  suitedDown('8', '4'),
  suitedDown('7', '4'),
  suitedDown('6', '4'),
  '52s',
  '42s',
  '32s',
  offsuitDown('K', '4'),
  offsuitDown('Q', '8'),
  offsuitDown('J', '8'),
  'T7o',
  '97o',
  '86o',
  '76o',
);

const SB_OPEN = range(
  pairsFrom('2'),
  suitedDown('A', '2'),
  suitedDown('K', '5'),
  suitedDown('Q', '8'),
  suitedDown('J', '8'),
  suitedDown('T', '7'),
  '97s',
  '86s',
  '76s',
  '75s',
  '65s',
  '64s',
  '54s',
  offsuitDown('A', '9'),
  offsuitDown('K', 'T'),
  'QTo',
  'JTo',
  'T9o',
);

export const OPEN_RANGE: Record<Position, string> = {
  UTG: UTG_OPEN,
  'UTG+1': UTG1_OPEN,
  'UTG+2': UTG2_OPEN,
  LJ: LJ_OPEN,
  HJ: HJ_OPEN,
  CO: CO_OPEN,
  BTN: BTN_OPEN,
  SB: SB_OPEN,
  BB: '',
};

const BB_CALL_EP = range(
  pairsFrom('2'),
  suitedDown('A', '2'),
  suitedDown('K', 'T'),
  'QJs',
  'QTs',
  'JTs',
  'T9s',
  '98s',
  '87s',
  '76s',
  offsuitDown('A', 'T'),
  'KQo',
  'KJo',
);

const BB_CALL_MP = range(
  BB_CALL_EP,
  suitedDown('K', '8'),
  'Q9s',
  'J9s',
  'T8s',
  '97s',
  '86s',
  '65s',
  'A9o',
  'KTo',
  'QTo',
  'JTo',
);

const BB_CALL_WIDE = range(
  pairsFrom('2'),
  suitedDown('A', '2'),
  suitedDown('K', '2'),
  suitedDown('Q', '4'),
  suitedDown('J', '6'),
  suitedDown('T', '6'),
  suitedDown('9', '6'),
  suitedDown('8', '6'),
  '75s',
  '65s',
  '64s',
  '54s',
  '53s',
  '43s',
  offsuitDown('A', '2'),
  offsuitDown('K', '8'),
  offsuitDown('Q', '9'),
  offsuitDown('J', '9'),
  'T9o',
  '98o',
);

const BTN_CALL_TIGHT = range(
  pairsBetween('9', '2'),
  suitedDown('A', '2'),
  suitedDown('K', '9'),
  'QTs',
  'QJs',
  'JTs',
  'T9s',
  '98s',
  '87s',
  '76s',
  'AJo',
  'KQo',
  'KJo',
);

const BTN_CALL_WIDE = range(
  pairsFrom('2'),
  suitedDown('A', '2'),
  suitedDown('K', '6'),
  suitedDown('Q', '8'),
  suitedDown('J', '8'),
  suitedDown('T', '7'),
  '97s',
  '86s',
  '76s',
  '65s',
  '54s',
  offsuitDown('A', '9'),
  offsuitDown('K', 'T'),
  'QTo',
  'JTo',
  'T9o',
);

const LATE_CALL_EP = range(
  pairsBetween('T', '5'),
  suitedDown('A', '9'),
  'KQs',
  'KJs',
  'KTs',
  'QJs',
  'QTs',
  'JTs',
  'T9s',
  '98s',
  '87s',
  'AQo',
  'AJo',
  'KQo',
);

const LATE_CALL_WIDE = range(
  LATE_CALL_EP,
  pairsBetween('4', '2'),
  'A8s',
  'A7s',
  'A6s',
  'A5s',
  'K9s',
  'Q9s',
  'J9s',
  'T8s',
  '76s',
  '65s',
  'KJo',
  'QJo',
);

const EARLY_CALL = range(
  pairsBetween('J', '7'),
  'AJs',
  'ATs',
  'KQs',
  'QJs',
  'JTs',
  'T9s',
  '98s',
  'AQo',
);

const EARLY_CALL_WIDE = range(
  EARLY_CALL,
  pairsBetween('6', '2'),
  'A9s',
  'A8s',
  'KJs',
  'KTs',
  'QTs',
  'J9s',
  '87s',
  '76s',
  'AJo',
  'KQo',
);

const VALUE_3BET = range(pairsFrom('Q'), 'AKs', 'AKo', 'AQs', 'A5s', 'A4s');
const HJ_3BET = range(pairsFrom('J'), 'AKs', 'AQs', 'AKo', 'AQo', 'KQs', 'A5s', 'A4s', 'A3s');
const BTN_3BET = range(
  pairsFrom('T'),
  suitedDown('A', 'J'),
  offsuitDown('A', 'Q'),
  'KQs',
  'KJs',
  suitedDown('A', '2'),
  '76s',
  '65s',
);
const SB_3BET = range(pairsFrom('T'), suitedDown('A', 'J'), offsuitDown('A', 'Q'), 'KQs', 'A5s', 'A4s', 'A3s', '76s', '65s', '54s');
const BB_3BET_TIGHT = range(pairsFrom('Q'), 'AKs', 'AKo', 'AQs', 'A5s', 'A4s', 'KQs');
const BB_3BET_WIDE = range(pairsFrom('T'), suitedDown('A', 'Q'), 'AKo', 'AQo', suitedDown('A', '2'), 'KQs', '76s', '65s');

export function threeBetRange(hero: Position, opener: Position): string {
  const group = openerGroup(opener);
  if (hero === 'SB') return SB_3BET;
  if (hero === 'BB') return group === 'EP' || group === 'MP' ? BB_3BET_TIGHT : BB_3BET_WIDE;
  if (hero === 'BTN') return BTN_3BET;
  if (hero === 'CO' || hero === 'HJ') return HJ_3BET;
  return VALUE_3BET;
}

export function callRange(hero: Position, opener: Position): string {
  const group = openerGroup(opener);
  const late = group === 'CO' || group === 'BTN' || group === 'SB';
  if (hero === 'SB') return '';
  if (hero === 'BB') return late ? BB_CALL_WIDE : group === 'EP' ? BB_CALL_EP : BB_CALL_MP;
  if (hero === 'BTN') return late ? BTN_CALL_WIDE : BTN_CALL_TIGHT;
  if (hero === 'CO' || hero === 'HJ') return late ? LATE_CALL_WIDE : LATE_CALL_EP;
  return late ? EARLY_CALL_WIDE : EARLY_CALL;
}

/** Big blind raises this range over limps and checks the rest. */
export const BB_ISO = range(
  pairsFrom('7'),
  suitedDown('A', 'T'),
  'A5s',
  'A4s',
  'A3s',
  'A2s',
  'KQs',
  'KJs',
  'QJs',
  'JTs',
  offsuitDown('A', 'Q'),
  'KQo',
);

export function fourBetRange(hero: Position): { fourBet: string; call: string } {
  const late = hero === 'BTN' || hero === 'CO' || hero === 'HJ';
  return {
    fourBet: late
      ? range(pairsFrom('K'), 'AKs', 'AKo', 'AQs', 'A5s', 'A4s')
      : range(pairsFrom('K'), 'AKs', 'AKo'),
    call: late
      ? range(pairsBetween('Q', '8'), 'AQs', 'AJs', 'KQs', 'JTs', 'T9s')
      : range(pairsBetween('Q', 'T'), 'AQs'),
  };
}

export function coldFourBetRange(hero: Position): { fourBet: string; call: string } {
  const late = hero === 'BTN' || hero === 'CO';
  return {
    fourBet: range(pairsFrom('K'), 'AKs'),
    call: late ? range('QQ', 'AKo', 'AQs', pairsBetween('J', '9'), 'JTs', 'T9s') : range('QQ', 'AKo'),
  };
}

/** Continue range when facing a 4-bet that is not all-in: 5-bet KK+, call QQ and AK. */
export const FIVE_BET_RANGE = range(pairsFrom('K'));
export const CALL_VS_FOUR_BET = range('QQ', 'AKs', 'AKo');
/** Calling a 4-bet or 5-bet jam. */
export const CALL_VS_JAM = range(pairsFrom('Q'), 'AKs', 'AKo');
export const CALL_VS_FIVE_BET_JAM = range(pairsFrom('K'));

export function continuesMultiway(hand: string, callers: number): boolean {
  if (callers <= 0) return true;
  if (hand.length === 2) return true;
  if (!hand.endsWith('s')) return false;
  if (callers === 1) return true;
  if (hand[0] === 'A') return true;
  const gap = rankIndex(hand[1]) - rankIndex(hand[0]) - 1;
  return gap <= 2;
}
