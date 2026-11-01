import { describe, expect, it } from 'vitest';
import { type Card, type Rank, type Suit } from '../engine/cards';
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
  pickRank,
  pickSuit,
  projectCards,
  rankBlocked,
  rankLabel,
  revealedStreet,
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

function choose(session: PickerSession, slots: SlotCards, rank: Rank, suit: Suit) {
  const ranked = pickRank(session, rank, slots);
  expect(ranked?.step).toBe('suit');
  expect(ranked?.rank).toBe(rank);
  const placed = pickSuit(ranked!, suit, slots);
  expect(placed).not.toBeNull();
  return placed!;
}

describe('card picker flow', () => {
  it('offers ranks from 2 through ace, with ten shown as 10', () => {
    expect(PICKER_RANKS).toEqual(['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']);
    expect(PICKER_RANKS.map(rankLabel)).toEqual(['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']);
    expect(SUITS.map(suitName)).toEqual(['spades', 'hearts', 'diamonds', 'clubs']);
  });

  it('walks the hole cards, then lets the board be filled before any street is dealt', () => {
    let slots = emptySlots();
    let session: PickerSession | null = { slot: 'hole-0', step: 'rank', rank: null, origin: 'hole-0' };

    let placed = choose(session, slots, 'A', 's');
    slots = placed.slots;
    session = placed.session;
    expect(slots['hole-0']).toEqual(card('A', 's'));
    expect(session).toMatchObject({ slot: 'hole-1', step: 'rank', origin: 'hole-0' });

    placed = choose(session!, slots, 'K', 'd');
    slots = placed.slots;
    session = placed.session;
    expect(slots['hole-1']).toEqual(card('K', 'd'));
    expect(session).toBeNull();
    expect(projectCards(slots, 'preflop')).toEqual({
      hole: [card('A', 's'), card('K', 'd')],
      board: [],
    });

    session = { slot: 'flop-0', step: 'rank', rank: null, origin: 'flop-0' };
    const ranks = ['2', '7', '9', '4', '3'] as const;
    for (const [index, rank] of ranks.entries()) {
      placed = choose(session!, slots, rank, 'c');
      slots = placed.slots;
      session = placed.session;
      expect(slots[BOARD_SLOTS[index]]).toEqual(card(rank, 'c'));
      if (index < BOARD_SLOTS.length - 1) expect(session?.slot).toBe(BOARD_SLOTS[index + 1]);
    }
    expect(session).toBeNull();
    expect(projectCards(slots, 'preflop').board).toEqual([]);
    expect(projectCards(slots, 'flop').board.map((item) => item.rank)).toEqual(['2', '7', '9']);
    expect(projectCards(slots, 'river').board).toHaveLength(5);
    expect(firstEmptyBoardSlot('preflop', slots)).toBeNull();
    expect(firstEmptyBoardSlot('flop', slots)).toBeNull();
    expect(firstEmptyBoardSlot('turn', { ...slots, turn: null })).toBe('turn');
    expect(revealedStreet(slots, 'preflop', false)).toBe('preflop');
    expect(revealedStreet(slots, 'preflop', true)).toBe('flop');
    expect(revealedStreet(slots, 'flop', true)).toBe('turn');
  });

  it('goes back from the suit step to the rank step, then to the previous slot, then closes', () => {
    const onSecond: PickerSession = { slot: 'hole-1', step: 'suit', rank: 'Q', origin: 'hole-0' };

    const ranks = back(onSecond);
    expect(ranks).toEqual({ slot: 'hole-1', step: 'rank', rank: null, origin: 'hole-0' });

    const previous = back(ranks!);
    expect(previous).toEqual({ slot: 'hole-0', step: 'rank', rank: null, origin: 'hole-0' });
    expect(back(previous!)).toBeNull();

    const openedHere: PickerSession = { slot: 'flop-1', step: 'rank', rank: null, origin: 'flop-1' };
    expect(back(openedHere)).toBeNull();
    const onTurn: PickerSession = { slot: 'turn', step: 'rank', rank: null, origin: 'flop-0' };
    expect(back(onTurn)?.slot).toBe('flop-2');
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
    expect(pickSuit(suited, 'c', slots)?.slots['flop-1']).toEqual(card('A', 'c'));
    expect(pickSuit(suited, 's', slots)).toBeNull();

    const elsewhere = { slot: 'turn' as const, step: 'rank' as const, rank: null, origin: 'turn' as const };
    expect(pickRank(elsewhere, 'A', slots)).toBeNull();
  });

  it('keeps hole-card picking on the hole cards and walks the board onward', () => {
    const slots = fill(emptySlots(), 'hole-1', 'Q', 'h');
    const placed = pickSuit({ slot: 'hole-0', step: 'suit', rank: 'J', origin: 'hole-0' }, 's', slots);
    expect(placed!.session).toBeNull();

    const jumped = choose({ slot: 'flop-2', step: 'rank', rank: null, origin: 'flop-2' }, placed!.slots, '5', 'd');
    expect(jumped.session?.slot).toBe('turn');
    expect(projectCards(jumped.slots, 'preflop').board).toEqual([]);
    const completed = fill(fill(jumped.slots, 'flop-0', '2', 'c'), 'flop-1', '3', 'h');
    expect(projectCards(completed, 'flop').board.map((item) => item.rank)).toEqual(['2', '3', '5']);
    expect(revealedStreet(completed, 'preflop', true)).toBe('flop');
    expect(revealedStreet(completed, 'flop', true)).toBe('flop');
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

    const kept = slotsAfterUndo({ ...dealt, street: 'flop' }, { ...dealt, street: 'flop', actions: [] }, slots);
    expect(kept.river).toEqual(card('2', 'c'));

    const wiped = slotsAfterUndo({ ...dealt, hole: [card('A', 's')] }, { ...dealt, hole: [], board: [] }, slots);
    expect(wiped).toEqual(emptySlots());
  });
});
