export { type CubeShape, cubeShapeSchema } from './cube.ts';
export { type CuboidShape, cuboidShapeSchema } from './cuboid.ts';
export { defaultModelSpecs, type ModelSpec, modelSpecSchema, type Shape, type ShapeKind, shapeSchema } from './model.ts';
export { PRISM_BASE_SIDES, type PrismBaseSides, type PrismShape, prismShapeSchema } from './prism.ts';
export { RATIO_LIMITS, ratioSchema } from './ratio.ts';
export {
  DEFAULT_LONGEST_DIMENSION_MM,
  MAX_LONGEST_DIMENSION_MM,
  type PhysicalScale,
  physicalScaleSchema,
} from './scale.ts';
