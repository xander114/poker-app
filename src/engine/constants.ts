export const POSITIONS = ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'] as const;

export type Position = (typeof POSITIONS)[number];

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 9;

/**
 * Full-ring seats, nearest first, counted forward from a seat until the button.
 * A short-handed seat uses the chart this many spots off the button.
 */
const OFF_BUTTON: readonly Position[] = ['BTN', 'CO', 'HJ', 'LJ', 'UTG+2', 'UTG+1', 'UTG'];

/**
 * Seats in preflop action order.
 * Six-handed is UTG, HJ, CO, BTN, SB, BB.
 * Heads-up is BTN, BB: the button posts the small blind and acts first.
 */
const SEATS_BY_COUNT: Record<number, readonly Position[]> = {
  2: ['BTN', 'BB'],
  3: ['BTN', 'SB', 'BB'],
  4: ['CO', 'BTN', 'SB', 'BB'],
  5: ['HJ', 'CO', 'BTN', 'SB', 'BB'],
  6: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  7: ['UTG', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  8: ['UTG', 'UTG+1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  9: POSITIONS,
};

export function seatsFor(players: number): Position[] {
  const seats = SEATS_BY_COUNT[players];
  if (!seats) throw new Error('A table needs between 2 and 9 players.');
  return [...seats];
}

export const PREFLOP_ORDER: readonly Position[] = POSITIONS;

export function postflopOrder(seats: readonly Position[]): Position[] {
  if (seats.length === 2) return ['BB', 'BTN'];
  const early = seats.filter((seat) => seat !== 'BTN' && seat !== 'SB' && seat !== 'BB');
  const order: Position[] = [];
  if (seats.includes('SB')) order.push('SB');
  if (seats.includes('BB')) order.push('BB');
  order.push(...early);
  if (seats.includes('BTN')) order.push('BTN');
  return order;
}

export const POSTFLOP_ORDER: readonly Position[] = postflopOrder(POSITIONS);

/** Heads-up, the button posts the small blind. Every larger table has a small blind. */
export function smallBlindSeat(seats: readonly Position[]): Position {
  return seats.length === 2 ? 'BTN' : 'SB';
}

/**
 * One spot with the button each new hand: the button becomes the small blind,
 * the small blind becomes the big blind, and the big blind becomes first to act.
 * Heads-up has no separate small blind, so the two players swap.
 */
export function nextHeroSeat(seats: readonly Position[], hero: Position): Position {
  const index = seats.indexOf(hero);
  if (index < 0) return seats[0];
  return seats[(index + 1) % seats.length];
}

/** Full-ring chart for this seat: same number of spots off the button, blinds stay blinds. */
export function chartPosition(seats: readonly Position[], position: Position): Position {
  if (position === 'SB' || position === 'BB') return position;
  const start = seats.indexOf(position);
  if (start < 0) return position;
  let steps = 0;
  let index = start;
  while (seats[index] !== 'BTN') {
    index = (index + 1) % seats.length;
    steps += 1;
    if (steps > seats.length) return position;
  }
  return OFF_BUTTON[Math.min(steps, OFF_BUTTON.length - 1)];
}

/** Where to sit when a seat name disappears because the table got shorter or longer. */
export function closestSeat(from: readonly Position[], hero: Position, to: readonly Position[]): Position {
  if (to.includes(hero)) return hero;
  const wanted = chartPosition(from, hero);
  if (wanted === 'BB') return to.includes('BB') ? 'BB' : to[to.length - 1];
  if (wanted === 'SB') return to.includes('SB') ? 'SB' : 'BTN';
  const wantedRank = OFF_BUTTON.indexOf(wanted);
  let best = to[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const seat of to) {
    const chart = chartPosition(to, seat);
    if (chart === 'SB' || chart === 'BB') continue;
    const dist = Math.abs(OFF_BUTTON.indexOf(chart) - wantedRank);
    if (dist < bestDist) {
      best = seat;
      bestDist = dist;
    }
  }
  return best;
}

export type Street = 'preflop' | 'flop' | 'turn' | 'river';

export const STREETS: readonly Street[] = ['preflop', 'flop', 'turn', 'river'];

export function nextStreet(street: Street): Street | null {
  if (street === 'preflop') return 'flop';
  if (street === 'flop') return 'turn';
  if (street === 'turn') return 'river';
  return null;
}

export function boardCardsFor(street: Street): number {
  if (street === 'preflop') return 0;
  if (street === 'flop') return 3;
  if (street === 'turn') return 4;
  return 5;
}

export function streetLabel(street: Street): string {
  if (street === 'preflop') return 'Preflop';
  if (street === 'flop') return 'Flop';
  if (street === 'turn') return 'Turn';
  return 'River';
}
