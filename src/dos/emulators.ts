import type { Emulators } from "emulators";

/**
 * Loader for the js-dos `emulators` runtime.
 *
 * The package is a browserify bundle that assigns `window.emulators` rather than
 * exporting a module, so it is pulled in with a script tag. Types come from the
 * package via `import type`, which erases at compile time and leaves no runtime
 * import behind.
 */

declare global {
  interface Window {
    emulators?: Emulators;
  }
}

/** Where copy-emulator-assets.mjs stages the runtime. */
const EMULATORS_BASE = "/emulators/";

let pending: Promise<Emulators> | null = null;

export function loadEmulators(): Promise<Emulators> {
  pending ??= new Promise<Emulators>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${EMULATORS_BASE}emulators.js`;
    script.async = true;

    script.onload = () => {
      const emulators = window.emulators;
      if (!emulators) {
        reject(new Error("emulators.js loaded but did not define window.emulators"));
        return;
      }
      // Tells the bundle where to fetch wdosbox.wasm and friends.
      emulators.pathPrefix = EMULATORS_BASE;
      resolve(emulators);
    };

    script.onerror = () => {
      pending = null; // allow a retry
      reject(
        new Error(
          `Failed to load ${EMULATORS_BASE}emulators.js — ` +
            `run: npm run emulators:stage`,
        ),
      );
    };

    document.head.appendChild(script);
  });

  return pending;
}
