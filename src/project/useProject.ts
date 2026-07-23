import { useCallback, useMemo, useState } from "react";

import type { SourceFile } from "../build/turboc";
import { compareDosNames, fileKind, normalizeDosName, splitDosName } from "./dosNames";

/**
 * The in-memory project: a flat set of files, which of them are open as tabs,
 * and which one is showing.
 *
 * Files carry an `id` that is independent of their name, so a rename is an edit
 * rather than a delete-and-recreate. The editor keys its Monaco models off the
 * same id, which is what lets undo history and cursor position survive one.
 *
 * Nothing here is persisted yet — step 5 puts this behind IndexedDB.
 */

export interface ProjectFile extends SourceFile {
  id: string;
}

let idCounter = 0;
const nextId = () => `f${++idCounter}`;

/**
 * A new header gets its include guard written for it. Not decoration: every file
 * in a project this size ends up included from two places sooner or later, and
 * the redefinition errors that follow are a poor introduction.
 */
function templateFor(name: string): string {
  if (fileKind(name) !== "header") return "";
  const guard = `${splitDosName(name).stem}_H`;
  return `#ifndef ${guard}\n#define ${guard}\n\n\n\n#endif\n`;
}

const sortFiles = (files: ProjectFile[]): ProjectFile[] =>
  [...files].sort((a, b) => compareDosNames(a.name, b.name));

export interface ProjectApi {
  /** Every file, in display order. */
  files: ProjectFile[];
  /** The subset with a tab, in the order they were opened. */
  openFiles: ProjectFile[];
  activeId: string | null;
  activeFile: ProjectFile | null;
  open: (id: string) => void;
  close: (id: string) => void;
  create: (name: string) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  setText: (id: string, text: string) => void;
}

export function useProject(initial: SourceFile[]): ProjectApi {
  const [files, setFiles] = useState<ProjectFile[]>(() =>
    sortFiles(initial.map((file) => ({ ...file, id: nextId() }))),
  );
  const [openIds, setOpenIds] = useState<string[]>(() => files.map((file) => file.id));
  const [activeId, setActiveId] = useState<string | null>(() => files[0]?.id ?? null);

  const open = useCallback((id: string) => {
    setOpenIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
    setActiveId(id);
  }, []);

  const close = useCallback((id: string) => {
    setOpenIds((ids) => {
      const index = ids.indexOf(id);
      if (index === -1) return ids;
      const next = ids.filter((other) => other !== id);
      // Closing the visible tab hands focus to its right-hand neighbour, or the
      // left one if it was last — the same thing every editor does, and the only
      // choice that doesn't feel like the editor lost your place.
      setActiveId((current) =>
        current === id ? (next[index] ?? next[index - 1] ?? null) : current,
      );
      return next;
    });
  }, []);

  const create = useCallback((raw: string) => {
    const name = normalizeDosName(raw);
    const file: ProjectFile = { id: nextId(), name, text: templateFor(name) };
    setFiles((current) => sortFiles([...current, file]));
    setOpenIds((ids) => [...ids, file.id]);
    setActiveId(file.id);
  }, []);

  const rename = useCallback((id: string, raw: string) => {
    const name = normalizeDosName(raw);
    setFiles((current) =>
      sortFiles(current.map((file) => (file.id === id ? { ...file, name } : file))),
    );
  }, []);

  const remove = useCallback(
    (id: string) => {
      setFiles((current) => current.filter((file) => file.id !== id));
      close(id);
    },
    [close],
  );

  const setText = useCallback((id: string, text: string) => {
    setFiles((current) =>
      // Same-value edits arrive whenever a Monaco model is reset from state;
      // returning the array unchanged keeps them from re-rendering the editor.
      current.some((file) => file.id === id && file.text !== text)
        ? current.map((file) => (file.id === id ? { ...file, text } : file))
        : current,
    );
  }, []);

  const openFiles = useMemo(
    () =>
      openIds
        .map((id) => files.find((file) => file.id === id))
        .filter((file): file is ProjectFile => file !== undefined),
    [openIds, files],
  );

  const activeFile = useMemo(
    () => files.find((file) => file.id === activeId) ?? null,
    [files, activeId],
  );

  return {
    files,
    openFiles,
    activeId,
    activeFile,
    open,
    close,
    create,
    rename,
    remove,
    setText,
  };
}
