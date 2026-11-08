import { type Measurement, satisfies } from './frame.ts';

/** A closed interval of one dimension, in millimetres. */
export interface Interval {
  readonly min: number;
  readonly max: number;
}

/**
 * The values of one connector dimension that satisfy every constraint depending on it while the other dimensions stay
 * as they are, in millimetres. `min` > `max` when a lower and an upper limit conflict; `blocked` when a constraint that
 * depends on the dimension fails whatever its value. Either way no value is feasible.
 */
export interface ParameterBounds {
  readonly min: number;
  readonly max: number;
  readonly blocked: boolean;
}

export const hasFeasibleValues = (bounds: ParameterBounds): boolean => !bounds.blocked && bounds.min <= bounds.max;

export interface ParameterFeasibility<Issue> {
  readonly bounds: ParameterBounds;
  /** The constraints that fail at the current dimensions and depend on this one: what moving it can repair. */
  readonly issues: readonly Issue[];
}

/** One dimension to solve for: where to search, its current value, and the dimensions with it replaced. */
export interface ParameterSpec<Key extends string, Dimensions> {
  readonly key: Key;
  /**
   * A finite search range derived from the model, wide enough to hold every feasible value, such as a diameter up to
   * the section's diameter; a calibration window for clearances, which are limited by policy as well.
   */
  readonly envelope: Interval;
  readonly value: number;
  readonly with: (dimensions: Dimensions, value: number) => Dimensions;
}

export interface ConnectorFeasibility<Key extends string, Issue> {
  /** Every constraint that fails at the current dimensions: empty exactly when the connector can be built. */
  readonly issues: readonly Issue[];
  readonly parameters: Readonly<Record<Key, ParameterFeasibility<Issue>>>;
  /**
   * Failing constraints that no connector dimension changes, such as the material under a plug, which only the cut's
   * position or the model's size can repair.
   */
  readonly unattributed: readonly Issue[];
}

const reaches = ({ valueMm, minimumMm }: Measurement): boolean => valueMm >= minimumMm;

// Halving a bracket of doubles reaches adjacent values within about 64 steps for any finite envelope; this is a cap.
const BISECTION_STEPS = 200;

/** The satisfied end of the bracket [satisfied, unsatisfied], narrowed until the two ends are adjacent doubles. */
function bisect(holds: (value: number) => boolean, satisfied: number, unsatisfied: number): number {
  let [good, bad] = [satisfied, unsatisfied];
  for (let step = 0; step < BISECTION_STEPS; step += 1) {
    const middle = (good + bad) / 2;
    if (middle === good || middle === bad) break;
    if (holds(middle)) good = middle;
    else bad = middle;
  }
  return good;
}

// Narrows a bracket by a third per step: enough to locate the best value to well below any printable length.
const SEARCH_STEPS = 80;

/** A value of the envelope that reaches the minimum, for a concave margin that fails at both ends; undefined if none does. */
function interiorSolution(margin: (value: number) => number, { min, max }: Interval): number | undefined {
  let [low, high] = [min, max];
  for (let step = 0; step < SEARCH_STEPS; step += 1) {
    const [first, second] = [low + (high - low) / 3, high - (high - low) / 3];
    if (margin(first) >= 0) return first;
    if (margin(second) >= 0) return second;
    // NaN never compares as greater, so an undefined margin narrows towards the other end.
    if (margin(first) > margin(second)) high = second;
    else low = first;
  }
  return undefined;
}

/**
 * Solves every constraint for one dimension x and intersects the results, the other dimensions fixed. The checks must
 * list the same constraints in the same order for every x, and each must be concave in x, as a monotone or piecewise
 * linear wall is (see the connectors' tests). A concave constraint holds on one interval of the envelope, or nowhere:
 * its values at the ends tell whether that interval reaches them, a search finds it when it reaches neither, and a
 * bisection that keeps the satisfied end finds each threshold, which is itself satisfied. A constraint with the same
 * value at both ends and between them is constant and does not depend on x.
 *
 * Thresholds inside the envelope satisfy each minimum exactly, without the roundoff tolerance that the plans allow, so
 * that a bound converted to the stored settings and back still passes the plans.
 */
function solveParameter<Issue extends Measurement>(
  evaluate: (value: number) => readonly Issue[],
  envelope: Interval,
  current: readonly Issue[],
): { feasibility: ParameterFeasibility<Issue>; dependent: readonly boolean[] } {
  const atMin = evaluate(envelope.min);
  const atMax = evaluate(envelope.max);
  const atMiddle = evaluate((envelope.min + envelope.max) / 2);
  let { min, max } = envelope;
  let blocked = false;
  const issues: Issue[] = [];
  const same = (a: Issue, b: Issue) => Object.is(a.valueMm, b.valueMm) && Object.is(a.minimumMm, b.minimumMm);
  const dependent = atMin.map((low, index) => {
    const high = atMax[index] as Issue;
    if (same(low, high) && same(low, atMiddle[index] as Issue)) return false;
    const now = current[index] as Issue;
    if (!satisfies(now)) issues.push(now);
    // The envelope's ends are exact values, such as a calibration window's: the plans' tolerance applies to them.
    const [lowHolds, highHolds] = [satisfies(low), satisfies(high)];
    if (lowHolds && highHolds) return true;
    const holds = (value: number) => reaches(evaluate(value)[index] as Issue);
    const margin = (value: number) => {
      const { valueMm, minimumMm } = evaluate(value)[index] as Issue;
      return valueMm - minimumMm;
    };
    const inside = lowHolds ? envelope.min : highHolds ? envelope.max : interiorSolution(margin, envelope);
    if (inside === undefined) {
      blocked = true;
      return true;
    }
    if (!lowHolds) min = Math.max(min, bisect(holds, inside, envelope.min));
    if (!highHolds) max = Math.min(max, bisect(holds, inside, envelope.max));
    return true;
  });
  return { feasibility: { bounds: { min, max, blocked }, issues }, dependent };
}

/** Each dimension's feasible values with the others fixed, and the failing constraints by the dimension that repairs them. */
export function connectorFeasibility<Dimensions, Key extends string, Issue extends Measurement>(
  checks: (dimensions: Dimensions) => readonly Issue[],
  dimensions: Dimensions,
  parameters: readonly ParameterSpec<Key, Dimensions>[],
): ConnectorFeasibility<Key, Issue> {
  const current = checks(dimensions);
  const attributed = current.map(() => false);
  const solved = {} as Record<Key, ParameterFeasibility<Issue>>;
  for (const parameter of parameters) {
    const { feasibility, dependent } = solveParameter(
      (value) => checks(parameter.with(dimensions, value)),
      parameter.envelope,
      current,
    );
    solved[parameter.key] = feasibility;
    dependent.forEach((depends, index) => {
      if (depends) attributed[index] = true;
    });
  }
  const failing = (issue: Issue) => !satisfies(issue);
  return {
    issues: current.filter(failing),
    parameters: solved,
    unattributed: current.filter((issue, index) => failing(issue) && !attributed[index]),
  };
}
