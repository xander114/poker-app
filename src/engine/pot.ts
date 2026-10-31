/** Chip math shared by the hand tracker and the advisor. Amounts are in chips. */

export const EPS = 1e-6;

export function eq(a: number, b: number): boolean {
  return Math.abs(a - b) < EPS;
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Whole chips when the big blind is at least 1; otherwise the blind itself. */
export function chipStep(bb: number): number {
  if (bb >= 1) return 1;
  if (bb > 0) return bb;
  return 0.01;
}

export function roundToChips(amount: number, bb: number): number {
  const step = chipStep(bb);
  return roundMoney(Math.round(amount / step) * step);
}

export function formatChips(n: number): string {
  const rounded = roundMoney(n);
  if (Math.abs(rounded - Math.round(rounded)) < EPS) return String(Math.round(rounded));
  return rounded.toFixed(2).replace(/0$/, '').replace(/\.$/, '');
}

export function formatBb(chips: number, bb: number): string {
  if (bb <= 0) return formatChips(chips);
  const value = chips / bb;
  const rounded = Math.round(value * 10) / 10;
  const text = Math.abs(rounded - Math.round(rounded)) < EPS ? String(Math.round(rounded)) : rounded.toFixed(1);
  return `${text}bb`;
}

export function chipsAndBb(chips: number, bb: number): string {
  return `${formatChips(chips)} (${formatBb(chips, bb)})`;
}

/** Fraction of the pot you must win to break even on a call. Null when there is nothing to call. */
export function potOdds(pot: number, toCall: number): number | null {
  if (toCall <= EPS) return null;
  return toCall / (pot + toCall);
}

export function potOddsLabel(pot: number, toCall: number): string {
  if (toCall <= EPS) return 'No bet to call';
  const required = potOdds(pot, toCall) ?? 0;
  return `Call ${formatChips(toCall)} to win ${formatChips(pot)} (${Math.round(required * 100)}%)`;
}

/** Stack-to-pot ratio using the chips you still have behind, divided by the current pot. */
export function spr(remainingStack: number, pot: number): number | null {
  if (pot <= EPS) return null;
  return remainingStack / pot;
}

export function formatSpr(value: number | null): string {
  if (value === null) return '—';
  return value >= 10 ? value.toFixed(0) : value.toFixed(1);
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
