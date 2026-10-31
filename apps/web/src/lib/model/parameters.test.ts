import { describe, expect, it } from 'vitest';
import { initialParameterTexts, parseDecimal, resolveModelRequest, validateRatio } from './parameters.ts';

describe('parseDecimal', () => {
  it.each([
    ['1,5', 1.5],
    ['1.5', 1.5],
    [' 2 ', 2],
    ['0,25', 0.25],
    [',5', 0.5],
    ['3.', 3],
    ['-1', -1],
  ])('reads "%s" as %s', (text, value) => {
    expect(parseDecimal(text)).toBe(value);
  });

  it.each(['', ' ', '-', ',', '1,2,3', '1.5.', 'abc', '1e2', 'Infinity', 'NaN', '0x10'])('rejects "%s"', (text) => {
    expect(parseDecimal(text)).toBeUndefined();
  });
});

describe('validateRatio', () => {
  it.each([
    ['0,25', 0.25],
    ['4', 4],
    ['1,5', 1.5],
  ])('accepts %s, including the limits', (text, value) => {
    expect(validateRatio(text)).toEqual({ value });
  });

  it.each([
    ['', 'Введіть значення.'],
    ['   ', 'Введіть значення.'],
    ['-', 'Введіть число, наприклад 1,5.'],
    ['abc', 'Введіть число, наприклад 1,5.'],
    ['0,2', 'Допустимі значення — від 0,25 до 4.'],
    ['4,01', 'Допустимі значення — від 0,25 до 4.'],
    ['0', 'Допустимі значення — від 0,25 до 4.'],
    ['-1', 'Допустимі значення — від 0,25 до 4.'],
  ])('reports "%s" without clamping it', (text, error) => {
    expect(validateRatio(text)).toEqual({ error });
  });
});

describe('resolveModelRequest', () => {
  it('starts the cuboid at b/a = 1,5 and c/a = 2 with the default 80 mm scale', () => {
    expect(initialParameterTexts()).toEqual({ widthRatio: '1,5', heightRatio: '2' });
    expect(resolveModelRequest('cuboid', initialParameterTexts()).spec).toEqual({
      shape: { kind: 'cuboid', widthRatio: 1.5, heightRatio: 2 },
      scale: { longestDimensionMm: 80 },
    });
  });

  it('ignores parameter fields for the cube', () => {
    const request = resolveModelRequest('cube', { widthRatio: '', heightRatio: 'abc' });
    expect(request.spec).toEqual({ shape: { kind: 'cube' }, scale: { longestDimensionMm: 80 } });
    expect(request.errors).toEqual({});
  });

  it('reports every invalid field and produces no specification', () => {
    const request = resolveModelRequest('cuboid', { widthRatio: '', heightRatio: '9' });
    expect(request.spec).toBeUndefined();
    expect(request.key).toBeUndefined();
    expect(request.errors).toEqual({ widthRatio: 'Введіть значення.', heightRatio: 'Допустимі значення — від 0,25 до 4.' });
  });

  it('gives equal keys to texts that denote the same model and different keys otherwise', () => {
    const comma = resolveModelRequest('cuboid', { widthRatio: '1,5', heightRatio: '2' });
    const point = resolveModelRequest('cuboid', { widthRatio: '1.50', heightRatio: '2' });
    const other = resolveModelRequest('cuboid', { widthRatio: '1,5', heightRatio: '2,5' });
    expect(point.key).toBe(comma.key);
    expect(other.key).not.toBe(comma.key);
    expect(resolveModelRequest('cube', initialParameterTexts()).key).not.toBe(comma.key);
  });
});
