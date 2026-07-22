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
