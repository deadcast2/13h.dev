# Working notes for 13h.dev

A single-page IDE for writing mode 13h VGA graphics in Turbo C++, compiling and
running entirely client-side. See `README.md` for what it is; this file is for
what bites.

## State

Steps 0–3 of 8 are done and committed. The pipeline works end to end: supply
install disks, compile a mode 13h program with the real `TCC.EXE`, watch it run.

**Next: step 4, the Monaco editor shell** — real editing, multi-file tabs, a file
tree, Build wired to the existing pipeline. `src/App.tsx` is currently a spike
page with a single hardcoded sample; it is meant to be replaced.

Then: 5 project model + IndexedDB persistence, 6 import/export, 7 compiler
diagnostics inline, 8 polish.

## Commands

```bash
npm run dev        # stages emulator assets, then vite
npm run typecheck
npm run build
```

There is no test suite. Verification has been done by driving the real app in a
browser and reading pixels back off the canvas.

## Layout

| Path | Role |
| --- | --- |
| `src/toolchain/unpack.ts` | Disks → `C:\TC` tree. Expands containers until none remain, then sorts files by type. |
| `src/toolchain/sevenZip.ts` | 7-Zip wasm loader. Dynamically imported; 1.65 MB. |
| `src/toolchain/store.ts` | IndexedDB cache of the unpacked toolchain. |
| `src/toolchain/SetupPane.tsx` | First-run drop zone. |
| `src/build/turboc.ts` | Runs `TCC.EXE` in a headless DOSBox, reads back log + `.EXE`. |
| `src/run/runner.ts` | Runs the built `.EXE` in a visible DOSBox, paints to canvas. |
| `src/dos/emulatorLock.ts` | Serialises all emulator create/destroy. |
| `src/dos/initFs.ts` | Copies buffers on the way into an emulator. |
| `src/dos/keyCodes.ts` | `KeyboardEvent.code` → GLFW key codes. |

## Traps

Every one of these cost real debugging time. They are load-bearing.

**`fsReadFile` on a missing path never settles.** It neither resolves nor rejects,
so `await` hangs forever and `try/catch` cannot help. Always establish existence
via `fsTree()` first. See `listFiles()` in `turboc.ts`.

**Buffers handed to an emulator are transferred, not copied.** The underlying
`ArrayBuffer` is detached on our side — length goes to 0, reuse throws
`ArrayBuffer at index 0 is already detached`. Everything going into `initFs` must
go through `copyForEmulator()`. This bites on any second use: Restart, rebuild, a
cached toolchain reused across builds.

**DOSBox only emits a frame for lines that change.** A program that draws once and
waits for a key produces a completely static screen. The emulator becomes ready
only *after* `[autoexec]` has started, so a program routinely finishes drawing
before anything is subscribed to `onFrame`, and then no frame is ever sent — black
canvas, status "running", no error. `runner.ts` seeds from `ci.screenshot()` until
live frames arrive. Do not remove that.

**Frame dimensions are not settled at boot.** `ci.width()`/`height()` do not
reflect the real video mode until the emulator has run a while, and `onFrameSize`
does not fire for the size already in effect when it becomes ready. Dimensions are
re-read *per frame*; caching them at startup means every frame fails the length
check and nothing paints.

**`TCC` shells out to `TLINK` by bare name.** `C:\TC\BIN` must be on the DOS
`PATH` or compiling succeeds and linking fails with a message pointing nowhere
near the cause.

**js-dos needs real directory entries in bundle zips.** `fflate`'s `zipSync` emits
file records only, and DOSBox then reports `TC/INCLUDE: No such file or directory`
and comes up with no toolchain, and the build hangs. The toolchain zip is written
by 7-Zip for this reason.

**Compiler flags live in `TURBOC.CFG`, not the command line.** DOS has a
127-character command-line limit that a project with several source files would
otherwise hit.

**Only one emulator at a time.** Each is a worker holding a 1.4 MB wasm module and
a 16 MB machine. `runProgram()` stops the previous one and starts the next as a
single unit on `emulatorLock`. Never call `emulatorLock.run()` from inside a task
already on it — it deadlocks. That is why `boot()`/`shutdown()` are unlocked and
only the `runProgram`/`stopProgram` wrappers take the lock.

## Turbo C++ versions

Both 1.01 and 3.0 work. Same flags, same `TURBOC.CFG`, same `C0x.OBJ`/`Cx.LIB`
naming. Differences that matter:

- **1.01 cannot assemble inline `asm`.** It emits `.ASM` and shells out to TASM,
  which is on none of the disks. Workaround: pseudo-registers (`_AX`, `_AH`, …)
  with `geninterrupt()`, or `int86()` — compiler intrinsics needing no assembler.
- **3.0 has a built-in assembler**, so inline `asm` just works. Prefer it.
- **3.0's compiler is a DPMI application.** It needs the DPMI runtime from
  `BIN.ZIP` (`DPMI16BI.OVL`, `DPMILOAD.EXE`, …) and XMS enabled, or it fails with
  `Failed to locate DPMI server`.
- **3.0 keeps the compiler in `CMDLINE.CA1`/`.CA2`** — Borland split archives: a
  four-byte header plus raw zip data, concatenated in numeric order. Parts are
  spread across different disks, so they must be matched by name across the whole
  tree, not per directory.

## Verification

Do not trust that a canvas looks right. Step 2 was declared working when the image
on screen had been painted by an emulator that was then torn down — stopping does
not clear the canvas, so a dead emulator's leftovers looked exactly like success.

**Check liveness separately from correctness.** Confirm frames are actually
arriving, not only that the pixels are right.

Reading pixels back beats screenshots: the sample program writes colour `x ^ y`,
so values are checkable against the default VGA palette — `(1,0)` blue
`0,0,170`, `(2,0)` green `0,170,0`, `(4,0)` red `170,0,0`, `(5,5)` black on the
XOR diagonal. A correct run gives 320x200, 246 distinct colours, 61808 non-black
pixels.

In dev, `import("/src/build/turboc.ts")` from the browser console works and is the
quickest way to compile arbitrary source without touching the UI.

## Conventions

- **8.3 filenames are enforced**, not mapped. DOS has no long names, and silently
  rewriting `player_movement.c` to `PLAYER_M.C` would break every `#include`.
- The compiler is never repo content. Users supply their own disks.
- Licensed GPL-2.0-or-later because js-dos embeds DOSBox; serving JS/wasm to a
  browser is distribution. `THIRD-PARTY-NOTICES.md` carries the 7-Zip unRAR
  statement, which is an obligation, not decoration.
- Commit messages explain *why*, and record traps found so they are not
  rediscovered.
