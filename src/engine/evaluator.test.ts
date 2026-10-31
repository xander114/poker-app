import { describe, expect, it } from 'vitest';
import { analyzeHolding, boardTexture } from './analyze';
import { cardsFrom } from './cards';
import { CATEGORY, evaluate } from './evaluator';

describe('hand evaluator', () => {
  it('ranks a royal flush above quads', () => {
    const royal = evaluate(cardsFrom('As Ks Qs Js Ts'));
    const quads = evaluate(cardsFrom('Ah Ad Ac As Kd'));
    expect(royal.category).toBe(CATEGORY.STRAIGHT_FLUSH);
    expect(royal.name).toBe('Royal flush');
    expect(quads.category).toBe(CATEGORY.QUADS);
    expect(royal.score).toBeGreaterThan(quads.score);
  });

  it('ranks a full house above a flush and a flush above a straight', () => {
    const house = evaluate(cardsFrom('Kh Kd Kc 8s 8d'));
    const flush = evaluate(cardsFrom('Ah Qh 9h 5h 2h'));
    const straight = evaluate(cardsFrom('9c 8d 7s 6h 5c'));
    expect(house.category).toBe(CATEGORY.FULL_HOUSE);
    expect(flush.category).toBe(CATEGORY.FLUSH);
    expect(straight.category).toBe(CATEGORY.STRAIGHT);
    expect(house.score).toBeGreaterThan(flush.score);
    expect(flush.score).toBeGreaterThan(straight.score);
  });

  it('plays the wheel below a six-high straight and below an ace-high straight', () => {
    const wheel = evaluate(cardsFrom('As 2d 3c 4h 5s'));
    const six = evaluate(cardsFrom('2c 3d 4h 5s 6c'));
    const broadway = evaluate(cardsFrom('As Kd Qh Jc Ts'));
    expect(wheel.name).toBe('Straight, five high');
    expect(six.score).toBeGreaterThan(wheel.score);
    expect(broadway.score).toBeGreaterThan(six.score);
  });

  it('uses kickers when pairs match', () => {
    const king = evaluate(cardsFrom('As Ah Kd 3c 2s'));
    const queen = evaluate(cardsFrom('As Ah Qd 3c 2s'));
    expect(king.score).toBeGreaterThan(queen.score);
  });

  it('picks the flush out of seven cards instead of the board pair', () => {
    const result = evaluate(cardsFrom('Ah Kh 2c 2d 9h 3h 4h'));
    expect(result.category).toBe(CATEGORY.FLUSH);
    expect(result.name).toBe('Flush, ace high');
  });

  it('splits the same two pair', () => {
    const left = evaluate(cardsFrom('Ah Qd As Kd 7c 7h 2s'));
    const right = evaluate(cardsFrom('Ad Qc As Kd 7c 7h 2s'));
    expect(left.score).toBe(right.score);
    expect(left.category).toBe(CATEGORY.TWO_PAIR);
  });

  it('labels sets, overpairs, and top pair from the hole cards', () => {
    const set = analyzeHolding(
      [cardsFrom('7h')[0], cardsFrom('7d')[0]],
      cardsFrom('7c Kd 2s'),
    );
    const overpair = analyzeHolding(
      [cardsFrom('As')[0], cardsFrom('Ad')[0]],
      cardsFrom('Kh 7c 2d'),
    );
    const top = analyzeHolding(
      [cardsFrom('Ah')[0], cardsFrom('Kd')[0]],
      cardsFrom('Kc 7d 2s'),
    );
    expect(set.madeLabel).toBe('Set of sevens');
    expect(set.strength).toBe('monster');
    expect(overpair.madeLabel).toBe('Overpair, aces');
    expect(overpair.strength).toBe('strong');
    expect(top.madeLabel).toBe('Top pair, ace kicker');
    expect(top.strength).toBe('strong');
  });

  it('finds a flush draw and an open-ended straight draw', () => {
    const flush = analyzeHolding(
      [cardsFrom('Ah')[0], cardsFrom('5h')[0]],
      cardsFrom('Kh 9h 2c'),
    );
    const straight = analyzeHolding(
      [cardsFrom('Qd')[0], cardsFrom('Jc')[0]],
      cardsFrom('Ts 9h 2c'),
    );
    expect(flush.flushDraw).toBe(true);
    expect(flush.nutFlushDraw).toBe(true);
    expect(flush.outs).toBeGreaterThanOrEqual(9);
    expect(straight.oesd).toBe(true);
    expect(straight.outs).toBe(8);
  });

  it('describes dry and wet flops, and later streets by the full board', () => {
    expect(boardTexture(cardsFrom('Kd 7c 2s')).wetness).toBe('dry');
    expect(boardTexture(cardsFrom('Jh Th 9h')).wetness).toBe('wet');
    expect(boardTexture(cardsFrom('Jh Th 9h')).monotone).toBe(true);
    const river = boardTexture(cardsFrom('Kc 7d 2s 3c 9h'));
    expect(river.summary).not.toContain('rainbow');
    expect(river.wetness).toBe('dry');
    const flushy = boardTexture(cardsFrom('Ks 7d 2c 4s 9s'));
    expect(flushy.summary).toContain('three-flush');
    expect(flushy.wetness).not.toBe('dry');
  });
});
