import { useMemo, useState } from 'react';
import { analyzeHolding } from './engine/analyze';
import { type Rank, type Suit, startingHandName } from './engine/cards';
import {
  type Position,
  boardCardsFor,
  closestSeat,
  seatsFor,
  streetLabel,
  type Street,
} from './engine/constants';
import {
  type HandState,
  type ActionInput,
  amountToCall,
  advanceStreet,
  applyAction,
  createHand,
  defaultConfig,
  derive,
  foldToHero,
  isPristine,
  maxStreetCommit,
  newHand,
  setBoard,
  setHole,
  streetChoices,
  undo,
  validateConfig,
} from './engine/hand';
import { chipsAndBb, formatChips, formatSpr, percent, roundMoney, roundToChips } from './engine/pot';
import { recommend } from './engine/recommend';
import { CardSlot, RankSuitPicker } from './ui/Cards';
import {
  type PickerSession,
  type SlotCards,
  type SlotId,
  BOARD_SLOTS,
  HOLE_SLOTS,
  back as backPicker,
  emptySlotLabel,
  emptySlots,
  firstEmptyBoardSlot,
  openPicker,
  pickRank,
  pickSuit,
  projectCards,
  revealedStreet,
  slotsAfterUndo,
  takenCards,
} from './ui/cardPicker';

const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river'];

