import { useEffect, useRef, useState } from "react";

import { Icon } from "../Icon";
import { fileKind, validateDosName } from "../project/dosNames";
import type { ProjectFile } from "../project/useProject";
import { ConfirmDelete } from "./ConfirmDelete";

/**
 * The project's files. Flat, because DOS projects of this vintage were flat and
 * the build mounts a single directory.
 *
 * Naming is where the 8.3 rules are enforced, so this is also where they are
 * explained: the input rejects on submit with the specific reason rather than
 * silently correcting, which would leave the user's `#include` lines pointing at
 * names they never chose.
 */

interface Props {
  files: ProjectFile[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

/** Shared by the new-file row and the rename-in-place row. */
function NameInput({
  initial,
  taken,
  onCommit,
  onCancel,
}: {
  initial: string;
  taken: string[];
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const problem = validateDosName(draft, taken);
    if (problem) {
      setError(problem);
      return;
    }
    onCommit(draft);
  }

  return (
    <form onSubmit={submit} className="tree-form">
      <input
        ref={inputRef}
        className="tree-input"
        value={draft}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
        // Committing on blur would fight the Escape key and swallow errors, so
        // leaving the field simply abandons the edit.
        onBlur={onCancel}
        placeholder="NAME.C"
      />
      {error && <p className="tree-error">{error}</p>}
    </form>
  );
}

export function FileTree({ files, activeId, onOpen, onCreate, onRename, onDelete }: Props) {
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const names = files.map((file) => file.name);

  return (
    <div className="pane tree">
      <header className="pane-header">
        <span>Files</span>
        <button
          className="icon-btn"
          title="New file"
          onClick={() => {
            setRenamingId(null);
            setConfirmingDeleteId(null);
            setCreating(true);
          }}
        >
          <Icon name="newFile" />
        </button>
      </header>

      <ul className="tree-list">
        {files.map((file) => {
          if (renamingId === file.id) {
            return (
              <li key={file.id}>
                <NameInput
                  initial={file.name}
                  taken={names.filter((name) => name !== file.name)}
                  onCommit={(name) => {
                    onRename(file.id, name);
                    setRenamingId(null);
                  }}
                  onCancel={() => setRenamingId(null)}
                />
              </li>
            );
          }

          if (confirmingDeleteId === file.id) {
            return (
              <li key={file.id}>
                <ConfirmDelete
                  className="tree-confirm"
                  message={`Delete ${file.name}?`}
                  onConfirm={() => {
                    onDelete(file.id);
                    setConfirmingDeleteId(null);
                  }}
                  onCancel={() => setConfirmingDeleteId(null)}
                />
              </li>
            );
          }

          return (
            <li key={file.id}>
              <div
                className={`tree-row${file.id === activeId ? " is-active" : ""}`}
                data-kind={fileKind(file.name)}
              >
                <button
                  className="tree-name"
                  onClick={() => onOpen(file.id)}
                  onDoubleClick={() => setRenamingId(file.id)}
                  title={`${file.name} — double-click to rename`}
                >
                  {file.name}
                </button>
                <button
                  className="icon-btn"
                  title={`Rename ${file.name}`}
                  onClick={() => {
                    setCreating(false);
                    setConfirmingDeleteId(null);
                    setRenamingId(file.id);
                  }}
                >
                  <Icon name="rename" />
                </button>
                <button
                  className="icon-btn"
                  title={`Delete ${file.name}`}
                  disabled={files.length === 1}
                  onClick={() => {
                    setRenamingId(null);
                    setConfirmingDeleteId(file.id);
                  }}
                >
                  <Icon name="delete" />
                </button>
              </div>
            </li>
          );
        })}

        {creating && (
          <li>
            <NameInput
              initial=""
              taken={names}
              onCommit={(name) => {
                onCreate(name);
                setCreating(false);
              }}
              onCancel={() => setCreating(false)}
            />
          </li>
        )}
      </ul>

      <p className="tree-hint">
        8.3 names only — up to eight characters, a dot, then up to three.{" "}
        <code>.C</code>, <code>.CPP</code> and <code>.ASM</code> are compiled;{" "}
        <code>.H</code> and <code>.INC</code> are written to the build directory
        to be included, not built. Assembly needs a <code>TASM.EXE</code>{" "}
        supplied with your disks.
      </p>
    </div>
  );
}
