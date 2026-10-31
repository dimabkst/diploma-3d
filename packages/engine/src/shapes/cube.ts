import type { CubeShape } from '@diploma-3d/schema';
import type { Manifold } from 'manifold-3d';
import type { GeometryKernel } from '../kernel.ts';
import type { Track } from '../scope.ts';

/** Unit cube in model units, centred in XY and resting on the build plate (z = 0). */
export function buildUnitCube(kernel: GeometryKernel, track: Track, _shape: CubeShape): Manifold {
  const centred = track(kernel.Manifold.cube([1, 1, 1], true));
  return track(centred.translate([0, 0, 0.5]));
}
