# Full Ring Advisor

A browser study tool for **no-limit hold'em cash games**, from heads-up to a full ring. You set the blinds, effective stack, and table size, pick your seat once, and walk a hand from preflop to the river. Each new hand moves your seat one spot with the button. At each decision the app recommends fold, check, call, bet, or raise, and it keeps the pot, the price to call, pot odds, and stack-to-pot ratio up to date.

It is meant for study, home games, and hand review. It is **not** a poker solver, and most online poker sites forbid real-time assistance software. Don't use it at a real-money online table.

## Run it

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

```bash
npm test        # engine unit tests
npm run build   # typecheck and production build
```

No server and no account are required. Everything runs in the browser.

## How a hand works

1. Set the small blind, big blind, effective stack (default 100bb), and how many players are sitting (2 through 9). Pick your seat once. A full ring is UTG, UTG+1, UTG+2, LJ, HJ, CO, BTN, SB, BB. Six-handed is UTG, HJ, CO, BTN, SB, BB. Heads-up is BTN and BB, and the button posts the small blind.
2. Click a hole-card slot. Choose a rank from 2 through ace, then a suit. The picker moves to the next empty slot. Cards already in use are marked and cannot be picked again. The app recommends a preflop action from a full-ring chart, using the action already in front of you (unopened, limped, facing an open, facing a 3-bet, and so on).
3. Enter every fold, check, call, bet, and raise in order. Use **Folds to you** when the table folds around. **Play this** applies the recommendation for your seat.
4. Board slots use the same picker as the hole cards, and you can fill the flop, turn, and river before the street is dealt. When the betting round is closed, **Deal flop**, **Deal turn**, or **Deal river** brings those cards into the hand. If that street's cards are already chosen, the view moves there on its own. You get a new recommendation on each street, with a one- or two-line reason.
5. **New hand** clears the cards and history, deals the blinds again, and moves your seat one spot with the button: the button becomes the small blind, the small blind becomes the big blind, and the big blind becomes first to act. Heads-up, the two seats swap. **Change seat** picks a different seat before the hand starts, and **Set next seat** does it for the hand after this one. Dropping or adding a player waits until the next hand if a hand is already underway. **Undo** takes back the last action. The hand history on the left is only the current hand.

## How recommendations are made

True solver output is not computed in the browser. The advisor is honest about that in two layers.

**Preflop** uses simplified, unmixed 100bb full-ring charts in `src/engine/ranges.ts`: early opens in the low teens of hands, wider opens from the cutoff and button, a raise-or-fold small blind, and a wider big-blind defense. Pocket aces raise or 3-bet from every seat. Seven-deuce offsuit does not. Close spots are pure actions. There are no mixed frequencies. Open sizes are 2.5bb, or 3bb from the small blind. 3-bets are 3x in position and 4x from the blinds. 4-bets are about 2.4–2.7x, and 5-bets are all-in.

**Postflop** is a heuristic in `src/engine/postflop.ts`:

- One villain's range is inferred from the preflop line (open, call, or 3-bet). If they bet a later street, hands with no pair and no draw are dropped when that still leaves a range.
- Equity is exact on the turn and river, and Monte Carlo on the flop, against that range.
- The action compares that equity with the pot odds, then adjusts for hand class (set, top pair, draw, air), board texture (dry, dynamic, wet), and stack-to-pot ratio. Strong made hands bet or raise. Draws call when the price is there and sometimes semi-bluff. Air folds when the price is short. Missed rivers are not auto-bluffed.

### Where a real solver would plug in

- Preflop: replace the range strings in `src/engine/ranges.ts`, or the `WeightedCombo[]` from `combosFromRange`, with combo-level weights from a solver export. Every chart decision goes through that function.
- Postflop: replace `decidePostflop` with a strategy lookup for the board and node, and replace `inferVillainRange` with the solver's ranges. The UI only reads `recommend()`.

## Layout

`src/engine` is the poker engine and has no React in it: cards, the 5–7 card evaluator, pot and odds math, equity, charts, and the advisor. `src/App.tsx` and `src/ui` are the interface. Tests live next to the engine and cover the evaluator, equity, pot math, chart shape, and a few recommendation cases (aces raise from every seat, 72o folds under the gun, a set bets the flop, a missed river folds to a pot-sized bet).

## Limits

- Charts are a published-style simplification for 100bb nine-handed play, not a licensed solver pack. They ignore mixed strategies, ante games, and short stacks beyond "shove when the chart size is most of your stack."
- Shorter tables do not have their own charts. A seat uses the full-ring chart the same number of spots off the button, and the blinds keep the blind charts. Six-handed UTG is three off the button, so it uses the lojack chart. Heads-up uses the button and big-blind charts, which are wider or tighter than a real heads-up strategy. The recommendation says when it is borrowing a chart.
- Postflop play is heads-up-leaning. Multiway pots bet less often and do not bluff, but equity is still against one estimated range.
- Villain ranges are not narrowed by every street the way a solver would. A bet only removes empty air.
- Short all-ins still reopen the action.
- Side pots are not modeled. Everyone is assumed to cover the effective stack.
- The Monte Carlo flop equity is stable for a given board, but it is still an estimate. The turn and river are enumerated.
