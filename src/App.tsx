import { useEffect, useState } from "react";

import { MODE13H_SAMPLE } from "./build/samples";
import { compile, type BuildResult } from "./build/turboc";
import { PreviewPane } from "./run/PreviewPane";
import { SetupPane } from "./toolchain/SetupPane";
import { clearToolchain, loadToolchain, type StoredToolchain } from "./toolchain/store";

type Phase = "idle" | "building" | "done" | "error";

/** DOS executables start with "MZ" — a cheap sanity check that we got a real binary. */
function isDosExecutable(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x4d && bytes[1] === 0x5a;
}

const PANEL: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--bg-panel)",
  marginTop: "1.5rem",
};

const PANEL_HEADER: React.CSSProperties = {
  padding: "0.6rem 1rem",
  borderBottom: "1px solid var(--border)",
  color: "var(--text-dim)",
  fontSize: "0.8rem",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

export function App() {
  // undefined while the cache is being read, null when nothing is installed.
  const [toolchain, setToolchain] = useState<StoredToolchain | null | undefined>();
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<BuildResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<Uint8Array | null>(null);

  useEffect(() => {
    loadToolchain().then(setToolchain);
  }, []);

  async function runBuild() {
    setPhase("building");
    setResult(null);
    setError(null);
    setRunning(null); // a new build invalidates whatever is on screen
    try {
      setResult(await compile([MODE13H_SAMPLE]));
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  async function forgetToolchain() {
    await clearToolchain();
    setToolchain(null);
    setResult(null);
    setRunning(null);
    setPhase("idle");
  }

  const exe = result?.executable ?? null;

  return (
    <main style={{ maxWidth: "56rem", margin: "0 auto", padding: "3rem 1.5rem" }}>
      <h1 style={{ margin: 0, fontSize: "2rem", letterSpacing: "-0.02em" }}>
        13h<span style={{ color: "var(--text-dim)" }}>.dev</span>
      </h1>
      <p style={{ color: "var(--text-dim)", marginTop: "0.25rem" }}>
        Turbo C++ · mode 13h · entirely in your browser
      </p>

      {toolchain === undefined && (
        <p style={{ color: "var(--text-dim)", marginTop: "2rem" }}>
          Checking for an installed compiler…
        </p>
      )}

      {toolchain === null && <SetupPane onInstalled={setToolchain} />}

      {toolchain && (
        <>
          <section style={PANEL}>
            <header style={PANEL_HEADER}>Compile spike</header>
            <div style={{ padding: "1rem" }}>
              <p style={{ marginTop: 0, color: "var(--text-dim)" }}>
                Compiles a mode 13h program with the real <code>TCC.EXE</code> in a
                headless DOSBox, then reads the linked executable back out.
              </p>

              <button
                onClick={runBuild}
                disabled={phase === "building"}
                style={{
                  font: "inherit",
                  padding: "0.5rem 1.25rem",
                  borderRadius: 4,
                  border: "1px solid var(--border)",
                  background: phase === "building" ? "var(--bg)" : "var(--vga-blue)",
                  color: "var(--text)",
                  cursor: phase === "building" ? "wait" : "pointer",
                }}
              >
                {phase === "building" ? "Compiling…" : "Compile"}
              </button>

              {exe && !running && (
                <button
                  onClick={() => setRunning(exe)}
                  style={{
                    font: "inherit",
                    marginLeft: "0.75rem",
                    padding: "0.5rem 1.25rem",
                    borderRadius: 4,
                    border: "1px solid var(--border)",
                    background: "var(--vga-cyan)",
                    color: "var(--vga-black)",
                    cursor: "pointer",
                  }}
                >
                  Run ▸
                </button>
              )}

              {error && <p style={{ color: "var(--vga-light-red)" }}>{error}</p>}

              {result && (
                <div style={{ marginTop: "1rem" }}>
                  <p
                    style={{
                      color: result.ok
                        ? "var(--vga-light-green)"
                        : "var(--vga-light-red)",
                    }}
                  >
                    {result.ok ? "✓ Build succeeded" : "✗ Build failed"}
                    <span style={{ color: "var(--text-dim)" }}>
                      {" "}
                      · {(result.durationMs / 1000).toFixed(1)}s
                      {exe && ` · ${exe.length.toLocaleString()} bytes`}
                      {exe &&
                        ` · ${isDosExecutable(exe) ? "valid MZ header" : "NOT an MZ binary"}`}
                    </span>
                  </p>

                  <pre
                    style={{
                      margin: 0,
                      padding: "0.75rem",
                      background: "var(--bg)",
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      overflowX: "auto",
                      whiteSpace: "pre-wrap",
                      fontSize: "0.85rem",
                    }}
                  >
                    {result.log}
                  </pre>
                </div>
              )}
            </div>
          </section>

          {running && (
            <section style={PANEL}>
              <header style={PANEL_HEADER}>Preview</header>
              <div style={{ padding: "1rem" }}>
                <PreviewPane executable={running} />
              </div>
            </section>
          )}

          <section style={PANEL}>
            <header style={PANEL_HEADER}>Source</header>
            <pre
              style={{
                margin: 0,
                padding: "1rem",
                overflowX: "auto",
                fontSize: "0.85rem",
                color: "var(--text-dim)",
              }}
            >
              {MODE13H_SAMPLE.text}
            </pre>
          </section>

          <p
            style={{
              marginTop: "1.5rem",
              color: "var(--text-dim)",
              fontSize: "0.85rem",
            }}
          >
            Compiler from <strong>{toolchain.sourceName}</strong> ·{" "}
            {toolchain.fileCount} files ·{" "}
            {(toolchain.zip.length / 1024).toFixed(0)} KB cached ·{" "}
            <button
              onClick={forgetToolchain}
              style={{
                font: "inherit",
                background: "none",
                border: "none",
                padding: 0,
                color: "var(--vga-light-cyan)",
                textDecoration: "underline",
                cursor: "pointer",
              }}
            >
              remove
            </button>
          </p>
        </>
      )}

      {/*
        A visible source link is how a web app meets the spirit of GPL section 3:
        the code is served to every visitor, so every visitor should be able to
        find where it came from.
      */}
      <footer
        style={{
          marginTop: "2rem",
          paddingTop: "1rem",
          borderTop: "1px solid var(--border)",
          color: "var(--text-dim)",
          fontSize: "0.8rem",
        }}
      >
        13h.dev is free software under the{" "}
        <a href="https://www.gnu.org/licenses/old-licenses/gpl-2.0.html">GPL-2.0</a>.
        DOS emulation by <a href="https://github.com/caiiiycuk/js-dos">js-dos</a>{" "}
        (GPL-2.0), archive handling by{" "}
        <a href="https://github.com/use-strict/7z-wasm">7-Zip</a> (LGPL). Turbo C++
        is Borland/Embarcadero&apos;s and is supplied by you, not by this site.
      </footer>
    </main>
  );
}
