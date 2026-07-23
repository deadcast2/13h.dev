import { fileKind } from "../project/dosNames";
import type { ProjectFile } from "../project/useProject";

/**
 * Tabs for the open files. The tab strip is the open set and the file list is
 * the project — closing a tab puts the file away without deleting it, which is
 * the distinction every editor makes and the one people expect.
 */
export function EditorTabs({
  files,
  activeId,
  onSelect,
  onClose,
}: {
  files: ProjectFile[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {files.map((file) => (
        <div
          key={file.id}
          className={`tab${file.id === activeId ? " is-active" : ""}`}
          data-kind={fileKind(file.name)}
        >
          <button
            role="tab"
            aria-selected={file.id === activeId}
            className="tab-name"
            onClick={() => onSelect(file.id)}
          >
            {file.name}
          </button>
          <button
            className="icon-btn"
            title={`Close ${file.name}`}
            onClick={() => onClose(file.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
