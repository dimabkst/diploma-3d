import { describe, expect, it } from 'vitest';
import {
  initialParameterChoices,
  initialParameterTexts,
  type ParameterTexts,
  resolveModelRequest,
  validateRatio,
} from './parameters.ts';

const texts = (overrides: Partial<ParameterTexts>): ParameterTexts => ({ ...initialParameterTexts(), ...overrides });
const triangle = initialParameterChoices();

describe('validateRatio', () => {
  it.each([
    ['0,25', 0.25],
    ['4', 4],
    ['1,5', 1.5],
    // Values between the 0,1 stepping grid are as valid as typed.
    ['2.05', 2.05],
    ['1,234', 1.234],
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
  it('starts the cuboid at b/a = 1,5 and c/a = 2 and the prism at three sides and h/a = 2, at 80 mm', () => {
    expect(initialParameterTexts()).toEqual({ cuboidWidthRatio: '1,5', cuboidHeightRatio: '2', prismHeightRatio: '2' });
    expect(initialParameterChoices()).toEqual({ prismBaseSides: 3 });
    expect(resolveModelRequest('cuboid', initialParameterTexts(), triangle).spec).toEqual({
      shape: { kind: 'cuboid', widthRatio: 1.5, heightRatio: 2 },
      scale: { longestDimensionMm: 80 },
    });
    expect(resolveModelRequest('prism', initialParameterTexts(), triangle).spec).toEqual({
      shape: { kind: 'prism', baseSides: 3, heightRatio: 2 },
      scale: { longestDimensionMm: 80 },
    });
  });

  it('ignores parameter fields for the cube', () => {
    const request = resolveModelRequest(
      'cube',
      { cuboidWidthRatio: '', cuboidHeightRatio: 'abc', prismHeightRatio: '-' },
      triangle,
    );
    expect(request.spec).toEqual({ shape: { kind: 'cube' }, scale: { longestDimensionMm: 80 } });
    expect(request.errors).toEqual({});
  });

  it('reads only the fields of the selected shape', () => {
    const mixed = texts({ cuboidHeightRatio: 'abc', prismHeightRatio: '3' });
    expect(resolveModelRequest('prism', mixed, triangle).spec?.shape).toEqual({ kind: 'prism', baseSides: 3, heightRatio: 3 });
    expect(resolveModelRequest('cuboid', mixed, triangle).errors).toEqual({ cuboidHeightRatio: 'Введіть число, наприклад 1,5.' });
  });

  it('reports every invalid field and produces no specification', () => {
    const request = resolveModelRequest('cuboid', texts({ cuboidWidthRatio: '', cuboidHeightRatio: '9' }), triangle);
    expect(request.spec).toBeUndefined();
    expect(request.key).toBeUndefined();
    expect(request.errors).toEqual({
      cuboidWidthRatio: 'Введіть значення.',
      cuboidHeightRatio: 'Допустимі значення — від 0,25 до 4.',
    });
    expect(request.values).toEqual({});

    const prism = resolveModelRequest('prism', texts({ prismHeightRatio: '4,5' }), triangle);
    expect(prism.spec).toBeUndefined();
    expect(prism.errors).toEqual({ prismHeightRatio: 'Допустимі значення — від 0,25 до 4.' });
  });

  it('keeps the validated value of a correct field while the other one is being corrected', () => {
    const partial = resolveModelRequest('cuboid', texts({ cuboidWidthRatio: '1,1', cuboidHeightRatio: '-' }), triangle);
    expect(partial.spec).toBeUndefined();
    expect(partial.values).toEqual({ cuboidWidthRatio: 1.1 });
    expect(partial.errors).toEqual({ cuboidHeightRatio: 'Введіть число, наприклад 1,5.' });
    expect(partial.scale).toEqual({ longestDimensionMm: 80 });
  });

  it('uses the exact typed values between the stepping quarters for the specification', () => {
    const request = resolveModelRequest('cuboid', texts({ cuboidWidthRatio: '2,05', cuboidHeightRatio: '1.1' }), triangle);
    expect(request.values).toEqual({ cuboidWidthRatio: 2.05, cuboidHeightRatio: 1.1 });
    expect(request.spec?.shape).toEqual({ kind: 'cuboid', widthRatio: 2.05, heightRatio: 1.1 });
    expect(request.scale).toBe(request.spec?.scale);
    expect(resolveModelRequest('prism', texts({ prismHeightRatio: '1,1' }), triangle).spec?.shape).toEqual({
      kind: 'prism',
      baseSides: 3,
      heightRatio: 1.1,
    });
  });

  it.each([3, 4, 5, 6, 8] as const)('builds a prism with %s base sides and keeps h/a when the base changes', (prismBaseSides) => {
    const request = resolveModelRequest('prism', texts({ prismHeightRatio: '0,75' }), { prismBaseSides });
    expect(request.spec?.shape).toEqual({ kind: 'prism', baseSides: prismBaseSides, heightRatio: 0.75 });
    expect(request.values).toEqual({ prismHeightRatio: 0.75 });
  });

  it('gives equal keys to texts that denote the same model and different keys otherwise', () => {
    const comma = resolveModelRequest('cuboid', texts({ cuboidWidthRatio: '1,5' }), triangle);
    const point = resolveModelRequest('cuboid', texts({ cuboidWidthRatio: '1.50' }), triangle);
    const other = resolveModelRequest('cuboid', texts({ cuboidHeightRatio: '2,5' }), triangle);
    expect(point.key).toBe(comma.key);
    expect(other.key).not.toBe(comma.key);
    expect(resolveModelRequest('cube', initialParameterTexts(), triangle).key).not.toBe(comma.key);
    // The same h/a with another base is another model.
    const square = resolveModelRequest('prism', initialParameterTexts(), { prismBaseSides: 4 });
    expect(square.key).not.toBe(resolveModelRequest('prism', initialParameterTexts(), triangle).key);
  });
});
