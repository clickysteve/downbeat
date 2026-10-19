/**
 * Kits shipped with DOWNBEAT, installed into the kit library on first launch (Slop Factory Core's
 * installBundledKits: once per id and version, never over the user's kits, the default only if
 * none is set; deleting one is respected). None yet: see docs/KITS.md, "Bundled kits", for adding
 * one (a portable `.kit.zip` in public/kits/, listed here).
 */
import type { BundledKit } from '@slopfactory/core/kits';

/** A bundled kit served from public/kits/ (fetched only when it is first installed). */
export function servedKit(id: string, version: number, file: string): BundledKit {
  return {
    id,
    version,
    load: async () => {
      const r = await fetch(new URL(`kits/${file}`, document.baseURI));
      if (!r.ok) throw new Error(`The bundled kit ${file} could not be loaded (${r.status}).`);
      return new Uint8Array(await r.arrayBuffer());
    },
    // DOWNBEAT opens the project's own sounds at startup; a bundled kit is offered in KITS
    makeDefault: false,
  };
}

export const BUNDLED_KITS: BundledKit[] = [];
