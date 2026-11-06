import {
  ConnectorUnsuitableError,
  ConnectorVerificationError,
  InfeasibleGeometryError,
  InvalidModelSpecError,
  KernelInitializationError,
  type ModelArtifacts,
} from '@diploma-3d/engine';

/**
 * Only `ready` artifacts may be downloaded. While a replacement is generated or the parameters are invalid, the
 * previous artifacts of the same shape stay visible as a `stale` preview.
 */
export type ModelState =
  | { readonly status: 'generating'; readonly stale: ModelArtifacts | undefined }
  | { readonly status: 'invalid'; readonly stale: ModelArtifacts | undefined }
  | { readonly status: 'ready'; readonly key: string; readonly artifacts: ModelArtifacts }
  | { readonly status: 'error'; readonly message: string };

export function visibleArtifacts(state: ModelState): ModelArtifacts | undefined {
  switch (state.status) {
    case 'ready':
      return state.artifacts;
    case 'generating':
    case 'invalid':
      return state.stale;
    case 'error':
      return undefined;
  }
}

export function describeModelError(error: unknown): string {
  if (error instanceof KernelInitializationError) {
    return 'Не вдалося завантажити геометричний модуль. Перевірте з’єднання з мережею та спробуйте ще раз.';
  }
  if (error instanceof InfeasibleGeometryError) {
    return 'Тіло задовге й тонке для надійного обчислення. Збільште кут нахилу або зменште зміщення.';
  }
  if (error instanceof ConnectorUnsuitableError) {
    return 'Кріплення не вміщується в ці частини. Змініть розмір, довжину кріплення або положення перерізу.';
  }
  if (error instanceof ConnectorVerificationError) {
    return 'Кріплення не пройшло перевірку геометрії, тому файл не створено. Змініть розмір, довжину або зазор.';
  }
  if (error instanceof InvalidModelSpecError) {
    return 'Параметри моделі некоректні. Перевірте значення й спробуйте ще раз.';
  }
  return 'Під час обчислення геометрії сталася помилка.';
}
