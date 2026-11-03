import { describe, expect, it } from 'vitest';
import { integrate } from './numeric.ts';

const tight = { absoluteTolerance: 1e-13, relativeTolerance: 1e-13 } as const;

/**
 * The trapezoid rule with n panels over a full period: for a smooth periodic integrand its error falls faster than any
 * power of 1/n, so with many panels it is an independent reference to near double precision.
 */
function periodicTrapezoid(f: (x: number) => number, n: number): number {
  let sum = 0;
  for (let index = 0; index < n; index += 1) sum += f((2 * Math.PI * index) / n);
  return (sum * 2 * Math.PI) / n;
}

describe('integrate', () => {
  it.each([
    ['sin x over [0, π]', Math.sin, 0, Math.PI, 2],
    ['sin² x over [0, 2π]', (x: number) => Math.sin(x) ** 2, 0, 2 * Math.PI, Math.PI],
    ['3x² + 1 over [−1, 2]', (x: number) => 3 * x ** 2 + 1, -1, 2, 12],
    ['eˣ over [0, 1]', Math.exp, 0, 1, Math.E - 1],
  ] as const)('integrates %s', (_, f, a, b, expected) => {
    expect(integrate(f, a, b, tight)).toBeCloseTo(expected, 12);
  });

  // The lateral areas of the oblique cylinder and cone with r = h = d = 1.
  it.each([
    ['√(1 + cos² θ)', (theta: number) => Math.hypot(1, Math.cos(theta)), 7.640395578055],
    ['½·√(1 + (1 − cos θ)²)', (theta: number) => Math.hypot(1, 1 - Math.cos(theta)) / 2, 4.753793841546],
  ] as const)('integrates %s over a full turn to the reference value', (_, f, expected) => {
    const value = integrate(f, 0, 2 * Math.PI, tight);
    expect(value).toBeCloseTo(expected, 11);
    expect(value).toBeCloseTo(periodicTrapezoid(f, 4096), 12);
  });

  it('meets its tolerance with bounded work on a sharply varying periodic integrand', () => {
    // r = 1, h = 0,25, d = 4: the cylinder's area element varies between 0,25 and 4,01 within a few degrees.
    const f = (theta: number) => Math.hypot(0.25, 4 * Math.cos(theta));
    let evaluations = 0;
    const counted = (theta: number) => {
      evaluations += 1;
      return f(theta);
    };
    const tolerance = { absoluteTolerance: 1e-4, relativeTolerance: 1e-8 };
    const value = integrate(counted, 0, 2 * Math.PI, tolerance);
    const reference = periodicTrapezoid(f, 1 << 16);
    expect(Math.abs(value - reference)).toBeLessThan(1e-4 + 1e-8 * reference);
    expect(evaluations).toBeLessThan(5000);
  });

  it('is deterministic', () => {
    const f = (theta: number) => Math.hypot(1.1, 2.35 * Math.cos(theta));
    const options = { absoluteTolerance: 1e-4, relativeTolerance: 1e-8 };
    expect(integrate(f, 0, 2 * Math.PI, options)).toBe(integrate(f, 0, 2 * Math.PI, options));
  });

  it('refuses a non-finite integrand, an invalid interval and too much work instead of returning a poor value', () => {
    const options = { absoluteTolerance: 1e-6, relativeTolerance: 0 };
    expect(() => integrate((x) => 1 / x, 0, 1, options)).toThrow(RangeError);
    expect(() => integrate((x) => Math.sqrt(x - 0.5), 0, 1, options)).toThrow(RangeError);
    expect(() => integrate(Math.sin, 1, 1, options)).toThrow(RangeError);
    expect(() => integrate(Math.sin, 0, Number.POSITIVE_INFINITY, options)).toThrow(RangeError);
    expect(() => integrate(Math.sin, 0, 1, { ...options, absoluteTolerance: Number.NaN })).toThrow(RangeError);
    // A kink at an irrational point needs many refinements: a tiny evaluation budget is exceeded.
    expect(() =>
      integrate((x) => Math.sqrt(Math.abs(x - Math.SQRT1_2)), 0, 1, {
        ...options,
        absoluteTolerance: 1e-12,
        maxEvaluations: 200,
      }),
    ).toThrow(RangeError);
  });
});
