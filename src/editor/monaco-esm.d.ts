/**
 * monaco-editor ships declarations for its API surface only (editor.api.d.ts).
 * The bundles below are side-effect JavaScript that registers features and
 * language tokenizers against that API, and with `noUncheckedSideEffectImports`
 * TypeScript insists even a side-effect import resolve to something.
 *
 * Declaring them here is what keeps the narrow entry points. The alternative is
 * importing the `monaco-editor` barrel, which is typed but drags in every
 * language monaco knows about.
 */
declare module "monaco-editor/esm/vs/editor/edcore.main";
declare module "monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution";
