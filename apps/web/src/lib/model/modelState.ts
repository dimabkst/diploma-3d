import { InvalidModelSpecError, KernelInitializationError, type ModelArtifacts } from '@diploma-3d/engine';

export type ModelState =
  | { readonly status: 'generating' }
  | { readonly status: 'ready'; readonly artifacts: ModelArtifacts }
  | { readonly status: 'error'; readonly message: string };

export function describeModelError(error: unknown): string {
  if (error instanceof KernelInitializationError) {
    return 'Не вдалося завантажити геометричний модуль. Перевірте з’єднання з мережею та спробуйте ще раз.';
  }
  if (error instanceof InvalidModelSpecError) {
    return 'Параметри моделі некоректні: розміри мають бути скінченними додатними числами.';
  }
  return 'Під час обчислення геометрії сталася помилка.';
}
