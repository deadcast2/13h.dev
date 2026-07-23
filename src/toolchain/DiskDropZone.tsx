import { useCallback, useRef, useState } from "react";

import type { UnpackProgress } from "./unpack";

/**
 * The drop target for whatever a user supplies — install disks the first time,
 * an assembler later. Shared so that both routes behave identically, since from
 * the user's side they are the same act.
 */
export function DiskDropZone({
  busy,
  progress,
  prompt,
  hint,
  onFiles,
}: {
  busy: boolean;
  progress: UnpackProgress | null;
  prompt: string;
  hint: React.ReactNode;
  onFiles: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      if (!busy) onFiles([...event.dataTransfer.files]);
    },
    [busy, onFiles],
  );

  return (
    <>
      <div
        className={`dropzone${dragging ? " is-dragging" : ""}${busy ? " is-busy" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !busy && inputRef.current?.click()}
      >
        {busy ? (
          <>
            <div className="dropzone-stage">{progress?.stage ?? "Working…"}</div>
            {progress?.detail && (
              <div className="dropzone-hint">{progress.detail}</div>
            )}
          </>
        ) : (
          <>
            <div>{prompt}</div>
            <div className="dropzone-hint">{hint}</div>
          </>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => onFiles([...(event.target.files ?? [])])}
      />
    </>
  );
}
