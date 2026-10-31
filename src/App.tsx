import { useEffect, useMemo, useState } from 'react';
import { analyzeHolding } from './engine/analyze';
import { type Card, cardText, sameCard, startingHandName } from './engine/cards';
import {
  type Position,
  POSITIONS,
  boardCardsFor,
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
  undo,
  validateConfig,
} from './engine/hand';
import { chipsAndBb, formatChips, formatSpr, percent, roundMoney, roundToChips } from './engine/pot';
import { recommend } from './engine/recommend';
import { CardPicker, EmptySlot, PlayingCard } from './ui/Cards';

const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river'];

export function App() {
  const [state, setState] = useState<HandState>(() => createHand(defaultConfig()));
  const [sbText, setSbText] = useState('1');
  const [bbText, setBbText] = useState('2');
  const [stackText, setStackText] = useState('100');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<'hole' | 'board'>('hole');

  const derived = useMemo(() => derive(state), [state]);
  const advice = useMemo(() => recommend(state), [state]);
  const pristine = isPristine(state);
  const boardLimit = boardCardsFor(state.street);
  const visibleBoard = state.board.slice(0, boardLimit);
  const read =
    state.hole.length === 2 && visibleBoard.length >= 3
      ? analyzeHolding([state.hole[0], state.hole[1]], visibleBoard)
      : null;

  useEffect(() => {
    if (state.street !== 'preflop' && state.board.length < boardCardsFor(state.street)) setPicking('board');
  }, [state.street, state.board.length]);

  function replace(next: HandState) {
    setState(next);
    setError(null);
  }

  function apply(input: ActionInput) {
    const result = applyAction(state, input);
    if (!result.ok) setError(result.error);
    else {
      replace(result.state);
      setAmount('');
    }
  }

  function updateTable(partial: Partial<{ sb: number; bb: number; stackBb: number; hero: Position }>) {
    const config = {
      sb: partial.sb ?? Number(sbText),
      bb: partial.bb ?? Number(bbText),
      stackBb: partial.stackBb ?? Number(stackText),
      hero: partial.hero ?? state.hero,
    };
    const problem = validateConfig(config);
    if (problem) {
      setError(problem);
      return;
    }
    if (!pristine) return;
    setError(null);
    setState(createHand(config));
  }

  function toggleCard(card: Card) {
    if (picking === 'hole' || state.street === 'preflop') {
      const exists = state.hole.some((other) => sameCard(other, card));
      const next = exists ? state.hole.filter((other) => !sameCard(other, card)) : [...state.hole, card];
      if (!exists && (state.hole.length >= 2 || state.board.some((other) => sameCard(other, card)))) return;
      const result = setHole(state, next);
      if (!result.ok) setError(result.error);
      else replace(result.state);
      return;
    }
    const exists = state.board.some((other) => sameCard(other, card));
    const next = exists ? state.board.filter((other) => !sameCard(other, card)) : [...state.board, card];
    if (!exists && (state.board.length >= boardLimit || state.hole.some((other) => sameCard(other, card)))) return;
    const result = setBoard(state, next);
    if (!result.ok) setError(result.error);
    else replace(result.state);
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
  const facingBet = derived.currentBet > 0;
  const canRaise = Boolean(actor) && facingBet && actorMax > derived.currentBet && actorOwed < actorMax - actorCommit;
  const canBet = Boolean(actor) && !facingBet && actorMax >= state.bb;

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
    apply({ position: actor, kind: facingBet ? 'raise' : 'bet', to });
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
          <p className="mark">9-handed no-limit hold'em</p>
          <h1>Full Ring Advisor</h1>
          <p className="lede">Xander's study table for cash-game decisions, from the first open through the river.</p>
        </div>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            replace(newHand(state));
            setPicking('hole');
            setAmount('');
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
          <span>Your seat</span>
          <div>
            {POSITIONS.map((position) => (
              <button
                key={position}
                type="button"
                className={position === state.hero ? 'seat on' : 'seat'}
                disabled={!pristine}
                onClick={() => updateTable({ hero: position })}
              >
                {position}
              </button>
            ))}
          </div>
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
              <p>{state.hole.length === 2 ? startingHandName(state.hole[0], state.hole[1]) : 'Choose two hole cards'}</p>
            </div>
            <div className="held">
              {state.hole.map((card) => (
                <PlayingCard
                  key={cardText(card)}
                  card={card}
                  size="lg"
                  onClick={() => {
                    const result = setHole(state, state.hole.filter((other) => !sameCard(other, card)));
                    if (!result.ok) setError(result.error);
                    else replace(result.state);
                  }}
                />
              ))}
              {state.hole.length < 2 && <EmptySlot label="Hole" />}
              {state.hole.length < 1 && <EmptySlot label="Card" />}
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
              <p>{visibleBoard.length === 0 ? 'No community cards yet' : advice.texture ?? 'Community cards'}</p>
            </div>
            <div className="held board-row">
              {Array.from({ length: 5 }, (_, index) => {
                const card = state.board[index];
                const open = index < boardLimit;
                if (!card || !open) return <EmptySlot key={index} label={index < 3 ? 'Flop' : index === 3 ? 'Turn' : 'River'} />;
                return (
                  <PlayingCard
                    key={cardText(card)}
                    card={card}
                    size="lg"
                    onClick={() => {
                      const result = setBoard(state, state.board.filter((other) => !sameCard(other, card)));
                      if (!result.ok) setError(result.error);
                      else replace(result.state);
                    }}
                  />
                );
              })}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Cards</h2>
              <div className="switch">
                <button type="button" className={picking === 'hole' ? 'on' : ''} onClick={() => setPicking('hole')}>
                  Hole cards
                </button>
                <button
                  type="button"
                  className={picking === 'board' ? 'on' : ''}
                  disabled={boardLimit === 0}
                  onClick={() => setPicking('board')}
                >
                  Board
                </button>
              </div>
            </div>
            <CardPicker
              selected={picking === 'board' ? visibleBoard : state.hole}
              blocked={picking === 'board' ? state.hole : state.board}
              disabled={picking === 'board' && boardLimit === 0}
              onToggle={toggleCard}
            />
          </section>

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
                  {!facingBet && (
                    <button type="button" className="quiet" onClick={() => apply({ position: actor, kind: 'check' })}>
                      Check
                    </button>
                  )}
                  {facingBet && (
                    <button type="button" className="call" onClick={() => apply({ position: actor, kind: 'call' })}>
                      Call {formatChips(actorOwed)}
                    </button>
                  )}
                </>
              )}
              {actor && actor !== state.hero && (
                <button type="button" className="quiet" onClick={() => replace(foldToHero(state))}>
                  Folds to you
                </button>
              )}
              <button type="button" className="quiet" onClick={() => replace(undo(state))}>
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
                      replace(result.state);
                      setPicking('board');
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
                  {(facingBet ? raisePresets : betPresets).map((preset) => (
                    <button key={preset.label} type="button" className="chip" onClick={() => submitSized(preset.to)}>
                      {facingBet ? 'Raise' : 'Bet'} {formatChips(preset.to)}
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
                    {facingBet ? 'Raise to' : 'Bet'}
                    <input
                      inputMode="decimal"
                      value={amount}
                      placeholder={facingBet ? String(derived.minRaiseTo) : String(state.bb)}
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
