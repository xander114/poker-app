import { CATEGORY, evaluate } from './evaluator';
import {
  type Card,
  RANK_PLURAL,
  RANK_VALUE,
  RANK_WORD,
  type Rank,
  capitalize,
} from './cards';

export type Strength = 'monster' | 'strong' | 'showdown' | 'weak' | 'air';
export type Wetness = 'dry' | 'dynamic' | 'wet';

export interface Texture {
  wetness: Wetness;
  paired: boolean;
  monotone: boolean;
  twoTone: boolean;
  connected: boolean;
  highCard: string;
  summary: string;
}

export interface HandRead {
  rankName: string;
  madeLabel: string;
  strength: Strength;
  drawLabels: string[];
  outs: number;
  flushDraw: boolean;
  nutFlushDraw: boolean;
  oesd: boolean;
  gutshot: boolean;
  overcards: number;
  playingBoard: boolean;
}

const EMPTY_TEXTURE: Texture = {
  wetness: 'dry',
  paired: false,
  monotone: false,
  twoTone: false,
  connected: false,
  highCard: '',
  summary: 'no board yet',
};

export function boardTexture(board: Card[]): Texture {
  if (board.length < 3) return EMPTY_TEXTURE;
  const flop = board.slice(0, 3);
  const flopValues = flop.map((card) => RANK_VALUE[card.rank]).sort((a, b) => a - b);
  const allValues = board.map((card) => RANK_VALUE[card.rank]);
  const paired = allValues.some((value, index) => allValues.indexOf(value) !== index);

  const suitCount = new Map<string, number>();
  for (const card of board) suitCount.set(card.suit, (suitCount.get(card.suit) ?? 0) + 1);
  const maxSuit = Math.max(...suitCount.values());
  const suitKinds = suitCount.size;
  const monotone = maxSuit >= 3 && suitKinds === 1;
  const twoTone = suitKinds === 2;
  const rainbow = maxSuit === 1;

  const span = flopValues[2] - flopValues[0];
  const close = flopValues[1] - flopValues[0] <= 2 || flopValues[2] - flopValues[1] <= 2;
  let connected = span <= 4;
  if (flopValues.includes(14)) {
    const lows = [1, ...flopValues.filter((value) => value !== 14)].sort((a, b) => a - b);
    if (lows.length >= 3 && lows[2] - lows[0] <= 4) connected = true;
  }

  let wetness: Wetness;
  if (monotone || maxSuit >= 4 || (twoTone && (connected || close)) || (maxSuit >= 3 && (connected || close))) wetness = 'wet';
  else if (maxSuit >= 3 || twoTone || connected || paired) wetness = 'dynamic';
  else wetness = 'dry';

  const high = Math.max(...allValues);
  const highCard = RANK_WORD[valueToRank(high)];
  let suitLabel: string | null = 'rainbow';
  if (maxSuit >= 4) suitLabel = 'four-flush';
  else if (monotone || maxSuit >= 3) suitLabel = 'three-flush';
  else if (twoTone) suitLabel = 'two-tone';
  else if (!rainbow) suitLabel = null;
  const parts = [wetness === 'dry' ? 'dry' : wetness === 'wet' ? 'wet' : 'dynamic', suitLabel].filter(
    (part): part is string => Boolean(part),
  );
  if (paired) parts.push('paired');
  if (connected) parts.push('connected');
  parts.push(`${highCard}-high`);

  return { wetness, paired, monotone, twoTone, connected, highCard, summary: parts.join(', ') };
}

export function analyzeHolding(hole: [Card, Card], board: Card[]): HandRead {
  const all = [...hole, ...board];
  const evaluated = board.length >= 3 ? evaluate(all) : null;
  const playingBoard =
    board.length === 5 && evaluated !== null && evaluate(board).score === evaluated.score;

  const draws = board.length >= 3 ? detectDraws(hole, board, evaluated?.category ?? 0) : emptyDraws();
  const made = evaluated ? describeMade(hole, board, evaluated.category, evaluated.name, playingBoard) : null;

  const madeLabel = made?.label ?? '';
  let strength: Strength = made?.strength ?? 'air';
  const boardSuitMax = maxSuitCount(board);
  const hasFlush = (evaluated?.category ?? 0) >= CATEGORY.FLUSH && !playingBoard;
  if (boardSuitMax >= 4 && !hasFlush && evaluated && evaluated.category < CATEGORY.FULL_HOUSE && !playingBoard) {
    if (strength === 'monster' || strength === 'strong') strength = 'showdown';
  }
  if (playingBoard) strength = 'weak';

  return {
    rankName: evaluated?.name ?? '',
    madeLabel: playingBoard ? `${madeLabel} on the board` : madeLabel,
    strength,
    drawLabels: draws.labels,
    outs: draws.outs,
    flushDraw: draws.flushDraw,
    nutFlushDraw: draws.nutFlushDraw,
    oesd: draws.oesd,
    gutshot: draws.gutshot,
    overcards: draws.overcards,
    playingBoard,
  };
}

