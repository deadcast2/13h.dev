// Generates a DEV-ONLY Turbo C++ toolchain fixture from a set of install disks.
//
// This exists so the compile/run pipeline can be developed without first building
// the in-browser unpacker (step 3). Once that lands, this script is redundant --
// the browser does all of this itself, from disks the user supplies at runtime.
// The output is gitignored and never shipped.
//
//   npm run toolchain:fixture -- ["path/to/Turbo C++ 1.01.7z"]
//
// Requires 7-Zip on the host. Three nested container formats have to be peeled:
//
//   1. .7z            LZMA
//   2. Disk0N.img     raw FAT12 720K floppy images
//   3. *.ZIP          PKZIP 1.x, compressed with the legacy "Implode" method
//
// That third layer is why this needs real 7-Zip and not a Node zip library:
// fflate, JSZip, yauzl et al. implement only stored+deflate and cannot read
// Implode. (7z-wasm handles all three, which is what step 3 will use.)

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STAGING = join(ROOT, "node_modules", ".cache", "toolchain-fixture");
const OUT_DIR = join(ROOT, "public", "dev-toolchain");
const OUT_ZIP = join(OUT_DIR, "tc101.zip");

// Which archives on the disks we actually need. The Turbo C++ IDE (TC.CA1/CA2)
// and its help database are deliberately excluded -- we drive TCC.EXE directly,
// and skipping them cuts the payload roughly in half.
const WANTED = [
  // dest subdir, source archive, optional explicit member list
  ["BIN", "TCC.ZIP", null], // TCC.EXE, the command-line compiler
  ["BIN", "BIN1.ZIP", ["TLINK.EXE", "MAKE.EXE", "TLIB.EXE", "CPP.EXE"]],
  ["INCLUDE", "INCLUDE.ZIP", null], // 39 headers
  ["LIB", "SLIB.ZIP", null], // small model:   C0S/C0T.OBJ, CS.LIB, MATHS.LIB
  ["LIB", "MLIB.ZIP", null], // medium model
  ["LIB", "CLIB.ZIP", null], // compact model
  ["LIB", "LLIB.ZIP", null], // large model
  ["LIB", "HLIB.ZIP", null], // huge model
  ["LIB", "XLIB.ZIP", null], // EMU/FP87/GRAPHICS/OVERLAY
  ["BGI", "BGI.ZIP", null], // EGAVGA.BGI + stroke fonts
];

function findSevenZip() {
  const candidates = [
    "7z",
    "7zz",
    "7za",
    "C:\\Program Files\\7-Zip\\7z.exe",
    "C:\\Program Files (x86)\\7-Zip\\7z.exe",
    "/usr/bin/7z",
    "/usr/local/bin/7zz",
    "/opt/homebrew/bin/7zz",
  ];
  for (const c of candidates) {
    try {
      execFileSync(c, ["i"], { stdio: "ignore" });
      return c;
    } catch {
      // not here; keep looking
    }
  }
  throw new Error(
    "7-Zip not found. Install it and/or put 7z on PATH.\n" +
      "  Windows: winget install 7zip.7zip\n" +
      "  macOS:   brew install sevenzip\n" +
      "  Linux:   apt install p7zip-full",
  );
}

function sevenZip(bin, args) {
  return execFileSync(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
}

function extract(bin, archive, dest, members = null) {
  mkdirSync(dest, { recursive: true });
  const args = ["x", archive, `-o${dest}`, "-y"];
  if (members) args.push(...members);
  sevenZip(bin, args);
}

/** Locate the source archive: explicit arg, else the first .7z in the repo root. */
function findSource(argPath) {
  if (argPath) {
    const p = resolve(argPath);
    if (!existsSync(p)) throw new Error(`No such file: ${p}`);
    return p;
  }
  const hit = readdirSync(ROOT).find((f) => f.toLowerCase().endsWith(".7z"));
  if (!hit) {
    throw new Error(
      "No .7z found in the repo root.\n" +
        "Pass one explicitly:  npm run toolchain:fixture -- <path-to-disks.7z>",
    );
  }
  return join(ROOT, hit);
}

/** Recursively collect every file under dir, as absolute paths. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const sevenZipBin = findSevenZip();
const source = findSource(process.argv[2]);
console.log(`7-Zip:  ${sevenZipBin}`);
console.log(`Source: ${source}\n`);

rmSync(STAGING, { recursive: true, force: true });

// Layer 1 -- unwrap the .7z.
const disksDir = join(STAGING, "disks");
console.log("[1/4] Extracting .7z ...");
extract(sevenZipBin, source, disksDir);

// Layer 2 -- pull the inner archives off each FAT12 floppy image. The images may
// sit at any depth depending on how the .7z was packed, so search for them.
const images = walk(disksDir).filter((f) => f.toLowerCase().endsWith(".img"));
if (images.length === 0) {
  throw new Error(`No .img disk images found under ${disksDir}`);
}
const rawDir = join(STAGING, "raw");
console.log(`[2/4] Reading ${images.length} FAT12 disk image(s) ...`);
for (const img of images) extract(sevenZipBin, img, rawDir);

// Layer 3 -- explode the Implode-compressed archives into a C:\TC tree.
const tcDir = join(STAGING, "TC");
console.log("[3/4] Unpacking toolchain archives ...");
for (const [subdir, archive, members] of WANTED) {
  const src = join(rawDir, archive);
  if (!existsSync(src)) {
    throw new Error(
      `Expected ${archive} on the install disks but it wasn't there.\n` +
        `These may not be Turbo C++ 1.01 disks.`,
    );
  }
  extract(sevenZipBin, src, join(tcDir, subdir), members);
}

// BGIDEMO.C rides along in BGI.ZIP; it's sample source, not part of the toolchain.
rmSync(join(tcDir, "BGI", "BGIDEMO.C"), { force: true });

// Layer 4 -- repack as a plain zip the browser can consume. Paths are TC/BIN/...
// so that mounting the archive root as C: yields the conventional C:\TC layout.
console.log("[4/4] Packing fixture ...");
mkdirSync(OUT_DIR, { recursive: true });
rmSync(OUT_ZIP, { force: true });
sevenZip(sevenZipBin, ["a", "-tzip", "-mx9", OUT_ZIP, tcDir]);

const files = walk(tcDir);
const rawBytes = files.reduce((n, f) => n + statSync(f).size, 0);
const zipBytes = statSync(OUT_ZIP).size;
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

console.log(
  `\nWrote ${OUT_ZIP}\n` +
    `  ${files.length} files, ${kb(rawBytes)} raw -> ${kb(zipBytes)} zipped`,
);
