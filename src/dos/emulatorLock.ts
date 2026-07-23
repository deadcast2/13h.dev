/**
 * Global serialisation of DOSBox instance lifecycle.
 *
 * Every `dosboxWorker(...)` and `ci.exit()` goes through here, so at most one
 * emulator is being created or destroyed at a time, and — combined with
 * runProgram()'s stop-then-start — at most one preview emulator exists at all.
 *
 * This is a deliberate resource decision rather than a workaround for a known
 * bug. Each instance is a Web Worker holding a 1.4 MB WebAssembly module and a
 * 16 MB emulated machine, and nothing in this app needs two at once: you build,
 * then you run. Serialising also makes Restart deterministic, however fast it is
 * clicked — the previous machine is always gone before the next one boots.
 *
 * The cost is that a compile cannot overlap a preview boot. Neither takes much
 * more than a second, and they are sequential from the user's point of view.
 */
class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    // `.then(task, task)` runs the next task whether the previous settled or
    // threw, so one failed boot cannot wedge the queue permanently.
    const result = this.tail.then(task, task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

/**
 * Never call this from inside a task already running on it — the inner call
 * waits for the outer one to finish, which it cannot, and the queue deadlocks.
 * That is why ProgramRunner.boot() and .shutdown() are unlocked, and only the
 * runProgram()/stopProgram() wrappers take the lock.
 */
export const emulatorLock = new Mutex();
