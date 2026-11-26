import { Document, type GLTF, type Material, WebIO } from '@gltf-transform/core';
import { GeometryError } from '../errors.ts';
import {
  assertValidSolidMesh,
  cross,
  dot,
  length,
  measureMesh,
  subtract,
  type TriangleMesh,
  triangleAreaVector,
  triangleAt,
  triangleCount,
  type Vec3,
  vertexAt,
} from '../mesh.ts';

export interface PreviewObject {
  readonly name: string;
  /** Millimetres, Z up. */
  readonly mesh: TriangleMesh;
  /**
   * Shade faces that meet at less than the feature-edge angle smoothly, as for the facets of a curved surface. Positions
   * stay the exported ones; only the display normals change. Polyhedra keep flat faces.
   */
  readonly smoothShading?: boolean;
  /**
   * For a smooth solid made by shearing a right one, x' = x + kx·z, y' = y + ky·z: the normals are smoothed, and the
   * feature edges found, on the right solid, where a cap meets the side at 90° or more however far the solid leans,
   * and are then mapped to the sheared surface by the inverse transpose of the shear.
   */
  readonly smoothingShear?: readonly [number, number];
  /**
   * 1 per triangle made by a cut or a connector, shown in the cut colour; the solid's own surface keeps its colour, 0. A value
   * 2 + k marks a face on the section's plane k, shown in that plane's colour of `PreviewOptions.planeColors`.
   */
  readonly newFaces?: Uint8Array;
  /**
   * A translation in millimetres, Z up, applied to the object's node only, such as to move the parts of a section
   * apart. The mesh keeps the exported positions.
   */
  readonly displayOffset?: Vec3;
  /** A turn about a line, also of the node only, applied before `displayOffset`; the mesh keeps the exported positions. */
  readonly displayTurn?: { readonly angleDeg: number; readonly axis: Vec3; readonly pivot: Vec3 };
  /** `plate`: a section plate, all of it in a neutral colour of its own, as it belongs to neither part of the solid. */
  readonly appearance?: 'plate';
}

/**
 * A display-only line of the construction, such as a generatrix: a thin square rod between two points in Z-up millimetres, in
 * its own material, named for the viewer to highlight. Never part of a printed solid.
 */
export interface PreviewGuide {
  readonly name: string;
  readonly from: Vec3;
  readonly to: Vec3;
  /** sRGB, as `#rrggbb`. */
  readonly color: string;
  /** Half the rod's width, in millimetres. */
  readonly halfWidth: number;
}

/** What a preview shows beside its solids: the colours of a section's planes, by index, and its guides. */
export interface PreviewOptions {
  /** sRGB, as `#rrggbb`: the faces marked 2 + k are shown in the colour k, in a material named `plane-${k + 1}`. */
  readonly planeColors?: readonly string[];
  readonly guides?: readonly PreviewGuide[];
}

/** glTF's colour factors are linear: the sRGB `#rrggbb` decoded. */
function linearColor(hex: string): [number, number, number] {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return [channel(1), channel(3), channel(5)];
}

export const GLB_MEDIA_TYPE = 'model/gltf-binary';

const METRES_PER_MILLIMETRE = 0.001;

// glTF primitive modes; Primitive.Mode is typed as a string record and would need non-null assertions.
const LINES: GLTF.MeshPrimitiveMode = 1;
const TRIANGLES: GLTF.MeshPrimitiveMode = 4;

// Linear RGB. A mid-tone matte surface keeps differently lit faces apart and stands out from the near-black background.
const SURFACE_COLOR = [0.2, 0.27, 0.4, 1] as const;
const EDGE_COLOR = [0.9, 0.92, 0.95, 1] as const;
// A warm tone that no lit side face takes, so that cut faces stand out from the solid's own faces.
const CUT_COLOR = [0.85, 0.42, 0.08, 1] as const;
// A mid neutral grey, apart from both the bluish solid and the orange cut faces, for a section plate; lighter, it washes out.
const PLATE_COLOR = [0.3, 0.3, 0.29, 1] as const;

