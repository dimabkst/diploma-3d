import {
  dot,
  measureMesh,
  type TriangleMesh,
  triangleAreaVector,
  triangleAt,
  triangleCount,
  type Vec3,
  vertexAt,
} from '../mesh.ts';
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

/**
 * Turns the mesh about the origin so that the unit vector `axis` becomes +Z: by the shortest rotation, Rodrigues' formula
 * with k = axis × Z, sinθ = |k| and cosθ = axis·Z. A proper rotation, so the triangles keep their outward winding; with
 * `axis` already along +Z the mesh stays as it is.
 */
export function rotateOntoZ(mesh: TriangleMesh, axis: Vec3): TriangleMesh {
  const [ax, ay, az] = axis;
  if (ax === 0 && ay === 0 && az === 1) return mesh;
  if (az === -1) return rotateHalfTurn(mesh, [1, 0, 0]);
  // k = (ay, −ax, 0); R = I + [k]× + [k]×²/(1 + cosθ).
  const [kx, ky] = [ay, -ax];
  const scale = 1 / (1 + az);
  const positions = new Float32Array(mesh.positions.length);
  for (let index = 0; index < positions.length; index += 3) {
    const [x, y, z] = [mesh.positions[index], mesh.positions[index + 1], mesh.positions[index + 2]] as [number, number, number];
    positions[index] = x + ky * z + scale * ky * (kx * y - ky * x);
    positions[index + 1] = y - kx * z + scale * kx * (ky * x - kx * y);
    positions[index + 2] = z + kx * y - ky * x - scale * (kx * kx + ky * ky) * z;
  }
  return { positions, triangles: mesh.triangles };
}

// Within this much of a base's plane, a float32 vertex lies on it at every export size.
const BASE_PLANE_TOLERANCE_MM = 1e-3;
// A larger face must be larger by more than roundoff, so that equal halves keep the part as it is.
const LARGER_FACE_RELATIVE = 1.001;

/** The centre of mass of a closed mesh, as the signed tetrahedra over the origin add up. */
function centreOfMass(mesh: TriangleMesh): Vec3 {
  let [volume, x, y, z] = [0, 0, 0, 0];
  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    const [a, b, c] = triangleAt(mesh, triangle).map((vertex) => vertexAt(mesh, vertex)) as [Vec3, Vec3, Vec3];
    const six = a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    volume += six;
    x += six * (a[0] + b[0] + c[0]);
    y += six * (a[1] + b[1] + c[1]);
    z += six * (a[2] + b[2] + c[2]);
  }
  return [x / (4 * volume), y / (4 * volume), z / (4 * volume)];
}

/** The triangles of a flat face with this outward normal in this plane: its area, and whether a point projects onto it. */
function flatFace(mesh: TriangleMesh, outward: Vec3, planeOffset: number, point: Vec3): { area: number; carries: boolean } {
  let area = 0;
  let carries = false;
  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    const corners = triangleAt(mesh, triangle).map((vertex) => vertexAt(mesh, vertex)) as [Vec3, Vec3, Vec3];
    if (!corners.every((corner) => Math.abs(dot(corner, outward) - planeOffset) <= BASE_PLANE_TOLERANCE_MM)) continue;
    const areaVector = triangleAreaVector(mesh, triangle);
    if (dot(areaVector, outward) <= 0) continue;
    area += dot(areaVector, outward);
    // A point projects onto a triangle when it lies on the inner side of each edge, seen along the normal.
    carries ||= corners.every((corner, index) => {
      const next = corners[(index + 1) % 3] as Vec3;
      const edge: Vec3 = [next[0] - corner[0], next[1] - corner[1], next[2] - corner[2]];
      const towards: Vec3 = [point[0] - corner[0], point[1] - corner[1], point[2] - corner[2]];
      const turned: Vec3 = [
        edge[1] * towards[2] - edge[2] * towards[1],
        edge[2] * towards[0] - edge[0] * towards[2],
        edge[0] * towards[1] - edge[1] * towards[0],
      ];
      return dot(turned, outward) >= 0;
    });
  }
  return { area, carries };
}

/**
 * Turns a cut part onto a flat face for printing, without assuming which one it has: each part of a plane through the
 * axis keeps at least half of a base. The larger remaining base that carries the part's centre of mass goes down; the
 * lower base as it is, the upper one by a half turn about the horizontal `turnAxis`, which keeps a connector on the cut
 * face pointing up. A leaning part may balance on neither, and a cone's tip has neither: it then rests on its flat cut
 * face, if it has one to spare in `cutFaceOutward`, or otherwise on its larger base, as an uncut leaning solid does. A part
 * with no flat face at all, whose cut carries a protruding connector, turns `connectorFace` upwards and touches the bed
 * with its tip. Rotations only: the size stays.
 */
export function restOnFlatFace(
  mesh: TriangleMesh,
  {
    baseHeight,
    turnAxis,
    cutFaceOutward,
    connectorFace,
  }: { baseHeight: number; turnAxis: Vec3; cutFaceOutward?: Vec3; connectorFace?: Vec3 },
): TriangleMesh {
  const centre = centreOfMass(mesh);
  const lower = flatFace(mesh, [0, 0, -1], 0, centre);
  const upper = flatFace(mesh, [0, 0, 1], baseHeight, centre);
  const onLower = mesh;
  const onUpper = () => rotateHalfTurn(mesh, turnAxis);
  const larger = upper.area > lower.area * LARGER_FACE_RELATIVE ? 'upper' : 'lower';
  if (lower.carries && (!upper.carries || larger === 'lower')) return onLower;
  if (upper.carries) return onUpper();
  const hasBase = lower.area > 0 || upper.area > 0;
  if (cutFaceOutward !== undefined) {
    const planeOffset = maxAlong(mesh, cutFaceOutward);
    if (!hasBase || flatFace(mesh, cutFaceOutward, planeOffset, centre).carries) {
      return rotateOntoZ(mesh, [-cutFaceOutward[0], -cutFaceOutward[1], -cutFaceOutward[2]]);
    }
  }
  // With no flat face to spare, as a cone's tip that carries a plug has none, the connector at least points up.
  if (!hasBase && connectorFace !== undefined) return rotateOntoZ(mesh, connectorFace);
  return larger === 'lower' ? onLower : onUpper();
}

/** The mesh's largest extent along a unit vector. */
function maxAlong(mesh: TriangleMesh, direction: Vec3): number {
  let largest = Number.NEGATIVE_INFINITY;
  for (let vertex = 0; vertex < mesh.positions.length / 3; vertex += 1)
    largest = Math.max(largest, dot(vertexAt(mesh, vertex), direction));
  return largest;
}

function translateMesh(mesh: TriangleMesh, offset: Vec3): TriangleMesh {
  return {
    positions: mesh.positions.map((value, index) => value + (offset[index % 3] as number)),
    triangles: mesh.triangles,
  };
}
