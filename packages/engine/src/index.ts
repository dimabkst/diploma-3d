export {
  buildModelArtifacts,
  CONNECTOR_PREVIEW_GAP_RELATIVE,
  type ModelArtifacts,
  previewSeparation,
  SECTION_PREVIEW_GAP_RELATIVE,
} from './artifacts.ts';
export {
  type ConnectorFeasibility,
  hasFeasibleValues,
  type Interval,
  type ParameterBounds,
  type ParameterFeasibility,
} from './connectors/bounds.ts';
export {
  buildDovetail,
  DOVETAIL_EXIT_MARGIN_MM,
  DOVETAIL_LEAD_IN_RELATIVE,
  DOVETAIL_MINIMUMS_MM,
  DOVETAIL_PROPORTIONS,
  DOVETAIL_ROOT_OVERLAP_MM,
  type DovetailDimensions,
  type DovetailFrame,
  type DovetailIssue,
  type DovetailParameter,
  type DovetailParts,
  type DovetailPlan,
  dovetailChecks,
  dovetailDimensions,
  dovetailFeasibility,
  dovetailProfileMm,
  dovetailProfileOfHeight,
  isStrictlyConvex,
  offsetConvexPolygon,
  planDovetail,
  tonguePoints,
  verifyDovetail,
} from './connectors/dovetail.ts';
export {
  type ApexChord,
  type ApexCut,
  apexChordCrossesBase,
  type BallHorizontalSection,
  ballOffsetLimitPercent,
  ballSection,
  CONNECTOR_MIN_WALL_MM,
  CONSTRAINT_ROUNDOFF_MM,
  type ConeObliqueSection,
  type ConeParallelSection,
  type ConeVerticalSection,
  coneApexAngleBounds,
  coneApexChord,
  coneObliqueSection,
  coneSection,
  coneVerticalSection,
  connectorVolumeTolerance,
  cutOfSection,
  cylinderSection,
  frameMatrix,
  framePoint,
  isApexChordUsable,
  lateralWall,
  type Measurement,
  type ObliqueCut,
  type ObliqueCylinderSection,
  type OffsetCut,
  obliqueAxes,
  obliqueCylinderSection,
  obliquePlaneContainsAxis,
  obliqueSplitReach,
  type ParallelCylinderSection,
  type SectionedShape,
  type SectionFrame,
  type SolidCut,
  type SolidSection,
  satisfies,
  sectionOffsetMm,
  sectionOffsetPercent,
  solidCut,
  type VerticalCylinderSection,
  verticalCylinderSection,
  verticalOffsetLimitMm,
  verticalOffsetLimitPercent,
} from './connectors/frame.ts';
export {
  buildRoundConnectors,
  PLUG_ROOT_OVERLAP_MM,
  planRoundConnectors,
  ROUND_CONNECTOR_CHAMFER,
  ROUND_CONNECTOR_DEPTH_ALLOWANCE_MM,
  ROUND_CONNECTOR_MINIMUMS_MM,
  ROUND_CONNECTOR_PROPORTIONS,
  type RoundConnectorDimensions,
  type RoundConnectorIssue,
  type RoundConnectorParameter,
  type RoundConnectorParts,
  type RoundConnectorPlan,
  type RoundConnectorSite,
  roundConnectorChecks,
  roundConnectorDimensions,
  roundConnectorDimensionsMm,
  roundConnectorFeasibility,
  verifyRoundConnectors,
} from './connectors/round.ts';
export {
  ConnectorUnsuitableError,
  ConnectorVerificationError,
  GeometryError,
  InfeasibleGeometryError,
  InvalidModelSpecError,
  KernelInitializationError,
} from './errors.ts';
export { createPreviewGlb, GLB_MEDIA_TYPE, type PreviewObject, toGltfPosition } from './export/glb.ts';
export { arrangeInRow, PRINT_LAYOUT_GAP_MM, restOnFlatFace, rotateHalfTurn, rotateOntoZ } from './export/layout.ts';
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
export {
  type ConnectorPlan,
  type GeneratedModel,
  generateModel,
  type ModelSection,
  modelName,
  type SectionPart,
  type Solid,
} from './model.ts';
export { type Plane, type SplitParts, sectionPlane, splitByPlane } from './section.ts';
export { cosSinDeg } from './shapes/angle.ts';
export {
  BALL_SEGMENTS,
  type BallMeasurements,
  ballCentreMm,
  ballInradiusMm,
  ballMeasurements,
  ballPolyhedron,
  ballRadiusMm,
  ballSegments,
} from './shapes/ball.ts';
export { type BaseShape, type BaseSides, baseSidesMm, baseVertices } from './shapes/base.ts';
export { type BoxShape, boxEdgeLengthsMm, boxProportions } from './shapes/box.ts';
export {
  checkNumericalFeasibility,
  MAX_RELATIVE_ROUNDING,
  type NumericalFeasibility,
} from './shapes/feasibility.ts';
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