// On a smoothly shaded solid, edges between faces meeting at a smaller angle are tessellation edges of a curved surface.
// Smooth shading blends exactly these faces, so outlined edges such as a cylinder's rims stay sharp.
const FEATURE_EDGE_MIN_ANGLE_DEG = 30;
const FEATURE_EDGE_MIN_COSINE = Math.cos((FEATURE_EDGE_MIN_ANGLE_DEG * Math.PI) / 180);

// A polyhedron's faces are planar, so every edge between non-coplanar triangles is a real edge, however flat: the lateral
// faces of a parallelepiped with α = 165° meet at 15°, those of a low octagonal pyramid at about 9°. Only the rounding
// noise between triangles of one face, far below this angle, is excluded.
const POLYHEDRON_EDGE_MIN_ANGLE_DEG = 1;
const POLYHEDRON_EDGE_MIN_COSINE = Math.cos((POLYHEDRON_EDGE_MIN_ANGLE_DEG * Math.PI) / 180);

// Lines exactly on the surface z-fight with it; running them this fraction of the bounding-box diagonal outside the
// adjacent faces keeps them visible without visibly detaching them from the solid.
export const EDGE_LIFT_RELATIVE = 0.002;

// At a sharp apex the point a full lift outside every face lies far beyond the tip. Longer offsets are shortened to
// this multiple of the lift; shortening keeps them outside every face, only closer to it.
const MAX_VERTEX_OFFSET_IN_LIFTS = 3;

/**
 * glTF is Y-up and in metres. Rotating −90° about X maps (x, y, z) to (x, z, −y); as a proper rotation it keeps the
 * triangle winding, so outward faces stay counter-clockwise.
 */
export function toGltfPosition([x, y, z]: Vec3): Vec3 {
  return [x * METRES_PER_MILLIMETRE, z * METRES_PER_MILLIMETRE, -y * METRES_PER_MILLIMETRE];
}

const toGltfDirection = ([x, y, z]: Vec3): Vec3 => [x, z, -y];

