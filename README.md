# 13h.dev

A single-page IDE for writing **mode 13h VGA graphics in Turbo C++ 1.01** — editing,
compiling, and running, entirely client-side. No server, no DOS prompt, no Borland
IDE. Write C, press build, watch your pixels.

Built while working through *Gardens of Imagination*.

## How it works

Three layers, all in the browser:

| Layer | What it does |
| --- | --- |
| **Editor** | Monaco, multi-file projects, tabs, 8.3-validated filenames, autosaved |
| **Compiler** | Real `TCC.EXE` running in a headless [js-dos](https://js-dos.com) DOSBox worker |
| **Preview** | The compiled `.EXE` in a second, visible DOSBox — actual emulated VGA |

A build seeds a hidden DOSBox with the toolchain plus your sources, runs `TCC`
via `[autoexec]` with output redirected to a file, then reads back the log and the
resulting executable. Nothing about DOS is exposed to you.

## The compiler is not included

13h.dev ships no Borland code. On first run you supply your own **Turbo C++ 1.01
or 3.0** install disks — the original `.7z` of floppy images, the `.img` files, or
an already-installed `C:\TC` folder — and the app unpacks them in your browser and
caches the result locally. They never leave your machine.

### Which version?

**3.0 if you have a choice**, for one reason: it has a built-in inline assembler.

Turbo C++ 1.01 doesn't assemble `asm` blocks itself — it emits `.ASM` and shells
out to TASM, which was a separate product and is on none of the disks. An `asm`
block therefore fails with:

```
Warning main.c 5: Restarting compile using assembly in function set_mode_13h
Error: Unable to execute command 'tasm.exe'
```

3.0 assembles inline `asm` directly, statement and block form both, including
references to C variables. If you're following a book that drops into assembly for
speed, that difference matters. On 1.01 the way around it is pseudo-registers
(`_AX`, `_AH`, …) with `geninterrupt()`, or `int86()` — all compiler intrinsics
that need no assembler.

### Assembly files

`.ASM` files are part of the build: TCC recognises them and hands them to TASM,
exactly as it does for a `.C` file it needs to assemble. `.INC` travels with them
without being assembled on its own, the way `.H` does for C.

That needs a `TASM.EXE`, and this is the one thing the built-in assembler does
*not* cover — 3.0 assembles inline `asm` itself, but a standalone `.ASM` file
goes to TASM on both versions. Turbo Assembler was sold as a separate product, so
it is on none of the Turbo C++ disks; supply a copy alongside them and it is
picked up automatically. Without one, a build that needs to assemble stops with

```
Error: Unable to execute command 'tasm.exe'
```

which the build panel explains rather than leaving you to work out whose program
`tasm.exe` was supposed to be.

Both are supported and verified end to end; the build flags, `TURBOC.CFG` and
`C0x.OBJ`/`Cx.LIB` naming are identical between them.

Getting there means peeling three nested containers, which is why this uses
[7z-wasm](https://github.com/use-strict/7z-wasm) rather than a normal zip library:

1. **`.7z`** — LZMA
2. **`Disk0N.img`** — raw FAT12 720K floppy images
3. **`TCC.ZIP`, `INCLUDE.ZIP`, …** — PKZIP 1.x using the legacy **Implode** method,
   which `fflate`, `JSZip`, and friends cannot decode

Turbo C++ 3.0 adds a fourth: `CMDLINE.CA1`/`.CA2`, Borland's own split archives,
which is where 3.0 keeps the command-line compiler. They turn out to be a four-byte
header followed by raw zip data cut across disks — strip the headers, concatenate
in numeric order, and an ordinary zip falls out. Parts are matched by name across
the whole disk set, because they are deliberately spread apart: on the 3.0 disks
`CMDLINE.CA2` is on disk 1 and `CMDLINE.CA1` is on disk 3.

Rather than branch on which of those shapes you supplied, containers are expanded
repeatedly until none are left, and the resulting files are then sorted by what
each one *is* — compiler and linker to `BIN`, `.H` to `INCLUDE`, `.LIB`/`.OBJ` to
`LIB`, `.BGI`/`.CHR` to `BGI`. An already-installed `C:\TC` folder therefore works
as well as the raw disks.

Assembled, the toolchain is ~80 files / 2 MB, cached at under 1 MB in IndexedDB.
The Turbo C++ IDE itself (`TC.CA1`/`TC.CA2`) is skipped — `TCC.EXE` is driven
directly. If what you supply doesn't contain a complete toolchain, setup says
which pieces were missing rather than failing later at compile time.

## Your work stays put

There is no Save button and no account. Projects are written to IndexedDB as you
type — debounced, and flushed when you switch project or tab away — and the one
you had open is the one that reopens next visit. You can keep as many as you
like; each is an independent set of files with its own tabs.

Like the compiler, none of it leaves the machine, which is also the limit worth
knowing: this is browser storage, so it is per-browser and per-profile, and
clearing site data clears your projects with it. Step 6 adds export to a file,
which is the answer to both. If storage is unavailable at all — private mode,
say — the app still runs on a single in-memory project and says so in the status
bar rather than letting you find out by closing the tab.

## Filenames are 8.3

DOS has no long filenames, so `player_movement.c` would silently become
`PLAYER_M.C` and break every `#include` that referenced it. Rather than maintain a
mapping layer that makes your source lie to you, the editor validates filenames and
rejects ones DOS can't represent. Period-accurate, and you always know what the
compiler sees.

Names are rejected with the specific reason — too long, more than one dot, a
character FAT doesn't allow, or a reserved device name like `CON`. Everything is
uppercased on the way in, because that is what the disk stores.

A build writes every file in the project to the compiler's working directory but
names only `.C`, `.CPP` and `.ASM` on the command line: `.H` and `.INC` travel
with the sources so `#include "VGA.H"` resolves, without being compiled as
translation units in their own right. That command line is subject to DOS's 127-character limit, which
is checked before the build rather than discovered as a link error afterwards.

## Development

```bash
npm install
npm run dev
```

The dev server sets `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy`
so that `SharedArrayBuffer` is available — js-dos needs cross-origin isolation for
its worker backend. **Any production host must send these headers too.**

On first run the app asks for install disks; the unpacked toolchain is then cached
in IndexedDB, so it is a one-time step per browser rather than per session.

## Licensing

Copyright (C) 2026 Caleb Cohoon

> This program is free software; you can redistribute it and/or modify it under
> the terms of the GNU General Public License as published by the Free Software
> Foundation; either version 2 of the License, or (at your option) any later
> version.
>
> This program is distributed in the hope that it will be useful, but WITHOUT ANY
> WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
> PARTICULAR PURPOSE. See the GNU General Public License for more details.

See `LICENSE` for the full text, and `THIRD-PARTY-NOTICES.md` for what it covers
and why.

The short version: js-dos embeds DOSBox, which is GPL-2.0, and a deployed copy of
this site serves that emulator to every visitor. Shipping JavaScript and WebAssembly
to a browser is distribution — the GPL applies to a website in a way it does not
apply to purely server-side use.

Two things this does **not** reach:

- **Your code.** Programs you write in the editor are yours. They are compiled
  locally, by a compiler you supplied, and this project claims nothing over the
  source or the executables it produces.
- **Turbo C++.** Borland/Embarcadero's, neither included nor redistributed here.
  Users supply their own copy.

## Status

Step 5 of 8. Supply your disks, edit a multi-file project, press Ctrl+B, watch
your pixels, and find it all still there tomorrow. Still to come: import/export,
and compiler errors shown inline against the source rather than only in the
build log.
