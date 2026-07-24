import { useEffect, useRef, useState } from "react";

import { Icon } from "../Icon";
import { MAX_PROJECT_NAME, type StoredProject } from "../project/store";
import { EXPORT_EXTENSION } from "../project/transfer";
import { ConfirmDelete } from "./ConfirmDelete";

/**
 * Switch between saved projects; create, rename, delete, import and export them.
 *
 * Project names are the user's own labels rather than anything DOS ever sees,
 * so unlike filenames they are not held to 8.3 — only to being non-empty and
 * short enough to read in a toolbar.
 */

interface Props {
  projects: StoredProject[];
  currentId: string;
  /** False when storage is unavailable; there is then only ever one project. */
  persistent: boolean;
  onSwitch: (id: string) => void;
  onCreate: (name: string) => void;
  /** Makes a copy of the live project — its files as they are now, not as stored. */
  onDuplicate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** Builds the file from the live project, which only the workbench has. */
  onExport: () => void;
  /** Encodes the live project into a link and copies it, again from the workbench. */
  onShare: () => void;
  /**
   * Reading and checking the file is the workbench's, because that is where a
   * rejection can be shown at full width. This only picks it.
   */
  onImportFile: (file: File) => void;
}

function NameField({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  return (
    <form
      className="project-form"
      onSubmit={(event) => {
        event.preventDefault();
        const name = draft.trim().slice(0, MAX_PROJECT_NAME);
        if (name) onCommit(name);
      }}
    >
      <input
        ref={inputRef}
        className="project-input"
        value={draft}
        maxLength={MAX_PROJECT_NAME}
        spellCheck={false}
        autoComplete="off"
        placeholder="Project name"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
        onBlur={onCancel}
      />
    </form>
  );
}

export function ProjectMenu({
  projects,
  currentId,
  persistent,
  onSwitch,
  onCreate,
  onDuplicate,
  onRename,
  onDelete,
  onExport,
  onShare,
  onImportFile,
}: Props) {
  const [editing, setEditing] = useState<"new" | "rename" | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const current = projects.find((project) => project.id === currentId);

  if (editing) {
    return (
      <NameField
        initial={editing === "rename" ? (current?.name ?? "") : ""}
        onCommit={(name) => {
          if (editing === "rename") onRename(currentId, name);
          else onCreate(name);
          setEditing(null);
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  // Swaps the toolbar for the prompt, the way a rename does — the switcher and
  // its buttons are gone while the question stands, so there is no second delete
  // to press behind it.
  if (confirmingDelete) {
    return (
      <ConfirmDelete
        className="project-confirm"
        message={`Delete "${current?.name}" and everything in it?`}
        onConfirm={() => {
          onDelete(currentId);
          setConfirmingDelete(false);
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    );
  }

  const unavailable = persistent ? undefined : "Storage is unavailable in this browser";

  return (
    <div className="project-menu">
      <select
        className="project-select"
        value={currentId}
        disabled={!persistent}
        title={unavailable ?? "Switch project"}
        onChange={(event) => onSwitch(event.target.value)}
      >
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>

      <button
        className="icon-btn"
        disabled={!persistent}
        title={unavailable ?? "New project"}
        onClick={() => setEditing("new")}
      >
        <Icon name="new" />
      </button>
      {/* Needs somewhere to keep the copy, so it goes with the storage-gated
          group: without persistence there is only ever one project. */}
      <button
        className="icon-btn"
        disabled={!persistent}
        title={unavailable ?? `Duplicate "${current?.name}"`}
        onClick={onDuplicate}
      >
        <Icon name="copy" />
      </button>
      <button
        className="icon-btn"
        disabled={!persistent}
        title={unavailable ?? "Rename this project"}
        onClick={() => setEditing("rename")}
      >
        <Icon name="rename" />
      </button>
      <button
        className="icon-btn"
        disabled={!persistent}
        title={unavailable ?? "Delete this project"}
        onClick={() => setConfirmingDelete(true)}
      >
        <Icon name="delete" />
      </button>

      {/*
        Neither of these is disabled when storage is unavailable. That is the
        state in which they matter most: a project you can carry as a file is
        the only kind a private-mode browser can keep at all.
      */}
      <button
        className="icon-btn"
        title={`Export "${current?.name}" to a file`}
        onClick={onExport}
      >
        <Icon name="export" />
      </button>
      <button
        className="icon-btn"
        title="Import a project from a file"
        onClick={() => fileRef.current?.click()}
      >
        <Icon name="import" />
      </button>
      <button
        className="icon-btn"
        title={`Copy a link that opens a copy of "${current?.name}"`}
        onClick={onShare}
      >
        <Icon name="share" />
      </button>

      <input
        ref={fileRef}
        type="file"
        hidden
        accept={`${EXPORT_EXTENSION},application/json`}
        onChange={(event) => {
          const [file] = event.target.files ?? [];
          // Cleared so that picking the same file twice in a row still fires a
          // change event — re-importing after a mistake is an obvious thing to
          // try, and an input that silently does nothing is not an answer.
          event.target.value = "";
          if (file) onImportFile(file);
        }}
      />
    </div>
  );
}
