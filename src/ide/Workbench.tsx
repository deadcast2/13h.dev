import { useCallback, useEffect, useRef, useState } from "react";

import { STARTER_PROJECT } from "../build/samples";
import { compile, type BuildResult } from "../build/turboc";
import { CodeEditor } from "../editor/CodeEditor";
import { useProject } from "../project/useProject";
import { PreviewPane } from "../run/PreviewPane";
import { stopProgram } from "../run/runner";
import type { StoredToolchain } from "../toolchain/store";
import { EditorTabs } from "./EditorTabs";
import { FileTree } from "./FileTree";

type Phase = "idle" | "building" | "done" | "error";

/** DOS executables start with "MZ" — a cheap sanity check that we got a binary. */
const isDosExecutable = (bytes: Uint8Array) =>
  bytes.length > 2 && bytes[0] === 0x4d && bytes[1] === 0x5a;

export function Workbench({
  toolchain,
  onForget,
}: {
  toolchain: StoredToolchain;
  onForget: () => void;
}) {
  const project = useProject(STARTER_PROJECT);

  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<BuildResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [executable, setExecutable] = useState<Uint8Array | null>(null);

  const { files } = project;

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
          </span>
        )}
      </header>

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
          <button className="link-btn" onClick={onForget}>
            remove
          </button>
        </span>
        <span>
          {project.files.length} files ·{" "}
          <a href="https://github.com/deadcast2/13h.dev">source</a> ·{" "}
          <a href="https://www.gnu.org/licenses/old-licenses/gpl-2.0.html">GPL-2.0</a>
        </span>
      </footer>
    </div>
  );
}
