import { type Card, cardText, sameCard } from './cards';
import {
  type Position,
  type Street,
  POSITIONS,
  POSTFLOP_ORDER,
  PREFLOP_ORDER,
  boardCardsFor,
  nextStreet,
} from './constants';
import { EPS, potOdds, roundMoney, spr } from './pot';

export type ActionKind = 'post' | 'fold' | 'check' | 'call' | 'bet' | 'raise';

export interface ActionRecord {
  street: Street;
  position: Position;
  kind: ActionKind;
  /** Chips added to the pot by this action. */
  added: number;
  /** This player's total commitment on the street after the action. */
  commitAfter: number;
}

export interface TableConfig {
  sb: number;
  bb: number;
  stackBb: number;
  hero: Position;
}

export interface HandState {
  sb: number;
  bb: number;
  stackBb: number;
  stack: number;
  hero: Position;
  hole: Card[];
  board: Card[];
  street: Street;
  actions: ActionRecord[];
}

export interface Derived {
  pot: number;
  /** Chips the hero must add to match the current bet. */
  toCall: number;
  currentBet: number;
  lastFullRaise: number;
  minRaiseTo: number;
  heroStreetCommit: number;
  heroTotal: number;
  heroRemaining: number;
  maxHeroStreetCommit: number;
  spr: number | null;
  potOdds: number | null;
  folded: Position[];
  allIn: Position[];
  toAct: Position | null;
  winner: Position | null;
  streetCommit: Record<Position, number>;
  totalCommit: Record<Position, number>;
  active: Position[];
}

export interface ActionInput {
  position: Position;
  kind: 'fold' | 'check' | 'call' | 'bet' | 'raise';
  /** Total street commitment for a bet or raise. */
  to?: number;
}

export type ActionResult = { ok: true; state: HandState } | { ok: false; error: string };

export function defaultConfig(): TableConfig {
  return { sb: 1, bb: 2, stackBb: 100, hero: 'HJ' };
}

export function validateConfig(config: Pick<TableConfig, 'sb' | 'bb' | 'stackBb'>): string | null {
  if (!(config.sb > 0)) return 'Small blind must be greater than zero.';
  if (!(config.bb >= config.sb)) return 'Big blind must be at least the small blind.';
  if (!(config.stackBb >= 1)) return 'Effective stack must be at least 1bb.';
  if (!Number.isFinite(config.sb) || !Number.isFinite(config.bb) || !Number.isFinite(config.stackBb)) {
    return 'Blinds and stack need to be numbers.';
  }
  return null;
}

export function createHand(config: TableConfig): HandState {
  const problem = validateConfig(config);
  if (problem) throw new Error(problem);
  const sb = roundMoney(config.sb);
  const bb = roundMoney(config.bb);
  const stackBb = roundMoney(config.stackBb);
  const stack = roundMoney(stackBb * bb);
  return {
    sb,
    bb,
    stackBb,
    stack,
    hero: config.hero,
    hole: [],
    board: [],
    street: 'preflop',
    actions: [
      { street: 'preflop', position: 'SB', kind: 'post', added: Math.min(sb, stack), commitAfter: Math.min(sb, stack) },
      { street: 'preflop', position: 'BB', kind: 'post', added: Math.min(bb, stack), commitAfter: Math.min(bb, stack) },
    ],
  };
}

export function isPristine(state: HandState): boolean {
  return (
    state.street === 'preflop' &&
    state.hole.length === 0 &&
    state.board.length === 0 &&
    state.actions.every((action) => action.kind === 'post')
  );
}

export function newHand(state: HandState): HandState {
  return createHand({ sb: state.sb, bb: state.bb, stackBb: state.stackBb, hero: state.hero });
}

export function updateConfig(state: HandState, config: TableConfig): HandState {
  if (!isPristine(state)) return state;
  return createHand(config);
}

function cardsOverlap(a: Card[], b: Card[]): boolean {
  return a.some((card) => b.some((other) => sameCard(card, other)));
}

export function setHole(state: HandState, hole: Card[]): ActionResult {
  if (hole.length > 2) return { ok: false, error: 'You can only hold two cards.' };
  if (new Set(hole.map(cardText)).size !== hole.length) return { ok: false, error: 'Those two cards are the same.' };
  if (cardsOverlap(hole, state.board)) return { ok: false, error: 'That card is already on the board.' };
  return { ok: true, state: { ...state, hole } };
}

export function setBoard(state: HandState, board: Card[]): ActionResult {
  if (board.length > 5) return { ok: false, error: 'A board has at most five cards.' };
  if (new Set(board.map(cardText)).size !== board.length) return { ok: false, error: 'Duplicate board card.' };
  if (cardsOverlap(board, state.hole)) return { ok: false, error: 'That card is in your hand.' };
  return { ok: true, state: { ...state, board } };
}

