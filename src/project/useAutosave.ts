import { useCallback, useEffect, useRef, useState } from "react";

import { saveProject, type StoredProject } from "./store";
import type { ProjectSnapshot } from "./useProject";

/**
 * Writes the project back as it is edited.
 *
 * There is no Save button and no dirty document to lose, which is the right
 * shape for something with no file system behind it: the work exists in one
 * browser and closing the tab must not be how you find that out.
 */

export type SaveState = "saved" | "saving" | "unavailable";

/** Long enough to coalesce a burst of typing, short enough to be honest. */
const DEBOUNCE_MS = 600;

export function useAutosave(
  project: StoredProject,
  snapshot: ProjectSnapshot,
): SaveState {
  const [state, setState] = useState<SaveState>("saved");

  // The identity fields — name especially — can change from outside this hook,
  // and a save must not write back the copy captured when the debounce started.
  const latest = useRef(project);
  latest.current = project;

  const pending = useRef<ProjectSnapshot | null>(null);
  const isFirstRun = useRef(true);

  const flush = useCallback(async () => {
    const snapshotToWrite = pending.current;
    if (!snapshotToWrite) return;
    pending.current = null;

    try {
      await saveProject({
        ...latest.current,
        ...snapshotToWrite,
        updatedAt: Date.now(),
      });
      setState("saved");
    } catch {
      setState("unavailable");
    }
  }, []);

  useEffect(() => {
    // The snapshot on mount is what was just loaded; writing it back would only
    // bump the timestamp and make every visit look like an edit.
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }

    pending.current = snapshot;
    setState((current) => (current === "unavailable" ? current : "saving"));

    const timer = setTimeout(() => void flush(), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [snapshot, flush]);

  useEffect(() => {
    // `visibilitychange` is the one that can be relied on to finish the write:
    // the page is still alive behind a switched-away tab, whereas `pagehide`
    // may not outlast an async transaction. Both are worth trying.
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") void flush();
    };

    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      // Unmount here means a different project is being opened. The debounce
      // timer was just cancelled by the effect above, so without this the last
      // keystrokes before a switch would be dropped.
      void flush();
    };
  }, [flush]);

  return state;
}
