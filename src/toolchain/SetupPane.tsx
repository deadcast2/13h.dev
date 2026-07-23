import { useCallback, useState } from "react";

import { DiskDropZone } from "./DiskDropZone";
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
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<UnpackProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          sourceName: files.length === 1 ? files[0].name : `${files.length} files`,
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

  return (
    <section className="setup-panel">
      <header className="pane-header">Set up the compiler</header>

      <div className="dialog-body">
        <p className="dialog-lede">
          13h.dev doesn&apos;t ship a compiler. Supply your own copy of the{" "}
          <strong>Turbo C++ 1.01 or 3.0</strong> install disks and it will be
          unpacked here in your browser and kept on this machine.
        </p>

        <DiskDropZone
          busy={phase === "working"}
          progress={progress}
          prompt="Drop your install disks here, or click to choose"
          hint={
            <>
              A <code>.7z</code> of the disk images, the <code>.img</code> files
              themselves, or a folder with Turbo C++ already installed
            </>
          }
          onFiles={(files) => void install(files)}
        />

        {error && <pre className="dialog-error">{error}</pre>}

        <p className="dialog-note">
          Turbo C++ is Borland/Embarcadero&apos;s. Your copy stays on this machine
          — it is never uploaded, and there is no server here to upload it to.
          Turbo Assembler can be added later, from the status bar, if you want to
          build <code>.ASM</code> files.
        </p>
      </div>
    </section>
  );
}
