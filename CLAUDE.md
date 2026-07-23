# Working notes for 13h.dev

A single-page IDE for writing mode 13h VGA graphics in Turbo C++, compiling and
running entirely client-side. See `README.md` for what it is; this file is for
what bites.

## State

Steps 0–6 of 8 are done and committed. It is a working IDE that remembers your
work and lets you take it with you: supply install disks, edit a multi-file
project in Monaco, press Ctrl+B, watch it run, come back to it tomorrow, and
export it to a file when you want it in another browser.

**All eight steps are done.** What follows is maintenance and whatever the next
idea turns out to be.

Diagnostics land as Monaco markers and as a clickable list beside the log.
`BuildResult` now carries `diagnostics` alongside `hint` and `log`: the log is
TCC's own words, `hint` explains a failure the compiler reports accurately but
obscurely, and `diagnostics` is our reading of where each one points. All three
sit beside each other rather than competing.

Assembly works end to end as of the last session, given a TASM. That is the most
recently exercised path and the least covered by anything written down, so treat
it as the thing most likely to break unnoticed.

## Commands

```bash
npm run dev        # stages emulator assets, then vite
npm run typecheck
npm test           # vitest, node environment, ~0.4s
npm run test:watch
npm run build
```

**The suite covers pure logic, storage, and the concurrency traps.** 169 tests:

| File | What it holds down |
| --- | --- |
| `build/commandLine.test.ts` | Which files reach TCC; the 127-character limit, from both sides. |
| `build/diagnostics.test.ts` | Three tools' message formats, against real captured logs. |
| `project/dosNames.test.ts` | Every 8.3 rejection, device names, sort order. |
| `project/transfer.test.ts` | Export round trip; every case an import refuses. |
| `project/store.test.ts` | The two-writer merge, against real IndexedDB semantics. |
| `project/useAutosave.test.ts` | Debounce, unmount flush, and which fields it writes. |
| `project/useProjects.test.ts` | StrictMode seeding, import, delete, storage failure. |
| `dos/emulatorLock.test.ts` | That two emulators can never be live at once. |

Node by default; the two hook files opt into jsdom with a `@vitest-environment`
docblock. Storage tests run against `fake-indexeddb` rather than a hand-written
double, because transaction semantics are the entire subject and a double would
have to reimplement them to be worth anything.

**Still outside it, and deliberately:** the emulator itself, the canvas, Monaco,
and anything that claims a program ran. A fake for those would pass while the
app was broken. Those are verified by driving the real app; see Verification.
Also outside it: `Workbench`'s build re-entrancy ref, which would need Monaco,
the runner and the preview pane all mocked to reach — the trap is real, the test
for it would be mostly scaffolding.

## Layout

