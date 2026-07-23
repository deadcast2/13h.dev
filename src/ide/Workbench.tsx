import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { diagnosticSummary, locate } from "../build/diagnostics";
import { compile, type BuildResult } from "../build/turboc";
import { CodeEditor, type EditorMarker, type Reveal } from "../editor/CodeEditor";
import type { StoredProject } from "../project/store";
import {
  downloadBytes,
  downloadText,
  exeFilename,
  exportFilename,
  parseExport,
  serializeExport,
  toExport,
} from "../project/transfer";
import { buildShareUrl, SHARE_URL_SOFT_LIMIT } from "../project/shareLink";
import { useAutosave } from "../project/useAutosave";
import { useProject } from "../project/useProject";
import type { ProjectsApi } from "../project/useProjects";
import { PreviewPane } from "../run/PreviewPane";
import { stopProgram } from "../run/runner";
import { AddToolsDialog } from "../toolchain/AddToolsDialog";
import type { StoredToolchain } from "../toolchain/store";
import { DiagnosticList } from "./DiagnosticList";
import { EditorTabs } from "./EditorTabs";
import { FileTree } from "./FileTree";
import { ProjectMenu } from "./ProjectMenu";
import { ShortcutsDialog } from "./ShortcutsDialog";

type Phase = "idle" | "building" | "done" | "error";

/** DOS executables start with "MZ" — a cheap sanity check that we got a binary. */
const isDosExecutable = (bytes: Uint8Array) =>
  bytes.length > 2 && bytes[0] === 0x4d && bytes[1] === 0x5a;

const SAVE_LABEL: Record<ReturnType<typeof useAutosave>, string> = {
  saved: "saved",
  saving: "saving…",
  unavailable: "not saved — storage unavailable",
};

/**
 * Mounted with the project's id as its key, so opening a different project
 * remounts the whole workbench. That resets the editor's models and the build
 * state together, which is what should happen: the executable belonging to the
 * project you just closed has no business still being on screen.
 */