function describeMade(
  hole: [Card, Card],
  board: Card[],
  category: number,
  rankName: string,
  playingBoard: boolean,
): { label: string; strength: Strength } {
  if (playingBoard) return { label: rankName, strength: 'weak' };
  if (category === CATEGORY.STRAIGHT_FLUSH || category === CATEGORY.QUADS || category === CATEGORY.FULL_HOUSE) {
    return { label: rankName, strength: 'monster' };
  }
  if (category === CATEGORY.FLUSH) return { label: rankName, strength: 'monster' };
  if (category === CATEGORY.STRAIGHT) return { label: rankName, strength: 'monster' };

  const holeValues = hole.map((card) => RANK_VALUE[card.rank]);
  const boardValues = board.map((card) => RANK_VALUE[card.rank]);
  const topBoard = Math.max(...boardValues);
  const uniqueBoard = [...new Set(boardValues)].sort((a, b) => b - a);

  if (category === CATEGORY.TRIPS) {
    if (holeValues[0] === holeValues[1] && boardValues.includes(holeValues[0])) {
      return { label: `Set of ${RANK_PLURAL[valueToRank(holeValues[0])]}`, strength: 'monster' };
    }
    if (holeValues[0] !== holeValues[1] && (boardValues.includes(holeValues[0]) || boardValues.includes(holeValues[1]))) {
      const trip = boardPairRank(boardValues) ?? holeValues.find((value) => boardValues.includes(value)) ?? holeValues[0];
      const kicker = holeValues.find((value) => value !== trip);
      const kickerText = kicker ? `, ${RANK_WORD[valueToRank(kicker)]} kicker` : '';
      return { label: `Trips${kickerText}`, strength: 'monster' };
    }
    return { label: 'Trips on the board', strength: 'showdown' };
  }

  if (category === CATEGORY.TWO_PAIR) {
    const pairRanks = pairRanksIn(holeValues, boardValues);
    const higher = Math.max(...pairRanks);
    const lower = Math.min(...pairRanks);
    const label = `Two pair, ${RANK_PLURAL[valueToRank(higher)]} and ${RANK_PLURAL[valueToRank(lower)]}`;
    return { label, strength: higher >= topBoard ? 'monster' : 'strong' };
  }

  if (category === CATEGORY.PAIR) {
    return describePair(holeValues, boardValues, uniqueBoard, topBoard);
  }

  return { label: rankName, strength: 'air' };
}

function describePair(
  holeValues: number[],
  boardValues: number[],
  uniqueBoard: number[],
  topBoard: number,
): { label: string; strength: Strength } {
  const counts = new Map<number, number>();
  for (const value of [...holeValues, ...boardValues]) counts.set(value, (counts.get(value) ?? 0) + 1);
  const pairRank = [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([rank]) => rank)
    .sort((a, b) => b - a)[0];

  if (pairRank === undefined) return { label: 'Pair', strength: 'weak' };

  const pocket = holeValues[0] === holeValues[1];
  if (pocket && holeValues[0] === pairRank) {
    if (pairRank > topBoard) {
      return { label: `Overpair, ${RANK_PLURAL[valueToRank(pairRank)]}`, strength: 'strong' };
    }
    const belowAll = pairRank < Math.min(...boardValues);
    if (belowAll) return { label: `Underpair, ${RANK_PLURAL[valueToRank(pairRank)]}`, strength: 'weak' };
    return { label: `Pocket ${RANK_PLURAL[valueToRank(pairRank)]}`, strength: 'showdown' };
  }

  if (!holeValues.includes(pairRank)) {
    return { label: `Pair of ${RANK_PLURAL[valueToRank(pairRank)]} on the board`, strength: 'weak' };
  }

  const kicker = holeValues.find((value) => value !== pairRank) ?? 0;
  const kickerName = RANK_WORD[valueToRank(kicker)];
  const index = uniqueBoard.indexOf(pairRank);
  const good = kicker >= 12 || (pairRank >= 13 && kicker >= 11);
  if (index === 0) {
    return {
      label: `Top pair, ${kickerName} kicker`,
      strength: good ? 'strong' : 'showdown',
    };
  }
  if (index === uniqueBoard.length - 1) {
    return { label: `Bottom pair, ${kickerName} kicker`, strength: 'weak' };
  }
  return { label: `Middle pair, ${kickerName} kicker`, strength: 'showdown' };
}

