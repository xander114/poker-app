import { describe, expect, it } from 'vitest';
import { type Card, type Rank, type Suit } from '../engine/cards';
import { type Street } from '../engine/constants';
import { createHand } from '../engine/hand';
import {
  type PickerSession,
  type SlotCards,
  type SlotId,
  BOARD_SLOTS,
  PICKER_RANKS,
  back,
  emptySlots,
  firstEmptyBoardSlot,
  isSlotAllowed,
  pickRank,
  pickSuit,
  projectCards,
  rankBlocked,
  rankLabel,
  slotsAfterUndo,
  suitBlocked,
  suitName,
} from './cardPicker';

const SUITS: Suit[] = ['s', 'h', 'd', 'c'];

function card(rank: Rank, suit: Suit): Card {
  return { rank, suit };
}

function fill(slots: SlotCards, slot: SlotId, rank: Rank, suit: Suit): SlotCards {
  return { ...slots, [slot]: card(rank, suit) };
}

function choose(session: PickerSession, slots: SlotCards, street: Street, rank: Rank, suit: Suit) {
  const ranked = pickRank(session, rank, slots);
  expect(ranked?.step).toBe('suit');
  expect(ranked?.rank).toBe(rank);
  const placed = pickSuit(ranked!, suit, slots, street);
  expect(placed).not.toBeNull();
  return placed!;
}

