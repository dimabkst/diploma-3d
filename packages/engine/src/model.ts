import { type ModelSpec, modelSpecSchema, type Shape, type ShapeKind } from '@diploma-3d/schema';
import type { Manifold } from 'manifold-3d';
import { GeometryError, InvalidModelSpecError } from './errors.ts';
import type { GeometryKernel } from './kernel.ts';
import { assertValidSolidMesh, type MeshMeasurements, measureMesh, meshFromManifold, type TriangleMesh } from './mesh.ts';
import { type Track, withScope } from './scope.ts';
import { buildUnitCube } from './shapes/cube.ts';

export interface Solid {
  /** ASCII identifier, also used as the object name in exported files. */
  readonly name: string;
  readonly mesh: TriangleMesh;
  readonly measurements: MeshMeasurements;
}

export interface GeneratedModel {
  readonly kind: ShapeKind;
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
    const unitSolid = buildUnitShape(kernel, track, spec.shape);
    const solid = track(unitSolid.scale(spec.scale.unitLengthMm));
    const status = solid.status();
    if (status !== 'NoError' || solid.isEmpty()) {
      throw new GeometryError(`Geometry kernel produced no solid (${status}).`);
    }
    return meshFromManifold(solid);
  });
  assertValidSolidMesh(mesh);

  const { kind } = spec.shape;
  return { kind, spec, solids: [{ name: kind, mesh, measurements: measureMesh(mesh) }] };
}

function buildUnitShape(kernel: GeometryKernel, track: Track, shape: Shape): Manifold {
  switch (shape.kind) {
    case 'cube':
      return buildUnitCube(kernel, track, shape);
  }
}
