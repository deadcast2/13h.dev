import { useEffect, useRef, useState } from "react";

import type { StoredProject } from "../project/store";

/**
 * Switch between saved projects, and create, rename or delete them.
 *
 * Project names are the user's own labels rather than anything DOS ever sees,
 * so unlike filenames they are not held to 8.3 — only to being non-empty and
 * short enough to read in a toolbar.
 */

const MAX_NAME = 40;

interface Props {
  projects: StoredProject[];
  currentId: string;
  /** False when storage is unavailable; there is then only ever one project. */
  persistent: boolean;
  onSwitch: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
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
        const name = draft.trim().slice(0, MAX_NAME);
        if (name) onCommit(name);
      }}
    >
      <input
        ref={inputRef}
        className="project-input"
        value={draft}
        maxLength={MAX_NAME}
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
  onRename,
  onDelete,
}: Props) {
  const [editing, setEditing] = useState<"new" | "rename" | null>(null);

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
        +
      </button>
      <button
        className="icon-btn"
        disabled={!persistent}
        title={unavailable ?? "Rename this project"}
        onClick={() => setEditing("rename")}
      >
        ✎
      </button>
      <button
        className="icon-btn"
        disabled={!persistent}
        title={unavailable ?? "Delete this project"}
        onClick={() => {
          if (confirm(`Delete "${current?.name}" and everything in it?`)) {
            onDelete(currentId);
          }
        }}
      >
        ✕
      </button>
    </div>
  );
}
