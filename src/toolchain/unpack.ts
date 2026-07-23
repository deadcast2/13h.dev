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

/**
 * Anything worth trying to open. Extensions are a hint; 7-Zip sniffs contents.
 *
 * `.pak` is Turbo Assembler's, and is the fourth container format this has had
 * to learn. It turns out to be plain LHA — `-lh5-` four bytes in — which 7-Zip
 * has read all along; the extension was the only thing standing in the way. Its
 * absence meant a TASM 5.0 drop unpacked to a heap of .PAK files and no
 * assembler, with nothing to say why.
 */
const CONTAINER = /\.(7z|zip|img|ima|dsk|cab|arj|lzh|lha|pak|rar|tar|gz|exe)$/i;

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
  // 'tasm.exe'". 3.0's built-in assembler covers inline asm but not a standalone
  // .ASM file, which goes to TASM on both versions.
  "TASM.EXE",
  // TASM's DPMI-extended twin, for sources too big for the real-mode one. TCC
  // never calls it, but it costs little and is the documented escape hatch.
  "TASMX.EXE",

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

/**
 * Finding one of these in a tree marks that tree as an assembler drop.
 *
 * Turbo Assembler 5.0 also ships TLINK.EXE, MAKE.EXE and TLIB.EXE — all of them
 * things `classify` wants — and its TLINK is from 1996 against a compiler from
 * 1990. Whichever copy won used to depend on the order files came off the drop,
 * which is no way to decide which linker someone's builds go through.
 */
const ASSEMBLER_MARKERS = new Set(["TASM.EXE", "TASMX.EXE"]);

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

const WORK = "/work";
const STAGE = "/stage";

/** Which of the dropped inputs a file ultimately came from. */
function provenance(path: string): string {
  const relative = path.startsWith(`${WORK}/`) ? path.slice(WORK.length + 1) : path;
  return relative.split("/")[0] ?? "";
}