/** Builds a shaded preview with outlined feature edges from the same meshes that are exported for printing. */
export async function createPreviewGlb(
  objects: readonly PreviewObject[],
  options: PreviewOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  if (objects.length === 0) {
    throw new GeometryError('A preview needs at least one object.');
  }

  const document = new Document();
  document.getRoot().getAsset().generator = 'diploma-3d engine';
  const buffer = document.createBuffer();
  const scene = document.createScene('preview');
  const surfaceMaterial = document
    .createMaterial('surface')
    .setBaseColorFactor([...SURFACE_COLOR])
    .setMetallicFactor(0)
    .setRoughnessFactor(0.75);
  const edgeMaterial = document.createMaterial('edges').setBaseColorFactor([...EDGE_COLOR]);
  // Only previews of a section have cut faces.
  let cutMaterial: Material | undefined;
  const cutMaterialOnce = () => {
    cutMaterial ??= document
      .createMaterial('cut')
      .setBaseColorFactor([...CUT_COLOR])
      .setMetallicFactor(0)
      .setRoughnessFactor(0.75);
    return cutMaterial;
  };

  let plateMaterial: Material | undefined;
  const plateMaterialOnce = () => {
    plateMaterial ??= document
      .createMaterial('plate')
      .setBaseColorFactor([...PLATE_COLOR])
      .setMetallicFactor(0)
      .setRoughnessFactor(0.75);
    return plateMaterial;
  };

  const planeMaterials = (options.planeColors ?? []).map((color, index) =>
    document
      .createMaterial(`plane-${index + 1}`)
      .setBaseColorFactor([...linearColor(color), 1])
      .setMetallicFactor(0)
      .setRoughnessFactor(0.75),
  );
  const materialOf = (object: PreviewObject, kind: number) =>
    object.appearance === 'plate'
      ? plateMaterialOnce()
      : kind === 0
        ? surfaceMaterial
        : kind === 1
          ? cutMaterialOnce()
          : (planeMaterials[kind - 2] ?? cutMaterialOnce());

  for (const object of objects) {
    assertValidSolidMesh(object.mesh);
    const smooth = object.smoothShading ?? false;
    const shear = smooth ? object.smoothingShear : undefined;
    const rightMesh = shear === undefined ? object.mesh : unshear(object.mesh, shear);
    const shaded = shadedTriangles(object.mesh, rightMesh, smooth, shear, object.newFaces);
    const mesh = document.createMesh(object.name);
    const kinds = [...new Set(object.newFaces ?? [0])].sort((a, b) => a - b);
    for (const kind of kinds.includes(0) ? kinds : [0, ...kinds]) {
      const selected = selectTriangles(shaded, (triangle) => (object.newFaces?.[triangle] ?? 0) === kind);
      if (selected.positions.length === 0) continue;
      mesh.addPrimitive(
        document
          .createPrimitive()
          .setMode(TRIANGLES)
          .setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(selected.positions).setBuffer(buffer))
          .setAttribute('NORMAL', document.createAccessor().setType('VEC3').setArray(selected.normals).setBuffer(buffer))
          .setMaterial(materialOf(object, kind)),
      );
    }

    // Every outline in the one edge colour, the rims of cut faces too: only the faces show which plane made them.
    const edgePositions = featureEdgeSegments(
      object.mesh,
      rightMesh,
      smooth ? FEATURE_EDGE_MIN_COSINE : POLYHEDRON_EDGE_MIN_COSINE,
      object.newFaces,
    );
    if (edgePositions.length > 0) {
      mesh.addPrimitive(
        document
          .createPrimitive()
          .setMode(LINES)
          .setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(edgePositions).setBuffer(buffer))
          .setMaterial(edgeMaterial),
      );
    }
    const node = document.createNode(object.name).setMesh(mesh);
    const { rotation, translation } = previewNodeTransform(object);
    if (rotation !== undefined) node.setRotation([...rotation]);
    if (translation !== undefined) node.setTranslation([...translation]);
    scene.addChild(node);
  }

  for (const guide of options.guides ?? []) {
    const color = linearColor(guide.color);
    const material = document
      .createMaterial(`guide-${guide.name}`)
      .setBaseColorFactor([...color, 1])
      .setEmissiveFactor(color)
      .setMetallicFactor(0)
      .setRoughnessFactor(1)
      // A thin rod is seen from every side; both sides keep it visible whatever its winding looks like from the camera.
      .setDoubleSided(true);
    const rod = guideRod(guide);
    const mesh = document
      .createMesh(`guide-${guide.name}`)
      .addPrimitive(
        document
          .createPrimitive()
          .setMode(TRIANGLES)
          .setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(rod.positions).setBuffer(buffer))
          .setAttribute('NORMAL', document.createAccessor().setType('VEC3').setArray(rod.normals).setBuffer(buffer))
          .setMaterial(material),
      );
    scene.addChild(document.createNode(`guide-${guide.name}`).setMesh(mesh));
  }

  // glTF-Transform allocates a regular ArrayBuffer; its typings predate the ArrayBuffer type parameter.
  return (await new WebIO().writeBinary(document)) as Uint8Array<ArrayBuffer>;
}

/**
 * A guide's rod in glTF axes and metres, flat-shaded: its four long faces, square about the segment, and its two ends, each face
 * two triangles of its own vertices.
 */
