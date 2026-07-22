import { useEffect, useState } from "react";

import { DEV_TOOLCHAIN_URL } from "./toolchain/devFixture";

type CheckState = "pending" | "ok" | "warn" | "fail";

interface Check {
  name: string;
  state: CheckState;
  detail: string;
}

/**
 * Everything the compile pipeline depends on before a single line of C is written.
 * Each of these has bitten browser-DOS projects before, so they get surfaced
 * plainly rather than failing deep inside a worker with an opaque message.
 */
async function runPreflight(): Promise<Check[]> {
  const checks: Check[] = [];

  checks.push({
    name: "WebAssembly",
    state: typeof WebAssembly === "object" ? "ok" : "fail",
    detail:
      typeof WebAssembly === "object"
        ? "available"
        : "missing — DOSBox cannot run",
  });

  // js-dos's worker backend wants SharedArrayBuffer, which is gated behind
  // cross-origin isolation (COOP/COEP). Without it we fall back to the slower
  // single-threaded direct backend, so this is a warning rather than an error.
  checks.push({
    name: "Cross-origin isolation",
    state: globalThis.crossOriginIsolated ? "ok" : "warn",
    detail: globalThis.crossOriginIsolated
      ? "SharedArrayBuffer available"
      : "not isolated — worker backend unavailable, check COOP/COEP headers",
  });

  checks.push({
    name: "IndexedDB",
    state: "indexedDB" in globalThis ? "ok" : "fail",
    detail:
      "indexedDB" in globalThis
        ? "available"
        : "missing — projects cannot be saved",
  });

  // The dev fixture stands in for the toolchain until the in-browser unpacker
  // lands. It is gitignored, so a fresh clone legitimately won't have one.
  try {
    const res = await fetch(DEV_TOOLCHAIN_URL, { method: "HEAD" });
    const size = Number(res.headers.get("content-length") ?? 0);
    checks.push({
      name: "Dev toolchain fixture",
      state: res.ok ? "ok" : "warn",
      detail: res.ok
        ? `present (${(size / 1024).toFixed(0)} KB)`
        : "absent — run: npm run toolchain:fixture",
    });
  } catch {
    checks.push({
      name: "Dev toolchain fixture",
      state: "warn",
      detail: "absent — run: npm run toolchain:fixture",
    });
  }

  return checks;
}

const STATE_COLOR: Record<CheckState, string> = {
  pending: "var(--text-dim)",
  ok: "var(--vga-light-green)",
  warn: "var(--vga-yellow)",
  fail: "var(--vga-light-red)",
};

const STATE_GLYPH: Record<CheckState, string> = {
  pending: "…",
  ok: "✓",
  warn: "!",
  fail: "✗",
};

export function App() {
  const [checks, setChecks] = useState<Check[] | null>(null);

  useEffect(() => {
    runPreflight().then(setChecks);
  }, []);

  return (
    <main
      style={{
        maxWidth: "48rem",
        margin: "0 auto",
        padding: "3rem 1.5rem",
      }}
    >
      <h1 style={{ margin: 0, fontSize: "2rem", letterSpacing: "-0.02em" }}>
        13h<span style={{ color: "var(--text-dim)" }}>.dev</span>
      </h1>
      <p style={{ color: "var(--text-dim)", marginTop: "0.25rem" }}>
        Turbo C++ 1.01 · mode 13h · entirely in your browser
      </p>

      <section
        style={{
          marginTop: "2.5rem",
          border: "1px solid var(--border)",
          borderRadius: 6,
          background: "var(--bg-panel)",
        }}
      >
        <header
          style={{
            padding: "0.6rem 1rem",
            borderBottom: "1px solid var(--border)",
            color: "var(--text-dim)",
            fontSize: "0.8rem",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Preflight
        </header>
        <ul style={{ listStyle: "none", margin: 0, padding: "0.5rem 0" }}>
          {(checks ?? []).map((check) => (
            <li
              key={check.name}
              style={{
                display: "grid",
                gridTemplateColumns: "1.5rem 12rem 1fr",
                gap: "0.5rem",
                padding: "0.3rem 1rem",
              }}
            >
              <span style={{ color: STATE_COLOR[check.state] }}>
                {STATE_GLYPH[check.state]}
              </span>
              <span>{check.name}</span>
              <span style={{ color: "var(--text-dim)" }}>{check.detail}</span>
            </li>
          ))}
          {checks === null && (
            <li style={{ padding: "0.3rem 1rem", color: "var(--text-dim)" }}>
              checking…
            </li>
          )}
        </ul>
      </section>

      <p style={{ color: "var(--text-dim)", marginTop: "2rem" }}>
        Scaffold only. Next: compile a C file with TCC.EXE inside a headless
        DOSBox and read the resulting executable back out.
      </p>
    </main>
  );
}
