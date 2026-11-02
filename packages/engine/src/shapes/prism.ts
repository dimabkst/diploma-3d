import type { PrismShape } from '@diploma-3d/schema';
import type { Manifold } from 'manifold-3d';
import type { GeometryKernel } from '../kernel.ts';
import type { Track } from '../scope.ts';
import { baseContours } from './polygon.ts';
import { regularBaseProportions } from './regular-base.ts';

/** Prism in model units: the base centred at the origin in z = 0, extruded along +Z. */
export function buildUnitPrism(kernel: GeometryKernel, track: Track, shape: PrismShape): Manifold {
  const { base, height } = regularBaseProportions(shape);
  return track(kernel.Manifold.extrude(baseContours(base), height));
}
