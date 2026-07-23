import * as monaco from "monaco-editor/esm/vs/editor/editor.api";

// The full editor feature set — find, multi-cursor, folding, command palette —
// but none of the language services. Importing the `monaco-editor` barrel
// instead would pull in TypeScript, JSON, HTML and CSS tokenizers and their
// web workers, in an app whose only language is C.
import "monaco-editor/esm/vs/editor/edcore.main";
import "monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution";

// Monaco's own worker, used for word-based completions and diffing. It must be
// bundled rather than fetched from a CDN: this page is cross-origin isolated for
// SharedArrayBuffer's sake, and COEP: require-corp blocks third-party scripts.
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

import { ASM_LANGUAGE_ID, registerAsmLanguage } from "./asmLanguage";

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

registerAsmLanguage();

export const THEME = "13h";

/**
 * The palette is the app's, which is in turn the default VGA one. Keywords in
 * light cyan and strings in yellow is roughly what Turbo C++'s own editor did
 * on a colour monitor, and it beats inventing a second colour scheme for the
 * one panel that has syntax in it.
 */
monaco.editor.defineTheme(THEME, {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "7d8590", fontStyle: "italic" },
    { token: "keyword", foreground: "55ffff" },
    { token: "keyword.directive", foreground: "ff5555" },
    { token: "keyword.directive.control", foreground: "ff5555" },
    { token: "number", foreground: "55ff55" },
    { token: "number.hex", foreground: "55ff55" },
    { token: "number.binary", foreground: "55ff55" },
    { token: "string", foreground: "ffff55" },
    { token: "identifier", foreground: "d6dae0" },
    { token: "type", foreground: "55ffff" },
    // Assembly: registers stand out from everything else on the line, and a
    // label is the one thing you scan a listing for.
    { token: "variable.predefined", foreground: "ff55ff" },
    { token: "type.identifier", foreground: "ffffff" },
  ],
  colors: {
    "editor.background": "#14171c",
    "editor.foreground": "#d6dae0",
    "editor.lineHighlightBackground": "#1a1e25",
    "editor.selectionBackground": "#204070",
    "editorCursor.foreground": "#55ffff",
    "editorLineNumber.foreground": "#3a414c",
    "editorLineNumber.activeForeground": "#7d8590",
    "editorRuler.foreground": "#20242b",
    "editorIndentGuide.background1": "#20242b",
    "editorWidget.background": "#0b0d10",
    "editorWidget.border": "#262b33",
    "editorSuggestWidget.background": "#0b0d10",
    "editorSuggestWidget.border": "#262b33",
    "editorSuggestWidget.selectedBackground": "#204070",
    "input.background": "#0b0d10",
    "input.border": "#262b33",
    "focusBorder": "#00aaaa",
    "scrollbarSlider.background": "#26333f80",
    "scrollbarSlider.hoverBackground": "#33414f",
  },
});

export const EDITOR_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  theme: THEME,
  automaticLayout: true,
  fontFamily:
    'ui-monospace, "Cascadia Code", "JetBrains Mono", "SF Mono", Consolas, monospace',
  fontSize: 13,
  lineHeight: 1.55,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  // Turbo C's own defaults, and what the books' listings are indented with.
  tabSize: 4,
  insertSpaces: true,
  // The line every DOS-era listing was written to fit inside.
  rulers: [80],
  renderWhitespace: "selection",
  bracketPairColorization: { enabled: false },
  padding: { top: 10, bottom: 10 },
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
  smoothScrolling: true,
  overviewRulerBorder: false,
  wordWrap: "off",
};

/** Turbo C++ compiles .CPP as C++ and everything else as C; so does the editor. */
export function languageFor(name: string): string {
  if (/\.(asm|inc)$/i.test(name)) return ASM_LANGUAGE_ID;
  return /\.(cpp|hpp)$/i.test(name) ? "cpp" : "c";
}

export { monaco };