function guideRod({ from, to, halfWidth }: PreviewGuide): {
  positions: Float32Array<ArrayBuffer>;
  normals: Float32Array<ArrayBuffer>;
} {
  const along = subtract(to, from);
  const direction = scaledBy(along, 1 / length(along));
  const helper: Vec3 = Math.abs(direction[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const side = scaledBy(cross(direction, helper), 1 / length(cross(direction, helper)));
  const other = cross(direction, side);
  const corner = (end: Vec3, a: number, b: number): Vec3 => [
    end[0] + halfWidth * (a * side[0] + b * other[0]),
    end[1] + halfWidth * (a * side[1] + b * other[1]),
    end[2] + halfWidth * (a * side[2] + b * other[2]),
  ];
  const square = [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ] as const;
  const positions: number[] = [];
  const normals: number[] = [];
  const face = (corners: readonly Vec3[], normal: Vec3) => {
    for (const index of [0, 1, 2, 0, 2, 3]) {
      positions.push(...toGltfPosition(corners[index] as Vec3));
      normals.push(...toGltfDirection(normal));
    }
  };
  square.forEach(([a, b], index) => {
    const [c, d] = square[(index + 1) % 4] as readonly [number, number];
    const outward = scaledBy(
      [(a + c) * side[0] + (b + d) * other[0], (a + c) * side[1] + (b + d) * other[1], (a + c) * side[2] + (b + d) * other[2]],
      1 / 2,
    );
    face([corner(from, a, b), corner(from, c, d), corner(to, c, d), corner(to, a, b)], outward);
  });
  face(
    square.map(([a, b]) => corner(to, a, b)),
    direction,
  );
  face(
    [...square].reverse().map(([a, b]) => corner(from, a, b)),
    scaledBy(direction, -1),
  );
  return { positions: new Float32Array(positions), normals: new Float32Array(normals) };
}

const scaledBy = (a: Vec3, factor: number): Vec3 => [a[0] * factor, a[1] * factor, a[2] * factor];

/** A node's transform in glTF axes and metres, p ↦ R·p + t, R the unit quaternion (x, y, z, w); absent parts are the identity. */
export interface NodeTransform {
  readonly rotation?: readonly [number, number, number, number];
  readonly translation?: Vec3;
}

/**
 * The transform of a preview object's node: its turn about a line, then its display offset. The GLB's node has exactly this
 * transform, and an annotation of a point of the object's mesh is placed by `previewPosition` through the same one.
 */
export function previewNodeTransform({
  displayOffset,
  displayTurn,
}: Pick<PreviewObject, 'displayOffset' | 'displayTurn'>): NodeTransform {
  const offset = toGltfPosition(displayOffset ?? [0, 0, 0]);
  if (displayTurn === undefined) return displayOffset === undefined ? {} : { translation: offset };
  const { rotation, translation } = turnAboutLine(displayTurn);
  return { rotation, translation: [translation[0] + offset[0], translation[1] + offset[1], translation[2] + offset[2]] };
}

/** R·v for the unit quaternion q = (u, w): v + 2w(u × v) + 2u × (u × v). */
function rotated([x, y, z, w]: readonly [number, number, number, number], vector: Vec3): Vec3 {
  const u: Vec3 = [x, y, z];
  const first = cross(u, vector);
  const second = cross(u, first);
  return [0, 1, 2].map(
    (index) => (vector[index] as number) + 2 * w * (first[index] as number) + 2 * (second[index] as number),
  ) as unknown as Vec3;
}

/** Where the preview shows a point of an object's mesh, given in Z-up millimetres: in glTF metres, moved by its node. */
export function previewPosition(object: Pick<PreviewObject, 'displayOffset' | 'displayTurn'>, point: Vec3): Vec3 {
  const { rotation, translation = [0, 0, 0] } = previewNodeTransform(object);
  const local = toGltfPosition(point);
  const turned = rotation === undefined ? local : rotated(rotation, local);
  return [turned[0] + translation[0], turned[1] + translation[1], turned[2] + translation[2]];
}

/** The same for a direction, such as a face's normal: in glTF axes, turned by its node. */
export function previewDirection(object: Pick<PreviewObject, 'displayOffset' | 'displayTurn'>, direction: Vec3): Vec3 {
  const { rotation } = previewNodeTransform(object);
  const local = toGltfDirection(direction);
  return rotation === undefined ? local : rotated(rotation, local);
}

/**
 * The node's rotation and translation for a turn about a line in Z-up millimetres. The conversion to glTF is a proper rotation,
 * so it keeps the angle's sign about the converted axis. A node maps p ↦ R·p + t, and p ↦ R·(p − c) + c needs t = c − R·c, with
 * R·c = c·cosθ + (a × c)·sinθ + a·(a·c)(1 − cosθ).
 */
function turnAboutLine({ angleDeg, axis, pivot }: NonNullable<PreviewObject['displayTurn']>) {
  const half = (angleDeg * Math.PI) / 360;
  const unit = toGltfDirection(axis);
  const rotation: [number, number, number, number] = [
    unit[0] * Math.sin(half),
    unit[1] * Math.sin(half),
    unit[2] * Math.sin(half),
    Math.cos(half),
  ];
  const centre = toGltfPosition(pivot);
  const [cos, sin] = [Math.cos(2 * half), Math.sin(2 * half)];
  const across = cross(unit, centre);
  const along = dot(unit, centre) * (1 - cos);
  const translation = [0, 1, 2].map(
    (index) =>
      (centre[index] as number) -
      ((centre[index] as number) * cos + (across[index] as number) * sin + (unit[index] as number) * along),
  ) as unknown as Vec3;
  return { rotation, translation };
}

type ShadedTriangles = { positions: Float32Array<ArrayBuffer>; normals: Float32Array<ArrayBuffer> };

/** The corners of the triangles that pass `keep`, in their order. */
function selectTriangles({ positions, normals }: ShadedTriangles, keep: (triangle: number) => boolean): ShadedTriangles {
  const kept = Array.from({ length: positions.length / 9 }, (_, triangle) => triangle).filter(keep);
  const pick = (source: Float32Array<ArrayBuffer>) => {
    const target = new Float32Array(kept.length * 9);
    kept.forEach((triangle, index) => {
      target.set(source.subarray(triangle * 9, triangle * 9 + 9), index * 9);
    });
    return target;
  };
  return { positions: pick(positions), normals: pick(normals) };
}

/** The right solid before the shear x' = x + kx·z, y' = y + ky·z: the same triangles with x − kx·z, y − ky·z. */
function unshear(mesh: TriangleMesh, [kx, ky]: readonly [number, number]): TriangleMesh {
  const positions = Float32Array.from(mesh.positions);
  for (let index = 0; index < positions.length; index += 3) {
    const z = positions[index + 2] as number;
    positions[index] = (positions[index] as number) - kx * z;
    positions[index + 1] = (positions[index + 1] as number) - ky * z;
  }
  return { positions, triangles: mesh.triangles };
}

/**
 * A normal of the right solid mapped to the sheared one: normals transform by the inverse transpose of the shear,
 * (nx, ny, nz) ↦ (nx, ny, nz − kx·nx − ky·ny), which stays perpendicular to every sheared tangent.
 */
function shearNormal(normal: Vec3, [kx, ky]: readonly [number, number]): Vec3 {
  const mapped: Vec3 = [normal[0], normal[1], normal[2] - kx * normal[0] - ky * normal[1]];
  return scale(mapped, 1 / length(mapped));
}

/**
 * Unshared vertices per triangle, so that each corner has its own normal. Flat shading uses the face normal. Smooth
 * shading averages, weighted by their angles at the vertex, the normals of the faces around the vertex that lie within
 * the feature-edge angle of this face: the facets of a curved side blend, while a rim between the side and a flat cap
 * stays sharp. At a cone's apex each side triangle thus gets a normal close to its own instead of the axis direction.
 * For a sheared solid this happens on `rightMesh`, the solid before the shear, and the result is mapped back. A cut face
 * never blends with the solid's own surface, which a steep oblique plane can meet at a small angle.
 */
function shadedTriangles(
  mesh: TriangleMesh,
  rightMesh: TriangleMesh,
  smooth: boolean,
  shear: readonly [number, number] | undefined,
  newFaces: Uint8Array | undefined,
): ShadedTriangles {
  const faceNormals = Array.from({ length: triangleCount(mesh) }, (_, triangle) => unitNormal(rightMesh, triangle));
  const cornersOfVertex = new Map<number, { triangle: number; angle: number }[]>();
  if (smooth) {
    for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
      const corners = triangleAt(mesh, triangle);
      corners.forEach((vertex, corner) => {
        const at = vertexAt(rightMesh, vertex);
        const toNext = subtract(vertexAt(rightMesh, corners[(corner + 1) % 3] as number), at);
        const toPrevious = subtract(vertexAt(rightMesh, corners[(corner + 2) % 3] as number), at);
        const angle = Math.acos(Math.max(-1, Math.min(1, dot(toNext, toPrevious) / (length(toNext) * length(toPrevious)))));
        const list = cornersOfVertex.get(vertex) ?? [];
        list.push({ triangle, angle });
        cornersOfVertex.set(vertex, list);
      });
    }
  }

  const positions = new Float32Array(triangleCount(mesh) * 9);
  const normals = new Float32Array(triangleCount(mesh) * 9);
  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    const faceNormal = faceNormals[triangle] as Vec3;
    triangleAt(mesh, triangle).forEach((vertex, corner) => {
      let normal = faceNormal;
      if (smooth) {
        let sum: Vec3 = [0, 0, 0];
        for (const neighbour of cornersOfVertex.get(vertex) ?? []) {
          const neighbourNormal = faceNormals[neighbour.triangle] as Vec3;
          const sameKind = newFaces?.[neighbour.triangle] === newFaces?.[triangle];
          if (sameKind && dot(neighbourNormal, faceNormal) >= FEATURE_EDGE_MIN_COSINE)
            sum = add(sum, scale(neighbourNormal, neighbour.angle));
        }
        normal = scale(sum, 1 / length(sum));
      }
      if (shear !== undefined) normal = shearNormal(normal, shear);
      const offset = triangle * 9 + corner * 3;
      positions.set(toGltfPosition(vertexAt(mesh, vertex)), offset);
      normals.set(toGltfDirection(normal), offset);
    });
  }
  return { positions, normals };
}