describe('card picker flow', () => {
  it('offers ranks from 2 through ace, with ten shown as 10', () => {
    expect(PICKER_RANKS).toEqual(['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']);
    expect(PICKER_RANKS.map(rankLabel)).toEqual(['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']);
    expect(SUITS.map(suitName)).toEqual(['spades', 'hearts', 'diamonds', 'clubs']);
  });

  it('walks hole cards, then the board, and stops where the street stops', () => {
    let slots = emptySlots();
    let session: PickerSession | null = { slot: 'hole-0', step: 'rank', rank: null, origin: 'hole-0' };

    let placed = choose(session, slots, 'preflop', 'A', 's');
    slots = placed.slots;
    session = placed.session;
    expect(slots['hole-0']).toEqual(card('A', 's'));
    expect(session).toMatchObject({ slot: 'hole-1', step: 'rank', origin: 'hole-0' });

    placed = choose(session!, slots, 'preflop', 'K', 'd');
    slots = placed.slots;
    session = placed.session;
    expect(slots['hole-1']).toEqual(card('K', 'd'));
    expect(session).toBeNull();
    expect(projectCards(slots, 'preflop')).toEqual({
      hole: [card('A', 's'), card('K', 'd')],
      board: [],
    });

    expect(firstEmptyBoardSlot('preflop', slots)).toBeNull();
    expect(isSlotAllowed('preflop', 'flop-0')).toBe(false);
    expect(isSlotAllowed('flop', 'flop-2')).toBe(true);
    expect(isSlotAllowed('flop', 'turn')).toBe(false);

    session = { slot: 'flop-0', step: 'rank', rank: null, origin: 'flop-0' };
    for (const [index, rank] of (['2', '7', '9'] as const).entries()) {
      placed = choose(session!, slots, 'flop', rank, 'c');
      slots = placed.slots;
      session = placed.session;
      expect(slots[BOARD_SLOTS[index]]).toEqual(card(rank, 'c'));
      if (index < 2) expect(session?.slot).toBe(BOARD_SLOTS[index + 1]);
    }
    expect(session).toBeNull();
    expect(projectCards(slots, 'flop').board.map((item) => item.rank)).toEqual(['2', '7', '9']);
    expect(firstEmptyBoardSlot('turn', slots)).toBe('turn');
    expect(isSlotAllowed('turn', 'turn')).toBe(true);
    expect(isSlotAllowed('turn', 'river')).toBe(false);
    expect(isSlotAllowed('river', 'river')).toBe(true);
  });

  it('goes back from the suit step to the rank step, then to the previous slot, then closes', () => {
    const onSecond: PickerSession = { slot: 'hole-1', step: 'suit', rank: 'Q', origin: 'hole-0' };

    const ranks = back(onSecond, 'preflop');
    expect(ranks).toEqual({ slot: 'hole-1', step: 'rank', rank: null, origin: 'hole-0' });

    const previous = back(ranks!, 'preflop');
    expect(previous).toEqual({ slot: 'hole-0', step: 'rank', rank: null, origin: 'hole-0' });
    expect(back(previous!, 'preflop')).toBeNull();

    const openedHere: PickerSession = { slot: 'flop-1', step: 'rank', rank: null, origin: 'flop-1' };
    expect(back(openedHere, 'flop')).toBeNull();
  });

  it('does not offer a used card, and still allows the card being replaced', () => {
    let slots = fill(emptySlots(), 'hole-0', 'A', 's');
    slots = fill(slots, 'hole-1', 'A', 'h');
    slots = fill(slots, 'flop-0', 'A', 'd');
    slots = fill(slots, 'flop-1', 'A', 'c');

    const taken = [card('A', 's'), card('A', 'h'), card('A', 'd'), card('A', 'c')];
    expect(rankBlocked('A', taken)).toBe(true);
    expect(rankBlocked('K', taken)).toBe(false);
    expect(suitBlocked('K', 's', [card('K', 's')])).toBe(true);
    expect(suitBlocked('K', 'h', [card('K', 's')])).toBe(false);

    const editing = { slot: 'flop-1' as const, step: 'rank' as const, rank: null, origin: 'flop-1' as const };
    expect(pickRank(editing, 'A', slots)?.rank).toBe('A');
    const suited = pickRank(editing, 'A', slots)!;
    expect(pickSuit(suited, 'c', slots, 'flop')?.slots['flop-1']).toEqual(card('A', 'c'));
    expect(pickSuit(suited, 's', slots, 'flop')).toBeNull();

    const elsewhere = { slot: 'turn' as const, step: 'rank' as const, rank: null, origin: 'turn' as const };
    expect(pickRank(elsewhere, 'A', slots)).toBeNull();
  });

  it('skips filled slots and refuses board slots the street has not dealt', () => {
    let slots = fill(emptySlots(), 'hole-1', 'Q', 'h');
    const session: PickerSession = { slot: 'hole-0', step: 'suit', rank: 'J', origin: 'hole-0' };
    const placed = pickSuit(session, 's', slots, 'flop');
    slots = placed!.slots;
    expect(placed!.session?.slot).toBe('flop-0');

    const jumped = choose(
      { slot: 'flop-2', step: 'rank', rank: null, origin: 'flop-2' },
      slots,
      'river',
      '5',
      'd',
    );
    expect(jumped.session?.slot).toBe('turn');
      expect(projectCards(jumped.slots, 'river').board).toEqual([]);
    const completed = fill(fill(jumped.slots, 'flop-0', '2', 'c'), 'flop-1', '3', 'h');
    expect(projectCards(completed, 'turn').board).toHaveLength(3);
    expect(projectCards(completed, 'flop').board.map((item) => item.rank)).toEqual(['2', '3', '5']);
  });

  it('drops later board cards when undo leaves the street, and clears every slot when undo clears the hand', () => {
    const slots = fill(fill(emptySlots(), 'hole-0', 'A', 's'), 'river', '2', 'c');
    const dealt = createHand({ sb: 1, bb: 2, stackBb: 100, hero: 'HJ' });
    const rewound = slotsAfterUndo(
      { ...dealt, street: 'river' },
      { ...dealt, street: 'flop' },
      fill(slots, 'flop-0', 'K', 'd'),
    );
    expect(rewound['flop-0']).toEqual(card('K', 'd'));
    expect(rewound.river).toBeNull();
    expect(rewound['hole-0']).toEqual(card('A', 's'));

    const wiped = slotsAfterUndo({ ...dealt, hole: [card('A', 's')] }, { ...dealt, hole: [], board: [] }, slots);
    expect(wiped).toEqual(emptySlots());
  });
});
