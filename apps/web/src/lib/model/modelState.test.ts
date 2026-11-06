import {
  ConnectorUnsuitableError,
  ConnectorVerificationError,
  GeometryError,
  InfeasibleGeometryError,
  InvalidModelSpecError,
} from '@diploma-3d/engine';
import { describe, expect, it } from 'vitest';
import { describeModelError } from './modelState.ts';

describe('describeModelError', () => {
  it('explains a solid that the engine refused as too thin, apart from other failures', () => {
    expect(describeModelError(new InfeasibleGeometryError(0.01))).toBe(
      'Тіло задовге й тонке для надійного обчислення. Збільште кут нахилу або зменште зміщення.',
    );
    expect(describeModelError(new InvalidModelSpecError(['shape']))).toBe(
      'Параметри моделі некоректні. Перевірте значення й спробуйте ще раз.',
    );
    expect(describeModelError(new GeometryError('kernel'))).toBe('Під час обчислення геометрії сталася помилка.');
  });

  it('explains a connector that the engine refused or that failed its geometric checks', () => {
    expect(describeModelError(new ConnectorUnsuitableError([{ code: 'stop-thin' }]))).toMatch(/^Кріплення не вміщується/);
    expect(describeModelError(new ConnectorVerificationError('clear-path'))).toMatch(/^Кріплення не пройшло перевірку/);
  });
});