export function App() {
  const [state, setState] = useState<HandState>(() => createHand(defaultConfig()));
  const [sbText, setSbText] = useState('1');
  const [bbText, setBbText] = useState('2');
  const [stackText, setStackText] = useState('100');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [slots, setSlots] = useState<SlotCards>(() => emptySlots());
  const [picker, setPicker] = useState<PickerSession | null>(null);
  const [pickingSeat, setPickingSeat] = useState(false);
  const [pendingPlayers, setPendingPlayers] = useState<number | null>(null);
  const [pendingHero, setPendingHero] = useState<Position | null>(null);

  const derived = useMemo(() => derive(state), [state]);
  const advice = useMemo(() => recommend(state), [state]);
  const pristine = isPristine(state);
  const boardLimit = boardCardsFor(state.street);
  const visibleBoard = state.board.slice(0, boardLimit);
  const holeA = slots['hole-0'];
  const holeB = slots['hole-1'];
  const read =
    state.hole.length === 2 && visibleBoard.length >= 3
      ? analyzeHolding([state.hole[0], state.hole[1]], visibleBoard)
      : null;

  function replace(next: HandState) {
    setState(next);
    setError(null);
  }

  function apply(input: ActionInput) {
    const result = applyAction(state, input);
    if (!result.ok) setError(result.error);
    else {
      replace(publishBoard(result.state, slots));
      setAmount('');
    }
  }

  function updateTable(partial: Partial<{ sb: number; bb: number; stackBb: number; hero: Position; players: number }>) {
    const players = partial.players ?? state.seats.length;
    const seats = seatsFor(players);
    const requested = partial.hero ?? state.hero;
    const config = {
      sb: partial.sb ?? Number(sbText),
      bb: partial.bb ?? Number(bbText),
      stackBb: partial.stackBb ?? Number(stackText),
      hero: seats.includes(requested) ? requested : closestSeat(state.seats, requested, seats),
      players,
    };
    const problem = validateConfig(config);
    if (problem) {
      setError(problem);
      return;
    }
    if (!pristine) return;
    setError(null);
    setPendingHero(null);
    setPendingPlayers(null);
    setState(createHand(config));
  }

  function setPlayerCount(next: number) {
    if (next < 2 || next > 9) return;
    if (!pristine) {
      setPendingPlayers(next === state.seats.length ? null : next);
      return;
    }
    updateTable({ players: next });
  }

  function chooseSeat(position: Position) {
    setPickingSeat(false);
    if (pristine) {
      updateTable({ hero: position });
      return;
    }
    setPendingHero(position);
  }

  const following = newHand(state, {
    ...(pendingHero ? { hero: pendingHero } : {}),
    ...(pendingPlayers ? { players: pendingPlayers } : {}),
  });
  const editedPlayers = pendingPlayers ?? state.seats.length;

  function publishBoard(hand: HandState, nextSlots: SlotCards): HandState {
    const projected = projectCards(nextSlots, hand.street);
    const boarded = setBoard(hand, projected.board);
    if (!boarded.ok) return hand;
    const view = derive(boarded.state);
    const street = revealedStreet(nextSlots, boarded.state.street, !view.toAct && !view.winner);
    if (street === boarded.state.street) return boarded.state;
    const advanced = advanceStreet(boarded.state);
    if (!advanced.ok) return boarded.state;
    const later = setBoard(advanced.state, projectCards(nextSlots, advanced.state.street).board);
    return later.ok ? later.state : advanced.state;
  }

  function commitSlots(nextSlots: SlotCards): boolean {
    const projected = projectCards(nextSlots, state.street);
    const holeResult = setHole(state, projected.hole);
    if (!holeResult.ok) {
      setError(holeResult.error);
      return false;
    }
    replace(publishBoard(holeResult.state, nextSlots));
    setSlots(nextSlots);
    return true;
  }

  function openSlot(slot: SlotId) {
    setPicker(openPicker(slot));
  }

  function chooseRank(rank: Rank) {
    if (!picker) return;
    const next = pickRank(picker, rank, slots);
    if (next) setPicker(next);
  }

  function chooseSuit(suit: Suit) {
    if (!picker) return;
    const placed = pickSuit(picker, suit, slots);
    if (!placed || !commitSlots(placed.slots)) return;
    setPicker(placed.session);
  }

  function goBack() {
    if (!picker) return;
    setPicker(backPicker(picker));
  }

  function clearPickedSlot() {
    if (!picker) return;
    const nextSlots: SlotCards = { ...slots, [picker.slot]: null };
    if (!commitSlots(nextSlots)) return;
    setPicker({ ...picker, step: 'rank', rank: null });
  }

  function playAdvice() {
    if (derived.toAct !== state.hero) return;
    if (advice.action === 'fold') apply({ position: state.hero, kind: 'fold' });
    if (advice.action === 'check') apply({ position: state.hero, kind: 'check' });
    if (advice.action === 'call') apply({ position: state.hero, kind: 'call' });
    if (advice.action === 'bet' && advice.chips) apply({ position: state.hero, kind: 'bet', to: advice.chips });
    if (advice.action === 'raise' && advice.chips) apply({ position: state.hero, kind: 'raise', to: advice.chips });
  }

  const actor = derived.toAct;
  const actorMax = actor ? maxStreetCommit(state, actor) : 0;
  const actorOwed = actor ? amountToCall(state, actor) : 0;
  const actorCommit = actor ? derived.streetCommit[actor] : 0;
  const canAct = Boolean(actor) && !derived.winner;
  const choices = streetChoices({
    owed: actorOwed,
    currentBet: derived.currentBet,
    actorMax,
    actorCommit,
    minimumBet: state.bb,
  });
  const canRaise = Boolean(actor) && choices.raise;
  const canBet = Boolean(actor) && choices.bet;
  const raising = derived.currentBet > 0;

  const betPresets = canBet
    ? uniqueSizes(
        [
          ['33%', sizeBet(derived.pot, 0.33, state.bb, actorMax)],
          ['50%', sizeBet(derived.pot, 0.5, state.bb, actorMax)],
          ['66%', sizeBet(derived.pot, 0.66, state.bb, actorMax)],
          ['Pot', sizeBet(derived.pot, 1, state.bb, actorMax)],
          ['All-in', actorMax],
        ],
        actorMax,
      )
    : [];

  const raisePresets = canRaise
    ? uniqueSizes(
        [
          ['Min', Math.min(actorMax, derived.minRaiseTo)],
          ['3x', clampTo(derived.currentBet * 3, derived.minRaiseTo, actorMax)],
          ['Pot', clampTo(actorCommit + derived.pot + 2 * actorOwed, derived.minRaiseTo, actorMax)],
          ['All-in', actorMax],
        ],
        actorMax,
      )
    : [];

  function submitSized(to: number) {
    if (!actor) return;
    apply({ position: actor, kind: raising ? 'raise' : 'bet', to });
  }

  function submitCustom() {
    const to = roundMoney(Number(amount));
    if (!actor || !Number.isFinite(to)) {
      setError('Enter a bet or raise amount.');
      return;
    }
    submitSized(to);
  }

  const nextStreet = state.street === 'preflop' ? 'flop' : state.street === 'flop' ? 'turn' : state.street === 'turn' ? 'river' : null;
  const canAdvance = !derived.toAct && !derived.winner && nextStreet !== null;

  return (
    <div className="app">
      <header className="top">
        <div>
          <p className="mark">{state.seats.length}-handed no-limit hold'em</p>
          <h1>Full Ring Advisor</h1>
          <p className="lede">Xander's study table for cash-game decisions, from the first open through the river.</p>
        </div>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            replace(following);
            setSlots(emptySlots());
            setPicker(null);
            setAmount('');
            setPickingSeat(false);
            setPendingHero(null);
            setPendingPlayers(null);
          }}
        >
          New hand
        </button>
      </header>

      <section className="setup">
        <label>
          Small blind
          <input
            inputMode="decimal"
            value={sbText}
            disabled={!pristine}
            onChange={(event) => {
              setSbText(event.target.value);
              const sb = Number(event.target.value);
              if (event.target.value.trim() && Number.isFinite(sb)) updateTable({ sb });
            }}
          />
        </label>
        <label>
          Big blind
          <input
            inputMode="decimal"
            value={bbText}
            disabled={!pristine}
            onChange={(event) => {
              setBbText(event.target.value);
              const bb = Number(event.target.value);
              if (event.target.value.trim() && Number.isFinite(bb)) updateTable({ bb });
            }}
          />
        </label>
        <label>
          Effective stack
          <span className="suffix">
            <input
              inputMode="decimal"
              value={stackText}
              disabled={!pristine}
              onChange={(event) => {
                setStackText(event.target.value);
                const stackBb = Number(event.target.value);
                if (event.target.value.trim() && Number.isFinite(stackBb)) updateTable({ stackBb });
              }}
            />
            bb
          </span>
        </label>
        <div className="seats">
          <span>Players</span>
          <div>
            <button type="button" className="seat" disabled={editedPlayers <= 2} onClick={() => setPlayerCount(editedPlayers - 1)}>
              −
            </button>
            <strong className="player-count" data-testid="player-count">{editedPlayers}</strong>
            <button type="button" className="seat" disabled={editedPlayers >= 9} onClick={() => setPlayerCount(editedPlayers + 1)}>
              +
            </button>
          </div>
        </div>
        <div className="seats">
          <span>Your seat</span>
          <div role="group" aria-label={pickingSeat ? 'Choose your seat' : 'Your seat'}>
            {state.seats.map((position) => (
              <button
                key={position}
                type="button"
                className={position === state.hero ? 'seat on' : 'seat'}
                disabled={!pickingSeat}
                aria-pressed={position === state.hero}
                onClick={() => chooseSeat(position)}
              >
                {position}
              </button>
            ))}
            <button type="button" className="seat" onClick={() => setPickingSeat((open) => !open)}>
              {pickingSeat ? 'Cancel' : pristine ? 'Change seat' : 'Set next seat'}
            </button>
          </div>
          <p className="seat-note">
            {pendingHero
              ? `Next hand you play ${following.hero}.`
              : `Each new hand you move one spot, to ${following.hero}.`}
            {pendingPlayers ? ` ${pendingPlayers} players starting next hand.` : ''}
            {!pendingPlayers && state.seats.length < 9 ? ' Short-handed seats use the closest full-ring chart.' : ''}
          </p>
        </div>
      </section>

      <div className="layout">
        <main>
          <div className="rail" aria-label="Street">
            {STREETS.map((street) => (
              <span key={street} className={street === state.street ? 'on' : ''}>
                {streetLabel(street)}
              </span>
            ))}
          </div>

          <section className="panel">
            <div className="panel-head">
              <h2>Your hand</h2>
              <p>
                {holeA && holeB ? startingHandName(holeA, holeB) : 'Click a slot to choose two cards'}
              </p>
            </div>
            <div className="held">
              {HOLE_SLOTS.map((slot) => (
                <CardSlot
                  key={slot}
                  slot={slot}
                  label={emptySlotLabel(slot)}
                  card={slots[slot]}
                  active={picker?.slot === slot}
                  onClick={() => openSlot(slot)}
                />
              ))}
            </div>
            {read && (
              <p className="made">
                {read.madeLabel}
                {read.drawLabels.length > 0 ? ` · ${read.drawLabels.join(', ')}` : ''}
                {read.outs > 0 ? ` · ${read.outs} outs` : ''}
              </p>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Board</h2>
              <p>
                {BOARD_SLOTS.some((slot) => slots[slot]) ? (advice.texture ?? 'Community cards') : 'No community cards yet'}
              </p>
            </div>
            <div className="held board-row">
              {BOARD_SLOTS.map((slot) => (
                <CardSlot
                  key={slot}
                  slot={slot}
                  label={emptySlotLabel(slot)}
                  card={slots[slot]}
                  active={picker?.slot === slot}
                  onClick={() => openSlot(slot)}
                />
              ))}
            </div>
          </section>

          {picker && (
            <RankSuitPicker
              session={picker}
              taken={takenCards(slots, picker.slot)}
              current={slots[picker.slot]}
              onRank={chooseRank}
              onSuit={chooseSuit}
              onBack={goBack}
              onClear={clearPickedSlot}
            />
          )}

          <section className="panel">
            <div className="panel-head">
              <h2>Action</h2>
              <p>
                {derived.winner
                  ? derived.winner === state.hero
                    ? 'You won the pot'
                    : 'Hand over'
                  : actor
                    ? `${actor === state.hero ? `${actor} (you)` : actor} to act`
                    : 'Betting closed'}
              </p>
            </div>
            {error && <p className="error">{error}</p>}
            <div className="actions">
              {canAct && actor && (
                <>
                  <button type="button" onClick={() => apply({ position: actor, kind: 'fold' })}>
                    Fold
                  </button>
                  {choices.check && (
                    <button type="button" className="quiet" onClick={() => apply({ position: actor, kind: 'check' })}>
                      Check
                    </button>
                  )}
                  {choices.call && (
                    <button type="button" className="call" onClick={() => apply({ position: actor, kind: 'call' })}>
                      Call {formatChips(actorOwed)}
                    </button>
                  )}
                </>
              )}
              {actor && actor !== state.hero && (
                <button type="button" className="quiet" onClick={() => replace(publishBoard(foldToHero(state), slots))}>
                  Folds to you
                </button>
              )}
              <button
                type="button"
                className="quiet"
                onClick={() => {
                  const next = undo(state);
                  setSlots((current) => slotsAfterUndo(state, next, current));
                  setPicker(null);
                  replace(next);
                }}
              >
                Undo
              </button>
              {canAdvance && (
                <button
                  type="button"
                  className="deal"
                  onClick={() => {
                    const result = advanceStreet(state);
                    if (!result.ok) setError(result.error);
                    else {
                      const projected = projectCards(slots, result.state.street);
                      const boarded = setBoard(result.state, projected.board);
                      const next = boarded.ok ? boarded.state : result.state;
                      replace(next);
                      const nextSlot = firstEmptyBoardSlot(next.street, slots);
                      setPicker(nextSlot ? openPicker(nextSlot) : null);
                    }
                  }}
                >
                  Deal {nextStreet}
                </button>
              )}
            </div>
            {(canBet || canRaise) && actor && (
              <div className="sizer">
                <div className="presets">
                  {(raising ? raisePresets : betPresets).map((preset) => (
                    <button key={preset.label} type="button" className="chip" onClick={() => submitSized(preset.to)}>
                      {raising ? 'Raise' : 'Bet'} {formatChips(preset.to)}
                      <small>{preset.label}</small>
                    </button>
                  ))}
                </div>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitCustom();
                  }}
                >
                  <label>
                    {raising ? 'Raise to' : 'Bet'}
                    <input
                      inputMode="decimal"
                      value={amount}
                      placeholder={raising ? String(derived.minRaiseTo) : String(state.bb)}
                      onChange={(event) => setAmount(event.target.value)}
                    />
                  </label>
                  <button type="submit" className="deal">
                    Enter
                  </button>
                </form>
              </div>
            )}
          </section>

          <section className="panel history">
            <div className="panel-head">
              <h2>Hand history</h2>
              <p>This hand only</p>
            </div>
            <ol>
              {STREETS.map((street) => {
                const lines = state.actions.filter((action) => action.street === street);
                if (lines.length === 0 && streetOrder(street) > streetOrder(state.street)) return null;
                if (lines.length === 0 && street !== state.street) return null;
                return (
                  <li key={street}>
                    <h3>{streetLabel(street)}</h3>
                    {lines.length === 0 && <p className="muted">No action yet.</p>}
                    <ul>
                      {lines.map((action, index) => (
                        <li key={`${street}-${index}`}>
                          <b>{action.position === state.hero ? `${action.position} (you)` : action.position}</b>
                          <span>{actionPhrase(action.kind, action.added, action.commitAfter)}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ol>
          </section>
        </main>

        <aside>
          <section className={`paper action-${advice.action}`} data-testid="recommendation">
            <p className="eyebrow">{advice.source}</p>
            <h2>{advice.headline}</h2>
            <p className="why">{advice.explanation}</p>
            <dl>
              {advice.handLabel && (
                <>
                  <dt>Hand</dt>
                  <dd>{advice.handLabel}</dd>
                </>
              )}
              {advice.texture && (
                <>
                  <dt>Board</dt>
                  <dd>{advice.texture}</dd>
                </>
              )}
              {advice.equity !== null && (
                <>
                  <dt>Equity</dt>
                  <dd>
                    {percent(advice.equity)}
                    {advice.equityMethod === 'monte-carlo' ? ' approx.' : ''}
                  </dd>
                </>
              )}
              {advice.requiredEquity !== null && advice.toCall > 0 && (
                <>
                  <dt>Needs</dt>
                  <dd>{percent(advice.requiredEquity)} to call</dd>
                </>
              )}
              {advice.rangeLabel && (
                <>
                  <dt>Range</dt>
                  <dd>{advice.rangeLabel}</dd>
                </>
              )}
            </dl>
            {derived.toAct === state.hero && advice.action !== 'wait' && (
              <button type="button" className="play" onClick={playAdvice}>
                Play this
              </button>
            )}
          </section>

          <section className="stats">
            <h2>Pot</h2>
            <dl>
              <dt>Pot</dt>
              <dd data-testid="pot">{chipsAndBb(derived.pot, state.bb)}</dd>
              <dt>To call</dt>
              <dd>{derived.toCall > 0 ? chipsAndBb(derived.toCall, state.bb) : '—'}</dd>
              <dt>Pot odds</dt>
              <dd>{advice.potOddsText}</dd>
              <dt>SPR</dt>
              <dd>{formatSpr(derived.spr)}</dd>
              <dt>Behind</dt>
              <dd>{chipsAndBb(derived.heroRemaining, state.bb)}</dd>
            </dl>
          </section>
        </aside>
      </div>

      <footer>
        <p>
          For study, home games, and hand review. Preflop advice comes from simplified 100bb full-ring charts. Postflop
          advice is an equity heuristic, not a solver. Most online poker sites ban real-time assistance.
        </p>
      </footer>
    </div>
  );
}

function sizeBet(pot: number, fraction: number, bb: number, maxTo: number): number {
  return Math.min(maxTo, Math.max(bb, roundToChips(pot * fraction, bb)));
}

function clampTo(target: number, minTo: number, maxTo: number): number {
  if (target >= maxTo) return roundMoney(maxTo);
  if (target < minTo) return roundMoney(Math.min(maxTo, minTo));
  return roundMoney(target);
}

function uniqueSizes(items: [string, number][], maxTo: number): { label: string; to: number }[] {
  const seen = new Set<number>();
  const out: { label: string; to: number }[] = [];
  for (const [label, raw] of items) {
    const to = roundMoney(Math.min(maxTo, raw));
    if (to <= 0 || seen.has(to)) continue;
    seen.add(to);
    out.push({ label: to >= maxTo - 0.001 && label !== 'All-in' ? `${label} · all-in` : label, to });
  }
  return out;
}

function actionPhrase(kind: string, added: number, commitAfter: number): string {
  if (kind === 'post') return `posts ${formatChips(added)}`;
  if (kind === 'fold') return 'folds';
  if (kind === 'check') return 'checks';
  if (kind === 'call') return `calls ${formatChips(added)}`;
  if (kind === 'bet') return `bets ${formatChips(commitAfter)}`;
  return `raises to ${formatChips(commitAfter)}`;
}

function streetOrder(street: Street): number {
  return STREETS.indexOf(street);
}
