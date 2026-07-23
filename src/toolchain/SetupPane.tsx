import { useCallback, useRef, useState } from "react";

import { saveToolchain, type StoredToolchain } from "./store";
import { unpackToolchain, type UnpackProgress } from "./unpack";

/**
 * First-run setup: the user supplies their own Turbo C++ install disks.
 *
 * 13h.dev ships no Borland code. The disks are read in the browser, unpacked in
 * the browser, and cached in the browser — nothing is uploaded, and there is no
 * server to upload it to.
 */

interface Props {
  onInstalled: (toolchain: StoredToolchain) => void;
}

type Phase = "idle" | "working" | "failed";

export function SetupPane({ onInstalled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<UnpackProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const install = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setPhase("working");
      setError(null);
      setProgress({ stage: "Starting…" });

      try {
        const unpacked = await unpackToolchain(files, setProgress);
        const toolchain: StoredToolchain = {
          ...unpacked,
          installedAt: Date.now(),
          sourceName:
            files.length === 1 ? files[0].name : `${files.length} files`,
        };
        await saveToolchain(toolchain);
        onInstalled(toolchain);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase("failed");
      } finally {
        setProgress(null);
      }
    },
    [onInstalled],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      void install([...event.dataTransfer.files]);
    },
    [install],
  );

  const busy = phase === "working";

  return (
    <section
      style={{
        border: "1px solid var(--border)",
        borderRadius: 6,
        background: "var(--bg-panel)",
        marginTop: "1.5rem",
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
        Set up the compiler
      </header>

      <div style={{ padding: "1rem" }}>
        <p style={{ marginTop: 0 }}>
          13h.dev doesn&apos;t ship a compiler. Supply your own copy of the{" "}
          <strong>Turbo C++ 1.01</strong> install disks and it will be unpacked
          here in your browser and kept on this machine.
        </p>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => !busy && inputRef.current?.click()}
          style={{
            marginTop: "1rem",
            padding: "2rem 1rem",
            textAlign: "center",
            border: `1px dashed ${dragging ? "var(--vga-light-cyan)" : "var(--border)"}`,
            borderRadius: 6,
            background: dragging ? "rgba(85,255,255,0.05)" : "var(--bg)",
            cursor: busy ? "wait" : "pointer",
          }}
        >
          {busy ? (
            <>
              <div style={{ color: "var(--vga-light-cyan)" }}>
                {progress?.stage ?? "Working…"}
              </div>
              {progress?.detail && (
                <div
                  style={{
                    color: "var(--text-dim)",
                    fontSize: "0.85rem",
                    marginTop: "0.35rem",
                  }}
                >
                  {progress.detail}
                </div>
              )}
            </>
          ) : (
            <>
              <div>Drop your install disks here, or click to choose</div>
              <div
                style={{
                  color: "var(--text-dim)",
                  fontSize: "0.85rem",
                  marginTop: "0.5rem",
                }}
              >
                A <code>.7z</code> of the disk images, the <code>.img</code> files
                themselves, or a folder with Turbo C++ already installed
              </div>
            </>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => void install([...(e.target.files ?? [])])}
        />

        {error && (
          <pre
            style={{
              marginTop: "1rem",
              marginBottom: 0,
              padding: "0.75rem",
              background: "var(--bg)",
              border: "1px solid var(--vga-light-red)",
              borderRadius: 4,
              color: "var(--vga-light-red)",
              whiteSpace: "pre-wrap",
              fontSize: "0.85rem",
            }}
          >
            {error}
          </pre>
        )}

        <p
          style={{
            color: "var(--text-dim)",
            fontSize: "0.85rem",
            marginBottom: 0,
            marginTop: "1rem",
          }}
        >
          Turbo C++ is Borland/Embarcadero&apos;s. Your copy stays on this machine
          — it is never uploaded, and there is no server here to upload it to.
        </p>
      </div>
    </section>
  );
}
