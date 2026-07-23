import { useEffect, useRef } from "react";

import type { ProjectFile } from "../project/useProject";
import { EDITOR_OPTIONS, languageFor, monaco } from "./monaco";

/**
 * Monaco, driven from the project state.
 *
 * One model per file rather than one model swapped between files, because a
 * model owns its undo stack, its cursor and its scroll position. Switching tabs
 * therefore returns you to exactly where you left off, and undo does not walk
 * backwards into a file you aren't looking at.
 *
 * Models are keyed by file id, not filename, so renaming a file keeps its
 * history. They are created without a URI: nothing here needs cross-file
 * language services, and a URI would only have to be recreated on every rename.
 */

/** A diagnostic already matched to a file the editor holds a model for. */
export interface EditorMarker {
  fileId: string;
  line: number;
  severity: "error" | "warning";
  message: string;
}

/**
 * A place to jump to. `token` is what makes clicking the same diagnostic twice
 * scroll back to it: without it the value would be unchanged and the effect
 * would not run.
 */
export interface Reveal {
  fileId: string;
  line: number;
  token: number;
}

/** Namespaces our markers, so setting them never disturbs anyone else's. */
const MARKER_OWNER = "tcc";

interface Props {
  files: ProjectFile[];
  activeId: string | null;
  onChange: (id: string, text: string) => void;
  /** Ctrl/Cmd+B from inside the editor, where the document has the keyboard. */
  onBuild: () => void;
  /** From the last build. Empty while one is running, and before the first. */
  markers: EditorMarker[];
  reveal: Reveal | null;
}

/**
 * A line number from a DOS tool, made safe to point at.
 *
 * TASM's "Unexpected end of file encountered" is reported one line past the end
 * of the file, and a stale marker can outlive the lines it referred to, so this
 * is a clamp rather than an assertion.
 */
const clampToModel = (line: number, model: monaco.editor.ITextModel) =>
  Math.min(Math.max(Math.trunc(line), 1), model.getLineCount());

export function CodeEditor({
  files,
  activeId,
  onChange,
  onBuild,
  markers,
  reveal,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelsRef = useRef(new Map<string, monaco.editor.ITextModel>());
  const viewStatesRef = useRef(new Map<string, monaco.editor.ICodeEditorViewState>());
  const shownRef = useRef<string | null>(null);

  // Held in refs so the sync effect below can depend only on the data. Without
  // this, a new callback identity on every render would tear down and rebuild
  // every model on every keystroke.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onBuildRef = useRef(onBuild);
  onBuildRef.current = onBuild;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const editor = monaco.editor.create(host, EDITOR_OPTIONS);
    editorRef.current = editor;

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB, () =>
      onBuildRef.current(),
    );

    // The editor measures its font's character width at create time. If the VGA
    // bitmap font is still loading then, Monaco measures the fallback mono and
    // every glyph lands a fraction off once the real font swaps in — the cursor
    // drifts from the caret. Remeasuring when fonts settle fixes the metrics.
    // (Usually already loaded, since the chrome uses it, but not guaranteed.)
    document.fonts.ready.then(() => monaco.editor.remeasureFonts());

    return () => {
      editor.dispose();
      editorRef.current = null;
      // Models outlive the editor unless disposed explicitly, and StrictMode's
      // double mount would otherwise leak a full set of them on every reload.
      for (const model of modelsRef.current.values()) model.dispose();
      modelsRef.current.clear();
      viewStatesRef.current.clear();
      shownRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const models = modelsRef.current;

    for (const file of files) {
      const existing = models.get(file.id);

      if (!existing) {
        const model = monaco.editor.createModel(file.text, languageFor(file.name));
        model.onDidChangeContent(() => onChangeRef.current(file.id, model.getValue()));
        models.set(file.id, model);
        continue;
      }

      // Only ever true for a change that did not originate in this editor;
      // setValue resets the undo stack, so it must not fire on our own edits.
      if (existing.getValue() !== file.text) existing.setValue(file.text);

      const language = languageFor(file.name);
      if (existing.getLanguageId() !== language) {
        monaco.editor.setModelLanguage(existing, language);
      }
    }

    const live = new Set(files.map((file) => file.id));
    for (const [id, model] of models) {
      if (live.has(id)) continue;
      model.dispose();
      models.delete(id);
      viewStatesRef.current.delete(id);
    }

    if (shownRef.current !== activeId) {
      const previous = shownRef.current;
      if (previous) {
        const state = editor.saveViewState();
        if (state) viewStatesRef.current.set(previous, state);
      }

      const next = activeId ? (models.get(activeId) ?? null) : null;
      editor.setModel(next);

      if (next && activeId) {
        const state = viewStatesRef.current.get(activeId);
        if (state) editor.restoreViewState(state);
        editor.focus();
      }

      shownRef.current = activeId;
    }
  }, [files, activeId]);

  // After the effect above, so a model created by this render already exists.
  // Every model is set, including to nothing: that is what clears the previous
  // build's markers from a file this one had no complaint about.
  useEffect(() => {
    const models = modelsRef.current;
    const byFile = new Map<string, monaco.editor.IMarkerData[]>();

    for (const marker of markers) {
      const model = models.get(marker.fileId);
      if (!model) continue;

      const line = clampToModel(marker.line, model);
      const list = byFile.get(marker.fileId) ?? [];
      list.push({
        severity:
          marker.severity === "error"
            ? monaco.MarkerSeverity.Error
            : monaco.MarkerSeverity.Warning,
        message: marker.message,
        startLineNumber: line,
        endLineNumber: line,
        // Borland's tools report a line and no column, so the whole line is
        // underlined rather than a guessed-at span of it.
        startColumn: 1,
        endColumn: model.getLineMaxColumn(line),
      });
      byFile.set(marker.fileId, list);
    }

    for (const [id, model] of models) {
      monaco.editor.setModelMarkers(model, MARKER_OWNER, byFile.get(id) ?? []);
    }
  }, [markers, files]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !reveal) return;

    const model = modelsRef.current.get(reveal.fileId);
    // The model-switching effect above runs first, so by now the right file is
    // showing — unless the click was for a file that has since gone.
    if (!model || editor.getModel() !== model) return;

    const line = clampToModel(reveal.line, model);
    editor.setPosition({ lineNumber: line, column: 1 });
    editor.revealLineInCenter(line);
    editor.focus();
  }, [reveal]);

  return (
    <div className="editor-host">
      <div ref={hostRef} className="editor-monaco" />
      {!activeId && (
        <p className="editor-empty">
          No file open. Pick one from the list, or add a new one.
        </p>
      )}
    </div>
  );
}
