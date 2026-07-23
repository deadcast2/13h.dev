import { useCallback, useEffect, useRef, useState } from "react";

import { NEW_PROJECT, STARTER_PROJECT } from "../build/samples";
import {
  deleteProject as removeProject,
  listProjects,
  newProject,
  saveProject,
  updateProject,
  type StoredProject,
} from "./store";

/**
 * The set of saved projects, and which one is open.
 *
 * This owns identity — names, creation, deletion, which project is current —
 * and nothing about the contents. The workbench owns those and writes them
 * straight to storage as they are edited, which is why switching re-reads
 * rather than handing over the copy in `projects`: that copy stops being
 * current the moment anything is typed.
 */

const STARTER_NAME = "Mode 13h starter";

export interface ProjectsApi {
  projects: StoredProject[];
  /** null only while the first read is in flight. */
  current: StoredProject | null;
  ready: boolean;
  /**
   * False when IndexedDB is unavailable — private mode, or storage blocked. The
   * app still works, on a single project, in memory, and says so rather than
   * pretending the work is safe.
   */
  persistent: boolean;
  switchTo: (id: string) => void;
  create: (name: string) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
}

export function useProjects(): ProjectsApi {
  const [projects, setProjects] = useState<StoredProject[]>([]);
  const [current, setCurrent] = useState<StoredProject | null>(null);
  const [ready, setReady] = useState(false);
  const [persistent, setPersistent] = useState(true);

  /**
   * Marks a project as the one to reopen next visit, and makes it current.
   *
   * Touches the one field rather than writing back the copy from `list`. That
   * copy is a snapshot of a read, and the workbench has very possibly saved over
   * it since; putting it back would undo whatever was typed in between. The
   * record that comes back is the current one, which is also what makes it safe
   * to hand to the workbench.
   */
  const openFrom = useCallback(async (list: StoredProject[], id: string) => {
    const opened = await updateProject(id, { lastOpenedAt: Date.now() });
    if (!opened) return;

    setProjects(list.map((project) => (project.id === id ? opened : project)));
    setCurrent(opened);
  }, []);

  /**
   * "Create a starter if there are none" is not idempotent, and StrictMode
   * deliberately runs effects twice: both passes read an empty store and both
   * write a starter, leaving the user with two. Refs survive the remount, so
   * this is the one effect here that must be told to run exactly once.
   */
  const initialised = useRef(false);

  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;

    void (async () => {
      try {
        let list = await listProjects();
        if (list.length === 0) {
          const starter = newProject(STARTER_NAME, STARTER_PROJECT);
          await saveProject(starter);
          list = [starter];
        }
        // listProjects sorts most-recently-opened first, so this resumes
        // wherever the last visit left off.
        await openFrom(list, list[0].id);
      } catch {
        const starter = newProject(STARTER_NAME, STARTER_PROJECT);
        setProjects([starter]);
        setCurrent(starter);
        setPersistent(false);
      } finally {
        setReady(true);
      }
    })();
  }, [openFrom]);

  /** Every mutation goes through storage and then re-reads, so the list is never a guess. */
  const withFreshList = useCallback(
    async (action: (list: StoredProject[]) => Promise<void>) => {
      try {
        await action(await listProjects());
      } catch {
        setPersistent(false);
      }
    },
    [],
  );

  const switchTo = useCallback(
    (id: string) => {
      if (id === current?.id) return;
      void withFreshList((list) => openFrom(list, id));
    },
    [current?.id, openFrom, withFreshList],
  );

  const create = useCallback(
    (name: string) => {
      void withFreshList(async (list) => {
        const created = newProject(name, NEW_PROJECT);
        await saveProject(created);
        await openFrom([created, ...list], created.id);
      });
    },
    [openFrom, withFreshList],
  );

  const rename = useCallback(
    (id: string, name: string) => {
      void withFreshList(async (list) => {
        // Only the name; the file contents are the workbench's and are very
        // likely newer than anything this read.
        const renamed = await updateProject(id, { name, updatedAt: Date.now() });
        if (!renamed) return;

        setProjects(list.map((project) => (project.id === id ? renamed : project)));
        setCurrent((open) => (open?.id === id ? { ...open, name } : open));
      });
    },
    [withFreshList],
  );

  const remove = useCallback(
    (id: string) => {
      void withFreshList(async (list) => {
        await removeProject(id);
        const rest = list.filter((project) => project.id !== id);

        if (rest.length === 0) {
          // Deleting the last project leaves a fresh one rather than an empty
          // application with nothing to show.
          const starter = newProject(STARTER_NAME, STARTER_PROJECT);
          await saveProject(starter);
          await openFrom([starter], starter.id);
          return;
        }

        setProjects(rest);
        if (id === current?.id) await openFrom(rest, rest[0].id);
      });
    },
    [current?.id, openFrom, withFreshList],
  );

  return { projects, current, ready, persistent, switchTo, create, rename, remove };
}
