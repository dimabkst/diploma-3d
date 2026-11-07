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

/**
 * Solves every constraint for one dimension x and intersects the results, the other dimensions fixed. The checks must
 * list the same constraints in the same order for every x, and each must be monotone in x, as the connectors' checks
 * are (see their tests). A monotone constraint then holds on a half-line of the envelope, on all of it or on none: its
 * values at the envelope's ends tell which, and a bisection that keeps the satisfied end finds a threshold, which is
 * itself satisfied. A constraint with the same value at both ends is constant and does not depend on x.
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
  let { min, max } = envelope;
  let blocked = false;
  const issues: Issue[] = [];
  const dependent = atMin.map((low, index) => {
    const high = atMax[index] as Issue;
    if (Object.is(low.valueMm, high.valueMm) && Object.is(low.minimumMm, high.minimumMm)) return false;
    const now = current[index] as Issue;
    if (!satisfies(now)) issues.push(now);
    // The envelope's ends are exact values, such as a calibration window's: the plans' tolerance applies to them.
    const [lowHolds, highHolds] = [satisfies(low), satisfies(high)];
    if (lowHolds && highHolds) return true;
    if (!lowHolds && !highHolds) {
      blocked = true;
      return true;
    }
    const holds = (value: number) => reaches(evaluate(value)[index] as Issue);
    if (lowHolds) max = Math.min(max, bisect(holds, envelope.min, envelope.max));
    else min = Math.max(min, bisect(holds, envelope.max, envelope.min));
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
