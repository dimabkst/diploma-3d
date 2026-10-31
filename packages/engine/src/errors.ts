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

export class KernelInitializationError extends GeometryError {
  override readonly name = 'KernelInitializationError';
}
