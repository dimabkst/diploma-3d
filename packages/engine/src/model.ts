import { type ModelSpec, modelSpecSchema, type PhysicalScale, type Shape, type ShapeKind } from '@diploma-3d/schema';
import type { Manifold } from 'manifold-3d';
import { GeometryError, InvalidModelSpecError } from './errors.ts';
import type { GeometryKernel } from './kernel.ts';
import { assertValidSolidMesh, type MeshMeasurements, measureMesh, meshFromManifold, type TriangleMesh } from './mesh.ts';
import { type Track, withScope } from './scope.ts';
import { buildBall } from './shapes/ball.ts';
import { buildUnitBox } from './shapes/box.ts';
import { buildParallelepiped } from './shapes/parallelepiped.ts';
import { buildUnitPrism } from './shapes/prism.ts';
import { buildUnitPyramid, pyramidParameters } from './shapes/pyramid.ts';
import { buildRoundSolid } from './shapes/round.ts';

export interface Solid {
  /** ASCII identifier, also used as the object name in exported files. */
  readonly name: string;
  readonly mesh: TriangleMesh;
  readonly measurements: MeshMeasurements;
  /** Display hint: the solid approximates curved surfaces, which the preview shades smoothly. */
  readonly smoothShading: boolean;
}

export interface GeneratedModel {
  readonly kind: ShapeKind;
  /** ASCII identifier of the model, used for file names and the names of its solids. */
  readonly name: string;
  readonly spec: ModelSpec;
  readonly solids: readonly Solid[];
}

/** Validates the specification, builds the shape in model units and converts it to millimetres with one uniform scale. */
export function generateModel(kernel: GeometryKernel, input: ModelSpec): GeneratedModel {
  const parsed = modelSpecSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidModelSpecError(parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`));
  }
  const spec = parsed.data;

  const mesh = withScope((track) => {
    const solid = buildShape(kernel, track, spec.shape, spec.scale);
    const status = solid.status();
    if (status !== 'NoError' || solid.isEmpty()) {
      throw new GeometryError(`Geometry kernel produced no solid (${status}).`);
    }
    return meshFromManifold(solid);
  });
  assertValidSolidMesh(mesh);

  const name = modelName(spec.shape);
  const smoothShading = spec.shape.kind === 'cylinder' || spec.shape.kind === 'cone' || spec.shape.kind === 'ball';
  return { kind: spec.shape.kind, name, spec, solids: [{ name, mesh, measurements: measureMesh(mesh), smoothShading }] };
}

/** The shape kind, with the number of base sides for prisms and pyramids, e.g. "prism-6-sided". */
export function modelName(shape: Shape): string {
  return shape.kind === 'prism' || shape.kind === 'pyramid' ? `${shape.kind}-${shape.baseSides}-sided` : shape.kind;
}

/**
 * The solid in millimetres: most polyhedra are built in model units and scaled once; the parallelepiped is scaled from
 * its unnormalised construction in one step, and curved solids are built at size.
 */
function buildShape(kernel: GeometryKernel, track: Track, shape: Shape, scale: PhysicalScale): Manifold {
  const toMillimetres = (unitSolid: Manifold) => track(unitSolid.scale(scale.longestDimensionMm));
  switch (shape.kind) {
    case 'cube':
    case 'cuboid':
      return toMillimetres(buildUnitBox(kernel, track, shape));
    case 'parallelepiped':
      return buildParallelepiped(kernel, track, shape, scale);
    case 'prism':
      return toMillimetres(buildUnitPrism(kernel, track, shape));
    case 'pyramid':
    case 'tetrahedron':
      return toMillimetres(buildUnitPyramid(kernel, track, pyramidParameters(shape)));
    case 'cylinder':
    case 'cone':
      return buildRoundSolid(kernel, track, shape, scale);
    case 'ball':
      return buildBall(kernel, track, scale);
  }
}
