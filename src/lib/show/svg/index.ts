/**
 * SVG vector-formation engine — public surface.
 *
 * Pipeline: parseSvg -> samplePlanePoints -> generateSvgFormationPoints ->
 * makeSvgFormation. Assignment, trajectory planning and safety validation stay
 * strictly downstream and are untouched by this package.
 */
export * from "./types";
export { parseSvg, parseTransform, scanSvg, type ParseSvgOptions } from "./parser";
export { parsePathData, tokenizePathData, arcToCubics } from "./paths";
export {
  applyMatrix,
  boundsOf,
  flattenSubPath,
  IDENTITY,
  matrixScale,
  multiply,
  polylineLength,
} from "./flatten";
export {
  planeTransform,
  planeToWorld,
  planePointsToWorld,
  svgPointsToWorld,
  toPlane,
  type PlaneTransform,
} from "./normalize";
export {
  allocateLargestRemainder,
  buildArcTable,
  farthestPointSelection,
  isInsideRegion,
  makeRng,
  pointAtArcLength,
  relaxAlongContour,
  relaxInsideRegion,
  samplePolylineByArcLength,
  spacingStats,
  totalLength,
} from "./distribute";
export { sampleFill, sampleOutline, samplePlanePoints, toPlaneContours } from "./sampling";
export { bounds3, buildFormationReport, checkPlacement } from "./validation";
export {
  defaultFormationName,
  formationNameFromFileName,
  generateSvgFormationPoints,
  makeSvgFormation,
  regenerateSvgFormation,
  resolveSvgParams,
  svgFormationSource,
  withPlacementWarnings,
} from "./formation";
export { importSvgFile, toSvgFormationError, type ImportSvgOptions } from "./import";
