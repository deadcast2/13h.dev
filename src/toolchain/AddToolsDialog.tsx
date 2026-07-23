import { useCallback, useEffect, useState } from "react";

import { DiskDropZone } from "./DiskDropZone";
import { saveToolchain, type StoredToolchain } from "./store";
import { addToToolchain, type UnpackProgress } from "./unpack";

/**
 * Adds more programs to an installed toolchain without discarding it.
 *
 * The assembler is the reason this exists. Turbo Assembler was a separate
 * product, so it is on none of the Turbo C++ disks, and wanting it only once
 * you've reached the chapter that needs it is the normal way round. Before this
 * the only route was to remove the compiler and supply everything again.
 */

type Phase = "idle" | "working" | "done" | "failed";

export function AddToolsDialog({
  toolchain,
  onUpdated,
  onClose,
}: {
  toolchain: StoredToolchain;
  onUpdated: (toolchain: StoredToolchain) => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<UnpackProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const add = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setPhase("working");
      setError(null);
      setProgress({ stage: "Starting…" });

      try {
        const merged = await addToToolchain(files, toolchain.zip, setProgress);
        const next: StoredToolchain = {
          ...toolchain,
          ...merged,
          sourceName: `${toolchain.sourceName} + ${
            files.length === 1 ? files[0].name : `${files.length} files`
          }`,
        };
        await saveToolchain(next);
        setAdded(merged.added);
        setPhase("done");
        onUpdated(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase("failed");
      } finally {
        setProgress(null);
      }
    },
    [toolchain, onUpdated],
  );

  return (
    <div className="overlay" onClick={onClose}>
      <section className="dialog" onClick={(event) => event.stopPropagation()}>
        <header className="pane-header">
          <span>Add to the toolchain</span>
          <button className="icon-btn" title="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="dialog-body">
          {phase === "done" ? (
            <>
              <p className="dialog-lede">
                Added {added.length} file{added.length === 1 ? "" : "s"}.
              </p>
              <ul className="added-list">
                {added.map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
              <p className="dialog-note">
                Anything already installed was kept as it was, so the compiler
                keeps the linker it came with.
              </p>
              <button className="btn" onClick={onClose}>
                Done
              </button>
            </>
          ) : (
            <>
              <p className="dialog-lede">
                Supply <strong>Turbo Assembler</strong> to build <code>.ASM</code>{" "}
                files — it was a separate product, so it is on none of the Turbo
                C++ disks. Anything already installed is left alone.
              </p>

              <DiskDropZone
                busy={phase === "working"}
                progress={progress}
                prompt="Drop the assembler disks here, or click to choose"
                hint={
                  <>
                    A <code>.7z</code> of the disk images, the <code>.img</code>{" "}
                    files themselves, or a folder with <code>TASM.EXE</code> in it
                  </>
                }
                onFiles={(files) => void add(files)}
              />

              {error && <pre className="dialog-error">{error}</pre>}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
