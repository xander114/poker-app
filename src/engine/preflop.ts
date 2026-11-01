import { type Card, handKey, startingHandName } from './cards';
import { chartPosition, type Position } from './constants';
import type { ActionRecord, HandState } from './hand';
import { derive } from './hand';
import { chipsAndBb, roundMoney } from './pot';
import {
  BB_ISO,
  CALL_VS_FIVE_BET_JAM,
  CALL_VS_FOUR_BET,
  CALL_VS_JAM,
  FIVE_BET_RANGE,
  OPEN_RANGE,
  OPEN_SIZE_BB,
  callRange,
  continuesMultiway,
  coldFourBetRange,
  fourBetRange,
  inRange,
  openerGroup,
  threeBetRange,
} from './ranges';

export interface PreflopAdvice {
  action: 'fold' | 'check' | 'call' | 'raise';
  /** Chips to add for a call, or the total street commitment for a raise. */
  chips: number | null;
  headline: string;
  explanation: string;
  source: string;
}

interface RaiseEvent {
  position: Position;
  to: number;
}

export function advisePreflop(state: HandState, hole: [Card, Card]): PreflopAdvice {
  const derived = derive(state);
  const key = handKey(hole[0], hole[1]);
  const name = startingHandName(hole[0], hole[1]);
  const spot = readSpot(state.actions);
  const maxTo = derived.maxHeroStreetCommit;

  if (spot.raises.length === 0 && spot.limps === 0) {
    return openAdvice(state, key, name, maxTo);
  }

  if (spot.raises.length === 0 && spot.limps > 0) {
    return limpAdvice(state, key, name, spot.limps, maxTo);
  }

  if (spot.raises.length === 1) {
    return versusOpen(state, key, name, spot.raises[0], spot.callers, maxTo);
  }

  if (spot.raises.length === 2) {
    return versusThreeBet(state, key, name, spot.raises, maxTo);
  }

  if (spot.raises.length === 3) {
    return versusFourBet(state, key, name, spot.raises[2], maxTo);
  }

  return versusFiveBet(state, key, name, maxTo);
}

function openAdvice(state: HandState, key: string, name: string, maxTo: number): PreflopAdvice {
  const chartSeat = heroChart(state);
  const chart = OPEN_RANGE[chartSeat];
  const source = `RFI chart · ${seatPhrase(state)} · 100bb full ring`;
  if (!chart || !inRange(key, chart)) {
    if (state.hero === 'BB') {
      return {
        action: 'check',
        chips: null,
        headline: 'Check',
        explanation: `${name} has nothing to raise over. Check and take the flop.`,
        source,
      };
    }
    return {
      action: 'fold',
      chips: null,
      headline: 'Fold',
      explanation: `${name} is outside the ${seatPhrase(state)} opening range in this 100bb full-ring chart. Fold.`,
      source,
    };
  }
  const desired = roundMoney(OPEN_SIZE_BB[chartSeat] * state.bb);
  const to = clampRaise(desired, state.bb * 2, maxTo);
  return {
    action: 'raise',
    chips: to,
    headline: raiseHeadline(to, maxTo, state.bb),
    explanation: `${name} is in the ${seatPhrase(state)} opening range. ${raiseSentence(to, maxTo, state.bb)}.`,
    source,
  };
}

function limpAdvice(state: HandState, key: string, name: string, limps: number, maxTo: number): PreflopAdvice {
  const chart = state.hero === 'BB' ? BB_ISO : OPEN_RANGE[heroChart(state)];
  const source = `Iso-raise chart · ${limps} limp${limps === 1 ? '' : 's'} · 100bb`;
  const limpWord = limps === 1 ? 'a limp' : `${limps} limps`;
  if (!inRange(key, chart)) {
    if (state.hero === 'BB') {
      return {
        action: 'check',
        chips: null,
        headline: 'Check',
        explanation: `${name} is not in the big-blind raise range over ${limpWord}. Check.`,
        source,
      };
    }
    return {
      action: 'fold',
      chips: null,
      headline: 'Fold',
      explanation: `${name} is not worth an iso-raise over ${limpWord} from ${seatPhrase(state)}. Fold.`,
      source,
    };
  }
  const desired = roundMoney((Math.max(OPEN_SIZE_BB[heroChart(state)], 3.5) + limps) * state.bb);
  const to = clampRaise(desired, state.bb * 2, maxTo);
  return {
    action: 'raise',
    chips: to,
    headline: raiseHeadline(to, maxTo, state.bb),
    explanation: `${name} can raise over ${limpWord} from ${seatPhrase(state)}. ${raiseSentence(to, maxTo, state.bb)}.`,
    source,
  };
}

