import type { FileSystem, SevenZipModule } from "7z-wasm";
import wasmUrl from "7z-wasm/7zz.wasm?url";

/**
 * 7-Zip, compiled to WebAssembly.
 *
 * This is what lets the browser read the Turbo C++ install disks unaided. Three
 * nested container formats have to be peeled, and the third is the awkward one:
 *
 *   1. .7z          LZMA
 *   2. Disk0N.img   raw FAT12 720K floppy images
 *   3. *.ZIP        PKZIP 1.x, compressed with the legacy "Implode" method
 *
 * No ordinary JavaScript zip library will do. fflate, JSZip, yauzl and the rest
 * implement stored and deflate only, and Implode predates both — PKZIP stopped
 * *writing* it decades ago but these disks were mastered in 1991. Rather than
 * carry a hand-written FAT12 reader plus an Implode decoder, this is the real
 * 7-Zip, which already understands all three.
 *
 * It costs 1.65 MB of wasm, so it is imported dynamically and only ever loaded
 * during first-run setup — never on a normal visit.
 */

export interface SevenZip {
  /** Runs the 7z CLI. Returns everything it printed. Never throws on a non-zero exit. */
  run(args: string[]): string;
  fs: FileSystem;
}

export async function loadSevenZip(): Promise<SevenZip> {
  const { default: createSevenZip } = await import("7z-wasm");

  let output: string[] = [];

  const module: SevenZipModule = await createSevenZip({
    // Vite emits the wasm as a hashed asset, so Emscripten's default
    // "next to the script" lookup would miss it.
    locateFile: () => wasmUrl,
    print: (line: string) => output.push(line),
    printErr: (line: string) => output.push(line),
    // 7-Zip's main() returning would otherwise tear the runtime down, and the
    // filesystem with it. Several archives get extracted in sequence, so the
    // instance has to survive more than one command.
    noExitRuntime: true,
  });

  return {
    fs: module.FS,
    run(args: string[]): string {
      output = [];
      try {
        module.callMain(args);
      } catch (err) {
        // Emscripten signals a normal exit() by throwing. A genuine failure is
        // reported through the captured output and by the caller checking for
        // the files it expected, so nothing useful is lost by not distinguishing
        // them here.
        output.push(String(err));
      }
      return output.join("\n");
    },
  };
}
