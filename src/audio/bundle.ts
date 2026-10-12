/**
 * Portable projects (.downbeatpack): the project file plus every sample it uses, in Slop
 * Factory Core's bundle format (a ZIP with a manifest; samples hash-checked on import).
 * Plain .downbeat.json files never contain audio.
 */
import { readBundle, writeBundle, type SampleStore, type StoredSample } from '@slopfactory/core/storage';
import type { Project } from '../engine/types';
import { fileName, serialize } from '../persistence/format';
import { referencedSamples } from './settings';

export const BUNDLE_APP = 'DOWNBEAT';
export const BUNDLE_SUFFIX = '.downbeatpack';

export async function makeBundle(project: Project, store: SampleStore | null): Promise<{ name: string; bytes: Uint8Array; missing: string[] }> {
  const samples: StoredSample[] = [];
  const missing: string[] = [];
  for (const id of referencedSamples(project.audio)) {
    const s = store ? await store.get(id) : null;
    if (s) samples.push(s);
    else {
      const slot = Object.values(project.audio?.sounds ?? {}).flat().find((x) => x.sampleId === id);
      missing.push(slot?.name || id.slice(0, 8));
    }
  }
  const name = fileName(project.name);
  return { name: fileName(project.name, BUNDLE_SUFFIX), bytes: writeBundle(BUNDLE_APP, { name, text: serialize(project) }, samples), missing };
}

/** Store the bundle's samples and return the project text to open, with any problems. */
export async function unpackBundle(bytes: Uint8Array, store: SampleStore | null): Promise<{ projectText: string; problems: string[]; stored: number }> {
  const b = await readBundle(bytes, BUNDLE_APP);
  const problems = [...b.problems];
  let stored = 0;
  for (const s of b.samples) {
    if (!store) {
      problems.push(`Sample "${s.name}" could not be kept: browser storage is unavailable.`);
      continue;
    }
    try {
      await store.put(s);
      stored++;
    } catch (e) {
      problems.push(`Sample "${s.name}" could not be stored: ${(e as Error).message}`);
    }
  }
  return { projectText: b.projectText, problems, stored };
}
