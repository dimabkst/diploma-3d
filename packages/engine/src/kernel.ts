import Module, { type ManifoldToplevel } from 'manifold-3d';
import { KernelInitializationError } from './errors.ts';

export type GeometryKernel = ManifoldToplevel;

export interface KernelOptions {
  /** Location of manifold.wasm when a bundler relocates it; by default it is resolved next to manifold.js. */
  readonly wasmUrl?: string;
}

let kernelPromise: Promise<GeometryKernel> | undefined;

/** Loads the WASM module once; concurrent callers share the instance, and the options of the first call apply. */
export function loadGeometryKernel(options: KernelOptions = {}): Promise<GeometryKernel> {
  kernelPromise ??= initializeKernel(options).catch((error: unknown) => {
    // Forget the failure so that a later call can retry, e.g. after a network error while fetching the WASM file.
    kernelPromise = undefined;
    throw new KernelInitializationError('Failed to initialise the geometry kernel.', { cause: error });
  });
  return kernelPromise;
}

async function initializeKernel({ wasmUrl }: KernelOptions): Promise<GeometryKernel> {
  const kernel = await Module(wasmUrl === undefined ? undefined : { locateFile: () => wasmUrl });
  kernel.setup();
  return kernel;
}
