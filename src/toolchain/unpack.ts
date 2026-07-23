import { loadSevenZip, type SevenZip } from "./sevenZip";

/**
 * Turns whatever a user hands over into a working C:\TC tree.
 *
 * The input is deliberately not pinned down. Turbo C++ turns up as a .7z of
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

/**
 * Borland split archives: CMDLINE.CA1, CMDLINE.CA2, HELP.CA1..CA3 and so on.
 *
 * Turbo C++ 3.0 keeps the command-line compiler in these rather than in a plain
 * zip the way 1.01 did, so without handling them everything unpacks except
 * TCC.EXE and TLINK.EXE — which is to say, everything except the compiler.
 *
 * The format turns out to be nothing exotic: a four-byte header followed by raw
 * zip data, cut across however many parts it takes to span the disks. Strip the
 * headers, concatenate in numeric order, and an ordinary zip falls out. Verified
 * against all three sets on the 3.0 disks.
 */
const SPLIT_PART = /^(.*)\.CA(\d+)$/i;

/** Bytes of Borland header before the zip payload begins. */
const SPLIT_HEADER_BYTES = 4;

/** Programs the build actually invokes. Everything else in BIN is dead weight. */
const WANTED_PROGRAMS = new Set([
  "TCC.EXE", // the compiler
  "TLINK.EXE", // the linker, which TCC shells out to
  "MAKE.EXE",
  "TLIB.EXE",
  "CPP.EXE",
  // Not on any Turbo C++ disk — it was a separate product — but kept if supplied.
  // Turbo C++ 1.01 hands inline asm to an external assembler, so without this a
  // program containing an `asm` block fails with "Unable to execute command
  // 'tasm.exe'". 3.0's built-in assembler makes it unnecessary there.
  "TASM.EXE",

  // Turbo C++ 3.0's compiler runs in protected mode and refuses to start without
  // its DPMI server: "Failed to locate DPMI server (DPMI16BI.OVL)". 1.01's is a
  // plain real-mode program and needs none of this.
  "DPMI16BI.OVL",
  "DPMILOAD.EXE",
  "DPMIMEM.DLL",
  "DPMIRES.EXE",
  "DPMIINST.EXE",
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

/**
 * Joins Borland split archives into ordinary zips, returning how many it made.
 *
 * Parts are grouped by name across the *whole* tree rather than per directory,
 * because they are deliberately spread over different floppies — on the 3.0
 * disks CMDLINE.CA2 is on disk 1 and CMDLINE.CA1 is on disk 3, so by the time
 * the images have been extracted the two halves sit in different folders.
 */
function joinSplitArchives(
  sevenZip: SevenZip,
  root: string,
  alreadyJoined: Set<string>,
): number {
  const groups = new Map<string, { index: number; path: string }[]>();

  for (const path of walk(sevenZip, root)) {
    const name = path.split("/").pop() ?? path;
    const match = SPLIT_PART.exec(name);
    if (!match) continue;

    const base = match[1].toUpperCase();
    if (alreadyJoined.has(base)) continue;
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base)!.push({ index: Number(match[2]), path });
  }

  let made = 0;
  for (const [base, parts] of groups) {
    parts.sort((a, b) => a.index - b.index);

    const chunks: Uint8Array[] = [];
    for (const [position, part] of parts.entries()) {
      let bytes: Uint8Array;
      try {
        bytes = sevenZip.fs.readFile(part.path, { encoding: "binary" });
      } catch {
        continue;
      }
      chunks.push(bytes.subarray(payloadStart(bytes, position === 0)));
    }
    if (chunks.length === 0) continue;

    const total = chunks.reduce((n, c) => n + c.length, 0);
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }

    // Named .zip so the ordinary container pass picks it up next round.
    sevenZip.fs.writeFile(`${root}/${base}.joined.zip`, joined);
    alreadyJoined.add(base);
    made++;
  }

  return made;
}

/**
 * Where the zip payload starts within a split part. For the first part this is
 * found by looking for the local-file signature rather than trusting the
 * four-byte constant; continuation parts have no signature to look for.
 */
function payloadStart(bytes: Uint8Array, isFirst: boolean): number {
  if (!isFirst) return SPLIT_HEADER_BYTES;

  for (let offset = 0; offset <= 32 && offset + 3 < bytes.length; offset++) {
    if (
      bytes[offset] === 0x50 && // P
      bytes[offset + 1] === 0x4b && // K
      bytes[offset + 2] === 0x03 &&
      bytes[offset + 3] === 0x04
    ) {
      return offset;
    }
  }
  return SPLIT_HEADER_BYTES;
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
  const joined = new Set<string>();
  for (let round = 1; round <= 6; round++) {
    // Split parts only become visible once the disk images have been opened, so
    // this runs every round rather than once up front.
    const newlyJoined = joinSplitArchives(sevenZip, WORK, joined);

    const pending = walk(sevenZip, WORK).filter(
      (path) => CONTAINER.test(path) && !expanded.has(path),
    );
    if (pending.length === 0 && newlyJoined === 0) break;

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
        `Expected Turbo C++ 1.01 or 3.0 install disks (a .7z of the disk images, ` +
        `the .img files themselves, or an installed TC folder). ` +
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