function versusOpen(
  state: HandState,
  key: string,
  name: string,
  opener: RaiseEvent,
  callers: number,
  maxTo: number,
): PreflopAdvice {
  const openerChart = chartPosition(state.seats, opener.position);
  const source = `Vs-${openerGroup(openerChart)} open · ${seatPhrase(state)} · 100bb`;
  const threeBet = threeBetRange(heroChart(state), openerChart);
  const flat = callRange(heroChart(state), openerChart);
  const who = `${opener.position} open`;

  if (inRange(key, threeBet)) {
    const oop = heroChart(state) === 'SB' || heroChart(state) === 'BB';
    const multiplier = oop ? 4 : 3;
    const desired = roundMoney(opener.to * multiplier + callers * opener.to);
    const minTo = derive(state).minRaiseTo;
    const to = clampRaise(desired, minTo, maxTo);
    const callerNote = callers > 0 ? ` with ${callers} caller${callers === 1 ? '' : 's'} already in` : '';
    return {
      action: 'raise',
      chips: to,
      headline: raiseHeadline(to, maxTo, state.bb),
      explanation: `${name} 3-bets a ${who} from ${seatPhrase(state)}${callerNote}. ${raiseSentence(to, maxTo, state.bb)}.`,
      source,
    };
  }

  const canCall = inRange(key, flat) && continuesMultiway(key, callers);
  if (canCall) {
    const owed = derive(state).toCall;
    return {
      action: 'call',
      chips: owed,
      headline: `Call ${chipsAndBb(owed, state.bb)}`,
      explanation: `${name} flats a ${who} from ${seatPhrase(state)} in this chart. Call ${chipsAndBb(owed, state.bb)}.`,
      source,
    };
  }

  if (callers > 0 && inRange(key, flat) && !continuesMultiway(key, callers)) {
    return {
      action: 'fold',
      chips: null,
      headline: 'Fold',
      explanation: `${name} might flat this open heads-up, but with ${callers} caller${callers === 1 ? '' : 's'} it is a fold from ${seatPhrase(state)}.`,
      source,
    };
  }

  return {
    action: 'fold',
    chips: null,
    headline: 'Fold',
    explanation: `${name} is not in the ${seatPhrase(state)} 3-bet or call range against a ${who}. Fold.`,
    source,
  };
}

function versusThreeBet(
  state: HandState,
  key: string,
  name: string,
  raises: RaiseEvent[],
  maxTo: number,
): PreflopAdvice {
  const heroOpened = raises[0].position === state.hero;
  const chart = heroOpened ? fourBetRange(heroChart(state)) : coldFourBetRange(heroChart(state));
  const source = heroOpened ? `Vs 3-bet · ${seatPhrase(state)} opened · 100bb` : `Cold vs 3-bet · ${seatPhrase(state)} · 100bb`;
  const derived = derive(state);
  const threeBet = raises[1];

  if (inRange(key, chart.fourBet)) {
    const chartSeat = heroChart(state);
    const oop = chartSeat === 'SB' || chartSeat === 'BB' || chartSeat === 'UTG';
    const desired = roundMoney(threeBet.to * (oop ? 2.7 : 2.4));
    const jammed = desired >= state.stack * 0.4;
    const to = jammed ? maxTo : clampRaise(desired, derived.minRaiseTo, maxTo);
    return {
      action: 'raise',
      chips: to,
      headline: raiseHeadline(to, maxTo, state.bb),
      explanation: `${name} 4-bets ${heroOpened ? 'after opening' : 'as a cold 4-bet'} against ${threeBet.position}. ${raiseSentence(to, maxTo, state.bb)}.`,
      source,
    };
  }

  if (inRange(key, chart.call)) {
    return {
      action: 'call',
      chips: derived.toCall,
      headline: `Call ${chipsAndBb(derived.toCall, state.bb)}`,
      explanation: `${name} calls the 3-bet from ${threeBet.position} in this chart and plays the flop. Call ${chipsAndBb(derived.toCall, state.bb)}.`,
      source,
    };
  }

  return {
    action: 'fold',
    chips: null,
    headline: 'Fold',
    explanation: `${name} is not strong enough to continue against ${threeBet.position}'s 3-bet from ${seatPhrase(state)}. Fold.`,
    source,
  };
}

