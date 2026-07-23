import type { InitFsEntry } from "emulators";

/**
 * Defensive copying for anything handed to an emulator's initFs.
 *
 * The backend posts these buffers to its worker as *transferables*. Transferring
 * detaches the ArrayBuffer on this side: length goes to zero and any further use
 * throws `ArrayBuffer at index 0 is already detached`. That makes every buffer
 * given to the emulator single-use, which is a poor fit for values the app wants
 * to keep — a compiled executable that should survive a Restart, or a cached
 * toolchain reused by every build.
 *
 * Copying here means the caller's array is never the one transferred, so it stays
 * valid indefinitely and the emulator gets a private buffer to consume. The cost
 * is one memcpy per boot, which against ~1 MB is not worth reasoning about.
 */

/** True if this buffer has already been transferred away and is unusable. */
function isDetached(bytes: Uint8Array): boolean {
  // ArrayBuffer.prototype.detached is ES2024; where it's missing, a detached
  // buffer still reports zero length, which is the signal we can rely on.
  const buffer = bytes.buffer as ArrayBuffer;
  return "detached" in ArrayBuffer.prototype
    ? buffer.detached
    : buffer.byteLength === 0 && bytes.byteLength === 0;
}

function copyBytes(bytes: Uint8Array, what: string): Uint8Array {
  if (isDetached(bytes)) {
    throw new Error(
      `${what} has already been handed to an emulator and its buffer was ` +
        `detached. Copy it before the first use, not after — the original is ` +
        `unrecoverable once transferred.`,
    );
  }
  return bytes.slice();
}

/**
 * Returns initFs entries whose buffers are safe to transfer, leaving the
 * originals untouched. Pass everything through this on the way to dosboxWorker.
 */
export function copyForEmulator(entries: InitFsEntry[]): InitFsEntry[] {
  return entries.map((entry, index) => {
    if (entry instanceof Uint8Array) {
      return copyBytes(entry, `Bundle at initFs index ${index}`);
    }
    if (typeof entry === "object" && entry !== null && "path" in entry) {
      return { path: entry.path, contents: copyBytes(entry.contents, entry.path) };
    }
    // DosConfig objects and plain strings carry no buffers.
    return entry;
  });
}