/**
 * Feature edges, lifted off the surface. Each vertex gets one offset shared by all its edges, so that the lines stay
 * connected at corners; offsetting every edge along its own normal bisector would leave gaps there. The edges are
 * found by the angle between faces of `rightMesh`, the solid before any shear, and lifted along the faces of `mesh`. The
 * rim of a cut face is a feature edge at any angle.
 */
function featureEdgeSegments(
  mesh: TriangleMesh,
  rightMesh: TriangleMesh,
  minCosine: number,
  newFaces: Uint8Array | undefined,
): Float32Array<ArrayBuffer> {
  const firstTriangleOfEdge = new Map<string, number>();
  const edges: [number, number][] = [];
  const adjacentFaces = new Map<number, AdjacentFace[]>();

  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    const corners = triangleAt(mesh, triangle);
    for (let corner = 0; corner < 3; corner += 1) {
      const from = corners[corner] as number;
      const to = corners[(corner + 1) % 3] as number;
      const key = from < to ? `${from}:${to}` : `${to}:${from}`;
      const neighbour = firstTriangleOfEdge.get(key);
      if (neighbour === undefined) {
        firstTriangleOfEdge.set(key, triangle);
      } else if (
        newFaces?.[triangle] !== newFaces?.[neighbour] ||
        dot(unitNormal(rightMesh, triangle), unitNormal(rightMesh, neighbour)) < minCosine
      ) {
        edges.push([from, to]);
        for (const vertex of [from, to]) {
          const faces = adjacentFaces.get(vertex) ?? [];
          for (const face of [triangle, neighbour]) faces.push({ normal: unitNormal(mesh, face), kind: newFaces?.[face] ?? 0 });
          adjacentFaces.set(vertex, faces);
        }
      }
    }
  }

  const lift = EDGE_LIFT_RELATIVE * length(measureMesh(mesh).size);
  const liftedPoints = new Map(
    [...adjacentFaces].map(([vertex, faces]) => [
      vertex,
      toGltfPosition(add(vertexAt(mesh, vertex), vertexOffset(surfaceNormals(faces, minCosine), lift))),
    ]),
  );
  return Float32Array.from(edges.flatMap(([from, to]) => [...(liftedPoints.get(from) ?? []), ...(liftedPoints.get(to) ?? [])]));
}

