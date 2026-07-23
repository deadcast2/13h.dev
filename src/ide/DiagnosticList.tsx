import { locate, type Diagnostic } from "../build/diagnostics";
import type { ProjectFile } from "../project/useProject";

/**
 * What the compiler complained about, as a list you can click.
 *
 * Markers in the gutter only help in a file you are already looking at, and a
 * multi-file project fails most often in the one you aren't. This is the way
 * back to it. It sits above the raw log rather than replacing it: the log is
 * TCC's own words, and when this list has read them wrongly — a message format
 * nobody has seen yet — the evidence is still right there underneath.
 */

interface Props {
  diagnostics: Diagnostic[];
  files: ProjectFile[];
  onSelect: (fileId: string, line: number) => void;
}

export function DiagnosticList({ diagnostics, files, onSelect }: Props) {
  if (diagnostics.length === 0) return null;

  return (
    <ul className="diagnostics">
      {diagnostics.map((diagnostic, index) => {
        const file = locate(diagnostic, files);
        // A linker error names a module but no line; there is somewhere to go,
        // just not a line to put the cursor on.
        const target = file ? (diagnostic.line ?? 1) : null;

        const where = file
          ? `${file.name}${diagnostic.line === null ? "" : `:${diagnostic.line}`}`
          : null;

        const body = (
          <>
            {where && <span className="diagnostic-where">{where}</span>}
            <span className="diagnostic-message">{diagnostic.message}</span>
          </>
        );

        return (
          <li key={index} className={`diagnostic is-${diagnostic.severity}`}>
            {file && target !== null ? (
              <button
                className="diagnostic-row"
                onClick={() => onSelect(file.id, target)}
                title={`Go to ${where}`}
              >
                {body}
              </button>
            ) : (
              // Nothing to open: a diagnostic about the build rather than about
              // a place in it. Shown all the same, since it is still the reason
              // the build failed.
              <span className="diagnostic-row is-unplaced">{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
