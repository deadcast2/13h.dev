import { useEffect, useRef, useState } from "react";

import { runProgram, stopProgram, type RunStatus } from "./runner";

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
  running: "running — click the screen for the keyboard",
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

    let cancelled = false;

    setError(null);
    setStatus("booting");

    // Status updates from a superseded runner are dropped. StrictMode mounts
    // twice in development, so the old instance's final "stopped" would otherwise
    // land after the new one's "running" and the UI would read as dead while a
    // program was happily on screen.
    runProgram(executable, canvas, {
      onStatus: (next) => {
        if (!cancelled) setStatus(next);
      },
    })
      .then(() => {
        if (!cancelled) canvas.focus();
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });

    // runProgram and stopProgram share one queue, so this teardown is guaranteed
    // to complete before the next effect's boot begins.
    return () => {
      cancelled = true;
      void stopProgram();
    };
  }, [executable, generation]);

  return (
    <div className="preview">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        className="preview-canvas"
        style={{
          // 320x200 is 8:5. Presenting it as 4:3 reproduces the vertical stretch
          // a VGA monitor applied; the backing store stays 320x200 either way.
          aspectRatio: aspect === "authentic" ? "4 / 3" : "8 / 5",
        }}
      />

      <div className="preview-controls">
        <button className="btn" onClick={() => setGeneration((n) => n + 1)}>
          Restart
        </button>

        <label>
          <input
            type="checkbox"
            checked={aspect === "authentic"}
            onChange={(e) => setAspect(e.target.checked ? "authentic" : "square")}
          />
          4:3 pixels
        </label>
      </div>

      <p className="preview-status" style={{ color: STATUS_COLOR[status] }}>
        {STATUS_LABEL[status]}
      </p>

      {error && <p className="preview-error">{error}</p>}
    </div>
  );
}
