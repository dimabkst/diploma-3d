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

/**
 * Turns the mesh half a turn about the unit axis through the origin, p ↦ 2(a·p)a − p: a proper rotation, so the
 * triangles keep their outward winding. About an axis in the cut plane it puts a part's top face down.
 */
export function rotateHalfTurn(mesh: TriangleMesh, [ax, ay, az]: Vec3): TriangleMesh {
  const positions = new Float32Array(mesh.positions.length);
  for (let index = 0; index < positions.length; index += 3) {
    const [x, y, z] = [mesh.positions[index], mesh.positions[index + 1], mesh.positions[index + 2]] as [number, number, number];
    const along = 2 * (ax * x + ay * y + az * z);
    positions[index] = along * ax - x;
    positions[index + 1] = along * ay - y;
    positions[index + 2] = along * az - z;
  }
  return { positions, triangles: mesh.triangles };
}

function translateMesh(mesh: TriangleMesh, offset: Vec3): TriangleMesh {
  return {
    positions: mesh.positions.map((value, index) => value + (offset[index % 3] as number)),
    triangles: mesh.triangles,
  };
}
