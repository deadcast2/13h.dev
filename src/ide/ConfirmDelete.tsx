import { useEffect, useRef } from "react";

/**
 * A delete confirmation shown inline, in place of the thing being deleted.
 *
 * It replaces `window.confirm()`, which this app avoids everywhere else — see the
 * import-error banner in `Workbench`, which is deliberately not an `alert` — and
 * which some embedded browsers (Claude's built-in one among them) swallow
 * outright, so the delete looked dead: the dialog never showed and `confirm`
 * returned false. An inline prompt shows on the page regardless.
 *
 * Escape cancels, the way leaving the rename fields does. The destructive button
 * wears the VGA danger red so it is never mistaken for the safe default; the
 * caller places this where the deleted thing was, so it reads as "this row" or
 * "this project" rather than a detached dialog.
 */
export function ConfirmDelete({
  message,
  className,
  onConfirm,
  onCancel,
}: {
  message: string;
  /** Context class for layout — the toolbar row vs. a file row. */
  className?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Focus the action the click asked for, so Enter confirms and Escape backs
  // out — the same two keys the rename fields answer to.
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  return (
    <div
      className={`confirm-inline${className ? ` ${className}` : ""}`}
      role="alertdialog"
      aria-label={message}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <span className="confirm-message">{message}</span>
      <button
        ref={confirmRef}
        type="button"
        className="confirm-btn confirm-btn--danger"
        onClick={onConfirm}
      >
        Delete
      </button>
      <button type="button" className="confirm-btn" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
