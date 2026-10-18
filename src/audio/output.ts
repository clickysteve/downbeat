/**
 * The OUTPUT CHAIN: a master output chain of Slop Factory Core output engines (The Good Bits'
 * OUTPUT STAGE, DRIVE and CRUNCH, and TONE), after the master processing and before VOLUME and
 * the master compressor, live and in EXPORT AUDIO alike. It is part of the project's audio
 * settings (like the master processing): projects without one have an empty chain and sound
 * exactly as before.
 *
 * DOWNBEAT offers every built-in audio engine. Core has no MIDI engines yet, so DOWNBEAT's
 * MIDI output is not routed through any chain.
 */
import { coreEngines, emptyChain, type ChainConfig } from '@slopfactory/core/engines';
import type { ProjectAudio } from './settings';

export const OUTPUT_ENGINES = coreEngines();

/** The project's chain, or an empty one (not stored). */
export const chainOf = (a: Pick<ProjectAudio, 'chain'>): ChainConfig => a.chain ?? emptyChain();