/** A triangle at a vertex with a feature edge: its unit normal and its kind, as `PreviewObject.newFaces` marks it. */
type AdjacentFace = { readonly normal: Vec3; readonly kind: number };

/**
 * One normal per surface meeting at a vertex: the faces of one kind within the feature-edge angle of each other are one
 * surface, such as the facets of a ball next to a cut's rim, and take their mean normal. Solved face by face, a cut face and two
 * facets 2° apart would be three planes: their exact offset runs up to several lifts along the rim, and shortened to the
 * maximum it no longer clears the surfaces, so the outline would wander off the rim in bumps. Distinct faces of a polyhedron
 * stay apart, as its feature-edge angle is that of rounding noise.
 */
function surfaceNormals(faces: readonly AdjacentFace[], minCosine: number): Vec3[] {
  const surfaces: { kind: number; sum: Vec3 }[] = [];
  for (const { normal, kind } of faces) {
    const surface = surfaces.find(
      (candidate) => candidate.kind === kind && dot(candidate.sum, normal) >= minCosine * length(candidate.sum),
    );
    if (surface === undefined) surfaces.push({ kind, sum: normal });
    else surface.sum = add(surface.sum, normal);
  }
  return surfaces.map(({ sum }) => scale(sum, 1 / length(sum)));
}

