export class InvalidModelSpecError extends Error {
  override readonly name = 'InvalidModelSpecError';
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid model specification: ${issues.join('; ')}`);
    this.issues = issues;
  }
}

export class GeometryError extends Error {
  override readonly name: string = 'GeometryError';
}

/**
 * The parameters are valid, but the solid they describe cannot be represented reliably: exporting it would change its
 * shape noticeably. Raised before any geometry is built; see `checkNumericalFeasibility`.
 */
export class InfeasibleGeometryError extends GeometryError {
  override readonly name = 'InfeasibleGeometryError';
  readonly relativeRounding: number;

  constructor(relativeRounding: number) {
    super(`The solid is too thin for its extent to be represented reliably (relative rounding ${relativeRounding}).`);
    this.relativeRounding = relativeRounding;
  }
}

export class KernelInitializationError extends GeometryError {
  override readonly name = 'KernelInitializationError';
}
