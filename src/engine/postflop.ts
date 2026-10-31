import { analyzeHolding, boardTexture, capitalizedHolding, texturePhrase, type HandRead, type Texture } from './analyze';
import { type Card } from './cards';
import type { Position, Street } from './constants';
import { type WeightedCombo, equityVsRange, seedFrom, type EquityResult } from './equity';
import { type HandState, derive, type Derived } from './hand';
import { EPS, chipsAndBb, percent, potOdds, roundMoney, roundToChips } from './pot';
import { OPEN_RANGE, callRange, combosFromRange, openerGroup, threeBetRange } from './ranges';

/**
 * Postflop advice is a heuristic, not a solver.
 *
 * It estimates one villain's range from the preflop line, measures equity
 * (exact on the turn and river, Monte Carlo on the flop), then picks
 * check / bet / call / raise / fold from equity versus pot odds, hand class,
 * board texture, and stack-to-pot ratio.
 *
 * Plug-in point: replace `decidePostflop` with a lookup of solver strategies
 * by board and node, and replace `inferVillainRange` with stored ranges.
 */

export type DecisionReason =
  | 'value-bet'
  | 'cbet'
  | 'semi-bluff'
  | 'check'
  | 'value-raise'
  | 'jam'
  | 'call'
  | 'call-draw'
  | 'fold';

export interface DecisionInput {
  equity: number;
  toCall: number;
  pot: number;
  spr: number;
  street: Street;
  multiway: boolean;
  heroIsAggressor: boolean;
  read: HandRead;
  texture: Texture;
  bb: number;
  heroRemaining: number;
  currentBet: number;
  heroStreetCommit: number;
  maxStreetCommit: number;
  minRaiseTo: number;
}

export interface Decision {
  action: 'fold' | 'check' | 'call' | 'bet' | 'raise';
  /** Street commitment for bet/raise, chips added for a call. */
  chips: number | null;
  reason: DecisionReason;
  fraction: number | null;
}

export interface PostflopAdvice {
  action: Decision['action'];
  chips: number | null;
  headline: string;
  explanation: string;
  source: string;
  equity: EquityResult;
  requiredEquity: number | null;
  handLabel: string;
  texture: string;
  rangeLabel: string;
  reason: DecisionReason;
}

export function decidePostflop(input: DecisionInput): Decision {
  const required = input.toCall > EPS ? input.toCall / (input.pot + input.toCall) : 0;
  if (input.toCall > EPS) return facingBet(input, required);
  return checkedTo(input);
}

function facingBet(input: DecisionInput, required: number): Decision {
  const { equity, read, texture, street, multiway, spr, toCall, pot, currentBet, heroStreetCommit, maxStreetCommit, minRaiseTo, heroRemaining } =
    input;
  const monster = read.strength === 'monster';
  const strong = read.strength === 'strong';
  const draw = read.flushDraw || read.oesd || read.outs >= 8;
  const canRaise = maxStreetCommit > currentBet + EPS && heroRemaining > toCall + EPS;

  if (
    !multiway &&
    canRaise &&
    equity >= Math.max(0.58, required) &&
    (monster || (strong && equity >= 0.72))
  ) {
    const target = texture.wetness === 'dry' && street === 'flop' ? currentBet * 3 : heroStreetCommit + pot + 2 * toCall;
    const to = clampCommit(target, minRaiseTo, maxStreetCommit, currentBet);
    const allIn = to >= maxStreetCommit - EPS;
    return { action: 'raise', chips: to, reason: allIn || spr <= 1.4 ? 'jam' : 'value-raise', fraction: null };
  }

  if (equity + 0.005 >= required) {
    return {
      action: 'call',
      chips: roundMoney(toCall),
      reason: draw && !monster && !strong ? 'call-draw' : 'call',
      fraction: null,
    };
  }

  const implied = !multiway && spr >= 6 && draw && equity + 0.07 >= required && street !== 'river';
  if (implied) return { action: 'call', chips: roundMoney(toCall), reason: 'call-draw', fraction: null };

  if (monster && equity + 0.04 >= required) {
    return { action: 'call', chips: roundMoney(toCall), reason: 'call', fraction: null };
  }

  return { action: 'fold', chips: null, reason: 'fold', fraction: null };
}

