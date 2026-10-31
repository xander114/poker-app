import { describe, expect, it } from 'vitest';
import type { Texture } from './analyze';
import type { HandRead } from './analyze';
import { cardsFrom } from './cards';
import type { Position } from './constants';
import { advanceStreet, applyAction, createHand, foldToHero, setBoard, setHole, type HandState } from './hand';
import { decidePostflop, type DecisionInput } from './postflop';
import { recommend } from './recommend';
import { comboCount, inRange, OPEN_RANGE, threeBetRange, callRange } from './ranges';

const SEATS: Position[] = ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN', 'SB'];

function ok(result: { ok: true; state: HandState } | { ok: false; error: string }): HandState {
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function withHole(hero: Position, cards: string): HandState {
  let state = createHand({ sb: 1, bb: 2, stackBb: 100, hero });
  state = ok(setHole(state, cardsFrom(cards)));
  return foldToHero(state);
}

const dry: Texture = {
  wetness: 'dry',
  paired: false,
  monotone: false,
  twoTone: false,
  connected: false,
  highCard: 'king',
  summary: 'dry, rainbow, disconnected, king-high',
};

function spot(over: Partial<DecisionInput> = {}): DecisionInput {
  return {
    equity: 0.5,
    toCall: 0,
    pot: 20,
    spr: 10,
    street: 'flop',
    multiway: false,
    heroIsAggressor: false,
    read: read(),
    texture: dry,
    bb: 2,
    heroRemaining: 180,
    currentBet: 0,
    heroStreetCommit: 0,
    maxStreetCommit: 180,
    minRaiseTo: 2,
    ...over,
  };
}

function read(over: Partial<HandRead> = {}): HandRead {
  return {
    rankName: 'King high',
    madeLabel: 'King high',
    strength: 'air',
    drawLabels: [],
    outs: 0,
    flushDraw: false,
    nutFlushDraw: false,
    oesd: false,
    gutshot: false,
    overcards: 0,
    playingBoard: false,
    ...over,
  };
}

describe('preflop charts', () => {
  it('opens wider as the seat gets later', () => {
    const order: Position[] = ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN'];
    for (let i = 1; i < order.length; i++) {
      expect(comboCount(OPEN_RANGE[order[i]])).toBeGreaterThan(comboCount(OPEN_RANGE[order[i - 1]]));
    }
    expect(comboCount(OPEN_RANGE.SB)).toBeGreaterThan(comboCount(OPEN_RANGE.UTG));
    expect(comboCount(OPEN_RANGE.BB)).toBe(0);
    expect(comboCount(OPEN_RANGE.UTG) / 1326).toBeGreaterThan(0.1);
    expect(comboCount(OPEN_RANGE.UTG) / 1326).toBeLessThan(0.18);
    expect(comboCount(OPEN_RANGE.BTN) / 1326).toBeGreaterThan(0.35);
  });

  it('keeps aces in every raising range and seven-deuce out of all of them', () => {
    for (const seat of SEATS) {
      expect(inRange('AA', OPEN_RANGE[seat])).toBe(true);
      expect(inRange('72o', OPEN_RANGE[seat])).toBe(false);
    }
    const openers: Position[] = ['UTG', 'LJ', 'CO', 'BTN', 'SB'];
    for (const hero of [...SEATS, 'BB' as Position]) {
      for (const opener of openers) {
        expect(inRange('AA', threeBetRange(hero, opener))).toBe(true);
        expect(inRange('72o', threeBetRange(hero, opener))).toBe(false);
        expect(inRange('72o', callRange(hero, opener))).toBe(false);
      }
    }
  });
});

describe('recommendations', () => {
  it('raises pocket aces from every seat', () => {
    for (const seat of SEATS) {
      const advice = recommend(withHole(seat, 'As Ad'));
      expect(advice.action, seat).toBe('raise');
      expect(advice.explanation.toLowerCase()).toContain('pocket aces');
    }

    let blind = createHand({ sb: 1, bb: 2, stackBb: 100, hero: 'BB' });
    blind = ok(setHole(blind, cardsFrom('Ah Ad')));
    blind = ok(applyAction(blind, { position: 'UTG', kind: 'raise', to: 5 }));
    blind = foldToHero(blind);
    const threeBet = recommend(blind);
    expect(threeBet.action).toBe('raise');
    expect(threeBet.chips).toBeGreaterThan(5);
  });

  it('folds seven-deuce offsuit under the gun', () => {
    const advice = recommend(withHole('UTG', '7c 2d'));
    expect(advice.action).toBe('fold');
    expect(advice.headline).toBe('Fold');
  });

  it('folds seven-deuce on the button as well', () => {
    expect(recommend(withHole('BTN', '7h 2c')).action).toBe('fold');
  });

  it('3-bets kings against an open', () => {
    let state = createHand({ sb: 1, bb: 2, stackBb: 100, hero: 'CO' });
    state = ok(setHole(state, cardsFrom('Kh Kd')));
    state = ok(applyAction(state, { position: 'UTG', kind: 'raise', to: 5 }));
    state = foldToHero(state);
    const advice = recommend(state);
    expect(advice.action).toBe('raise');
    expect(advice.chips).toBe(15);
  });

  it('bets a set when it is checked to the hero', () => {
    let state = createHand({ sb: 1, bb: 2, stackBb: 100, hero: 'BTN' });
    state = ok(setHole(state, cardsFrom('7h 7d')));
    state = foldToHero(state);
    state = ok(applyAction(state, { position: 'BTN', kind: 'raise', to: 5 }));
    state = ok(applyAction(state, { position: 'SB', kind: 'fold' }));
    state = ok(applyAction(state, { position: 'BB', kind: 'call' }));
    state = ok(advanceStreet(state));
    state = ok(setBoard(state, cardsFrom('7c Kd 2s')));
    state = ok(applyAction(state, { position: 'BB', kind: 'check' }));
    const advice = recommend(state);
    expect(advice.action).toBe('bet');
    expect(advice.handLabel).toContain('Set');
    expect(advice.equity ?? 0).toBeGreaterThan(0.7);
    expect(advice.explanation.toLowerCase()).toContain('equity');
  });

  it('folds nine-high on the river against a pot-sized bet from a tight range', () => {
    let state = createHand({ sb: 1, bb: 2, stackBb: 100, hero: 'BB' });
    state = ok(setHole(state, cardsFrom('9c 8d')));
    state = ok(applyAction(state, { position: 'UTG', kind: 'raise', to: 5 }));
    state = foldToHero(state);
    state = ok(applyAction(state, { position: 'BB', kind: 'call' }));
    state = ok(advanceStreet(state));
    state = ok(setBoard(state, cardsFrom('Ks Qh Jd')));
    state = ok(applyAction(state, { position: 'BB', kind: 'check' }));
    state = ok(applyAction(state, { position: 'UTG', kind: 'check' }));
    state = ok(advanceStreet(state));
    state = ok(setBoard(state, cardsFrom('Ks Qh Jd 4c')));
    state = ok(applyAction(state, { position: 'BB', kind: 'check' }));
    state = ok(applyAction(state, { position: 'UTG', kind: 'check' }));
    state = ok(advanceStreet(state));
    state = ok(setBoard(state, cardsFrom('Ks Qh Jd 4c 3s')));
    state = ok(applyAction(state, { position: 'BB', kind: 'check' }));
    const pot = 11;
    state = ok(applyAction(state, { position: 'UTG', kind: 'bet', to: pot }));
    const advice = recommend(state);
    expect(advice.toCall).toBe(pot);
    expect(advice.requiredEquity).toBeCloseTo(1 / 3, 2);
    expect(advice.action).toBe('fold');
  });
});

describe('postflop heuristic', () => {
  it('value-bets a monster when checked to', () => {
    const decision = decidePostflop(
      spot({
        equity: 0.82,
        read: read({ madeLabel: 'Set of sevens', strength: 'monster', rankName: 'Three sevens' }),
      }),
    );
    expect(decision.action).toBe('bet');
    expect(decision.reason).toBe('value-bet');
    expect(decision.chips).toBe(7);
  });

  it('folds air that is not getting the price', () => {
    const decision = decidePostflop(
      spot({
        equity: 0.12,
        toCall: 20,
        pot: 20,
        currentBet: 20,
        minRaiseTo: 40,
      }),
    );
    expect(decision.action).toBe('fold');
  });

  it('calls a draw that clears the required equity', () => {
    const decision = decidePostflop(
      spot({
        equity: 0.36,
        toCall: 5,
        pot: 20,
        currentBet: 5,
        minRaiseTo: 10,
        read: read({
          madeLabel: 'Ace high',
          strength: 'air',
          flushDraw: true,
          nutFlushDraw: true,
          outs: 9,
          drawLabels: ['a nut flush draw'],
        }),
      }),
    );
    expect(decision.action).toBe('call');
  });

  it('raises a monster that is facing a bet', () => {
    const decision = decidePostflop(
      spot({
        equity: 0.8,
        toCall: 10,
        pot: 30,
        currentBet: 10,
        minRaiseTo: 20,
        read: read({ madeLabel: 'Flush, ace high', strength: 'monster' }),
      }),
    );
    expect(decision.action).toBe('raise');
  });

  it('checks back a weak hand with no draw', () => {
    const decision = decidePostflop(spot({ equity: 0.28, heroIsAggressor: false }));
    expect(decision.action).toBe('check');
  });
});
