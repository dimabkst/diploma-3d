export interface IntegrationOptions {
  /** Absolute error target for the whole integral, in the units of the result. */
  readonly absoluteTolerance: number;
  /** Relative error target, applied to a first estimate of the integral. */
  readonly relativeTolerance: number;
  /** Upper bound on integrand evaluations; reaching it is an error rather than a less accurate result. */
  readonly maxEvaluations?: number;
}

const INITIAL_PANELS = 8;
const MAX_DEPTH = 40;

/**
 * ∫ f(x) dx over [a, b] by adaptive Simpson integration: each panel is halved until the two halves agree with the whole
 * within its share of the tolerance, |S₂ − S₁| ≤ 15·ε, and Richardson's correction (S₂ − S₁)/15 is added. The error
 * target is absoluteTolerance + relativeTolerance·|estimate|. The work is bounded and the result deterministic; a
 * non-finite integrand value, too many evaluations or too deep a refinement throws instead of returning a poor value.
 * Starting from several panels keeps a periodic integrand from looking flat at the first three sample points.
 */
export function integrate(f: (x: number) => number, a: number, b: number, options: IntegrationOptions): number {
  const { absoluteTolerance, relativeTolerance, maxEvaluations = 100_000 } = options;
  if (![a, b, absoluteTolerance, relativeTolerance].every(Number.isFinite) || !(b > a)) {
    throw new RangeError(`Invalid integration interval or tolerance: [${a}, ${b}].`);
  }
  let evaluations = 0;
  const evaluate = (x: number): number => {
    evaluations += 1;
    if (evaluations > maxEvaluations) throw new RangeError(`Integration needed more than ${maxEvaluations} evaluations.`);
    const value = f(x);
    if (!Number.isFinite(value)) throw new RangeError(`The integrand is not finite at x = ${x}.`);
    return value;
  };
  const simpson = (fa: number, fm: number, fb: number, width: number) => (width / 6) * (fa + 4 * fm + fb);

  function refine(
    x0: number,
    x1: number,
    f0: number,
    fm: number,
    f1: number,
    whole: number,
    tolerance: number,
    depth: number,
  ): number {
    const middle = (x0 + x1) / 2;
    const [fl, fr] = [evaluate((x0 + middle) / 2), evaluate((middle + x1) / 2)];
    const left = simpson(f0, fl, fm, middle - x0);
    const right = simpson(fm, fr, f1, x1 - middle);
    const difference = left + right - whole;
    if (Math.abs(difference) <= 15 * tolerance) return left + right + difference / 15;
    if (depth >= MAX_DEPTH) throw new RangeError('Integration did not converge within the refinement depth.');
    return (
      refine(x0, middle, f0, fl, fm, left, tolerance / 2, depth + 1) +
      refine(middle, x1, fm, fr, f1, right, tolerance / 2, depth + 1)
    );
  }

  const width = (b - a) / INITIAL_PANELS;
  const panels = Array.from({ length: INITIAL_PANELS }, (_, index) => {
    const [x0, x1] = [a + index * width, index === INITIAL_PANELS - 1 ? b : a + (index + 1) * width];
    return { x0, x1, f0: 0, fm: 0, f1: 0, whole: 0 };
  });
  for (const panel of panels) {
    panel.f0 = evaluate(panel.x0);
    panel.fm = evaluate((panel.x0 + panel.x1) / 2);
    panel.f1 = evaluate(panel.x1);
    panel.whole = simpson(panel.f0, panel.fm, panel.f1, panel.x1 - panel.x0);
  }
  const estimate = panels.reduce((sum, panel) => sum + panel.whole, 0);
  const tolerance = (absoluteTolerance + relativeTolerance * Math.abs(estimate)) / INITIAL_PANELS;
  return panels.reduce((sum, { x0, x1, f0, fm, f1, whole }) => sum + refine(x0, x1, f0, fm, f1, whole, tolerance, 0), 0);
}