function pairRanksIn(holeValues: number[], boardValues: number[]): number[] {
  const counts = new Map<number, number>();
  for (const value of [...holeValues, ...boardValues]) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([rank]) => rank)
    .sort((a, b) => b - a)
    .slice(0, 2);
}

function boardPairRank(boardValues: number[]): number | null {
  const counts = new Map<number, number>();
  for (const value of boardValues) counts.set(value, (counts.get(value) ?? 0) + 1);
  const found = [...counts.entries()].find(([, count]) => count >= 2);
  return found ? found[0] : null;
}

interface DrawInfo {
  labels: string[];
  outs: number;
  flushDraw: boolean;
  nutFlushDraw: boolean;
  oesd: boolean;
  gutshot: boolean;
  overcards: number;
}

function emptyDraws(): DrawInfo {
  return { labels: [], outs: 0, flushDraw: false, nutFlushDraw: false, oesd: false, gutshot: false, overcards: 0 };
}

function detectDraws(hole: [Card, Card], board: Card[], category: number): DrawInfo {
  const info = emptyDraws();
  if (category >= CATEGORY.STRAIGHT && category !== CATEGORY.FLUSH) return info;
  if (category >= CATEGORY.FULL_HOUSE) return info;

  const flush = flushDraw(hole, board);
  if (category < CATEGORY.FLUSH && flush.flushDraw) {
    info.flushDraw = true;
    info.nutFlushDraw = flush.nut;
    info.labels.push(flush.nut ? 'a nut flush draw' : 'a flush draw');
    info.outs += 9;
  }

  if (category < CATEGORY.STRAIGHT) {
    const straight = straightDraw(hole, board);
    info.oesd = straight.oesd;
    info.gutshot = straight.gutshot && !straight.oesd;
    if (straight.oesd) info.labels.push('an open-ended straight draw');
    else if (straight.doubleGutshot) info.labels.push('a double gutshot');
    else if (straight.gutshot) info.labels.push('a gutshot');
    const straightOuts = straight.oesd || straight.doubleGutshot ? 8 : straight.gutshot ? 4 : 0;
    info.outs += info.flushDraw ? Math.max(0, straightOuts - 2) : straightOuts;
  }

  const holeValues = hole.map((card) => RANK_VALUE[card.rank]);
  const topBoard = Math.max(...board.map((card) => RANK_VALUE[card.rank]));
  if (category <= CATEGORY.HIGH_CARD || (category === CATEGORY.PAIR && !holeValues.some((value, i) => hole[i] && boardHasPairWith(value, board) && holeValues[0] !== holeValues[1]))) {
    info.overcards = holeValues.filter((value) => value > topBoard).length;
  }
  if (category === CATEGORY.HIGH_CARD) {
    info.overcards = holeValues.filter((value) => value > topBoard).length;
  }
  if (info.overcards === 2 && category < CATEGORY.PAIR) info.labels.push('two overcards');
  else if (info.overcards === 1 && category < CATEGORY.PAIR && info.labels.length === 0) info.labels.push('one overcard');

  if (holeValues[0] === holeValues[1] && holeValues[0] < topBoard && !board.map((c) => RANK_VALUE[c.rank]).includes(holeValues[0])) {
    info.labels.push('a set draw');
    if (!info.flushDraw && !info.oesd && !info.gutshot) info.outs += 2;
  }

  info.outs = Math.min(15, info.outs);
  return info;
}

function boardHasPairWith(value: number, board: Card[]): boolean {
  return board.some((card) => RANK_VALUE[card.rank] === value);
}

