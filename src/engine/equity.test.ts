import { describe, expect, it } from 'vitest';
import { cardsFrom, parseCard } from './cards';
import { equityVsRange } from './equity';
import { combosFromRange } from './ranges';

function hole(text: string): [ReturnType<typeof parseCard>, ReturnType<typeof parseCard>] {
  const cards = cardsFrom(text);
  return [cards[0], cards[1]];
}

describe('equity calculator', () => {
  it('gives pocket aces about 82% against pocket kings before the flop', () => {
    const kings = combosFromRange('KK');
    expect(kings).toHaveLength(6);
    const result = equityVsRange({
      hero: hole('As Ah'),
      board: [],
      range: kings,
      iterations: 2500,
      seed: 7,
    });
    expect(result.method).toBe('monte-carlo');
    expect(result.equity).toBeGreaterThan(0.77);
    expect(result.equity).toBeLessThan(0.88);
  });

  it('gives a made royal flush the whole pot on the river', () => {
    const result = equityVsRange({
      hero: hole('As Ks'),
      board: cardsFrom('Qs Js Ts 2c 3d'),
      range: combosFromRange('22+'),
      seed: 1,
    });
    expect(result.method).toBe('exact');
    expect(result.equity).toBe(1);
    expect(result.win).toBe(1);
  });

  it('awards a chopped pot half the equity', () => {
    const result = equityVsRange({
      hero: hole('As Kd'),
      board: cardsFrom('Ac Ad Ks 2c 3d'),
      range: combosFromRange('AKo'),
      seed: 1,
    });
    expect(result.method).toBe('exact');
    expect(result.tie).toBe(1);
    expect(result.equity).toBeCloseTo(0.5, 5);
  });

  it('loses a dominated river with no chop', () => {
    const result = equityVsRange({
      hero: hole('2c 3d'),
      board: cardsFrom('Ah Kd Qc Js 9h'),
      range: combosFromRange('AA'),
      seed: 1,
    });
    expect(result.equity).toBe(0);
    expect(result.lose).toBe(1);
  });
});
