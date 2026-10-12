/**
 * URLs of Slop Factory Core's two runtime files, copied into the build by Vite: the
 * output-processing AudioWorklet and the sample-transformation Worker.
 */
import worklet from '@slopfactory/core/output-fx-worklet.js?url';
import worker from '@slopfactory/core/transform-worker.js?url';

export const OUTPUT_FX_WORKLET_URL: string = worklet;
export const TRANSFORM_WORKER_URL: string = worker;
