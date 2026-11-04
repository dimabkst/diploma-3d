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
export { cosSinDeg } from './shapes/angle.ts';
export {
  BALL_SEGMENTS,
  type BallMeasurements,
  ballMeasurements,
  ballRadiusMm,
  ballSegments,
} from './shapes/ball.ts';
export { type BaseShape, type BaseSides, baseSidesMm, baseVertices } from './shapes/base.ts';
export { type BoxShape, boxEdgeLengthsMm, boxProportions } from './shapes/box.ts';
export {
  type ParallelepipedDimensions,
  parallelepipedDimensionsMm,
  parallelepipedProportions,
} from './shapes/parallelepiped.ts';
export { parallelogramArea, parallelogramVertices } from './shapes/parallelogram.ts';
export { baseContours, polygonAreaCentroid, polygonSize, signedPolygonArea, type Vec2 } from './shapes/polygon.ts';
export {
  prismShapeProportions,
  regularPrismDimensionsMm,
  regularPrismProportions,
  type TrapezoidPrismDimensions,
  type TrianglePrismDimensions,
  trapezoidPrismDimensionsMm,
  trapezoidPrismProportions,
  trianglePrismDimensionsMm,
  trianglePrismProportions,
} from './shapes/prism.ts';
export {
  isOblique,
  type PrismDimensions,
  type PrismProportions,
  prismBoundingSize,
  prismDimensionsMm,
  prismScaleMm,
} from './shapes/prism-geometry.ts';
export {
  buildPyramidShape,
  type PyramidShapeDimensions,
  pyramidShapeDimensionsMm,
  pyramidShapeProportions,
} from './shapes/pyramid.ts';
export {
  isApexCentred,
  type PyramidDimensions,
  type PyramidProportions,
  pyramidBoundingSize,
  pyramidDimensionsMm,
  pyramidScaleMm,
} from './shapes/pyramid-geometry.ts';
export {
  type RegularBaseParameters,
  type RegularBaseProportions,
  regularBaseDimensionsMm,
  regularBaseProportions,
} from './shapes/regular-base.ts';
export { regularPolygonArea, regularPolygonVertices } from './shapes/regular-polygon.ts';
export {
  orientedRegularPolyhedronVertices,
  PHI,
  type RegularPolyhedronFacts,
  type RegularPolyhedronMeasurements,
  regularPolyhedronBoundingSize,
  regularPolyhedronFacts,
  regularPolyhedronMeasurements,
  regularPolyhedronScaleMm,
  regularPolyhedronVerticesMm,
  unitRegularPolyhedronVertices,
} from './shapes/regular-polyhedron.ts';
export {
  CIRCULAR_SEGMENTS,
  circularSegments,
  MAX_CIRCLE_DEVIATION_MM,
  type RoundShape,
  type RoundSolidMeasurements,
  roundDimensionsMm,
  roundSolidMeasurements,
} from './shapes/round.ts';
export { shearMatrix } from './shapes/shear.ts';
export {
  type TrapezoidKind,
  trapezoidArea,
  trapezoidKind,
  trapezoidLegs,
  trapezoidVertices,
} from './shapes/trapezoid.ts';
export { triangleArea, triangleThirdSide, triangleVertices } from './shapes/triangle.ts';
