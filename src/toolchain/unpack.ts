import { loadSevenZip, type SevenZip } from "./sevenZip";

/**
 * Turns whatever a user hands over into a working C:\TC tree.
 *
 * The input is deliberately not pinned down. Turbo C++ 1.01 turns up as a .7z of
 * floppy images, as loose Disk0N.img files, as a zip of an already-installed
 * C:\TC, or as a folder someone copied off an old machine. Rather than ask which
 * one it is, containers are expanded repeatedly until nothing is left to expand,
 * and the resulting pile of files is then sorted by what each file *is*. That
 * copes with all four shapes, and with layouts nobody has thought of, without a
 * branch per case.
 */

export interface UnpackProgress {
  stage: string;
  detail?: string;
}

export interface UnpackedToolchain {
  /** A plain zip laid out as TC/BIN, TC/INCLUDE, TC/LIB, TC/BGI. */
  zip: Uint8Array;
  fileCount: number;
  totalBytes: number;
}

/** Anything worth trying to open. Extensions are a hint; 7-Zip sniffs contents. */
const CONTAINER = /\.(7z|zip|img|ima|dsk|cab|arj|lzh|lha|rar|tar|gz|exe)$/i;

/** Programs the build actually invokes. Everything else in BIN is dead weight. */
const WANTED_PROGRAMS = new Set([
  "TCC.EXE", // the compiler
  "TLINK.EXE", // the linker, which TCC shells out to
  "MAKE.EXE",
  "TLIB.EXE",
  "CPP.EXE",
]);

/**
 * Files that must be present or the result is not a usable toolchain. Checked so
 * that someone who feeds in the wrong archive gets told exactly what was missing
 * rather than a compiler error an hour later.
 */
const REQUIRED: { label: string; test: (paths: string[]) => boolean }[] = [
  {
    label: "TCC.EXE (the compiler)",
    test: (p) => p.includes("TC/BIN/TCC.EXE"),
  },
  {
    label: "TLINK.EXE (the linker)",
    test: (p) => p.includes("TC/BIN/TLINK.EXE"),
  },
  {
    label: "a C runtime library (CS.LIB, CL.LIB, …)",
    test: (p) => p.some((x) => /^TC\/LIB\/C[STMCLH]\.LIB$/.test(x)),
  },
  {
    label: "a startup object (C0S.OBJ, C0L.OBJ, …)",
    test: (p) => p.some((x) => /^TC\/LIB\/C0[TSMCLH]\.OBJ$/.test(x)),
  },
  {
    label: "the standard headers (STDIO.H)",
    test: (p) => p.includes("TC/INCLUDE/STDIO.H"),
  },
];

/** Where a given file belongs in the installed tree, or null to discard it. */
function classify(name: string): string | null {
  const upper = name.toUpperCase();

  if (WANTED_PROGRAMS.has(upper)) return "TC/BIN";
  if (upper.endsWith(".H")) return "TC/INCLUDE";
  if (upper.endsWith(".LIB") || upper.endsWith(".OBJ")) return "TC/LIB";
  if (upper.endsWith(".BGI") || upper.endsWith(".CHR")) return "TC/BGI";

  // Everything else — examples, docs, the IDE, the tutorial — is not needed to
  // compile and link, and would only bloat what gets cached.
  return null;
}

/** mkdir -p, since Emscripten's mkdir throws on an existing directory. */
function ensureDir(sevenZip: SevenZip, path: string): void {
  let current = "";
  for (const part of path.split("/").filter(Boolean)) {
    current += `/${part}`;
    try {
      sevenZip.fs.mkdir(current);
    } catch {
      // Already there.
    }
  }
}

/** Every file below `dir`, as absolute paths in the emulated filesystem. */
function walk(sevenZip: SevenZip, dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = sevenZip.fs.readdir(dir);
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (entry === "." || entry === "..") continue;
    const path = `${dir}/${entry}`;
    try {
      const stat = sevenZip.fs.stat(path);
      if (sevenZip.fs.isDir(stat.mode)) walk(sevenZip, path, out);
      else out.push(path);
    } catch {
      // Unreadable entry; skip it rather than abandon the whole scan.
    }
  }
  return out;
}

/** Lets the browser repaint. 7-Zip runs synchronously and would otherwise freeze
 *  the page for the whole extraction with no progress visible. */
const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 0));