function flushDraw(hole: [Card, Card], board: Card[]): { flushDraw: boolean; nut: boolean } {
  const counts = new Map<string, Card[]>();
  for (const card of [...hole, ...board]) {
    const list = counts.get(card.suit) ?? [];
    list.push(card);
    counts.set(card.suit, list);
  }
  for (const [suit, cards] of counts) {
    if (cards.length !== 4) continue;
    const holeInSuit = hole.filter((card) => card.suit === suit);
    if (holeInSuit.length === 0) continue;
    const holeHasAce = holeInSuit.some((card) => card.rank === 'A');
    const boardHasAce = board.some((card) => card.suit === suit && card.rank === 'A');
    return { flushDraw: true, nut: holeHasAce || (boardHasAce && holeInSuit.some((card) => card.rank === 'K')) };
  }
  return { flushDraw: false, nut: false };
}

function straightDraw(hole: [Card, Card], board: Card[]): { oesd: boolean; gutshot: boolean; doubleGutshot: boolean } {
  const holeValues = hole.map((card) => RANK_VALUE[card.rank]);
  const boardValues = board.map((card) => RANK_VALUE[card.rank]);
  const present = new Set<number>([...holeValues, ...boardValues]);
  const holeSet = new Set<number>(holeValues);
  if (present.has(14)) present.add(1);
  if (holeSet.has(14)) holeSet.add(1);

  for (let low = 1; low <= 10; low++) {
    const window = [low, low + 1, low + 2, low + 3, low + 4];
    if (window.every((rank) => present.has(rank)) && window.some((rank) => holeSet.has(rank))) {
      return { oesd: false, gutshot: false, doubleGutshot: false };
    }
  }

  const missing = new Set<number>();
  for (let low = 1; low <= 10; low++) {
    const window = [low, low + 1, low + 2, low + 3, low + 4];
    const absent = window.filter((rank) => !present.has(rank));
    if (absent.length === 1 && window.some((rank) => present.has(rank) && holeSet.has(rank))) {
      missing.add(absent[0] === 1 ? 14 : absent[0]);
    }
  }

  let oesd = false;
  for (let start = 1; start <= 11; start++) {
    const run = [start, start + 1, start + 2, start + 3];
    if (!run.every((rank) => present.has(rank))) continue;
    if (!run.some((rank) => holeSet.has(rank))) continue;
    const ends: number[] = [];
    if (start - 1 >= 1) ends.push(start - 1);
    if (start + 4 <= 14) ends.push(start + 4);
    if (ends.filter((rank) => !present.has(rank)).length >= 2) oesd = true;
  }

  return {
    oesd,
    gutshot: missing.size >= 1,
    doubleGutshot: !oesd && missing.size >= 2,
  };
}

function maxSuitCount(board: Card[]): number {
  const counts = new Map<string, number>();
  for (const card of board) counts.set(card.suit, (counts.get(card.suit) ?? 0) + 1);
  return Math.max(0, ...counts.values());
}

function valueToRank(value: number): Rank {
  const entry = (Object.entries(RANK_VALUE) as [Rank, number][]).find(([, v]) => v === value);
  if (!entry) throw new Error(`Bad rank value ${value}`);
  return entry[0];
}

export function holdingPhrase(read: HandRead): string {
  if (!read.madeLabel && read.drawLabels.length === 0) return 'no made hand';
  if (read.strength === 'air' && read.drawLabels.length > 0) return read.drawLabels.join(' and ');
  if (read.drawLabels.length > 0 && read.strength !== 'monster') {
    return `${uncap(read.madeLabel)} with ${read.drawLabels.join(' and ')}`;
  }
  return uncap(read.madeLabel);
}

function uncap(text: string): string {
  if (!text) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

export function texturePhrase(texture: Texture): string {
  return `a ${texture.summary} board`;
}

export function strengthLabel(strength: Strength): string {
  if (strength === 'monster') return 'a very strong made hand';
  if (strength === 'strong') return 'a strong made hand';
  if (strength === 'showdown') return 'a showdown hand';
  if (strength === 'weak') return 'a weak made hand';
  return 'little showdown value';
}

export function capitalizedHolding(read: HandRead): string {
  return capitalize(holdingPhrase(read));
}
