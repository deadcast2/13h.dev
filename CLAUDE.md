# Working notes for 13h.dev

A single-page IDE for writing mode 13h VGA graphics in Turbo C++, compiling and
running entirely client-side. See `README.md` for what it is; this file is for
what bites.

## State

Steps 0–5 of 8 are done and committed. It is a working IDE that remembers your
work: supply install disks, edit a multi-file project in Monaco, press Ctrl+B,
watch it run, and come back to it tomorrow.

**Next: step 6, import/export** — getting projects in and out as files. The
stored shape in `src/project/store.ts` was written with this in mind: files are
kept by name with no session-scoped ids in them, so a `StoredProject` minus its
`id` and timestamps is very nearly the export format already.

Then: 7 compiler diagnostics inline, 8 polish.

The build log already carries what step 7 needs — TCC emits
`Error main.c 7: Undefined symbol 'this' in function main`, so file and line are
right there to be parsed into Monaco markers.

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
| `src/App.tsx` | Setup screen or IDE. Lazy-loads the workbench, and with it Monaco. |
| `src/ide/Workbench.tsx` | The IDE frame; owns build state and the one Build action. |
| `src/ide/FileTree.tsx` | File list, create/rename/delete, where 8.3 is enforced. |
| `src/ide/EditorTabs.tsx` | The open set. Closing a tab is not deleting a file. |
| `src/editor/monaco.ts` | Monaco entry points, VGA-palette theme, worker wiring. |
| `src/editor/CodeEditor.tsx` | One model per file, keyed by id; view state per tab. |
| `src/ide/ProjectMenu.tsx` | Switch, create, rename, delete projects. |
| `src/project/useProject.ts` | Live state: files, open tabs, active file. |
| `src/project/useProjects.ts` | Which projects exist and which one is open. |
| `src/project/useAutosave.ts` | Debounced write-back; owns the saved/saving state. |
| `src/project/store.ts` | Projects in IndexedDB. Stored by name, never by id. |
| `src/project/dosNames.ts` | 8.3 validation and the sort order the UI displays. |
| `src/storage/db.ts` | The one IndexedDB connection. Owns the version number. |
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

**Monaco is imported through narrow entry points, not the barrel.**
`edcore.main` is every editing feature and no languages; the C/C++ tokenizer is
added on its own. Importing `monaco-editor` instead drags in the TypeScript,
JSON, HTML and CSS services in an app whose only language is C. Those entry
points ship no `.d.ts`, and `noUncheckedSideEffectImports` rejects an import it
cannot resolve, which is what `src/editor/monaco-esm.d.ts` exists to satisfy.
The worker must be bundled rather than loaded from a CDN — this page is
cross-origin isolated, and COEP blocks third-party scripts outright.

**js-dos needs real directory entries in bundle zips.** `fflate`'s `zipSync` emits
file records only, and DOSBox then reports `TC/INCLUDE: No such file or directory`
and comes up with no toolchain, and the build hangs. The toolchain zip is written
by 7-Zip for this reason.

**Compiler flags live in `TURBOC.CFG`, not the command line.** DOS has a
127-character command-line limit that a project with several source files would
otherwise hit. Even with the flags moved out, the limit is close enough to matter
— roughly eight files at eight characters each — so `buildBat()` measures the
command and throws with a real explanation. COMMAND.COM truncates silently past
127, and the resulting failure is a linker error naming symbols whose source is
sitting right there in the project. If this ever needs lifting, the way is
separate `-c` compile passes and an explicit `TLINK`, not a longer line.

**Only `.C`/`.CPP` go on the command line; headers only go on the disk.** Naming
a header as a translation unit makes TCC compile it standalone and hand the
linker an object file full of nothing. Both still have to be written to `SRC`, or
`#include "VGA.H"` cannot resolve.

**One module owns the IndexedDB version.** The toolchain and the projects share
the `13h.dev` database. Two modules each calling `indexedDB.open` at a version of
their own gets the second a VersionError, or a silent block behind the first, so
both go through `src/storage/db.ts`. Upgrades create only what is missing —
bumping to v2 for projects left an already-cached compiler untouched, which was
verified rather than assumed.

**StrictMode duplicates create-if-missing initialisation.** "No projects yet, so
write a starter" is not idempotent, and StrictMode runs effects twice on purpose:
both passes read an empty store and both write, and the user opens the app to two
identical projects. `useProjects` guards with a ref, which survives the remount.
Any future first-run seeding needs the same treatment.

**Projects are stored by filename, never by file id.** Ids exist so a rename
keeps its Monaco model, and they are handed out by a counter that restarts with
the page. Persisting them would mean either restoring the counter alongside or
issuing duplicates after a reload. Names are already unique and already
validated, so they are the key, and the stored shape stays legible enough to
become the export format.

**Switching projects must re-read from storage.** The workbench autosaves
contents straight to IndexedDB without telling `useProjects`, so the copies in
its `projects` list go stale the moment anything is typed. They are fine for
showing names; handing one back to the workbench would silently revert the
session's work. `withFreshList` exists for this.

**The autosave debounce needs an unmount flush.** Switching projects remounts the
workbench, which cancels the pending timer. Without the flush in the cleanup, the
last few hundred milliseconds of typing before a switch are simply gone —
verified by marking a file and switching away in the same tick.

**`phase` state cannot guard build re-entrancy.** Ctrl+B inside the editor is
handled by Monaco's own binding, and if it also reaches the window listener both
fire in the same tick and both read the pre-render value. Two builds then race,
each booting an emulator — the one thing the design forbids. `Workbench` guards
with a ref, which updates synchronously. Same reasoning applies to any future
"build on save".

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

**Browser automation cannot press keys here.** Synthetic key events arrive with
`event.code` empty and modifiers dropped, so neither the preview's keyboard
(which maps from `code`) nor Ctrl+B can be exercised by clicking through the app.
Typing text into Monaco does work — it goes in as an input event. For the rest,
dispatch a properly-formed `KeyboardEvent` from the console; that still exercises
everything from the app's own listener onward, which is the part worth testing.

## Conventions

- **8.3 filenames are enforced**, not mapped. DOS has no long names, and silently
  rewriting `player_movement.c` to `PLAYER_M.C` would break every `#include`.
- The compiler is never repo content. Users supply their own disks.
- Licensed GPL-2.0-or-later because js-dos embeds DOSBox; serving JS/wasm to a
  browser is distribution. `THIRD-PARTY-NOTICES.md` carries the 7-Zip unRAR
  statement, which is an obligation, not decoration.
- Commit messages explain *why*, and record traps found so they are not
  rediscovered.
