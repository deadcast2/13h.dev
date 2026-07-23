import { describe, expect, it } from "vitest";

import { emulatorLock } from "./emulatorLock";

/**
 * The mutex every emulator create and destroy goes through. Each instance is a
 * worker holding a 1.4 MB wasm module and a 16 MB machine, and the whole design
 * rests on there never being two.
 *
 * Deliberately not tested: calling `run()` from inside a task already on it.
 * That deadlocks by design — the inner call waits on the outer one, which
 * cannot finish — so a test for it could only assert that the suite hangs. The
 * rule lives in a comment on the export and in CLAUDE.md instead.
 *
 * Note that the lock is module state shared by every test here, which is what
 * it is in the app too. Each test below leaves it settled.
 */

/** A promise plus the handles to settle it, so ordering is decided, not raced. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("emulatorLock", () => {
  it("does not start a task while another is running", async () => {
    const first = deferred();
    let secondStarted = false;

    const a = emulatorLock.run(() => first.promise);
    const b = emulatorLock.run(async () => {
      secondStarted = true;
    });

    // Give anything queued a chance to run, which it must not have.
    await Promise.resolve();
    expect(secondStarted).toBe(false);

    first.resolve();
    await a;
    await b;
    expect(secondStarted).toBe(true);
  });

  it("runs queued tasks in the order they were asked for", async () => {
    const order: number[] = [];

    await Promise.all(
      [1, 2, 3, 4].map((n) =>
        emulatorLock.run(async () => {
          order.push(n);
        }),
      ),
    );

    expect(order).toEqual([1, 2, 3, 4]);
  });

  it("never overlaps, even when tasks settle out of order", async () => {
    let running = 0;
    let mostAtOnce = 0;

    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        emulatorLock.run(async () => {
          running += 1;
          mostAtOnce = Math.max(mostAtOnce, running);
          // A varying number of microtask turns, so a task that yields cannot
          // let the next one in behind it.
          for (let turn = 0; turn < (i % 3) + 1; turn++) await Promise.resolve();
          running -= 1;
        }),
      ),
    );

    expect(mostAtOnce).toBe(1);
  });

  it("gives each caller its own result", async () => {
    const [a, b] = await Promise.all([
      emulatorLock.run(async () => "first"),
      emulatorLock.run(async () => "second"),
    ]);

    expect([a, b]).toEqual(["first", "second"]);
  });

  it("rejects the caller whose task failed", async () => {
    await expect(
      emulatorLock.run(async () => {
        throw new Error("boot failed");
      }),
    ).rejects.toThrow("boot failed");
  });

  it("keeps the queue moving after a failed task", async () => {
    // One failed boot must not wedge every later build and preview — which is
    // what `.then(task, task)` is for.
    const failed = emulatorLock.run(async () => {
      throw new Error("boot failed");
    });
    const after = emulatorLock.run(async () => "still working");

    await expect(failed).rejects.toThrow("boot failed");
    await expect(after).resolves.toBe("still working");
  });

  it("waits for a failing task to settle before starting the next", async () => {
    const first = deferred();
    let secondStarted = false;

    const a = emulatorLock.run(() => first.promise);
    const b = emulatorLock.run(async () => {
      secondStarted = true;
    });

    await Promise.resolve();
    expect(secondStarted).toBe(false);

    first.reject(new Error("teardown failed"));
    await expect(a).rejects.toThrow("teardown failed");
    await b;
    expect(secondStarted).toBe(true);
  });
});
