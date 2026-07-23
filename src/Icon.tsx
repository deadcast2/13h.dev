/**
 * Toolbar icons from Pixelarticons (MIT; © 2019 Gerrit Halfmann — see
 * THIRD-PARTY-NOTICES.md). A pixel-art vector set, so it keeps the retro look of
 * the CRT mark and VGA face while being far clearer than the hand-drawn glyphs
 * it replaced — a pencil that reads as a pencil, not a diagonal smudge.
 *
 * The paths are pixel rectangles on a 24-unit grid; `shape-rendering:
 * crispEdges` keeps their corners hard, and `fill: currentColor` makes each icon
 * whatever colour its button is, so hover styling needs no extra rules.
 * `aria-hidden`, because every button that carries one already has a `title`.
 */

export type IconName =
  | "new"
  | "newFile"
  | "rename"
  | "delete"
  | "close"
  | "stop"
  | "export"
  | "share"
  | "import";

const PATHS: Record<IconName, string> = {
  // folder-plus
  new:
    "M4 4h6v2H4zm0 14h10v2H4zM20 8h2v6h-2zM2 6h2v12H2zm8 0h10v2H10zm12 12v2h-6v-2z" +
    "M18 16h2v6h-2z",
  // plus — a new file, distinct from "new" (a whole project, a folder-plus).
  newFile: "M13 11h7v2h-7v7h-2v-7H4v-2h7V4h2v7Z",
  // pencil
  rename:
    "M4 16H6V18H8V20H10V22H2V14H4V16ZM12 20H10V18H12V20ZM14 18H12V16H14V18ZM10 16H8V14H10" +
    "V16ZM16 16H14V14H16V16ZM6 14H4V12H6V14ZM12 14H10V12H12V14ZM18 14H16V12H18V14ZM8 12H6" +
    "V10H8V12ZM14 12H12V10H14V12ZM20 12H18V10H20V12ZM10 10H8V8H10V10ZM18 10H16V8H18V10ZM22" +
    " 10H20V8H22V10ZM12 8H10V6H12V8ZM16 8H14V6H16V8ZM20 8H18V6H20V8ZM14 6H12V4H14V6ZM18 6H16" +
    "V4H18V6ZM16 4H14V2H16V4Z",
  // trash
  delete:
    "M18 22H6V20H18V22ZM9 6H15V4H17V6H22V8H20V20H18V8H6V20H4V8H2V6H7V4H9V6ZM15 4H9V2H15V4Z",
  // close (an X) — for putting a tab away, which is not the same as deleting.
  close:
    "M7 19H5V17H7V19ZM19 19H17V17H19V19ZM9 15V17H7V15H9ZM17 17H15V15H17V17ZM11 15H9V13H11" +
    "V15ZM15 15H13V13H15V15ZM13 13H11V11H13V13ZM11 11H9V9H11V11ZM15 11H13V9H15V11ZM9 9H7V7" +
    "H9V9ZM17 9H15V7H17V9ZM7 7H5V5H7V7ZM19 7H17V5H19V7Z",
  // A filled square — the media "stop", for halting the running program.
  stop: "M6 6h12v12H6z",
  // download
  export:
    "M21 15v4h-2v-4zm-2 4v2H5v-2zM5 15v4H3v-4zm8-12v14h-2V3z" +
    "M7 11v2h10v-2zm2 2v2h2v-2zm4 0v2h2v-2z" +
    "M15 11v2h2v-2z",
  // link — a chain link, for "copy a share link". Distinct from the two arrows,
  // where Pixelarticons' own "share" glyph is another up-arrow and collides.
  share: "M4 6h7v2H4zm0 10h7v2H4zM2 8h2v8H2zm18-2h-7v2h7zm0 10h-7v2h7zm2-8h-2v8h2zM7 11h10v2H7z",
  // upload
  import:
    "M19 21H5v-2h14v2ZM5 19H3v-4h2v4Zm16 0h-2v-4h2v4ZM13 5h2v2h2v2h-4v8h-2V9H7V7h2V5h2V3h2v2Z",
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      shapeRendering="crispEdges"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
