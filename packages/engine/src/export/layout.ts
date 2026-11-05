import { measureMesh, type TriangleMesh, type Vec3 } from '../mesh.ts';
import type { ThreeMfObject } from './three-mf.ts';

/** The clearance between the XY bounding boxes of neighbouring objects on the build plate. */
export const PRINT_LAYOUT_GAP_MM = 5;

/**
 * Places the objects in a row along +X for printing, by translation only, so that their orientation and size stay as
 * they are: each rests on z = 0, has its XY box centred on y = 0, and starts `gapMm` after the previous one's box ends.
 * The row as a whole is centred on x = 0. Nothing is shrunk to fit a build plate, which the slicer checks.
 */
export function arrangeInRow(objects: readonly ThreeMfObject[], gapMm = PRINT_LAYOUT_GAP_MM): ThreeMfObject[] {
  const boxes = objects.map((object) => measureMesh(object.mesh).bounds);
  const starts: number[] = [];
  let cursor = 0;
  for (const { min, max } of boxes) {
    starts.push(cursor);
    cursor += max[0] - min[0] + gapMm;
  }
  const rowCentre = (cursor - gapMm) / 2;
  return objects.map((object, index) => {
    const { min, max } = boxes[index] as (typeof boxes)[number];
    const offset: Vec3 = [(starts[index] as number) - rowCentre - min[0], -(min[1] + max[1]) / 2, -min[2]];
    return { ...object, mesh: translateMesh(object.mesh, offset) };
  });
}

function translateMesh(mesh: TriangleMesh, offset: Vec3): TriangleMesh {
  return {
    positions: mesh.positions.map((value, index) => value + (offset[index % 3] as number)),
    triangles: mesh.triangles,
  };
}