| Path | Role |
| --- | --- |
| `src/App.tsx` | Setup screen or IDE. Lazy-loads the workbench, and with it Monaco. |
| `src/ide/Workbench.tsx` | The IDE frame; owns build state and the one Build action. |
| `src/ide/FileTree.tsx` | File list, create/rename/delete, where 8.3 is enforced. |
| `src/ide/EditorTabs.tsx` | The open set. Closing a tab is not deleting a file. |
| `src/editor/monaco.ts` | Monaco entry points, VGA-palette theme, worker wiring. |
| `src/editor/asmLanguage.ts` | Monarch grammar for TASM/MASM; Monaco ships none. |
| `src/editor/CodeEditor.tsx` | One model per file, keyed by id; view state per tab. |
| `src/ide/ProjectMenu.tsx` | Switch, create, rename, delete projects. |
| `src/project/useProject.ts` | Live state: files, open tabs, active file. |
| `src/project/useProjects.ts` | Which projects exist and which one is open. |
| `src/project/useAutosave.ts` | Debounced write-back; owns the saved/saving state. |
| `src/project/store.ts` | Projects in IndexedDB. Stored by name, never by id. |
| `src/project/transfer.ts` | The `.13h.json` export format, its reader, and the download. |
| `src/project/dosNames.ts` | 8.3 validation and the sort order the UI displays. |
| `src/storage/db.ts` | The one IndexedDB connection. Owns the version number. |
| `src/toolchain/unpack.ts` | Disks → `C:\TC` tree. Expands containers until none remain, then sorts files by type. `addToToolchain` merges into an installed one. |
| `src/toolchain/DiskDropZone.tsx` | The drop target, shared by setup and additions. |
| `src/toolchain/AddToolsDialog.tsx` | Adding an assembler without re-supplying the compiler. |
| `src/toolchain/sevenZip.ts` | 7-Zip wasm loader. Dynamically imported; 1.65 MB. |
| `src/toolchain/store.ts` | IndexedDB cache of the unpacked toolchain. |
| `src/toolchain/SetupPane.tsx` | First-run drop zone. |
| `src/build/commandLine.ts` | What TCC is told to build. Pure, and therefore tested. |
| `src/build/diagnostics.ts` | Reads errors out of the build log. Three formats, one shape. |
| `src/ide/DiagnosticList.tsx` | The clickable list; the way back to a file you aren't in. |
| `src/ide/ShortcutsDialog.tsx` | What the keyboard does — mostly Monaco's, and otherwise invisible. |
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

**Calling assembly from C++ needs `extern "C"`.** TCC compiles `.CPP` as C++,
which mangles names, so a plain `extern void far setmode(int);` in a `.CPP` file
has TLINK hunting for a mangled symbol while the `.OBJ` exports `_setmode`. The
error names the C++ signature — `Undefined symbol setmode(int) in module
main.cpp` — which is the clue. The same applies to anything in a `.C` file called
from a `.CPP` one. Worth remembering that book listings of this vintage are often
C++ purely because they were `.CPP`: a declaration inside a `for` init is C99 or
C++, and never legal in the C89 that TCC's C mode implements.

**A hand-written `.ASM` needs `.MODEL`, `.CODE`, `PUBLIC` and `END`.** Without a
segment declared, TASM reports `Code or data emission to undeclared segment`
against every instruction line and nothing else; without `END` it finishes with
`Unexpected end of file encountered`. `.MODEL` must match the memory model in
`turboc.ts`, which defaults to large — and large is also what makes a bare `PROC`
default to `FAR`, as a large-model C call requires.

**Monaco is imported through narrow entry points, not the barrel.**
`edcore.main` is every editing feature and no languages; the C/C++ tokenizer is
added on its own. Importing `monaco-editor` instead drags in the TypeScript,
JSON, HTML and CSS services in an app whose only language is C. Those entry
points ship no `.d.ts`, and `noUncheckedSideEffectImports` rejects an import it
cannot resolve, which is what `src/editor/monaco-esm.d.ts` exists to satisfy.
The worker must be bundled rather than loaded from a CDN — this page is
cross-origin isolated, and COEP blocks third-party scripts outright.

**Turbo Assembler's `.PAK` files are LHA.** `-lh5-` four bytes in, and 7-Zip has
read the format all along — including the wasm build, checked directly. The
extension simply wasn't in `CONTAINER`, so a TASM 5.0 drop unpacked to a heap of
`.PAK` files and no assembler, with nothing to say why. `TASM.EXE` and
`TASMX.EXE` live in `CMD16.PAK` on disk 3; `TASM.EXE` reports itself as version
4.1 even in the 5.0 package, because 5.0 is the 32-bit assembler's version.

**Turbo Assembler also ships TLINK, MAKE and TLIB.** All three are things
`classify()` wants, and TASM 5.0's TLINK is from 1996 against a compiler from
1990. Which copy won used to fall out of traversal order — that is, out of which
file the user happened to drop first. The rule now: a tree containing
`TASM.EXE`/`TASMX.EXE` is an assembler drop, and a file it provides is taken only
when nothing else provided it. `addToToolchain` gets the same outcome from the
other direction by letting what is already installed win. Confirmed in a real
build: TASM 4.1 assembles and TLINK **3.01** links.

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

