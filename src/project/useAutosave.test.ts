// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { updateProject, type StoredProject } from "./store";
import { useAutosave } from "./useAutosave";
import type { ProjectSnapshot } from "./useProject";

/**
 * There is no Save button, so this hook is the only thing standing between the
 * user and losing work. Two of its behaviours were found the hard way and are
 * invisible when they break: it must write only the fields it owns, or a save
 * puts back a name the user just changed; and it must flush on unmount, or the
 * last few hundred milliseconds of typing before a project switch are simply
 * gone.
 *
 * The store is mocked here rather than exercised — what is under test is when a
 * write happens and what is in it. That the write itself is safe against a
 * concurrent one is store.test.ts's subject.
 */

vi.mock("./store", () => ({ updateProject: vi.fn() }));

const mockedUpdate = vi.mocked(updateProject);

const project = (id = "p1"): StoredProject => ({
  id,
  name: "Starter",
  files: [],
  openNames: [],
  activeName: null,
  createdAt: 0,
  updatedAt: 0,
  lastOpenedAt: 0,
});

const snapshot = (text: string): ProjectSnapshot => ({
  files: [{ name: "MAIN.C", text }],
  openNames: ["MAIN.C"],
  activeName: "MAIN.C",
});

/** Long enough to pass the debounce in useAutosave. */
const DEBOUNCE = 600;

interface Props {
  stored: StoredProject;
  snapshot: ProjectSnapshot;
}

const mount = (initial: ProjectSnapshot = snapshot("v1"), stored = project()) =>
  renderHook(({ stored, snapshot }: Props) => useAutosave(stored, snapshot), {
    initialProps: { stored, snapshot: initial },
  });

beforeEach(() => {
  // Only the timer functions; promises still resolve on their own, which the
  // flush depends on.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  mockedUpdate.mockReset();
  mockedUpdate.mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("when it writes", () => {
  it("does not write the snapshot it was mounted with", async () => {
    mount();
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE * 4);
    });

    // Writing it back would only bump the timestamp and make every visit that
    // touched nothing look like an edit.
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("writes once the typing stops", async () => {
    const { rerender } = mount();

    rerender({ stored: project(), snapshot: snapshot("v2") });
    expect(mockedUpdate).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE);
    });
    expect(mockedUpdate).toHaveBeenCalledTimes(1);
  });

  it("coalesces a burst of keystrokes into one write, carrying the last", async () => {
    const { rerender } = mount();

    for (const text of ["v2", "v3", "v4"]) {
      rerender({ stored: project(), snapshot: snapshot(text) });
      act(() => {
        vi.advanceTimersByTime(100);
      });
    }

    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE);
    });

    expect(mockedUpdate).toHaveBeenCalledTimes(1);
    expect(mockedUpdate.mock.calls[0][1].files).toEqual(snapshot("v4").files);
  });
});

describe("what it writes", () => {
  it("writes its own fields and nothing else", async () => {
    const { rerender } = mount();
    rerender({ stored: project(), snapshot: snapshot("v2") });
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE);
    });

    // The name and lastOpenedAt belong to the project list. Carrying them along
    // here is how a save could put back a name the user had just changed.
    expect(Object.keys(mockedUpdate.mock.calls[0][1]).sort()).toEqual([
      "activeName",
      "files",
      "openNames",
      "updatedAt",
    ]);
  });

  it("writes to the project it currently has, not the one it was mounted with", async () => {
    const { rerender } = mount();

    rerender({ stored: project("p2"), snapshot: snapshot("v2") });
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE);
    });

    expect(mockedUpdate.mock.calls[0][0]).toBe("p2");
  });
});

describe("flushing", () => {
  it("writes pending work on unmount", async () => {
    const { rerender, unmount } = mount();

    rerender({ stored: project(), snapshot: snapshot("typed just now") });
    // Deliberately short of the debounce: this is the project-switch case, where
    // the remount cancels the timer that would otherwise have saved this.
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE - 100);
    });
    expect(mockedUpdate).not.toHaveBeenCalled();

    unmount();

    expect(mockedUpdate).toHaveBeenCalledTimes(1);
    expect(mockedUpdate.mock.calls[0][1].files).toEqual(
      snapshot("typed just now").files,
    );
  });

  it("writes nothing on unmount when nothing is pending", async () => {
    const { unmount } = mount();
    unmount();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("does not write the same pending snapshot twice", async () => {
    const { rerender, unmount } = mount();

    rerender({ stored: project(), snapshot: snapshot("v2") });
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE);
    });
    expect(mockedUpdate).toHaveBeenCalledTimes(1);

    unmount();
    expect(mockedUpdate).toHaveBeenCalledTimes(1);
  });

  it("writes when the tab is hidden, which may be the last chance", async () => {
    const { rerender } = mount();
    rerender({ stored: project(), snapshot: snapshot("v2") });

    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(mockedUpdate).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
  });

  it("writes on pagehide", async () => {
    const { rerender } = mount();
    rerender({ stored: project(), snapshot: snapshot("v2") });

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(mockedUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("what it reports", () => {
  it("starts saved, since nothing has been typed", () => {
    expect(mount().result.current).toBe("saved");
  });

  it("says saving while a write is owed, then saved", async () => {
    const { result, rerender } = mount();

    act(() => {
      rerender({ stored: project(), snapshot: snapshot("v2") });
    });
    expect(result.current).toBe("saving");

    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE);
    });
    expect(result.current).toBe("saved");
  });

  it("says storage is unavailable when a write fails", async () => {
    mockedUpdate.mockRejectedValue(new Error("storage is blocked"));
    const { result, rerender } = mount();

    rerender({ stored: project(), snapshot: snapshot("v2") });
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE);
    });

    expect(result.current).toBe("unavailable");
  });

  it("keeps saying unavailable rather than flickering back to saving", async () => {
    mockedUpdate.mockRejectedValue(new Error("storage is blocked"));
    const { result, rerender } = mount();

    rerender({ stored: project(), snapshot: snapshot("v2") });
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE);
    });

    act(() => {
      rerender({ stored: project(), snapshot: snapshot("v3") });
    });
    expect(result.current).toBe("unavailable");
  });
});
