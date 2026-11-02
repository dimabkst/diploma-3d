export { buildModelArtifacts, type ModelArtifacts } from './artifacts.ts';
export { GeometryError, InvalidModelSpecError, KernelInitializationError } from './errors.ts';
export { createPreviewGlb, GLB_MEDIA_TYPE, type PreviewObject, toGltfPosition } from './export/glb.ts';
export { createThreeMf, THREE_MF_MEDIA_TYPE, type ThreeMfObject, type ThreeMfOptions } from './export/three-mf.ts';
export { type GeometryKernel, type KernelOptions, loadGeometryKernel } from './kernel.ts';
export {
  type Bounds,
  findMeshDefects,
  type MeshDefect,
  type MeshMeasurements,
  measureMesh,
  type TriangleMesh,
  type Vec3,
} from './mesh.ts';
export { type GeneratedModel, generateModel, modelName, type Solid } from './model.ts';
export {
  BALL_SEGMENTS,
  type BallMeasurements,
  ballMeasurements,
  ballRadiusMm,
  ballSegments,
} from './shapes/ball.ts';
export { type BoxShape, boxEdgeLengthsMm, boxProportions } from './shapes/box.ts';
export {
  type ParallelepipedDimensions,
  type ParallelepipedProportions,
  parallelepipedDimensionsMm,
  parallelepipedProportions,
} from './shapes/parallelepiped.ts';
export { cosSinDeg, parallelogramArea, parallelogramVertices } from './shapes/parallelogram.ts';
export { baseContours, polygonSize, signedPolygonArea, type Vec2 } from './shapes/polygon.ts';
export { pyramidParameters } from './shapes/pyramid.ts';
export {
  type RegularBaseParameters,
  type RegularBaseProportions,
  regularBaseDimensionsMm,
  regularBaseProportions,
} from './shapes/regular-base.ts';
export { regularPolygonArea, regularPolygonVertices } from './shapes/regular-polygon.ts';
export {
  CIRCULAR_SEGMENTS,
  circularSegments,
  MAX_CIRCLE_DEVIATION_MM,
  type RoundShape,
  type RoundSolidMeasurements,
  roundDimensionsMm,
  roundSolidMeasurements,
} from './shapes/round.ts';