**`.C`, `.CPP` and `.ASM` go on the command line; `.H` and `.INC` only go on the
disk.** Naming a header as a translation unit makes TCC compile it standalone and
hand the linker an object file full of nothing. All of them still have to be
written to `SRC`, or `#include "VGA.H"` cannot resolve.

**A silently ignored file is worse than a rejected one.** `.ASM` used to pass
name validation, appear in the tree, get written to the build directory, and
then never reach the compiler — the EXE came out byte-identical to a build
without it. Anything the project accepts must either be built or visibly
accounted for. `BuildResult.hint` is the channel for the second case: an
explanation shown beside the log, never spliced into it, because the log is
TCC's own words. Step 7's diagnostics should sit alongside it rather than
rewrite it.

**TLINK writes the executable and *then* reports undefined symbols.** So a
program calling a function that does not exist produces a MAIN.EXE — measured at
exactly 4,937 bytes, the same as the working version of the same program — and
the build used to report success and run it. "The executable exists" was the
whole test for a working build, on the reasoning that reading the log would mean
guessing at TCC's phrasing. That reasoning was sound until there was a parser
for the log; `ok` is now `exe exists && no error diagnostics`, and `executable`
is withheld when it is false, because what a failed link leaves behind is debris
rather than a program. Compile errors were never affected — those produce no EXE
at all — which is why this went unnoticed.

