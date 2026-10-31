import { boardCardsFor, streetLabel } from './constants';
import { type EquityResult } from './equity';
import { type HandState, derive } from './hand';
import { EPS, chipsAndBb, formatSpr, potOddsLabel } from './pot';
import { advisePreflop } from './preflop';
import { advisePostflop } from './postflop';
import { startingHandName, type Card } from './cards';

export type AdviceAction = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'wait';

export interface Recommendation {
  action: AdviceAction;
  /**
   * Call: chips to add.
   * Bet or raise: total commitment on this street.
   */
  chips: number | null;
  headline: string;
  explanation: string;
  source: string;
  equity: number | null;
  equityMethod: EquityResult['method'] | null;
  requiredEquity: number | null;
  handLabel: string | null;
  texture: string | null;
  rangeLabel: string | null;
  pot: number;
  toCall: number;
  spr: number | null;
  potOddsText: string;
  sprText: string;
}

/**
 * One recommendation for the hero's current decision.
 * Preflop uses the chart module. Later streets use the postflop heuristic.
 */
export function recommend(state: HandState): Recommendation {
  const derived = derive(state);
  const base = {
    pot: derived.pot,
    toCall: derived.toCall,
    spr: derived.spr,
    potOddsText: potOddsLabel(derived.pot, derived.toCall),
    sprText: formatSpr(derived.spr),
  };

  if (derived.winner === state.hero) {
    return info(base, 'You win the pot', `Everyone else folded. You win ${chipsAndBb(derived.pot, state.bb)}.`);
  }
  if (derived.winner) {
    return info(base, 'Hand over', 'You folded. Start a new hand when you are ready.');
  }
  if (derived.toAct && derived.toAct !== state.hero) {
    return info(
      base,
      `Waiting on ${derived.toAct}`,
      `Action is on ${derived.toAct}. Enter what they do, or fold the table to you.`,
    );
  }
  if (!derived.toAct) {
    const next = state.street === 'river' ? 'The hand is ready for showdown.' : `Deal the ${streetLabel(nextName(state)).toLowerCase()} when you are ready.`;
    return info(base, state.street === 'river' ? 'Showdown' : 'Street complete', next);
  }
  if (state.hole.length < 2) {
    return info(base, 'Pick two cards', 'Choose your hole cards. The advisor needs both before it can recommend a play.');
  }

  const needed = boardCardsFor(state.street);
  if (state.board.length < needed) {
    const missing = needed - state.board.length;
    return info(
      base,
      `Enter the ${streetLabel(state.street).toLowerCase()}`,
      `Add ${missing} more board card${missing === 1 ? '' : 's'} to see a recommendation.`,
    );
  }

  const hole: [Card, Card] = [state.hole[0], state.hole[1]];
  if (state.street === 'preflop') {
    const advice = advisePreflop(state, hole);
    const facingRaise = derived.currentBet > state.bb + EPS;
    const showPrice = advice.action === 'call' || (advice.action === 'fold' && facingRaise);
    return {
      ...base,
      action: advice.action,
      chips: advice.chips,
      headline: advice.headline,
      explanation: advice.explanation,
      source: advice.source,
      equity: null,
      equityMethod: null,
      requiredEquity: showPrice ? derived.potOdds : null,
      handLabel: startingHandName(hole[0], hole[1]),
      texture: null,
      rangeLabel: null,
    };
  }

  const advice = advisePostflop({ ...state, board: state.board.slice(0, needed) });
  if (!advice) {
    return info(base, 'Need a board', 'Enter the board to get a postflop recommendation.');
  }
  return {
    ...base,
    action: advice.action,
    chips: advice.chips,
    headline: advice.headline,
    explanation: advice.explanation,
    source: advice.source,
    equity: advice.equity.equity,
    equityMethod: advice.equity.method,
    requiredEquity: advice.requiredEquity,
    handLabel: advice.handLabel,
    texture: advice.texture,
    rangeLabel: advice.rangeLabel,
  };
}

function nextName(state: HandState): 'flop' | 'turn' | 'river' {
  if (state.street === 'preflop') return 'flop';
  if (state.street === 'flop') return 'turn';
  return 'river';
}

function info(
  base: Pick<Recommendation, 'pot' | 'toCall' | 'spr' | 'potOddsText' | 'sprText'>,
  headline: string,
  explanation: string,
): Recommendation {
  return {
    ...base,
    action: 'wait',
    chips: null,
    headline,
    explanation,
    source: 'Table state',
    equity: null,
    equityMethod: null,
    requiredEquity: null,
    handLabel: null,
    texture: null,
    rangeLabel: null,
  };
}