function exists(sevenZip: SevenZip, path: string): boolean {
  try {
    sevenZip.fs.stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Expands everything that was dropped and returns the files worth keeping,
 * keyed by where they belong in the installed tree.
 */
async function collect(
  sevenZip: SevenZip,
  files: File[],
  onProgress: (progress: UnpackProgress) => void,
): Promise<Map<string, Uint8Array>> {
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

  onProgress({ stage: "Sorting toolchain…" });
  await yieldToUi();

  // Gathered before anything is chosen, because which tree a duplicate should
  // come from cannot be known until every tree has been seen.
  const candidates = new Map<string, { path: string; root: string }[]>();
  const assemblerRoots = new Set<string>();

  for (const path of walk(sevenZip, WORK)) {
    const name = (path.split("/").pop() ?? path).toUpperCase();
    const destination = classify(name);
    if (!destination) continue;

    const root = provenance(path);
    if (ASSEMBLER_MARKERS.has(name)) assemblerRoots.add(root);

    const target = `${destination}/${name}`;
    if (!candidates.has(target)) candidates.set(target, []);
    candidates.get(target)!.push({ path, root });
  }

  const collected = new Map<string, Uint8Array>();
  for (const [target, options] of candidates) {
    // A file the assembler also supplies is only taken when nothing else
    // supplied it — so TASM.EXE comes through, and TLINK.EXE stays the
    // compiler's. Among equals the first wins: duplicates across the disks of
    // one product are byte-identical in practice.
    const chosen = options.find(({ root }) => !assemblerRoots.has(root)) ?? options[0];

    try {
      collected.set(target, sevenZip.fs.readFile(chosen.path, { encoding: "binary" }));
    } catch {
      // Unreadable file; the required-file check will catch it if it mattered.
    }
  }

  return collected;
}

/** Zips whatever is staged, and measures it. */
function packStage(sevenZip: SevenZip): UnpackedToolchain {
  // Archive paths are relative to the working directory, giving TC/BIN/... rather
  // than /stage/TC/BIN/...
  sevenZip.fs.chdir(STAGE);
  const OUT = "/toolchain.zip";
  // Written by 7-Zip rather than a JavaScript zip library, because js-dos
  // extracts the bundle into the guest filesystem and needs the archive to
  // contain real directory entries. fflate's zipSync emits file records only, and
  // DOSBox then fails with "TC/INCLUDE: No such file or directory" and comes up
  // with no toolchain at all — a build that simply hangs rather than reporting
  // anything useful.
  const packLog = sevenZip.run(["a", "-tzip", "-mx6", OUT, "TC"]);

  let zip: Uint8Array;
  try {
    zip = sevenZip.fs.readFile(OUT, { encoding: "binary" });
  } catch {
    throw new Error(`Could not pack the toolchain.\n\n${packLog}`);
  }

  const staged = walk(sevenZip, STAGE);
  const totalBytes = staged.reduce((n, path) => {
    try {
      return n + sevenZip.fs.stat(path).size;
    } catch {
      return n;
    }
  }, 0);

  return { zip, fileCount: staged.length, totalBytes };
}

function writeToStage(sevenZip: SevenZip, target: string, bytes: Uint8Array): void {
  const directory = target.slice(0, target.lastIndexOf("/"));
  ensureDir(sevenZip, `${STAGE}/${directory}`);
  sevenZip.fs.writeFile(`${STAGE}/${target}`, bytes);
}

export async function unpackToolchain(
  files: File[],
  onProgress: (progress: UnpackProgress) => void = () => {},
): Promise<UnpackedToolchain> {
  if (files.length === 0) throw new Error("No files were given.");

  onProgress({ stage: "Loading 7-Zip…" });
  const sevenZip = await loadSevenZip();
  const collected = await collect(sevenZip, files, onProgress);

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

  for (const [target, bytes] of collected) writeToStage(sevenZip, target, bytes);
  return packStage(sevenZip);
}

export interface ToolchainAddition extends UnpackedToolchain {
  /** What the drop actually contributed, as TC/BIN/TASM.EXE and the like. */
  added: string[];
}

/**
 * Merges more files into a toolchain that is already installed.
 *
 * The assembler was never on the Turbo C++ disks, so wanting it later is the
 * normal case rather than an afterthought — and without this the only route to
 * it is to discard the compiler and supply everything over again.
 *
 * What is already installed always wins. That keeps the compiler paired with the
 * linker it was verified against no matter what a later drop contains, and makes
 * adding the same archive twice a no-op rather than a coin toss.
 */
export async function addToToolchain(
  files: File[],
  existingZip: Uint8Array,
  onProgress: (progress: UnpackProgress) => void = () => {},
): Promise<ToolchainAddition> {
  if (files.length === 0) throw new Error("No files were given.");

  onProgress({ stage: "Loading 7-Zip…" });
  const sevenZip = await loadSevenZip();
  const collected = await collect(sevenZip, files, onProgress);

  onProgress({ stage: "Merging…" });
  await yieldToUi();

  const EXISTING = "/existing.zip";
  sevenZip.fs.writeFile(EXISTING, existingZip);
  const extractLog = sevenZip.run(["x", EXISTING, `-o${STAGE}`, "-y"]);
  if (!exists(sevenZip, `${STAGE}/TC`)) {
    throw new Error(`Could not read the installed toolchain.\n\n${extractLog}`);
  }

  const added: string[] = [];
  for (const [target, bytes] of collected) {
    if (exists(sevenZip, `${STAGE}/${target}`)) continue;
    writeToStage(sevenZip, target, bytes);
    added.push(target);
  }

  if (added.length === 0) {
    throw new Error(
      "Nothing new was found in those files.\n\n" +
        "Everything usable in them is already installed. If you were adding an " +
        "assembler, check that the drop really contains TASM.EXE — Turbo " +
        "Assembler 5.0 keeps it in CMD16.PAK, on the third disk.",
    );
  }

  onProgress({ stage: "Packing…", detail: `${added.length} new files` });
  await yieldToUi();

  return { ...packStage(sevenZip), added };
}
