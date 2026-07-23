# Third-party notices

13h.dev is distributed under the GNU General Public License, version 2 or later
(see `LICENSE`). That choice is not incidental — the emulator this project is
built on is GPL-2.0, and a deployed copy of 13h.dev serves that emulator to every
visitor.

## js-dos / emulators

- **Package:** `emulators` 8.4.1 (also `js-dos` 8.4.1)
- **Copyright:** Alexander Guryanov (caiiiycuk) and contributors
- **License:** GNU General Public License, version 2
- **Source:** https://github.com/caiiiycuk/js-dos

The following files are copied verbatim from the `emulators` npm package into
`public/emulators/` at build time by `tools/copy-emulator-assets.mjs`, and are
served unmodified:

| File | Contents |
| --- | --- |
| `emulators.js` | js-dos loader and CommandInterface |
| `wdosbox.js` | Emscripten glue for DOSBox |
| `wdosbox.wasm` | DOSBox, compiled to WebAssembly |
| `wlibzip.js`, `wlibzip.wasm` | libzip, used to unpack bundles into the guest filesystem |

`wdosbox.wasm` is a compiled form of **DOSBox** (https://www.dosbox.com/),
copyright the DOSBox Team, GPL-2.0. GPL-2.0 section 3 requires that the
corresponding source accompany a binary or be offered alongside it; the
unmodified upstream sources for the exact version distributed here are at the
js-dos repository above, tagged `8.4.1`.

None of these files are modified by this project.

## 7-Zip (7z-wasm)

- **Package:** `7z-wasm` 1.2.0, based on 7-Zip 24.09
- **Copyright:** Igor Pavlov
- **License:** GNU LGPL, and for `7zz.wasm` / `7zz.*.js`, **GNU LGPL + unRAR
  restriction**
- **Source:** https://github.com/use-strict/7z-wasm

Used only during first-run setup, to read the user's Turbo C++ install disks: the
LZMA `.7z`, the FAT12 floppy images inside it, and the PKZIP 1.x "Implode"
archives inside those. It is loaded dynamically and never fetched on an ordinary
visit. The files are used unmodified.

### unRAR restriction

7-Zip's RAR decompression engine was developed from unRAR source code, all
copyrights to which are owned by Alexander Roshal. That license carries a
restriction which must be reproduced here:

> The unRAR sources cannot be used to re-create the RAR compression algorithm,
> which is proprietary. Distribution of modified unRAR sources in separate form or
> as a part of other software is permitted, provided that it is clearly stated in
> the documentation and source comments that the code may not be used to develop a
> RAR (WinRAR) compatible archiver.

Accordingly: **this code may not be used to develop a RAR (WinRAR) compatible
archiver.** 13h.dev does not read or write RAR archives; the capability is simply
present in the 7-Zip build being redistributed.

## IBM VGA font (The Ultimate Oldschool PC Font Pack)

- **File:** `src/assets/fonts/Web437_IBM_VGA_9x16.woff` (bundled into the app and
  served to every visitor)
- **Copyright:** © 2016–2020 VileR
- **License:** Creative Commons Attribution-ShareAlike 4.0 International (CC
  BY-SA 4.0), https://creativecommons.org/licenses/by-sa/4.0/
- **Source:** https://int10h.org/oldschool-pc-fonts/

The "Web437 IBM VGA 9x16" web font — a faithful rendering of the IBM VGA 9×16
text-mode ROM face, code page 437 — dresses the application chrome (the wordmark,
panel titles, and buttons). It is used unmodified. CC BY-SA 4.0 requires that
this attribution accompany the work and that any *modified* version of the font
be shared under the same licence; the font here is redistributed as-is, and this
licence covers only the font file, not the rest of 13h.dev.

## Pixelarticons (toolbar icons)

- **Files:** the pixel-art icon paths inlined in `src/Icon.tsx`
- **Copyright:** © 2019 Gerrit Halfmann (halfmage)
- **License:** MIT
- **Source:** https://github.com/halfmage/pixelarticons

The project toolbar's icons (new, rename, delete, export, share, import) are
drawn from the Pixelarticons set, chosen because a pixel-art icon pack sits with
the rest of the retro chrome. The paths are inlined unmodified. MIT requires that
the copyright and permission notice accompany the work:

> Permission is hereby granted, free of charge, to any person obtaining a copy of
> this software and associated documentation files (the "Software"), to deal in
> the Software without restriction… The above copyright notice and this
> permission notice shall be included in all copies or substantial portions of
> the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.

## Turbo C++ 1.01

**Not included, and not redistributed.**

13h.dev ships no Borland code and never has. The compiler is supplied by each
user from their own copy of the original install disks, unpacked in their own
browser, and cached locally on their own machine. It is not uploaded anywhere and
is not part of this repository or of any deployed build.

Turbo C++ remains the property of Borland / Embarcadero Technologies. Its
licensing is a matter between the user and the rights holder, and is unaffected by
the GPL that covers this application.

## A note on scope

The GPL applies to the application and to the emulator it distributes. It does
**not** reach the C and C++ programs you write in the editor: those are your work,
compiled locally by a compiler you supplied, and 13h.dev claims nothing over the
source or the executables it produces for you.
