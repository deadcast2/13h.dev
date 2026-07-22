# 13h.dev

A single-page IDE for writing **mode 13h VGA graphics in Turbo C++ 1.01** — editing,
compiling, and running, entirely client-side. No server, no DOS prompt, no Borland
IDE. Write C, press build, watch your pixels.

Built while working through *Gardens of Imagination*.

## How it works

Three layers, all in the browser:

| Layer | What it does |
| --- | --- |
| **Editor** | Monaco, multi-file projects, compiler errors inline |
| **Compiler** | Real `TCC.EXE` running in a headless [js-dos](https://js-dos.com) DOSBox worker |
| **Preview** | The compiled `.EXE` in a second, visible DOSBox — actual emulated VGA |

A build seeds a hidden DOSBox with the toolchain plus your sources, runs `TCC`
via `[autoexec]` with output redirected to a file, then reads back the log and the
resulting executable. Nothing about DOS is exposed to you.

## The compiler is not included

13h.dev ships no Borland code. On first run you supply your own Turbo C++ 1.01
install disks — the original `.7z` of floppy images, the `.img` files, or an
already-installed `C:\TC` folder — and the app unpacks them in your browser and
caches the result locally. They never leave your machine.

Getting there means peeling three nested containers, which is why this uses
[7z-wasm](https://github.com/use-strict/7z-wasm) rather than a normal zip library:

1. **`.7z`** — LZMA
2. **`Disk0N.img`** — raw FAT12 720K floppy images
3. **`TCC.ZIP`, `INCLUDE.ZIP`, …** — PKZIP 1.x using the legacy **Implode** method,
   which `fflate`, `JSZip`, and friends cannot decode

Assembled, the toolchain is ~81 files / 2.1 MB, cached at under 1 MB. The Turbo C++
IDE itself (`TC.CA1`/`TC.CA2`) is skipped — `TCC.EXE` is driven directly.

## Filenames are 8.3

DOS has no long filenames, so `player_movement.c` would silently become
`PLAYER_M.C` and break every `#include` that referenced it. Rather than maintain a
mapping layer that makes your source lie to you, the editor validates filenames and
rejects ones DOS can't represent. Period-accurate, and you always know what the
compiler sees.

## Development

```bash
npm install
npm run dev
```

The dev server sets `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy`
so that `SharedArrayBuffer` is available — js-dos needs cross-origin isolation for
its worker backend. **Any production host must send these headers too.**

### Toolchain fixture (temporary)

Until the in-browser unpacker lands, the pipeline is developed against a fixture
generated from a local copy of the install disks. Requires 7-Zip on the host:

```bash
npm run toolchain:fixture -- "Borland Turbo C++ 1.01 (3.5).7z"
```

With a `.7z` sitting in the repo root, the argument can be omitted. Output lands in
`public/dev-toolchain/` and is gitignored.

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

Step 0 of 8. Scaffold and preflight checks only.
