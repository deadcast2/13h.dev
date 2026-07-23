/**
 * The mark: a CRT monitor showing the app's own output.
 *
 * The screen is the mode 13h starter's XOR pattern — colour `(x ^ y)` from the
 * first eight VGA palette entries — the same image the favicon carries and the
 * smoke test checks pixels against. Drawn on a 16-unit grid with
 * `shape-rendering: crispEdges` so it stays a clean pixel image at any size;
 * the caller sets that size in CSS.
 */

// The first eight entries of the default VGA palette, which is all an XOR of two
// 3-bit coordinates can reach.
const PALETTE = [
  "#000000",
  "#0000aa",
  "#00aa00",
  "#00aaaa",
  "#aa0000",
  "#aa00aa",
  "#aa5500",
  "#aaaaaa",
];

const SCREEN_W = 10;
const SCREEN_H = 7;

export function Logo({ className }: { className?: string }) {
  const pixels = [];
  for (let y = 0; y < SCREEN_H; y++) {
    for (let x = 0; x < SCREEN_W; x++) {
      pixels.push(
        <rect
          key={`${x},${y}`}
          x={3 + x}
          y={3 + y}
          width={1}
          height={1}
          fill={PALETTE[(x ^ y) & 7]}
        />,
      );
    }
  }

  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      role="img"
      aria-label="13h.dev"
    >
      {/* Stand and base, behind the case. */}
      <rect x={7} y={11} width={2} height={2} fill="#555555" />
      <rect x={4} y={13} width={8} height={2} fill="#aaaaaa" />
      <rect x={4} y={13} width={8} height={1} fill="#dddddd" />
      {/* Case: a white top highlight and a darker bottom lip give it a little depth. */}
      <rect x={1} y={1} width={14} height={11} fill="#aaaaaa" />
      <rect x={1} y={1} width={14} height={1} fill="#ffffff" />
      <rect x={1} y={11} width={14} height={1} fill="#555555" />
      {/* Black bezel, then the screen inset one pixel inside it. */}
      <rect x={2} y={2} width={12} height={9} fill="#000000" />
      {pixels}
    </svg>
  );
}
