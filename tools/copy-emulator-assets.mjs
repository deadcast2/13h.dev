// Copies the js-dos emulator runtime out of node_modules and into public/.
//
// The `emulators` package ships a browserify bundle that assigns window.emulators
// and then fetches its WebAssembly at runtime from `emulators.pathPrefix`. Those
// .wasm files therefore have to be served as static assets rather than imported,
// so they get staged into public/emulators/ (gitignored) before dev and build.

import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "node_modules", "emulators", "dist");
const DEST = join(ROOT, "public", "emulators");

// Deliberately excludes the DOSBox-X builds (~7.8 MB of wasm each) and the
// .symbols files. Plain DOSBox emulates VGA fine, which is all mode 13h needs.
const ASSETS = [
  "emulators.js", // the loader; sets window.emulators
  "wdosbox.js", // DOSBox glue
  "wdosbox.wasm", // DOSBox itself
  "wlibzip.js", // zip handling, used to unpack bundles into the guest FS
  "wlibzip.wasm",
];

mkdirSync(DEST, { recursive: true });

let total = 0;
for (const asset of ASSETS) {
  const from = join(SRC, asset);
  try {
    copyFileSync(from, join(DEST, asset));
    total += statSync(from).size;
  } catch (err) {
    throw new Error(
      `Could not stage ${asset} from ${SRC}.\n` +
        `Is the 'emulators' package installed? (npm install)\n${err.message}`,
    );
  }
}

console.log(
  `Staged ${ASSETS.length} emulator assets ` +
    `(${(total / 1024 / 1024).toFixed(1)} MB) -> public/emulators/`,
);
