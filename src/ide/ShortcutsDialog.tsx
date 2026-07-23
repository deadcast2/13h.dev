import { useEffect } from "react";

import { Icon } from "../Icon";

/**
 * What the keyboard does.
 *
 * Ctrl+B is on the Build button and needs no help, but almost everything else
 * here belongs to Monaco and is therefore completely invisible: the editor
 * arrived with a command palette, multi-cursor and find-and-replace already in
 * it, and nothing in the interface says so. This is the one place that says so.
 *
 * Only bindings that have been checked in this app are listed. Monaco ships a
 * great many more, which is what the command palette row is for.
 */

interface Shortcut {
  keys: string;
  what: string;
}

const BUILD: Shortcut[] = [{ keys: "Ctrl+B", what: "Compile the project and run it" }];

const EDITING: Shortcut[] = [
  { keys: "F1", what: "Command palette — everything the editor can do" },
  { keys: "Ctrl+F", what: "Find in this file" },
  { keys: "Ctrl+H", what: "Replace in this file" },
  { keys: "Ctrl+/", what: "Comment or uncomment the selection" },
  { keys: "Ctrl+D", what: "Select the next occurrence of the selection" },
  { keys: "Alt+↑ / Alt+↓", what: "Move the current line" },
  { keys: "Shift+Alt+↑ / ↓", what: "Copy the current line up or down" },
  { keys: "Ctrl+Space", what: "Suggest a word from elsewhere in the file" },
];

function Table({ title, rows }: { title: string; rows: Shortcut[] }) {
  return (
    <>
      <h3 className="shortcut-heading">{title}</h3>
      <dl className="shortcut-list">
        {rows.map((row) => (
          <div className="shortcut" key={row.keys}>
            <dt>
              <kbd>{row.keys}</kbd>
            </dt>
            <dd>{row.what}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <section className="dialog" onClick={(event) => event.stopPropagation()}>
        <header className="pane-header">
          <span>Keyboard</span>
          <button className="icon-btn" title="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>

        <div className="dialog-body">
          <Table title="Anywhere" rows={BUILD} />
          <Table title="In the editor" rows={EDITING} />

          <p className="dialog-note">
            On a Mac, Cmd stands in for Ctrl. The preview takes the keyboard
            only once you click the screen — otherwise the program would swallow
            keystrokes meant for the editor.
          </p>
        </div>
      </section>
    </div>
  );
}