**Three tools write to the build log and none of them agree on a format.**
`Error main.c 5: msg` from TCC, `Error: msg` with no line from TLINK, and
`**Error** clear.ASM(2) msg` from TASM. TASM's summary lines (`Error messages:
4`) begin with a severity word and are not diagnostics; the assembler pattern is
tested first partly to keep them out. Everything in `diagnostics.test.ts` is a
real log captured from a real failing build, because all three formats were
discovered by reading actual output — a fixture written from memory would test
the parser against the same guess that produced it.

**The compiler lower-cases the filenames it echoes and the assembler does not.**
A project holding `MAIN.C` and `CLEAR.ASM` is told about `main.c` and
`clear.ASM` in the same build, and an error inside an included header names the
header as given — `Error VGA.H 3: ) expected`. Matching a diagnostic to a
project file is therefore always case-insensitive; that is what `locate()` is
for. Comparing exactly puts markers on nothing at all.

**A reported line can be past the end of the file.** TASM's "Unexpected end of
file encountered" lands one line beyond the last, so a 5-line file gets a
diagnostic at line 6. Monaco is given a clamped line; the list still displays
what the tool said. The list reports the tool, the marker points somewhere that
exists, and neither lies about the other.

**A module exporting a component and a plain function cannot be hot-reloaded.**
`diagnosticSummary` sat next to `DiagnosticList` for exactly as long as it took
to notice Vite logging `Could not Fast Refresh ("diagnosticSummary" export is
incompatible)` on every edit to that file. Pure helpers go in a module of their
own — this one belonged in `diagnostics.ts` with the rest of the logic over
diagnostics anyway. Worth watching for whenever a `.tsx` file starts exporting
something that is not a component.

**Only the editor column is fractional, so only the editor shrinks.** Both side
panes are fixed widths, which means a narrow window takes its width from the one
column that can least afford it: at 900px the editor was down to 293px, about 35
columns of C, while the output pane still had 384. There are now two
breakpoints — the sides narrow at 1180px, and below 940px the output pane moves
under the editor instead of beside it. If a fourth pane is ever added, give it
the same treatment rather than another fixed column.

**Monaco's bindings are real but invisible.** The editor arrived with a command
palette, find and replace, multi-cursor and line-moving already in it, and
nothing in the interface said so. `ShortcutsDialog` is the only place that does.
Every binding listed there was checked against `editor.getAction(id)` in the
running app before being written down — this build imports `edcore.main` rather
than the barrel, so what is present is not a given, and a reference that lists a
shortcut which does nothing is worse than no reference.

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

**Two things write to a project, and they must never write the same fields.**
The workbench owns the contents and autosaves them continuously; `useProjects`
owns the name and which project was opened last. Both used to write the whole
record, each built from a read taken moments earlier, so either could quietly
undo the other — renaming could restore file contents from before the last few
keystrokes, and opening a project could do the same. Whole-record `saveProject`
is now only for creating one; everything else goes through `updateProject`,
which merges a patch inside a single transaction. If a third writer ever
appears, give it its own fields.

That the fields are disjoint is what makes it correct; the transaction is what
makes it atomic. `withStore` covers one request and cannot express
read-modify-write, hence `withTransaction` — and note that awaiting anything
that isn't an IndexedDB request inside one lets the transaction auto-commit out
from under the remaining work, which is why it hands out `resolve`/`reject`
instead of taking an async function.

The copies in `useProjects`'s list still go stale the moment anything is typed.
They are fine for showing names, and `withFreshList` keeps them honest, but
never hand one back to the workbench as the current project — take what
`updateProject` returns, which came from the store.

**The autosave debounce needs an unmount flush.** Switching projects remounts the
workbench, which cancels the pending timer. Without the flush in the cleanup, the
last few hundred milliseconds of typing before a switch are simply gone —
verified by marking a file and switching away in the same tick.

**Export reads the live snapshot, never `stored`.** `Workbench`'s `stored` prop
is the record it was mounted with, and autosave has been writing over that copy
in IndexedDB ever since. Building the export from it hands back the project as
it was when it was opened, missing everything typed since — silently, in a file
whose entire purpose is to be the copy that survives. `project.snapshot` is the
live one. Its `name` is the exception and does come from `stored`: renaming goes
through `useProjects`, which updates `current`, and the workbench is keyed by id
so it re-renders rather than remounting.

**An import is a new project, never a merge.** Filenames in an export belong to
the project that wrote it, and there is no answer worth guessing for two
differing `MAIN.C`s. `importFrom` is also the one mutation in `useProjects` that
deliberately skips `withFreshList`: it has somewhere useful to go when storage
fails — leaving the imported project open in memory — which is exactly the case
a private-mode user needs.

**Two small browser details in `downloadText`.** The anchor must be in the
document for Firefox to honour a synthetic click, and the object URL must
outlive the click — revoking in the same tick cancels the download in Chrome,
which only shows up on a fast machine. And a file input keeps its value, so
picking the same file twice in a row fires no second `change` event; the value
is cleared in the handler, because re-importing after a mistake is the obvious
thing to try.

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
  A standalone `.ASM` file goes to TASM on *both* versions: 3.0's built-in
  assembler handles inline `asm` only. Confirmed on 1.01 — `TCC ... CLEAR.ASM`
  gets as far as `clear.asm:` and then `Error: Unable to execute command
  'tasm.exe'`, the same message inline `asm` produces.
- **3.0 has a built-in assembler**, so inline `asm` just works. Prefer it.
- **3.0's compiler is a DPMI application.** It needs the DPMI runtime from
  `BIN.ZIP` (`DPMI16BI.OVL`, `DPMILOAD.EXE`, …) and XMS enabled, or it fails with
  `Failed to locate DPMI server`.
- **3.0 keeps the compiler in `CMDLINE.CA1`/`.CA2`** — Borland split archives: a
  four-byte header plus raw zip data, concatenated in numeric order. Parts are
  spread across different disks, so they must be matched by name across the whole
  tree, not per directory.

## Verification

**Two kinds, and they do not substitute for each other.** `npm test` owns the
rules and the timing — see the table under Commands. Everything involving an
emulator, a worker, a canvas or Monaco is verified by driving the real app,
because it cannot honestly be verified any other way. A fake for those would
pass while the app was broken, which is worse than no coverage at all.

**Every test here was mutation-checked before it was believed**, and anything
added should be too. What has been confirmed to turn the suite red:

| Break this | Red |
| --- | --- |
| Drop `asm` from `TRANSLATION_UNIT` | 2 |
| Move `DOS_COMMAND_LIMIT` by one | 3 |
| `updateProject` as read-modify-write outside a transaction | 3 |
| Remove `useAutosave`'s unmount flush | 1 |
| Let autosave write `name` alongside its own fields | 1 |
| Remove the `initialised` guard in `useProjects` | 3 |
| Make `emulatorLock.run` call its task immediately | 3 |

That last set is worth reading: without the guard the failures are *two
identical starter projects*, which is exactly the symptom the trap describes. A
test that has never been seen to fail is decoration.

After changing anything on the build path, compile the starter project for real.
The refactor that split `commandLine.ts` out of `turboc.ts` was accepted only
once a live build still produced the same 9,201-byte EXE.

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

**Install disks can be supplied without a file picker.** Vite serves the project
root, and the `.7z` archives sit there (gitignored by `*.7z`), so setup and
toolchain paths can be driven entirely from the console:

```js
const res = await fetch("/Borland Turbo Assembler 5.0 (3.5-1.44mb).7z");
const file = new File([await res.blob()], "tasm.7z");
const { addToToolchain } = await import("/src/toolchain/unpack.ts");
```

Feeding the real UI instead means building a `DataTransfer`, assigning it to the
dialog's hidden `input.files`, and dispatching a bubbling `change` — which is
what actually exercises React's handler. Both were used to verify the assembler
addition; neither needs the disks re-supplied by hand.

The same `DataTransfer` trick drives import, against
`.project-menu input[type=file]`. Export goes the other way: wrap
`URL.createObjectURL` to keep the `Blob` and replace
`HTMLAnchorElement.prototype.click` to read the filename off the anchor, then
click the button — that reads the file back without it ever reaching the disk.
Stub `window.alert` while doing it, or the first bad import blocks the page.
Step 6 was verified this way end to end: edit a model, export, close a tab,
re-export, import the captured JSON through the real input, reload, build the
imported project, and read the canvas back — 320x200, 246 colours, 61808
non-black. Note that `import()`
returns whatever the dev server last served, so reload the page after editing a
module or the console will keep handing back the old one.

**Browser automation cannot press keys here.** Synthetic key events arrive with
`event.code` empty and modifiers dropped, so neither the preview's keyboard
(which maps from `code`) nor Ctrl+B can be exercised by clicking through the app.
Typing text into Monaco does work — it goes in as an input event. For the rest,
dispatch a properly-formed `KeyboardEvent` from the console; that still exercises
everything from the app's own listener onward, which is the part worth testing.

Two more things about driving it that way. `javascript_tool` gives up after 30
seconds, so a script that waits on more than one build has to be split across
calls. And when the browser pane is not being displayed the page stops
compositing: Monaco renders nothing and `innerText` comes back empty, which
looks exactly like a broken editor. `import("/src/editor/monaco.ts")` from the
console returns the module instance the app is using, so
`monaco.editor.getModels()` reads and writes the real documents regardless —
and going through a model exercises the whole chain from `onDidChangeContent`
through React state to autosave.

## Conventions

- **8.3 filenames are enforced**, not mapped. DOS has no long names, and silently
  rewriting `player_movement.c` to `PLAYER_M.C` would break every `#include`.
- The compiler is never repo content. Users supply their own disks.
- Licensed GPL-2.0-or-later because js-dos embeds DOSBox; serving JS/wasm to a
  browser is distribution. `THIRD-PARTY-NOTICES.md` carries the 7-Zip unRAR
  statement, which is an obligation, not decoration.
- Commit messages explain *why*, and record traps found so they are not
  rediscovered.