function versusFourBet(state: HandState, key: string, name: string, fourBet: RaiseEvent, maxTo: number): PreflopAdvice {
  const derived = derive(state);
  const source = 'Vs 4-bet · 100bb full ring';
  const jam = derived.toCall >= state.stack * 0.45 || fourBet.to >= state.stack * 0.7;
  if (jam) {
    if (inRange(key, CALL_VS_JAM)) {
      return {
        action: 'call',
        chips: derived.toCall,
        headline: derived.toCall >= maxTo - 0.01 ? 'Call all-in' : `Call ${chipsAndBb(derived.toCall, state.bb)}`,
        explanation: `${name} calls a 4-bet jam from ${fourBet.position}. The chart continues with queens and ace-king, and jams or calls aces and kings.`,
        source,
      };
    }
    return {
      action: 'fold',
      chips: null,
      headline: 'Fold',
      explanation: `${name} folds to a 4-bet jam from ${fourBet.position} in this 100bb chart.`,
      source,
    };
  }

  if (inRange(key, FIVE_BET_RANGE)) {
    return {
      action: 'raise',
      chips: maxTo,
      headline: 'All-in',
      explanation: `${name} 5-bet jams over ${fourBet.position}'s 4-bet. Shove ${chipsAndBb(maxTo, state.bb)}.`,
      source,
    };
  }
  if (inRange(key, CALL_VS_FOUR_BET)) {
    return {
      action: 'call',
      chips: derived.toCall,
      headline: `Call ${chipsAndBb(derived.toCall, state.bb)}`,
      explanation: `${name} calls the 4-bet and sees a flop. Call ${chipsAndBb(derived.toCall, state.bb)}.`,
      source,
    };
  }
  return {
    action: 'fold',
    chips: null,
    headline: 'Fold',
    explanation: `${name} is a fold against ${fourBet.position}'s 4-bet at 100bb.`,
    source,
  };
}

function versusFiveBet(state: HandState, key: string, name: string, maxTo: number): PreflopAdvice {
  const derived = derive(state);
  const source = 'Vs 5-bet · 100bb full ring';
  if (inRange(key, CALL_VS_FIVE_BET_JAM)) {
    const canRaise = maxTo > derived.currentBet + 0.01 && derived.heroRemaining > derived.toCall + 0.01;
    if (!canRaise) {
      return {
        action: 'call',
        chips: derived.toCall,
        headline: 'Call all-in',
        explanation: `${name} calls the 5-bet. Aces and kings are the continuing hands in this chart.`,
        source,
      };
    }
    return {
      action: 'raise',
      chips: maxTo,
      headline: 'All-in',
      explanation: `${name} jams over the 5-bet. Aces and kings do not flat when a raise is still possible.`,
      source,
    };
  }
  return {
    action: 'fold',
    chips: null,
    headline: 'Fold',
    explanation: `${name} folds to a 5-bet. This chart only continues with aces and kings.`,
    source,
  };
}

function heroChart(state: HandState): Position {
  return chartPosition(state.seats, state.hero);
}

/** Seat name, plus the full-ring chart when a short table borrows one. */
function seatPhrase(state: HandState): string {
  const chart = heroChart(state);
  return chart === state.hero ? state.hero : `${state.hero} (${chart} chart)`;
}

function readSpot(actions: ActionRecord[]): { raises: RaiseEvent[]; limps: number; callers: number } {
  const raises: RaiseEvent[] = [];
  let limps = 0;
  let callers = 0;
  for (const action of actions) {
    if (action.street !== 'preflop' || action.kind === 'post') continue;
    if (action.kind === 'raise') {
      raises.push({ position: action.position, to: action.commitAfter });
      callers = 0;
    } else if (action.kind === 'call') {
      if (raises.length === 0) limps += 1;
      else callers += 1;
    }
  }
  return { raises, limps, callers };
}

function clampRaise(desired: number, minTo: number, maxTo: number): number {
  if (desired >= maxTo - 0.01) return roundMoney(maxTo);
  if (desired < minTo) return roundMoney(Math.min(maxTo, minTo));
  return roundMoney(desired);
}

function raiseHeadline(to: number, maxTo: number, bb: number): string {
  if (to >= maxTo - 0.01) return `All-in ${chipsAndBb(to, bb)}`;
  return `Raise to ${chipsAndBb(to, bb)}`;
}

function raiseSentence(to: number, maxTo: number, bb: number): string {
  if (to >= maxTo - 0.01) return `Move all-in for ${chipsAndBb(to, bb)}`;
  return `Raise to ${chipsAndBb(to, bb)}`;
}