function checkedTo(input: DecisionInput): Decision {
  const { equity, read, texture, street, multiway, heroIsAggressor, spr, pot, bb, maxStreetCommit } = input;
  const monster = read.strength === 'monster';
  const strong = read.strength === 'strong';
  const draw = (read.flushDraw || read.oesd) && read.outs >= 8;

  if (spr <= 1.3 && (monster || (strong && equity >= 0.55))) {
    return { action: 'bet', chips: roundMoney(maxStreetCommit), reason: 'jam', fraction: 1 };
  }

  const value =
    monster ||
    (strong && equity >= 0.52 && (!multiway || equity >= 0.6)) ||
    (!multiway && street === 'river' && (strong || read.strength === 'showdown') && equity >= 0.58);

  if (value) {
    let fraction = 0.66;
    if (street === 'flop' && texture.wetness === 'dry' && !texture.paired) fraction = 0.33;
    else if (texture.wetness === 'wet' || street === 'river') fraction = 0.75;
    return { action: 'bet', chips: sizeBet(pot, fraction, bb, maxStreetCommit), reason: 'value-bet', fraction };
  }

  if (!multiway && street !== 'river' && draw && equity >= 0.3) {
    return { action: 'bet', chips: sizeBet(pot, 0.66, bb, maxStreetCommit), reason: 'semi-bluff', fraction: 0.66 };
  }

  if (!multiway && heroIsAggressor && street === 'flop' && texture.wetness === 'dry' && !texture.paired && equity >= 0.4) {
    return { action: 'bet', chips: sizeBet(pot, 0.33, bb, maxStreetCommit), reason: 'cbet', fraction: 0.33 };
  }

  return { action: 'check', chips: null, reason: 'check', fraction: null };
}

function sizeBet(pot: number, fraction: number, bb: number, maxTo: number): number {
  const raw = Math.max(bb, roundToChips(pot * fraction, bb));
  if (raw >= maxTo * 0.9) return roundMoney(maxTo);
  return roundMoney(Math.min(maxTo, raw));
}

function clampCommit(target: number, minTo: number, maxTo: number, currentBet: number): number {
  if (maxTo <= currentBet + EPS) return roundMoney(maxTo);
  if (target >= maxTo - EPS) return roundMoney(maxTo);
  if (target < minTo) return roundMoney(Math.min(maxTo, minTo));
  return roundMoney(target);
}

export function advisePostflop(state: HandState): PostflopAdvice | null {
  if (state.hole.length !== 2 || state.board.length < 3) return null;
  const hole = state.hole as [Card, Card];
  const derived = derive(state);
  const read = analyzeHolding(hole, state.board);
  const texture = boardTexture(state.board);
  const villain = inferVillainRange(state);
  const equity = equityVsRange({
    hero: hole,
    board: state.board,
    range: villain.combos,
    iterations: state.board.length === 3 ? 1400 : 800,
    seed: seedFrom([
      hole.map((card) => `${card.rank}${card.suit}`).join(''),
      state.board.map((card) => `${card.rank}${card.suit}`).join(''),
      villain.label,
      String(derived.pot),
      String(derived.toCall),
    ]),
  });

  const opponents = derived.active.filter((position) => position !== state.hero).length;
  const decision = decidePostflop({
    equity: equity.equity,
    toCall: derived.toCall,
    pot: derived.pot,
    spr: derived.spr ?? 100,
    street: state.street,
    multiway: opponents >= 2,
    heroIsAggressor: heroWasAggressor(state),
    read,
    texture,
    bb: state.bb,
    heroRemaining: derived.heroRemaining,
    currentBet: derived.currentBet,
    heroStreetCommit: derived.heroStreetCommit,
    maxStreetCommit: derived.maxHeroStreetCommit,
    minRaiseTo: derived.minRaiseTo,
  });

  const required = potOdds(derived.pot, derived.toCall);
  return {
    action: decision.action,
    chips: decision.chips,
    headline: headlineFor(decision, state.bb, derived),
    explanation: explain(decision, read, texture, equity.equity, required, villain.label, state.bb),
    source: `Postflop heuristic · ${equity.method === 'exact' ? 'exact equity' : 'Monte Carlo equity'}`,
    equity,
    requiredEquity: required,
    handLabel: read.madeLabel || capitalizedHolding(read),
    texture: texture.summary,
    rangeLabel: villain.label,
    reason: decision.reason,
  };
}

function headlineFor(decision: Decision, bb: number, derived: Derived): string {
  if (decision.action === 'fold') return 'Fold';
  if (decision.action === 'check') return 'Check';
  if (decision.action === 'call') {
    const amount = decision.chips ?? derived.toCall;
    if (amount >= derived.heroRemaining - EPS) return 'Call all-in';
    return `Call ${chipsAndBb(amount, bb)}`;
  }
  const to = decision.chips ?? 0;
  if (to >= derived.maxHeroStreetCommit - EPS) return `All-in ${chipsAndBb(to, bb)}`;
  if (decision.action === 'raise') return `Raise to ${chipsAndBb(to, bb)}`;
  const fraction = decision.fraction ? ` · ${Math.round(decision.fraction * 100)}% pot` : '';
  return `Bet ${chipsAndBb(to, bb)}${fraction}`;
}