export async function unpackToolchain(
  files: File[],
  onProgress: (progress: UnpackProgress) => void = () => {},
): Promise<UnpackedToolchain> {
  if (files.length === 0) throw new Error("No files were given.");

  onProgress({ stage: "Loading 7-Zip…" });
  const sevenZip = await loadSevenZip();

  const WORK = "/work";
  sevenZip.fs.mkdir(WORK);

  onProgress({ stage: "Reading files…" });
  for (const file of files) {
    // Strip any directory component a folder-drop may carry.
    const name = file.name.split(/[\\/]/).pop() || file.name;
    const bytes = new Uint8Array(await file.arrayBuffer());
    sevenZip.fs.writeFile(`${WORK}/${name}`, bytes);
  }

  // Expand containers until none are left. Depth is bounded because the disks
  // nest three deep and a malformed archive should not spin forever.
  const expanded = new Set<string>();
  for (let round = 1; round <= 5; round++) {
    const pending = walk(sevenZip, WORK).filter(
      (path) => CONTAINER.test(path) && !expanded.has(path),
    );
    if (pending.length === 0) break;

    for (const [index, path] of pending.entries()) {
      expanded.add(path);
      const name = path.split("/").pop() ?? path;
      onProgress({
        stage: `Unpacking (pass ${round})`,
        detail: `${name} — ${index + 1} of ${pending.length}`,
      });
      await yieldToUi();

      // -o<dir> has no space before the path, and -y answers every prompt.
      sevenZip.run(["x", path, `-o${path}.d`, "-y"]);
    }
  }

  onProgress({ stage: "Sorting toolchain…" });
  await yieldToUi();

  const collected = new Map<string, Uint8Array>();
  for (const path of walk(sevenZip, WORK)) {
    const name = (path.split("/").pop() ?? path).toUpperCase();
    const destination = classify(name);
    if (!destination) continue;

    const target = `${destination}/${name}`;
    // First writer wins. Duplicates across disks are byte-identical in practice,
    // and preferring the earlier one keeps the result stable.
    if (collected.has(target)) continue;

    try {
      collected.set(target, sevenZip.fs.readFile(path, { encoding: "binary" }));
    } catch {
      // Unreadable file; the required-file check below will catch it if it
      // turns out to have mattered.
    }
  }

  const paths = [...collected.keys()];
  const missing = REQUIRED.filter((item) => !item.test(paths)).map((i) => i.label);
  if (missing.length > 0) {
    throw new Error(
      `Those files don't contain a complete Turbo C++ toolchain.\n\n` +
        `Missing:\n${missing.map((m) => `  • ${m}`).join("\n")}\n\n` +
        `Expected the Turbo C++ 1.01 install disks (a .7z of Disk01–04.img, the ` +
        `.img files themselves, or an installed TC folder). ` +
        `Found ${paths.length} usable file${paths.length === 1 ? "" : "s"}.`,
    );
  }

  onProgress({ stage: "Packing…", detail: `${paths.length} files` });
  await yieldToUi();

  // Written by 7-Zip rather than a JavaScript zip library, because js-dos
  // extracts the bundle into the guest filesystem and needs the archive to
  // contain real directory entries. fflate's zipSync emits file records only, and
  // DOSBox then fails with "TC/INCLUDE: No such file or directory" and comes up
  // with no toolchain at all — a build that simply hangs rather than reporting
  // anything useful.
  const STAGE = "/stage";
  for (const [target, bytes] of collected) {
    const directory = target.slice(0, target.lastIndexOf("/"));
    ensureDir(sevenZip, `${STAGE}/${directory}`);
    sevenZip.fs.writeFile(`${STAGE}/${target}`, bytes);
  }

  // Archive paths are relative to the working directory, giving TC/BIN/... rather
  // than /stage/TC/BIN/...
  sevenZip.fs.chdir(STAGE);
  const OUT = "/toolchain.zip";
  const packLog = sevenZip.run(["a", "-tzip", "-mx6", OUT, "TC"]);

  let zip: Uint8Array;
  try {
    zip = sevenZip.fs.readFile(OUT, { encoding: "binary" });
  } catch {
    throw new Error(`Could not pack the toolchain.\n\n${packLog}`);
  }

  const totalBytes = [...collected.values()].reduce((n, b) => n + b.length, 0);
  return { zip, fileCount: paths.length, totalBytes };
}