export function Workbench({
  stored,
  projects,
  toolchain,
  onToolchainChanged,
  onForget,
}: {
  stored: StoredProject;
  projects: ProjectsApi;
  toolchain: StoredToolchain;
  onToolchainChanged: (toolchain: StoredToolchain) => void;
  onForget: () => void;
}) {
  const [addingTools, setAddingTools] = useState(false);
  const [showingKeys, setShowingKeys] = useState(false);
  const project = useProject(stored);
  const saveState = useAutosave(stored, project.snapshot);

  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<BuildResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [executable, setExecutable] = useState<Uint8Array | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [shareNotice, setShareNotice] = useState<{ text: string; transient: boolean } | null>(
    null,
  );

  const { files } = project;

  /**
   * Diagnostics matched to the files they belong to. The compiler names files
   * as it echoed them — lower-cased, and the assembler differently again — so
   * `locate` is what turns a name in a log into a file the editor holds.
   *
   * Only those with a line become markers. A linker error names the module a
   * missing symbol was referenced from but not where, and putting a squiggle on
   * line 1 would be inventing a location the toolchain never gave. Those stay in
   * the list below the preview, where they can still be clicked to open the
   * file.
   */
  const markers = useMemo<EditorMarker[]>(() => {
    const diagnostics = result?.diagnostics ?? [];
    return diagnostics.flatMap((diagnostic) => {
      const file = locate(diagnostic, files);
      if (!file || diagnostic.line === null) return [];
      return [
        {
          fileId: file.id,
          line: diagnostic.line,
          severity: diagnostic.severity,
          message: diagnostic.message,
        },
      ];
    });
  }, [result, files]);

  /**
   * Reading an import, and saying why one was refused.
   *
   * The message is shown across the top of the IDE rather than in an `alert`.
   * A rejection is worth reading — it names the file and the specific reason,
   * often a filename DOS cannot represent — and a modal that has to be
   * dismissed before the text can be acted on is the wrong shape for that. It
   * also blocks the page, which made the failure impossible to drive from a
   * script when this was being tested.
   */
  const importFile = useCallback(
    async (file: File) => {
      try {
        projects.importFrom(parseExport(await file.text()));
        setImportError(null);
      } catch (problem) {
        setImportError(
          `${file.name} could not be imported. ` +
            (problem instanceof Error ? problem.message : String(problem)),
        );
      }
    },
    [projects],
  );

  /**
   * A link that carries the whole project. Built from the live snapshot, for the
   * same reason export is: `stored` is the copy this workbench mounted with, and
   * autosave has been writing over it since. Copied to the clipboard on the spot;
   * if the browser blocks that, the link itself goes in the notice so it is never
   * simply lost. A link past the soft limit is still handed over, with a word
   * that a file is the surer way to move a large project.
   */
  const share = useCallback(async () => {
    try {
      const url = await buildShareUrl(
        toExport(stored.name, project.snapshot),
        location.origin + location.pathname,
      );

      let copied = false;
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch {
        // Clipboard unavailable — not a secure context, or the user denied it.
      }

      const caveat =
        url.length > SHARE_URL_SOFT_LIMIT
          ? " It's a long link, so some chat apps may cut it off — for a project this size, an exported .13h.json file travels more reliably."
          : "";

      setShareNotice({
        text: copied
          ? `Link copied. Anyone who opens it gets their own copy of "${stored.name}".${caveat}`
          : `Copy this link to share "${stored.name}":\n${url}${caveat}`,
        // A confirmation can time out; a link the user still has to copy by hand
        // must not vanish from under them.
        transient: copied,
      });
    } catch (problem) {
      setShareNotice({
        text: problem instanceof Error ? problem.message : String(problem),
        transient: false,
      });
    }
  }, [stored.name, project.snapshot]);

  // A copied-link confirmation clears itself; anything the user still has to act
  // on stays until dismissed.
  useEffect(() => {
    if (!shareNotice?.transient) return;
    const id = setTimeout(() => setShareNotice(null), 8000);
    return () => clearTimeout(id);
  }, [shareNotice]);

  /** Opening the file first; the editor reveals the line once it is showing. */
  const goTo = useCallback(
    (fileId: string, line: number) => {
      project.open(fileId);
      setReveal((previous) => ({ fileId, line, token: (previous?.token ?? 0) + 1 }));
    },
    [project],
  );

  /**
   * Guards re-entry synchronously, which `phase` cannot: Ctrl+B pressed inside
   * the editor is handled by Monaco's binding, and if it also reaches the window
   * listener below, both fire in the same tick and both read the pre-render
   * `phase`. Two builds would then race, and each boots an emulator of its own —
   * the one thing the whole design forbids.
   */
  const building = useRef(false);

  const build = useCallback(async () => {
    if (building.current) return;
    building.current = true;

    setPhase("building");
    setResult(null);
    setError(null);
    setExecutable(null);

    try {
      // Awaited rather than left to the preview pane's unmount, which is not
      // ordered against what follows. Compiling boots an emulator of its own,
      // and the whole app is built on there being only ever one.
      await stopProgram();

      const built = await compile(files);
      setResult(built);
      setPhase(built.ok ? "done" : "error");
      if (built.executable) setExecutable(built.executable);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    } finally {
      building.current = false;
    }
  }, [files]);

  // The editor swallows keystrokes that reach it, so it binds Ctrl+B itself;
  // this covers everywhere else on the page.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        void build();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [build]);

  const status = {
    idle: "ready",
    building: "compiling…",
    done: "build succeeded",
    error: "build failed",
  }[phase];

  return (
    <div className="ide">
      <header className="ide-bar">
        <h1 className="brand">
          13h<span className="brand-dim">.dev</span>
        </h1>

        <ProjectMenu
          projects={projects.projects}
          currentId={stored.id}
          persistent={projects.persistent}
          onSwitch={projects.switchTo}
          onCreate={projects.create}
          onRename={projects.rename}
          onDelete={projects.remove}
          onImportFile={(file) => void importFile(file)}
          // From the live snapshot, never from `stored`: that is the copy this
          // workbench was mounted with, and autosave has been writing over it
          // ever since. Exporting it would hand back the project as it was when
          // it was opened, minus everything typed since — silently, in a file
          // whose whole purpose is to be the copy that survives.
          onExport={() =>
            downloadText(
              exportFilename(stored.name),
              serializeExport(toExport(stored.name, project.snapshot)),
            )
          }
          onShare={() => void share()}
        />

        <button
          className="btn btn-primary"
          onClick={() => void build()}
          disabled={phase === "building"}
        >
          {phase === "building" ? "Compiling…" : "Build & Run"}
          <kbd>Ctrl+B</kbd>
        </button>

        <span className={`status status-${phase}`}>{status}</span>

        {result && (
          <span className="status-detail">
            {(result.durationMs / 1000).toFixed(1)}s
            {result.executable && ` · ${result.executable.length.toLocaleString()} bytes`}
            {result.executable &&
              !isDosExecutable(result.executable) &&
              " · NOT an MZ binary"}
            {/* Offered from `result`, not the `executable` run-state, so it
                outlives stopping the preview: what built is downloadable whether
                or not it is still on screen. octet-stream because it is a raw
                DOS binary the browser should save, never try to interpret. */}
            {result.executable && (
              <>
                {" · "}
                <button
                  className="link-btn"
                  title="Download the compiled MS-DOS executable"
                  onClick={() =>
                    downloadBytes(
                      exeFilename(stored.name),
                      result.executable!,
                      "application/octet-stream",
                    )
                  }
                >
                  download .exe
                </button>
              </>
            )}
            {/* Warnings are worth saying out loud on a build that succeeded,
                which is the only time anyone would otherwise skip the log. */}
            {diagnosticSummary(result.diagnostics) &&
              ` · ${diagnosticSummary(result.diagnostics)}`}
          </span>
        )}
      </header>

      {importError && (
        <p className="ide-alert" role="alert">
          <span>{importError}</span>
          <button
            className="icon-btn"
            title="Dismiss"
            onClick={() => setImportError(null)}
          >
            ✕
          </button>
        </p>
      )}

      {/* A share link the page was opened from that would not read. Owned by
          useProjects — it is set before this workbench exists — and dismissed
          through it. */}
      {projects.linkError && (
        <p className="ide-alert" role="alert">
          <span>{projects.linkError}</span>
          <button className="icon-btn" title="Dismiss" onClick={projects.dismissLinkError}>
            ✕
          </button>
        </p>
      )}

      {shareNotice && (
        <p className="ide-alert is-info" role="status">
          <span className="ide-alert-text">{shareNotice.text}</span>
          <button className="icon-btn" title="Dismiss" onClick={() => setShareNotice(null)}>
            ✕
          </button>
        </p>
      )}

      <div className="ide-body">
        <FileTree
          files={project.files}
          activeId={project.activeId}
          onOpen={project.open}
          onCreate={project.create}
          onRename={project.rename}
          onDelete={project.remove}
        />

        <section className="pane editor-pane">
          <EditorTabs
            files={project.openFiles}
            activeId={project.activeId}
            onSelect={project.open}
            onClose={project.close}
          />
          <CodeEditor
            files={project.files}
            activeId={project.activeId}
            onChange={project.setText}
            onBuild={() => void build()}
            markers={markers}
            reveal={reveal}
          />
        </section>

        <section className="pane output-pane">
          <header className="pane-header">
            <span>Preview</span>
            {executable && (
              <button
                className="icon-btn"
                title="Stop the running program"
                onClick={() => {
                  setExecutable(null);
                  void stopProgram();
                }}
              >
                ■
              </button>
            )}
          </header>

          <div className="preview-slot">
            {executable ? (
              <PreviewPane executable={executable} />
            ) : (
              <p className="placeholder">
                {phase === "building"
                  ? "Compiling…"
                  : "Build to compile the project and run it here."}
              </p>
            )}
          </div>

          <header className="pane-header">Build output</header>
          {result?.hint && <p className="build-hint">{result.hint}</p>}
          <DiagnosticList
            diagnostics={result?.diagnostics ?? []}
            files={project.files}
            onSelect={goTo}
          />
          <pre className="build-log">
            {error ??
              result?.log ??
              "TCC's output appears here — warnings, errors, and the compiler banner."}
          </pre>
        </section>
      </div>

      <footer className="ide-status">
        <span>
          Turbo C++ from <strong>{toolchain.sourceName}</strong> · {toolchain.fileCount}{" "}
          files · {(toolchain.zip.length / 1024).toFixed(0)} KB cached ·{" "}
          <button className="link-btn" onClick={() => setAddingTools(true)}>
            add tools
          </button>{" "}
          ·{" "}
          <button className="link-btn" onClick={onForget}>
            remove
          </button>
        </span>
        <span>
          <span className={saveState === "unavailable" ? "save-warning" : undefined}>
            {SAVE_LABEL[saveState]}
          </span>{" "}
          · {project.files.length} files ·{" "}
          <button className="link-btn" onClick={() => setShowingKeys(true)}>
            keyboard
          </button>{" "}
          ·{" "}
          <a href="https://github.com/deadcast2/13h.dev">source</a> ·{" "}
          <a href="https://www.gnu.org/licenses/old-licenses/gpl-2.0.html">GPL-2.0</a>
        </span>
      </footer>

      {showingKeys && <ShortcutsDialog onClose={() => setShowingKeys(false)} />}

      {addingTools && (
        <AddToolsDialog
          toolchain={toolchain}
          onUpdated={onToolchainChanged}
          onClose={() => setAddingTools(false)}
        />
      )}
    </div>
  );
}
