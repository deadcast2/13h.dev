import type { CommandInterface } from "emulators";

import { loadEmulators } from "../dos/emulators";
import { toDosKeyCode } from "../dos/keyCodes";

/**
 * Runs a compiled DOS executable in a visible DOSBox and paints it to a canvas.
 *
 * This is a second, entirely separate emulator from the one that compiles. Keeping
 * them apart means the running program gets a clean machine with nothing on it but
 * its own executable — no compiler, no source, no leftover object files — so
 * "restart" is just a fresh boot rather than an attempt to undo whatever the last
 * run did to the disk.
 */

export type RunStatus = "booting" | "running" | "exited" | "stopped";

export interface RunnerOptions {
  /** 8.3 name of the executable as it will exist on the emulated C:. */
  executableName?: string;
  /** Extra files the program needs at runtime — .BGI drivers, data, art. */
  assets?: { path: string; contents: Uint8Array }[];
  onStatus?: (status: RunStatus) => void;
}

const DOSBOX_CONF = (exe: string) => `
[dosbox]
machine=svga_s3
memsize=16

[cpu]
core=auto
cputype=auto
cycles=max

[render]
# Scaling is handled on the host side, so DOSBox should hand over raw frames.
aspect=false
scaler=none

[autoexec]
mount c .
c:
${exe}
`;

export class ProgramRunner {
  private ci: CommandInterface | null = null;
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private frame: ImageData | null = null;
  private held = new Set<number>();
  private exitPoll: number | null = null;
  private disposed = false;
  private onStatus: (status: RunStatus) => void;

  private constructor(canvas: HTMLCanvasElement, onStatus: (s: RunStatus) => void) {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Could not get a 2D context for the preview.");

    this.canvas = canvas;
    this.context = context;
    this.onStatus = onStatus;
  }

  static async start(
    executable: Uint8Array,
    canvas: HTMLCanvasElement,
    options: RunnerOptions = {},
  ): Promise<ProgramRunner> {
    const exe = options.executableName ?? "MAIN.EXE";
    const runner = new ProgramRunner(canvas, options.onStatus ?? (() => {}));
    runner.onStatus("booting");

    const emulators = await loadEmulators();
    const ci = await emulators.dosboxWorker([
      { dosboxConf: DOSBOX_CONF(exe), jsdosConf: { version: emulators.version } },
      { path: exe, contents: executable },
      ...(options.assets ?? []),
    ]);

    if (runner.disposed) {
      // stop() was called while we were still booting.
      await ci.exit();
      return runner;
    }

    runner.ci = ci;
    runner.attach(ci, exe);
    runner.onStatus("running");
    return runner;
  }

  /**
   * The backing store stays at the emulator's native resolution — 320x200 for mode
   * 13h. Upscaling is left to CSS with image-rendering: pixelated, which gives
   * exact nearest-neighbour without any resampling maths here.
   */
  private resize(width: number, height: number) {
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.frame = this.context.createImageData(width, height);
  }

  private attach(ci: CommandInterface, exe: string) {
    const events = ci.events();

    // The initial frame size is negotiated before dosboxWorker() resolves, so
    // onFrameSize has already fired by the time there is anything to subscribe
    // with. Seed from the current dimensions; the event then only has to carry
    // later changes, such as the switch into mode 13h.
    this.resize(ci.width(), ci.height());
    events.onFrameSize((width, height) => this.resize(width, height));

    events.onFrame((rgb, rgba) => {
      if (!this.frame) return;
      const out = this.frame.data;

      if (rgba) {
        if (rgba.length !== out.length) return;
        out.set(rgba);
      } else if (rgb) {
        // In practice this is the path that runs: the DOSBox backend delivers
        // packed 24-bit RGB and leaves rgba null, so it gets widened here.
        // A mismatched length means a frame raced a mode change; skip it rather
        // than tear a half-old image or overrun the buffer.
        if (rgb.length * 4 !== out.length * 3) return;
        for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
          out[j] = rgb[i];
          out[j + 1] = rgb[i + 1];
          out[j + 2] = rgb[i + 2];
          out[j + 3] = 255;
        }
      } else {
        return;
      }

      this.context.putImageData(this.frame, 0, 0);
    });

    this.canvas.addEventListener("keydown", this.handleKeyDown);
    this.canvas.addEventListener("keyup", this.handleKeyUp);
    this.canvas.addEventListener("blur", this.releaseHeldKeys);

    this.watchForExit(ci, exe);
  }

  /**
   * DOS gives no exit callback, so the running program is identified by polling.
   * When the executable is no longer what's running, control has returned to the
   * shell and the program is done.
   */
  private watchForExit(ci: CommandInterface, exe: string) {
    const target = exe.replace(/\.EXE$/i, "").toUpperCase();
    let sawItRun = false;

    this.exitPoll = window.setInterval(async () => {
      if (this.disposed) return;
      try {
        const running = (await ci.getRunningProgram()).toUpperCase();
        if (running.includes(target)) {
          sawItRun = true;
        } else if (sawItRun) {
          this.onStatus("exited");
          this.stopPolling();
        }
      } catch {
        // Emulator is going away; nothing useful to report.
        this.stopPolling();
      }
    }, 500);
  }

  private stopPolling() {
    if (this.exitPoll !== null) {
      clearInterval(this.exitPoll);
      this.exitPoll = null;
    }
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    const code = toDosKeyCode(event.code);
    if (code === undefined) return;
    // Otherwise the browser acts on arrows, space, F-keys and friends while the
    // program is trying to read them.
    event.preventDefault();
    if (this.held.has(code)) return; // ignore auto-repeat; DOS handles its own
    this.held.add(code);
    this.ci?.sendKeyEvent(code, true);
  };

  private handleKeyUp = (event: KeyboardEvent) => {
    const code = toDosKeyCode(event.code);
    if (code === undefined) return;
    event.preventDefault();
    this.held.delete(code);
    this.ci?.sendKeyEvent(code, false);
  };

  /**
   * Losing focus mid-keypress would otherwise leave the key down forever from
   * DOS's point of view, and the character would run into a wall until you
   * clicked back in and tapped it again.
   */
  private releaseHeldKeys = () => {
    for (const code of this.held) this.ci?.sendKeyEvent(code, false);
    this.held.clear();
  };

  async stop(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.stopPolling();

    this.canvas.removeEventListener("keydown", this.handleKeyDown);
    this.canvas.removeEventListener("keyup", this.handleKeyUp);
    this.canvas.removeEventListener("blur", this.releaseHeldKeys);
    this.releaseHeldKeys();

    const ci = this.ci;
    this.ci = null;
    if (ci) await ci.exit();

    this.onStatus("stopped");
  }
}
