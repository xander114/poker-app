export const POSITIONS = ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'] as const;

export type Position = (typeof POSITIONS)[number];

export const PREFLOP_ORDER: readonly Position[] = POSITIONS;

export const POSTFLOP_ORDER: readonly Position[] = ['SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN'];

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
