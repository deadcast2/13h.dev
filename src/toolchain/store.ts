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

const DB_NAME = "13h.dev";
const DB_VERSION = 1;
const STORE = "toolchain";
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

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open the local database."));
  });
}

/** Wraps a store operation, closing the connection whatever happens. */
async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = operation(transaction.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Local database request failed."));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Local database transaction aborted."));
    });
  } finally {
    db.close();
  }
}

export async function loadToolchain(): Promise<StoredToolchain | null> {
  try {
    const stored = await withStore<StoredToolchain | undefined>("readonly", (store) =>
      store.get(KEY),
    );
    return stored ?? null;
  } catch {
    // A browser with IndexedDB blocked (private mode, strict settings) should
    // fall back to asking for the disks again, not fail to start.
    return null;
  }
}

export async function saveToolchain(toolchain: StoredToolchain): Promise<void> {
  await withStore("readwrite", (store) => store.put(toolchain, KEY));
}

export async function clearToolchain(): Promise<void> {
  await withStore("readwrite", (store) => store.delete(KEY));
}
