import { describe, expect, it } from 'vitest';
import { cardsFrom } from './cards';
import type { Position } from './constants';
import { type HandState, applyAction, createHand, derive, foldToHero, setHole } from './hand';
import { formatSpr, potOdds, spr } from './pot';

function must<T extends { ok: true; state: HandState } | { ok: false; error: string }>(result: T): HandState {
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

describe('pot and odds', () => {
  it('computes required equity and stack-to-pot ratio', () => {
    expect(potOdds(100, 50)).toBeCloseTo(1 / 3, 6);
    expect(potOdds(90, 30)).toBeCloseTo(0.25, 6);
    expect(potOdds(40, 0)).toBeNull();
    expect(spr(190, 40)).toBeCloseTo(4.75, 6);
    expect(spr(100, 0)).toBeNull();
    expect(formatSpr(14.92)).toBe('15');
    expect(formatSpr(4.75)).toBe('4.8');
  });

  it('tracks blinds, a raise, a call, and the next street', () => {
    let state = createHand({ sb: 1, bb: 2, stackBb: 100, hero: 'BTN' });
    state = must(setHole(state, cardsFrom('As Kd')));
    state = foldToHero(state);

    let view = derive(state);
    expect(view.pot).toBe(3);
    expect(view.toAct).toBe('BTN');
    expect(view.toCall).toBe(2);
    expect(view.spr).toBeCloseTo(200 / 3, 5);

    state = must(applyAction(state, { position: 'BTN', kind: 'raise', to: 6 }));
    view = derive(state);
    expect(view.pot).toBe(9);
    expect(view.toAct).toBe('SB');
    expect(view.currentBet).toBe(6);

    state = must(applyAction(state, { position: 'SB', kind: 'fold' }));
    view = derive(state);
    expect(view.toAct).toBe('BB');
    expect(amountFacing(state, 'BB')).toBe(4);

    state = must(applyAction(state, { position: 'BB', kind: 'call' }));
    view = derive(state);
    expect(view.pot).toBe(13);
    expect(view.toAct).toBeNull();
    expect(view.heroTotal).toBe(6);
    expect(view.spr).toBeCloseTo(194 / 13, 5);

    state = must(advance(state));
    expect(state.street).toBe('flop');
    view = derive(state);
    expect(view.currentBet).toBe(0);
    expect(view.toAct).toBe('BB');
    expect(view.pot).toBe(13);
  });

  it('rejects a check when facing a bet and a short raise', () => {
    let state = createHand({ sb: 1, bb: 2, stackBb: 100, hero: 'BB' });
    state = must(applyAction(state, { position: 'UTG', kind: 'raise', to: 6 }));
    state = foldToHero(state);
    const illegal = applyAction(state, { position: 'BB', kind: 'check' });
    expect(illegal.ok).toBe(false);
    const short = applyAction(state, { position: 'BB', kind: 'raise', to: 8 });
    expect(short.ok).toBe(false);
  });
});

function amountFacing(state: HandState, position: Position): number {
  const view = derive(state);
  return Math.max(0, view.currentBet - view.streetCommit[position]);
}

function advance(state: HandState): { ok: true; state: HandState } | { ok: false; error: string } {
  const view = derive(state);
  if (view.toAct) return { ok: false, error: 'still acting' };
  return { ok: true, state: { ...state, street: 'flop' } };
}
