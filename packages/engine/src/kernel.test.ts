import { describe, expect, it } from 'vitest';
import { KernelInitializationError } from './errors.ts';
import { loadGeometryKernel } from './kernel.ts';

describe('loadGeometryKernel', () => {
  it('reports a failed initialisation and allows a later retry', async () => {
    await expect(loadGeometryKernel({ wasmUrl: '/nonexistent/manifold.wasm' })).rejects.toBeInstanceOf(KernelInitializationError);

    const kernel = await loadGeometryKernel();
    expect(kernel.Manifold).toBeTypeOf('function');
  });

  it('shares one initialised module between concurrent callers', async () => {
    const [first, second] = await Promise.all([loadGeometryKernel(), loadGeometryKernel()]);
    expect(first).toBe(second);
  });
});
