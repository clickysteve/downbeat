/**
 * URLs of Slop Factory Core's runtime files, copied into the build by Vite: the
 * output-processing AudioWorklet, the output-chain AudioWorklet and the sample-transformation
 * Worker.
 */
import worklet from '@slopfactory/core/output-fx-worklet.js?url';
import chainWorklet from '@slopfactory/core/chain-worklet.js?url';
import worker from '@slopfactory/core/transform-worker.js?url';

export const OUTPUT_FX_WORKLET_URL: string = worklet;
export const CHAIN_WORKLET_URL: string = chainWorklet;
export const TRANSFORM_WORKER_URL: string = worker;
