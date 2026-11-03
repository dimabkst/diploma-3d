export { APEX_LIMITS, apexRatioSchema } from './apex.ts';
export { type BallShape, ballShapeSchema } from './ball.ts';
export {
  BASE_SHIFT_LIMITS,
  baseShiftSchema,
  DEFAULT_PARALLELOGRAM_BASE,
  DEFAULT_TRAPEZOID_BASE,
  DEFAULT_TRIANGLE_BASE,
} from './base.ts';
export { BASE_ANGLE_LIMITS, baseAngleSchema } from './base-angle.ts';
export { type CubeShape, cubeShapeSchema } from './cube.ts';
export { type CuboidShape, cuboidShapeSchema } from './cuboid.ts';
export {
  defaultModelSpecs,
  type ModelSpec,
  type ModelSpecInput,
  modelSpecSchema,
  type Shape,
  type ShapeKind,
  shapeSchema,
} from './model.ts';
export { OFFSET_LIMITS, offsetRatioSchema } from './offset.ts';
export { type ParallelepipedShape, parallelepipedShapeSchema } from './parallelepiped.ts';
export {
  PRISM_BASE_SIDES,
  PRISM_BASE_TYPES,
  type PrismBaseSides,
  type PrismBaseType,
  type PrismShape,
  prismShapeSchema,
  type RegularPrismShape,
  regularPrismShapeSchema,
  type TrapezoidPrismShape,
  type TrianglePrismShape,
  trapezoidPrismShapeSchema,
  trianglePrismShapeSchema,
} from './prism.ts';
export {
  PYRAMID_BASE_SIDES,
  PYRAMID_BASE_TYPES,
  type PyramidBaseSides,
  type PyramidBaseType,
  type PyramidShape,
  pyramidShapeSchema,
  type RegularPyramidShape,
} from './pyramid.ts';
export { RATIO_LIMITS, ratioSchema } from './ratio.ts';
export {
  type ConeShape,
  type CylinderShape,
  coneShapeSchema,
  cylinderShapeSchema,
  ROUND_OFFSET_LIMITS,
  roundOffsetSchema,
} from './round.ts';
export {
  DEFAULT_LONGEST_DIMENSION_MM,
  MAX_LONGEST_DIMENSION_MM,
  type PhysicalScale,
  physicalScaleSchema,
} from './scale.ts';
export { TETRAHEDRON_HEIGHT_RATIO, type TetrahedronShape, tetrahedronShapeSchema } from './tetrahedron.ts';