export function derive(state: HandState): Derived {
  const totalCommit = emptyAmounts();
  const streetCommit = emptyAmounts();
  const folded = new Set<Position>();

  for (const action of state.actions) {
    totalCommit[action.position] = roundMoney(totalCommit[action.position] + action.added);
    if (action.kind === 'fold') folded.add(action.position);
  }

  let currentBet = 0;
  let lastFullRaise = state.bb;
  const voluntary: ActionRecord[] = [];
  for (const action of state.actions) {
    if (action.street !== state.street) continue;
    if (action.kind === 'post') {
      streetCommit[action.position] = action.commitAfter;
      currentBet = Math.max(currentBet, action.commitAfter);
      continue;
    }
    if (action.kind === 'call' || action.kind === 'bet' || action.kind === 'raise') {
      streetCommit[action.position] = action.commitAfter;
    }
    if (action.kind === 'bet') {
      lastFullRaise = action.commitAfter;
      currentBet = action.commitAfter;
    } else if (action.kind === 'raise') {
      const increment = action.commitAfter - currentBet;
      if (increment >= lastFullRaise - EPS) lastFullRaise = increment;
      currentBet = Math.max(currentBet, action.commitAfter);
    }
    voluntary.push(action);
  }

  const allIn = POSITIONS.filter((position) => totalCommit[position] >= state.stack - EPS);
  const active = POSITIONS.filter((position) => !folded.has(position));
  const winner = active.length === 1 ? active[0] : null;
  const toAct = winner ? null : findToAct(state.street, folded, new Set(allIn), streetCommit, voluntary, currentBet);

  const heroTotal = totalCommit[state.hero];
  const heroStreetCommit = streetCommit[state.hero];
  const heroRemaining = roundMoney(Math.max(0, state.stack - heroTotal));
  const maxHeroStreetCommit = roundMoney(heroStreetCommit + heroRemaining);
  const rawToCall = Math.max(0, currentBet - heroStreetCommit);
  const toCall = roundMoney(Math.min(rawToCall, heroRemaining));
  const pot = roundMoney(POSITIONS.reduce((sum, position) => sum + totalCommit[position], 0));
  const minRaiseTo = roundMoney(currentBet <= EPS ? state.bb : currentBet + Math.max(lastFullRaise, state.bb));

  return {
    pot,
    toCall,
    currentBet: roundMoney(currentBet),
    lastFullRaise: roundMoney(lastFullRaise),
    minRaiseTo,
    heroStreetCommit: roundMoney(heroStreetCommit),
    heroTotal: roundMoney(heroTotal),
    heroRemaining,
    maxHeroStreetCommit,
    spr: spr(heroRemaining, pot),
    potOdds: potOdds(pot, toCall),
    folded: POSITIONS.filter((position) => folded.has(position)),
    allIn,
    toAct,
    winner,
    streetCommit,
    totalCommit,
    active,
  };
}

function emptyAmounts(): Record<Position, number> {
  return { UTG: 0, 'UTG+1': 0, 'UTG+2': 0, LJ: 0, HJ: 0, CO: 0, BTN: 0, SB: 0, BB: 0 };
}

function findToAct(
  street: Street,
  folded: Set<Position>,
  allIn: Set<Position>,
  streetCommit: Record<Position, number>,
  voluntary: ActionRecord[],
  currentBet: number,
): Position | null {
  const order = street === 'preflop' ? PREFLOP_ORDER : POSTFLOP_ORDER;
  const active = order.filter((position) => !folded.has(position));
  if (active.length < 2) return null;
  const living = (position: Position) => !allIn.has(position);
  if (voluntary.length === 0) return order.find((position) => active.includes(position) && living(position)) ?? null;

  const last = voluntary[voluntary.length - 1].position;
  const start = order.indexOf(last);
  for (let step = 1; step < order.length; step++) {
    const position = order[(start + step) % order.length];
    if (!active.includes(position) || !living(position)) continue;
    const commit = streetCommit[position] ?? 0;
    const acted = voluntary.some((action) => action.position === position);
    if (commit < currentBet - EPS || !acted) return position;
  }
  return null;
}

export function amountToCall(state: HandState, position: Position, derived: Derived = derive(state)): number {
  const remaining = Math.max(0, state.stack - derived.totalCommit[position]);
  return roundMoney(Math.min(Math.max(0, derived.currentBet - derived.streetCommit[position]), remaining));
}

export function maxStreetCommit(state: HandState, position: Position, derived: Derived = derive(state)): number {
  const remaining = Math.max(0, state.stack - derived.totalCommit[position]);
  return roundMoney(derived.streetCommit[position] + remaining);
}