function explain(
  decision: Decision,
  read: HandRead,
  texture: Texture,
  equity: number,
  required: number | null,
  rangeLabel: string,
  bb: number,
): string {
  const holding = capitalizedHolding(read);
  const board = texturePhrase(texture);
  const eq = percent(equity);
  const size = decision.chips !== null ? chipsAndBb(decision.chips, bb) : '';
  const need = required === null ? '' : percent(required);

  if (decision.reason === 'fold') {
    return `${holding} on ${board}. You have about ${eq} equity against ${rangeLabel}, short of the ${need} this bet needs. Fold.`;
  }
  if (decision.reason === 'call' || decision.reason === 'call-draw') {
    return `${holding} on ${board}. You have about ${eq} equity against ${rangeLabel}, and the call needs ${need}, so call ${size}.`;
  }
  if (decision.reason === 'value-raise' || decision.reason === 'jam') {
    const verb = decision.action === 'bet' ? `bet ${size}` : `raise to ${size}`;
    return `${holding} on ${board}. About ${eq} equity against ${rangeLabel} is well ahead, so ${verb}.`;
  }
  if (decision.reason === 'value-bet') {
    const portion = decision.fraction ? `, about ${Math.round(decision.fraction * 100)}% of the pot` : '';
    return `${holding} on ${board}. You have about ${eq} equity against ${rangeLabel}, so bet ${size}${portion}.`;
  }
  if (decision.reason === 'semi-bluff') {
    return `${holding} on ${board}. The draw has about ${eq} equity against ${rangeLabel}, so bet ${size} as a semi-bluff.`;
  }
  if (decision.reason === 'cbet') {
    return `${holding} on ${board}. You were the preflop raiser and have about ${eq} equity against ${rangeLabel}, so a small bet of ${size} continues.`;
  }
  return `${holding} on ${board}. About ${eq} equity against ${rangeLabel} is not a clear bet, so check.`;
}

interface VillainRange {
  combos: WeightedCombo[];
  label: string;
}

export function inferVillainRange(state: HandState): VillainRange {
  const derived = derive(state);
  const raises = preflopRaises(state);
  const active = derived.active.filter((position) => position !== state.hero);
  const lastRaiser = [...raises].reverse().find((raise) => raise.position !== state.hero && !derived.folded.includes(raise.position));
  const callers = preflopCallers(state).filter((position) => position !== state.hero && !derived.folded.includes(position));

  let position: Position | null = lastRaiser?.position ?? callers[callers.length - 1] ?? active[0] ?? null;
  let expr = '';
  let label = 'a random hand';

  if (position && lastRaiser && lastRaiser.position === position) {
    if (raises.length >= 3 && raises[raises.length - 1].position === position) {
      expr = 'QQ+,AKs,AKo';
      label = `${position}'s 4-bet range`;
    } else if (raises.length >= 2 && raises[1].position === position) {
      const opener = raises[0].position;
      expr = threeBetRange(position, opener);
      label = `${position}'s 3-bet range against ${openerGroup(opener)}`;
    } else {
      expr = OPEN_RANGE[position] || '22+,A2s+,A9o+,KTs+,KJo+,QTs+,JTs';
      label = `${position}'s opening range`;
    }
  } else if (position) {
    const opener = raises[0]?.position;
    if (opener && opener !== position) {
      expr = callRange(position, opener) || OPEN_RANGE[position] || '22+,A9s+,KTs+,QTs+,JTs,T9s,98s,AJo+,KQo';
      label = `${position}'s calling range`;
    } else {
      expr = '22+,A2s+,K9s+,Q9s+,J9s+,T8s+,97s+,86s+,A9o+,KTo+,QTo+,JTo';
      label = `${position}'s limp range`;
    }
  }

  const dead = [...state.hole, ...state.board];
  let combos = expr ? combosFromRange(expr, dead) : [];
  if (combos.length === 0) {
    label = 'a random hand';
  } else if (villainBetPostflop(state, position)) {
    const narrowed = combos.filter((combo) => continues(combo.cards, state.board));
    if (narrowed.length >= 8) {
      combos = narrowed;
      label = `${label}, narrowed to a continue range`;
    }
  }

  return { combos, label };
}

function continues(hole: [Card, Card], board: Card[]): boolean {
  if (board.length < 3) return true;
  const read = analyzeHolding(hole, board);
  if (read.flushDraw || read.oesd || read.gutshot || read.overcards >= 2) return true;
  if (read.strength === 'air') return false;
  return true;
}

function villainBetPostflop(state: HandState, villain: Position | null): boolean {
  if (!villain) return false;
  return state.actions.some(
    (action) =>
      action.position === villain &&
      action.street !== 'preflop' &&
      (action.kind === 'bet' || action.kind === 'raise'),
  );
}

function preflopRaises(state: HandState): { position: Position; to: number }[] {
  return state.actions
    .filter((action) => action.street === 'preflop' && action.kind === 'raise')
    .map((action) => ({ position: action.position, to: action.commitAfter }));
}

function preflopCallers(state: HandState): Position[] {
  let seenRaise = false;
  const callers: Position[] = [];
  for (const action of state.actions) {
    if (action.street !== 'preflop') continue;
    if (action.kind === 'raise') {
      seenRaise = true;
      continue;
    }
    if (action.kind === 'call' && seenRaise) callers.push(action.position);
  }
  return callers;
}

function heroWasAggressor(state: HandState): boolean {
  const raises = preflopRaises(state);
  if (raises.length === 0) return false;
  return raises[raises.length - 1].position === state.hero;
}