/**
 * The offset o that puts a vertex `lift` outside the plane of every given surface: n·o = lift for each unit normal n.
 * This is exact for up to three independent planes, such as at a box corner (o = lift·(±1, ±1, ±1)) or along a straight
 * edge, and a least-squares compromise where more faces meet. The solution of the regularised normal equations
 * (NᵀN + εI) o = Nᵀ·lift tends to the shortest such offset when the planes leave a direction free.
 */
function vertexOffset(normals: readonly Vec3[], lift: number): Vec3 {
  const epsilon = 1e-6 * normals.length;
  const rows: [Vec3, Vec3, Vec3] = [
    [epsilon, 0, 0],
    [0, epsilon, 0],
    [0, 0, epsilon],
  ];
  let target: Vec3 = [0, 0, 0];
  for (const normal of normals) {
    rows.forEach((row, index) => {
      rows[index] = add(row, scale(normal, normal[index] as number));
    });
    target = add(target, scale(normal, lift));
  }
  // Cramer's rule for the symmetric 3 × 3 system: the inverse's columns are the cross products of row pairs.
  const [r0, r1, r2] = rows;
  const offset = scale(
    add(add(scale(cross(r1, r2), target[0]), scale(cross(r2, r0), target[1])), scale(cross(r0, r1), target[2])),
    1 / dot(r0, cross(r1, r2)),
  );
  const offsetLength = length(offset);
  const maximum = MAX_VERTEX_OFFSET_IN_LIFTS * lift;
  return offsetLength > maximum ? scale(offset, maximum / offsetLength) : offset;
}

function unitNormal(mesh: TriangleMesh, triangle: number): Vec3 {
  const areaVector = triangleAreaVector(mesh, triangle);
  return scale(areaVector, 1 / length(areaVector));
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, factor: number): Vec3 => [a[0] * factor, a[1] * factor, a[2] * factor];