export function applyAction(state: HandState, input: ActionInput): ActionResult {
  const derived = derive(state);
  if (derived.winner) return { ok: false, error: 'This hand is already over.' };
  if (derived.toAct !== input.position) {
    return { ok: false, error: derived.toAct ? `It is ${derived.toAct}'s turn.` : 'Nobody needs to act.' };
  }

  const commit = derived.streetCommit[input.position];
  const owed = amountToCall(state, input.position, derived);
  const maxTo = maxStreetCommit(state, input.position, derived);
  const remaining = Math.max(0, state.stack - derived.totalCommit[input.position]);

  if (input.kind === 'fold') {
    return { ok: true, state: push(state, { ...base(state, input.position), kind: 'fold', added: 0, commitAfter: commit }) };
  }

  if (input.kind === 'check') {
    if (owed > EPS) return { ok: false, error: `${input.position} must call ${owed} or fold. A check is not legal.` };
    return { ok: true, state: push(state, { ...base(state, input.position), kind: 'check', added: 0, commitAfter: commit }) };
  }

  if (input.kind === 'call') {
    if (owed <= EPS) return { ok: false, error: 'There is nothing to call.' };
    const added = roundMoney(Math.min(owed, remaining));
    return {
      ok: true,
      state: push(state, { ...base(state, input.position), kind: 'call', added, commitAfter: roundMoney(commit + added) }),
    };
  }

  const to = input.to === undefined ? NaN : roundMoney(input.to);
  if (!Number.isFinite(to)) return { ok: false, error: 'A bet or raise needs an amount.' };

  if (input.kind === 'bet') {
    if (derived.currentBet > EPS) return { ok: false, error: 'There is already a bet. Raise or call.' };
    if (to < state.bb - EPS && to < maxTo - EPS) {
      return { ok: false, error: `The minimum bet is ${state.bb}.` };
    }
    if (to > maxTo + EPS) return { ok: false, error: `${input.position} only has ${maxTo} committed on this street.` };
    const added = roundMoney(to - commit);
    if (added <= EPS) return { ok: false, error: 'A bet has to put chips in.' };
    return { ok: true, state: push(state, { ...base(state, input.position), kind: 'bet', added, commitAfter: to }) };
  }

  if (derived.currentBet <= EPS) return { ok: false, error: 'There is no bet to raise. Bet instead.' };
  if (to <= derived.currentBet + EPS) return { ok: false, error: 'A raise has to be bigger than the current bet.' };
  const shortAllIn = to >= maxTo - EPS && maxTo < derived.minRaiseTo - EPS;
  if (to < derived.minRaiseTo - EPS && !shortAllIn) {
    return { ok: false, error: `The minimum raise is to ${derived.minRaiseTo}.` };
  }
  if (to > maxTo + EPS) return { ok: false, error: `${input.position} can raise to at most ${maxTo}.` };
  const target = Math.min(to, maxTo);
  const added = roundMoney(target - commit);
  if (added <= EPS) return { ok: false, error: 'That raise does not add chips.' };
  return {
    ok: true,
    state: push(state, { ...base(state, input.position), kind: 'raise', added, commitAfter: roundMoney(target) }),
  };
}

function base(state: HandState, position: Position): Pick<ActionRecord, 'street' | 'position'> {
  return { street: state.street, position };
}

function push(state: HandState, action: ActionRecord): HandState {
  return { ...state, actions: [...state.actions, action] };
}

export function foldToHero(state: HandState): HandState {
  let current = state;
  for (let i = 0; i < 10; i++) {
    const derived = derive(current);
    if (!derived.toAct || derived.toAct === current.hero) return current;
    const result = applyAction(current, { position: derived.toAct, kind: 'fold' });
    if (!result.ok) return current;
    current = result.state;
  }
  return current;
}

export function advanceStreet(state: HandState): ActionResult {
  const derived = derive(state);
  if (derived.winner) return { ok: false, error: 'This hand is over.' };
  if (derived.toAct) return { ok: false, error: `Action is still on ${derived.toAct}.` };
  const street = nextStreet(state.street);
  if (!street) return { ok: false, error: 'The river is the last street.' };
  return { ok: true, state: { ...state, street } };
}

export function undo(state: HandState): HandState {
  const lastVoluntary = [...state.actions].reverse().findIndex((action) => action.kind !== 'post');
  const streetActions = state.actions.filter((action) => action.street === state.street && action.kind !== 'post');
  let next: HandState;
  if (streetActions.length === 0 && state.street !== 'preflop') {
    const previous: Street = state.street === 'river' ? 'turn' : state.street === 'turn' ? 'flop' : 'preflop';
    next = { ...state, street: previous };
  } else if (lastVoluntary === -1) {
    next = { ...state, hole: [], board: [] };
  } else {
    const index = state.actions.length - 1 - lastVoluntary;
    next = { ...state, actions: state.actions.filter((_, actionIndex) => actionIndex !== index) };
  }
  const limit = boardCardsFor(next.street);
  if (next.board.length > limit) return { ...next, board: next.board.slice(0, limit) };
  return next;
}

export function heroInvested(state: HandState): number {
  return derive(state).heroTotal;
}

export function opponentsRemaining(state: HandState): number {
  const derived = derive(state);
  return derived.active.filter((position) => position !== state.hero).length;
}
