import { z } from 'zod';

// Practical application limits for edge ratios such as b/a or h/a in this version, not geometric ones; adjust them here
// only. Every shape that is defined by ratios shares them.
export const RATIO_LIMITS = { min: 0.25, max: 4 } as const;

export const ratioSchema = z.number().min(RATIO_LIMITS.min).max(RATIO_LIMITS.max);
