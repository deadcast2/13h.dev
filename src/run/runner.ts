import type { CommandInterface } from "emulators";

import { emulatorLock } from "../dos/emulatorLock";
import { loadEmulators } from "../dos/emulators";
import { copyForEmulator } from "../dos/initFs";
import { toDosKeyCode } from "../dos/keyCodes";

/**
 * Runs a compiled DOS executable in a visible DOSBox and paints it to a canvas.
 *
 * This is a separate emulator from the one that compiles. The running program
 * gets a clean machine with nothing on it but its own executable — no compiler,
 * no sources, no leftover object files — so a restart is a fresh boot rather than
 * an attempt to undo whatever the last run did to the disk.
 *
 * Exactly one preview emulator exists at a time, enforced by runProgram() below.
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
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly onStatus: (status: RunStatus) => void;
  private frame: ImageData | null = null;
  private held = new Set<number>();
  private exitPoll: number | null = null;
  private disposed = false;
  private framesSeen = 0;

  constructor(canvas: HTMLCanvasElement, onStatus: (status: RunStatus) => void) {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Could not get a 2D context for the preview.");

    this.canvas = canvas;
    this.context = context;
    this.onStatus = onStatus;
  }

  /**
   * Boots the emulator. Not locked — callers must already hold the emulator lock,
   * which runProgram() does. Calling this directly risks two live instances.
   */
  async boot(executable: Uint8Array, options: RunnerOptions): Promise<void> {
    const exe = options.executableName ?? "MAIN.EXE";
    this.onStatus("booting");

    const emulators = await loadEmulators();
    // The caller keeps its executable across restarts and recompiles, so it must
    // not be the buffer that gets transferred away.
    const ci = await emulators.dosboxWorker(
      copyForEmulator([
        { dosboxConf: DOSBOX_CONF(exe), jsdosConf: { version: emulators.version } },
        { path: exe, contents: executable },
        ...(options.assets ?? []),
      ]),
    );

    if (this.disposed) {
      await ci.exit();
      return;
    }

    this.ci = ci;
    this.attach(ci, exe);
    this.onStatus("running");
  }

  /**
   * The backing store stays at the emulator's native resolution — 320x200 for mode
   * 13h. Upscaling is left to CSS with image-rendering: pixelated, which gives
   * exact nearest-neighbour without any resampling maths here.
   */
  private resize(width: number, height: number) {
    // Assigning width/height clears the canvas, so a stopped runner must not do
    // it — that would blank whatever replaced it.
    if (this.disposed) return;
    if (this.frame?.width === width && this.frame?.height === height) return;

    this.canvas.width = width;
    this.canvas.height = height;
    this.frame = this.context.createImageData(width, height);
  }

  private attach(ci: CommandInterface, exe: string) {
    const events = ci.events();

    events.onFrameSize((width, height) => this.resize(width, height));

    events.onFrame((rgb, rgba) => {
      // Frames can still arrive between stop() and the emulator going away.
      if (this.disposed) return;

      const source = rgba ?? rgb;
      if (!source) return;
      // In practice rgba is always null and the packed 24-bit RGB path is the one
      // that runs, but the backend's type allows either.
      const stride = rgba ? 4 : 3;

      // Dimensions are re-read per frame rather than cached at startup.
      // onFrameSize does not fire for the size already in effect when the
      // emulator becomes ready, and the dimensions do not reflect the real mode
      // until it has settled — so a size sampled at boot is simply wrong, and
      // caching it means every frame fails the length check below and the screen
      // stays black. Re-reading is self-correcting across boot and mode switches.
      this.framesSeen++;

      const width = ci.width();
      const height = ci.height();
      if (this.frame?.width !== width || this.frame?.height !== height) {
        this.resize(width, height);
      }
      if (!this.frame || source.length !== width * height * stride) {
        return; // mid mode-change; the next frame will be consistent
      }

      const out = this.frame.data;
      if (stride === 4) {
        out.set(source);
      } else {
        for (let i = 0, j = 0; i < source.length; i += 3, j += 4) {
          out[j] = source[i];
          out[j + 1] = source[i + 1];
          out[j + 2] = source[i + 2];
          out[j + 3] = 255;
        }
      }

      this.context.putImageData(this.frame, 0, 0);
    });

    this.canvas.addEventListener("keydown", this.handleKeyDown);
    this.canvas.addEventListener("keyup", this.handleKeyUp);
    this.canvas.addEventListener("blur", this.releaseHeldKeys);

    void this.seedFromFramebuffer(ci);
    this.watchForExit(ci, exe);
  }

  /**
   * Paints the emulator's current framebuffer until live frames start arriving.
   *
   * DOSBox only emits a frame for lines that *change*. A program that draws its
   * screen once and then waits for a key — which is most of them, and every
   * example in a graphics book — leaves a completely static display, so if it
   * finishes painting before we have subscribed, not one frame is ever sent and
   * the canvas stays black indefinitely. The emulator becomes ready only after
   * [autoexec] has begun, so losing that race is normal rather than unlucky.
   *
   * Reading the framebuffer directly closes the gap. It stops as soon as a real
   * frame arrives, so animated programs pay for a couple of grabs at startup and
   * nothing after.
   */
  private async seedFromFramebuffer(ci: CommandInterface) {
    const deadline = Date.now() + 4000;

    while (!this.disposed && this.framesSeen === 0 && Date.now() < deadline) {
      try {
        const shot = await ci.screenshot();
        if (this.disposed || this.framesSeen > 0) return;
        this.resize(shot.width, shot.height);
        this.context.putImageData(shot, 0, 0);
      } catch {
        // Emulator not ready to be captured yet; try again shortly.
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
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

  /**
   * Tears the emulator down. Not locked, for the same reason boot() isn't.
   */
  async shutdown(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.stopPolling();

    this.canvas.removeEventListener("keydown", this.handleKeyDown);
    this.canvas.removeEventListener("keyup", this.handleKeyUp);
    this.canvas.removeEventListener("blur", this.releaseHeldKeys);
    this.releaseHeldKeys();

    const ci = this.ci;
    this.ci = null;
    this.onStatus("stopped");
    if (ci) await ci.exit();
  }
}

/** The single live preview emulator, if any. */
let active: ProgramRunner | null = null;

/**
 * Replaces whatever is currently running with a fresh boot of `executable`.
 *
 * Stopping the old instance and starting the new one happen as one unit on the
 * emulator lock, so the two can never be alive at the same time however quickly
 * Restart is clicked or however often StrictMode re-runs the effect.
 */
export function runProgram(
  executable: Uint8Array,
  canvas: HTMLCanvasElement,
  options: RunnerOptions = {},
): Promise<ProgramRunner> {
  return emulatorLock.run(async () => {
    if (active) {
      await active.shutdown();
      active = null;
    }

    const runner = new ProgramRunner(canvas, options.onStatus ?? (() => {}));
    await runner.boot(executable, options);
    active = runner;
    return runner;
  });
}

/** Stops the live preview, if there is one. */
export function stopProgram(): Promise<void> {
  return emulatorLock.run(async () => {
    if (active) {
      await active.shutdown();
      active = null;
    }
  });
}
