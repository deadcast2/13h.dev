import { useEffect, useRef, useState } from "react";

import { ProgramRunner, type RunStatus } from "./runner";

/**
 * A real VGA monitor stretched mode 13h's 320x200 across a 4:3 screen, so its
 * pixels were noticeably taller than they were wide. That distortion is part of
 * the subject matter — a "circle" plotted with equal x and y radii came out as an
 * ellipse, and period code compensated for it deliberately — so the authentic
 * display is the default, with square pixels available for when you need to see
 * the buffer as it actually is.
 */
type PixelAspect = "authentic" | "square";

const STATUS_LABEL: Record<RunStatus, string> = {
  booting: "starting DOS…",
  running: "running — click the screen to give it the keyboard",
  exited: "program exited",
  stopped: "stopped",
};

const STATUS_COLOR: Record<RunStatus, string> = {
  booting: "var(--text-dim)",
  running: "var(--vga-light-green)",
  exited: "var(--vga-yellow)",
  stopped: "var(--text-dim)",
};

export function PreviewPane({ executable }: { executable: Uint8Array }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<RunStatus>("booting");
  const [aspect, setAspect] = useState<PixelAspect>("authentic");
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let runner: ProgramRunner | null = null;
    let cancelled = false;

    setError(null);
    setStatus("booting");

    ProgramRunner.start(executable, canvas, { onStatus: setStatus })
      .then((started) => {
        runner = started;
        // StrictMode mounts twice in development; if the effect was already torn
        // down while DOS was booting, shut the emulator straight back down.
        if (cancelled) void started.stop();
        else canvas.focus();
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
      void runner?.stop();
    };
  }, [executable, generation]);

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          marginBottom: "0.75rem",
        }}
      >
        <button
          onClick={() => setGeneration((n) => n + 1)}
          style={{
            font: "inherit",
            padding: "0.35rem 0.9rem",
            borderRadius: 4,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text)",
            cursor: "pointer",
          }}
        >
          Restart
        </button>

        <label style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>
          <input
            type="checkbox"
            checked={aspect === "authentic"}
            onChange={(e) => setAspect(e.target.checked ? "authentic" : "square")}
            style={{ marginRight: "0.4rem" }}
          />
          4:3 pixel aspect
        </label>

        <span style={{ color: STATUS_COLOR[status], fontSize: "0.85rem" }}>
          {STATUS_LABEL[status]}
        </span>
      </div>

      {error && <p style={{ color: "var(--vga-light-red)" }}>{error}</p>}

      <canvas
        ref={canvasRef}
        tabIndex={0}
        style={{
          display: "block",
          width: "100%",
          // 320x200 is 8:5. Presenting it as 4:3 reproduces the vertical stretch
          // a VGA monitor applied; the backing store stays 320x200 either way.
          aspectRatio: aspect === "authentic" ? "4 / 3" : "8 / 5",
          background: "#000",
          border: "1px solid var(--border)",
          borderRadius: 4,
          // Nearest-neighbour upscale. Without this the browser smooths the image
          // and every hard-won pixel turns to mush.
          imageRendering: "pixelated",
          outline: "none",
          cursor: "crosshair",
        }}
      />
    </div>
  );
}
