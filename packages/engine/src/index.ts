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
export { type BoxShape, boxEdgeLengthsMm, boxProportions } from './shapes/box.ts';
export { type PrismProportions, prismDimensionsMm, prismProportions } from './shapes/prism.ts';
export { regularPolygonArea, regularPolygonVertices, type Vec2 } from './shapes/regular-polygon.ts';
