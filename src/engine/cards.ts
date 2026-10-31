export const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'] as const;
export type Rank = (typeof RANKS)[number];

export const SUITS = ['s', 'h', 'd', 'c'] as const;
export type Suit = (typeof SUITS)[number];

export interface Card {
  rank: Rank;
  suit: Suit;
}

export const RANK_VALUE: Record<Rank, number> = {
  A: 14,
  K: 13,
  Q: 12,
  J: 11,
  T: 10,
  '9': 9,
  '8': 8,
  '7': 7,
  '6': 6,
  '5': 5,
  '4': 4,
  '3': 3,
  '2': 2,
};

export const RANK_WORD: Record<Rank, string> = {
  A: 'ace',
  K: 'king',
  Q: 'queen',
  J: 'jack',
  T: 'ten',
  '9': 'nine',
  '8': 'eight',
  '7': 'seven',
  '6': 'six',
  '5': 'five',
  '4': 'four',
  '3': 'trey',
  '2': 'deuce',
};

export const RANK_PLURAL: Record<Rank, string> = {
  A: 'aces',
  K: 'kings',
  Q: 'queens',
  J: 'jacks',
  T: 'tens',
  '9': 'nines',
  '8': 'eights',
  '7': 'sevens',
  '6': 'sixes',
  '5': 'fives',
  '4': 'fours',
  '3': 'threes',
  '2': 'twos',
};

export const SUIT_GLYPH: Record<Suit, string> = {
  s: '♠',
  h: '♥',
  d: '♦',
  c: '♣',
};

const SUIT_INDEX: Record<Suit, number> = { s: 0, h: 1, d: 2, c: 3 };

const GLYPH_SUIT: Record<string, Suit> = {
  '♠': 's',
  '♥': 'h',
  '♦': 'd',
  '♣': 'c',
};

export function rankIndex(rank: string): number {
  const i = RANKS.indexOf(rank as Rank);
  if (i < 0) throw new Error(`Unknown rank: ${rank}`);
  return i;
}

export function isRed(suit: Suit): boolean {
  return suit === 'h' || suit === 'd';
}

/** Card id: rank value 2..14 packed with suit. Ace is 14. */
export function cardId(card: Card): number {
  return (RANK_VALUE[card.rank] - 2) * 4 + SUIT_INDEX[card.suit];
}

export function idRankValue(id: number): number {
  return (id >> 2) + 2;
}

export function cardText(card: Card): string {
  return `${card.rank}${card.suit}`;
}

export function cardGlyph(card: Card): string {
  return `${card.rank}${SUIT_GLYPH[card.suit]}`;
}

export function parseCard(raw: string): Card {
  let text = raw.trim();
  if (!text) throw new Error('Empty card');
  if (text.length === 3 && text.startsWith('10')) text = `T${text[2]}`;
  if (text.length !== 2) throw new Error(`Invalid card: ${raw}`);
  const rank = text[0].toUpperCase();
  if (!RANKS.includes(rank as Rank)) throw new Error(`Invalid card: ${raw}`);
  const suitChar = text[1];
  const suit = (GLYPH_SUIT[suitChar] ?? suitChar.toLowerCase()) as Suit;
  if (!SUITS.includes(suit)) throw new Error(`Invalid card: ${raw}`);
  return { rank: rank as Rank, suit };
}

export function cardsFrom(text: string): Card[] {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(parseCard);
}

export function allCards(): Card[] {
  const cards: Card[] = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) cards.push({ rank, suit });
  }
  return cards;
}

export function sameCard(a: Card, b: Card): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}

export function dedupeKey(card: Card): string {
  return cardText(card);
}

/** Starting-hand key: AA, AKs, AKo. */
export function handKey(a: Card, b: Card): string {
  const high = RANK_VALUE[a.rank] >= RANK_VALUE[b.rank] ? a : b;
  const low = high === a ? b : a;
  if (high.rank === low.rank) return `${high.rank}${low.rank}`;
  return `${high.rank}${low.rank}${high.suit === low.suit ? 's' : 'o'}`;
}

export function startingHandName(a: Card, b: Card): string {
  const high = RANK_VALUE[a.rank] >= RANK_VALUE[b.rank] ? a : b;
  const low = high === a ? b : a;
  if (high.rank === low.rank) {
    const word = RANK_PLURAL[high.rank];
    return `Pocket ${word}`;
  }
  const left = RANK_WORD[high.rank];
  const right = RANK_WORD[low.rank];
  const suited = high.suit === low.suit;
  const phrase = `${left}-${right} ${suited ? 'suited' : 'offsuit'}`;
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

export function capitalize(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
