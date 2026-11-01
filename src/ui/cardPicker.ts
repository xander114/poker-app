import { type Card, type Rank, type Suit, SUITS } from '../engine/cards';
import { type Street, boardCardsFor } from '../engine/constants';

/** Low to high, matching the "2 through ace" picker. Ten is stored as T. */
export const PICKER_RANKS: readonly Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

export const HOLE_SLOTS = ['hole-0', 'hole-1'] as const;
export const BOARD_SLOTS = ['flop-0', 'flop-1', 'flop-2', 'turn', 'river'] as const;
export const SLOT_ORDER = [...HOLE_SLOTS, ...BOARD_SLOTS] as const;

export type SlotId = (typeof SLOT_ORDER)[number];

export type SlotCards = Record<SlotId, Card | null>;

export interface PickerSession {
  slot: SlotId;
  step: 'rank' | 'suit';
  rank: Rank | null;
  /** Slot the player clicked. Back closes once the session returns here. */
  origin: SlotId;
}

export interface HandCards {
  hole: Card[];
  board: Card[];
}

export interface UndoSnap {
  hole: Card[];
  board: Card[];
  actions: unknown[];
  street: Street;
}

const SUIT_NAMES: Record<Suit, string> = {
  s: 'spades',
  h: 'hearts',
  d: 'diamonds',
  c: 'clubs',
};

export function emptySlots(): SlotCards {
  return {
    'hole-0': null,
    'hole-1': null,
    'flop-0': null,
    'flop-1': null,
    'flop-2': null,
    turn: null,
    river: null,
  };
}

export function rankLabel(rank: Rank): string {
  return rank === 'T' ? '10' : rank;
}

export function suitName(suit: Suit): string {
  return SUIT_NAMES[suit];
}

export function emptySlotLabel(slot: SlotId): string {
  if (slot === 'hole-0') return 'Hole';
  if (slot === 'hole-1') return 'Card';
  if (slot === 'turn') return 'Turn';
  if (slot === 'river') return 'River';
  return 'Flop';
}

export function slotHeading(slot: SlotId): string {
  if (slot === 'hole-0') return 'First hole card';
  if (slot === 'hole-1') return 'Second hole card';
  if (slot === 'flop-0') return 'First flop card';
  if (slot === 'flop-1') return 'Second flop card';
  if (slot === 'flop-2') return 'Third flop card';
  if (slot === 'turn') return 'Turn';
  return 'River';
}

export function isSlotAllowed(street: Street, slot: SlotId): boolean {
  if (slot === 'hole-0' || slot === 'hole-1') return true;
  const index = BOARD_SLOTS.indexOf(slot as (typeof BOARD_SLOTS)[number]);
  return index >= 0 && index < boardCardsFor(street);
}

export function slotLockReason(street: Street, slot: SlotId): string | null {
  if (isSlotAllowed(street, slot)) return null;
  if (slot === 'turn') return 'Deal the turn to choose this card';
  if (slot === 'river') return 'Deal the river to choose this card';
  return 'Deal the flop to choose this card';
}

export function takenCards(slots: SlotCards, except?: SlotId): Card[] {
  const cards: Card[] = [];
  for (const id of SLOT_ORDER) {
    if (id === except) continue;
    const card = slots[id];
    if (card) cards.push(card);
  }
  return cards;
}

export function rankBlocked(rank: Rank, taken: Card[]): boolean {
  return SUITS.every((suit) => taken.some((card) => card.rank === rank && card.suit === suit));
}

export function suitBlocked(rank: Rank, suit: Suit, taken: Card[]): boolean {
  return taken.some((card) => card.rank === rank && card.suit === suit);
}

export function openPicker(slot: SlotId): PickerSession {
  return { slot, step: 'rank', rank: null, origin: slot };
}

/** Rank step to suit step. Returns null when every suit of that rank is already in use. */
export function pickRank(session: PickerSession, rank: Rank, slots: SlotCards): PickerSession | null {
  if (session.step !== 'rank') return null;
  if (rankBlocked(rank, takenCards(slots, session.slot))) return null;
  return { ...session, step: 'suit', rank };
}

/**
 * Writes the card into the slot and moves to the next empty slot the street allows.
 * Returns null when that exact card is already used somewhere else.
 */
export function pickSuit(
  session: PickerSession,
  suit: Suit,
  slots: SlotCards,
  street: Street,
): { slots: SlotCards; session: PickerSession | null } | null {
  if (session.step !== 'suit' || !session.rank) return null;
  if (suitBlocked(session.rank, suit, takenCards(slots, session.slot))) return null;
  const nextSlots: SlotCards = { ...slots, [session.slot]: { rank: session.rank, suit } };
  return { slots: nextSlots, session: advanceAfterPick(session, street, nextSlots) };
}

/** Suit step returns to ranks. Rank step returns to the previous slot, or closes on the slot that was opened. */
export function back(session: PickerSession, street: Street): PickerSession | null {
  if (session.step === 'suit') return { ...session, step: 'rank', rank: null };
  if (session.slot === session.origin) return null;
  const prev = previousAllowedSlot(session.slot, street);
  if (!prev || slotIndex(prev) < slotIndex(session.origin)) return null;
  return { slot: prev, step: 'rank', rank: null, origin: session.origin };
}

export function firstEmptyBoardSlot(street: Street, slots: SlotCards): SlotId | null {
  for (const id of BOARD_SLOTS) {
    if (!isSlotAllowed(street, id)) continue;
    if (!slots[id]) return id;
  }
  return null;
}

/**
 * Cards the engine should see. Hole cards keep slot order and skip empties.
 * The board is the leading run of filled slots, and never past the current street.
 */
export function projectCards(slots: SlotCards, street: Street): HandCards {
  const hole = HOLE_SLOTS.map((id) => slots[id]).filter((card): card is Card => card !== null);
  const limit = boardCardsFor(street);
  const board: Card[] = [];
  for (let index = 0; index < limit; index++) {
    const card = slots[BOARD_SLOTS[index]];
    if (!card) break;
    board.push(card);
  }
  return { hole, board };
}

export function slotsAfterUndo(before: UndoSnap, after: UndoSnap, slots: SlotCards): SlotCards {
  const clearedCards =
    after.hole.length === 0 &&
    after.board.length === 0 &&
    before.actions.length === after.actions.length &&
    before.street === after.street;
  if (clearedCards) return emptySlots();
  const limit = boardCardsFor(after.street);
  const next: SlotCards = { ...slots };
  BOARD_SLOTS.forEach((id, index) => {
    if (index >= limit) next[id] = null;
  });
  return next;
}

function advanceAfterPick(session: PickerSession, street: Street, slots: SlotCards): PickerSession | null {
  const next = nextEmptyAllowedSlot(session.slot, street, slots);
  if (!next) return null;
  return { slot: next, step: 'rank', rank: null, origin: session.origin };
}

function nextEmptyAllowedSlot(from: SlotId, street: Street, slots: SlotCards): SlotId | null {
  for (let index = slotIndex(from) + 1; index < SLOT_ORDER.length; index++) {
    const id = SLOT_ORDER[index];
    if (!isSlotAllowed(street, id) || slots[id]) continue;
    return id;
  }
  return null;
}

function previousAllowedSlot(from: SlotId, street: Street): SlotId | null {
  for (let index = slotIndex(from) - 1; index >= 0; index--) {
    const id = SLOT_ORDER[index];
    if (isSlotAllowed(street, id)) return id;
  }
  return null;
}

function slotIndex(slot: SlotId): number {
  return SLOT_ORDER.indexOf(slot);
}
