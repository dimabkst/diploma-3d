import { z } from 'zod';

// Practical application limits for edge ratios such as b/a or h/a in this version, not geometric ones; adjust them here
// only. Every shape that is defined by ratios shares them, and every control of such a ratio uses exactly this range.
export const RATIO_LIMITS = { min: 0.25, max: 4 } as const;

export const ratioSchema = z.number().min(RATIO_LIMITS.min).max(RATIO_LIMITS.max);

// The height of a cylinder or cone relative to its radius r: the ratio limits applied to the diameter, h/(2r) = 0,25…4,
// stated as h/r, the parameter of the specification and the controls.
export const ROUND_HEIGHT_LIMITS = { min: 2 * RATIO_LIMITS.min, max: 2 * RATIO_LIMITS.max } as const;

export const roundHeightRatioSchema = z.number().min(ROUND_HEIGHT_LIMITS.min).max(ROUND_HEIGHT_LIMITS.max);
