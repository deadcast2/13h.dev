/**
 * Local persistence for the unpacked toolchain.
 *
 * Unpacking the install disks takes a few seconds and needs a 1.65 MB copy of
 * 7-Zip, so it happens once per browser and the result is kept here. Nothing is
 * ever uploaded: the compiler stays on the machine it was supplied from.
 *
 * IndexedDB rather than Cache Storage or localStorage — it takes a Uint8Array
 * directly via structured clone, has no practical size ceiling at ~1 MB, and
 * unlike Cache Storage it isn't shaped around HTTP requests for something that
 * never was one.
 */

import { TOOLCHAIN_STORE, withStore } from "../storage/db";

const KEY = "current";

export interface StoredToolchain {
  /** Plain zip laid out as TC/BIN, TC/INCLUDE, TC/LIB, TC/BGI. */
  zip: Uint8Array;
  fileCount: number;
  totalBytes: number;
  installedAt: number;
  /** What the user dropped in, shown so they can tell which copy this came from. */
  sourceName: string;
}

export async function loadToolchain(): Promise<StoredToolchain | null> {
  try {
    const stored = await withStore<StoredToolchain | undefined>(
      TOOLCHAIN_STORE,
      "readonly",
      (store) => store.get(KEY),
    );
    return stored ?? null;
  } catch {
    // A browser with IndexedDB blocked (private mode, strict settings) should
    // fall back to asking for the disks again, not fail to start.
    return null;
  }
}

export async function saveToolchain(toolchain: StoredToolchain): Promise<void> {
  await withStore(TOOLCHAIN_STORE, "readwrite", (store) => store.put(toolchain, KEY));
}

export async function clearToolchain(): Promise<void> {
  await withStore(TOOLCHAIN_STORE, "readwrite", (store) => store.delete(KEY));
}
