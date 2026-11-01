import { describe, expect, it } from 'vitest';
import { cardsFrom } from './cards';
import {
  type Position,
  chartPosition,
  postflopOrder,
  seatsFor,
  POSTFLOP_ORDER,
} from './constants';
import { advanceStreet, applyAction, createHand, derive, foldToHero, newHand, setHole, type HandState } from './hand';
import { recommend } from './recommend';

function ok(result: { ok: true; state: HandState } | { ok: false; error: string }): HandState {
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function deal(hero: Position, players = 9): HandState {
  return createHand({ sb: 1, bb: 2, stackBb: 100, hero, players });
}

describe('table size', () => {
  it('deals a full ring with the blinds posted and under the gun to act', () => {
    const state = deal('HJ');
    expect(state.seats).toEqual(['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
    expect(state.actions.map((action) => [action.position, action.added])).toEqual([
      ['SB', 1],
      ['BB', 2],
    ]);
    expect(derive(state).toAct).toBe('UTG');
    expect(derive(state).pot).toBe(3);
    expect(derive(state).active).toHaveLength(9);
    expect(postflopOrder(state.seats)).toEqual([...POSTFLOP_ORDER]);
  });

  it('deals six-handed with UTG, HJ, CO, BTN, SB, and BB', () => {
    const state = deal('BTN', 6);
    expect(state.seats).toEqual(['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
    expect(derive(state).toAct).toBe('UTG');
    expect(derive(state).active).toHaveLength(6);
    const folded = foldToHero(state);
    expect(derive(folded).toAct).toBe('BTN');
    expect(derive(folded).folded).toEqual(['UTG', 'HJ', 'CO']);
  });

  it('has the button post the small blind and act first heads-up', () => {
    const state = deal('BB', 2);
    expect(state.seats).toEqual(['BTN', 'BB']);
    expect(state.actions.map((action) => [action.position, action.kind, action.added])).toEqual([
      ['BTN', 'post', 1],
      ['BB', 'post', 2],
    ]);
    expect(derive(state).toAct).toBe('BTN');
    expect(derive(state).pot).toBe(3);

    let played = ok(applyAction(state, { position: 'BTN', kind: 'call' }));
    played = ok(applyAction(played, { position: 'BB', kind: 'check' }));
    played = ok(advanceStreet(played));
    expect(derive(played).toAct).toBe('BB');
    expect(postflopOrder(played.seats)).toEqual(['BB', 'BTN']);
  });

  it('lets the small blind act first on a six-handed flop', () => {
    let state = deal('BB', 6);
    for (const position of ['UTG', 'HJ', 'CO', 'BTN', 'SB'] as const) {
      state = ok(applyAction(state, { position, kind: 'call' }));
    }
    state = ok(applyAction(state, { position: 'BB', kind: 'check' }));
    expect(derive(state).toAct).toBeNull();
    state = ok(advanceStreet(state));
    expect(derive(state).toAct).toBe('SB');
  });
});

describe('seat rotation', () => {
  it('moves a full ring one spot for a whole orbit', () => {
    let state = deal('BTN');
    const seen = [state.hero];
    for (let step = 0; step < 9; step += 1) {
      state = newHand(state);
      seen.push(state.hero);
    }
    expect(seen).toEqual(['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN']);
  });

  it('rotates every six-handed seat and then returns', () => {
    let state = deal('UTG', 6);
    const seen = [state.hero];
    for (let step = 0; step < 6; step += 1) {
      state = newHand(state);
      seen.push(state.hero);
      expect(state.seats).toHaveLength(6);
    }
    expect(seen).toEqual(['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB', 'UTG']);
  });

  it('swaps the button and the big blind heads-up', () => {
    let state = deal('BTN', 2);
    state = newHand(state);
    expect(state.hero).toBe('BB');
    expect(derive(state).toAct).toBe('BTN');
    state = newHand(state);
    expect(state.hero).toBe('BTN');
    expect(state.actions[0].position).toBe('BTN');
  });

  it('keeps a deliberately chosen seat instead of rotating', () => {
    const state = newHand(deal('BTN'), { hero: 'HJ' });
    expect(state.hero).toBe('HJ');
  });

  it('starts the shorter table on the next hand and keeps the hero on a real seat', () => {
    const state = newHand(deal('UTG+2'), { players: 6 });
    expect(state.seats).toEqual(seatsFor(6));
    expect(state.seats).toContain(state.hero);
    expect(derive(state).active).toHaveLength(6);
  });
});

describe('short-table charts', () => {
  it('borrows the full-ring chart the same distance off the button', () => {
    expect(chartPosition(seatsFor(9), 'LJ')).toBe('LJ');
    expect(chartPosition(seatsFor(9), 'SB')).toBe('SB');
    expect(chartPosition(seatsFor(6), 'UTG')).toBe('LJ');
    expect(chartPosition(seatsFor(6), 'HJ')).toBe('HJ');
    expect(chartPosition(seatsFor(6), 'CO')).toBe('CO');
    expect(chartPosition(seatsFor(6), 'BTN')).toBe('BTN');
    expect(chartPosition(seatsFor(6), 'BB')).toBe('BB');
    expect(chartPosition(seatsFor(2), 'BTN')).toBe('BTN');
    expect(chartPosition(seatsFor(2), 'BB')).toBe('BB');
  });

  it('opens ace-nine offsuit from six-handed UTG with the lojack chart and folds it full ring', () => {
    const full = recommend(ok(setHole(deal('UTG'), cardsFrom('As 9d'))));
    const six = recommend(ok(setHole(deal('UTG', 6), cardsFrom('As 9d'))));
    expect(full.action).toBe('fold');
    expect(six.action).toBe('raise');
    expect(six.source).toContain('LJ chart');
    expect(six.explanation.toLowerCase()).toContain('ace-nine');
  });
});
