import { parseExport, type ExportedProject } from "./transfer";

/**
 * A project as a link.
 *
 * The app has no backend and never will — it is a static site that runs entirely
 * in the browser, and cross-origin isolation would block a third-party paste
 * service outright — so a shared project has to travel inside the URL itself. It
 * rides in the fragment (`#…`), which the browser never sends to the server: the
 * project stays on the two machines that already have it and passes between them
 * as text, exactly like the `.13h.json` export does. In fact it *is* that export,
 * compressed: the payload is the same `ExportedProject` JSON `transfer.ts` writes,
 * so a link and a file carry identical content and are read back by the same
 * validator.
 *
 * The one real cost of putting it in the URL is length. Source compresses well —
 * deflate typically takes a project to a third of its JSON — but a large one can
 * still outgrow what some chat apps will carry unbroken, which is what
 * {@link SHARE_URL_SOFT_LIMIT} is for.
 */

/**
 * The fragment key. `#p=<data>` rather than a bare `#<data>` leaves room to tell
 * this format from something a later version might add, and from an ordinary
 * anchor link; a future encoding can move to `p2=` and be told apart on sight.
 */
const SHARE_KEY = "p=";

/**
 * Past this many characters a share URL is still perfectly valid, but some places
 * that carry links — chat apps, issue trackers — may wrap or truncate it. The
 * share action warns rather than refuses, and points at the export file, which
 * has no such ceiling. Chosen well below the ~2000 that the most cautious tools
 * assume and comfortably under every browser's own limit.
 */
export const SHARE_URL_SOFT_LIMIT = 2000;

async function pipe(
  // ArrayBuffer-backed, not the generic ArrayBufferLike: on this cross-origin-
  // isolated page a plain Uint8Array can be SharedArrayBuffer-backed, which a Blob
  // part may not be. Both callers hand in freshly allocated, unshared buffers.
  bytes: Uint8Array<ArrayBuffer>,
  transform: TransformStream,
): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const deflate = (bytes: Uint8Array<ArrayBuffer>) =>
  pipe(bytes, new CompressionStream("deflate"));
const inflate = (bytes: Uint8Array<ArrayBuffer>) =>
  pipe(bytes, new DecompressionStream("deflate"));

/**
 * base64url — the URL-safe alphabet, and no `=` padding, so the whole payload can
 * sit in a fragment without being percent-encoded into something twice as long.
 */
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  // atob wants the padding back that the URL form dropped.
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The fragment body a project encodes to, without the leading `#`. */
export async function encodeShareFragment(exported: ExportedProject): Promise<string> {
  // Compact, not the indented form the file gets — every byte here becomes URL.
  const json = JSON.stringify(exported);
  const packed = await deflate(new TextEncoder().encode(json));
  return SHARE_KEY + bytesToBase64Url(packed);
}

/**
 * A full shareable URL. `base` is the origin and path to point at — normally
 * `location.origin + location.pathname` — and is taken as an argument rather than
 * read here so the encoding stays pure and testable. Any existing fragment on
 * `base` is replaced.
 */
export async function buildShareUrl(exported: ExportedProject, base: string): Promise<string> {
  const withoutHash = base.split("#")[0];
  return `${withoutHash}#${await encodeShareFragment(exported)}`;
}

/** The base64url body of a URL's share fragment, or null if it carries none. */
function shareFragmentOf(urlOrHash: string): string | null {
  const hash = urlOrHash.includes("#") ? urlOrHash.slice(urlOrHash.indexOf("#") + 1) : "";
  return hash.startsWith(SHARE_KEY) ? hash.slice(SHARE_KEY.length) : null;
}

/**
 * Reads a project out of a share URL, or null when the URL simply isn't one — a
 * plain visit, or a fragment meant for something else, is not an error and must
 * not be treated as one.
 *
 * A URL that *is* a share link but won't decode throws, with a message worth
 * showing: the same contract as `parseExport`, which this hands the decoded JSON
 * to for the identical validation an imported file gets. Damage caught here is a
 * mangled fragment — a link that a chat app broke across a line, say — as opposed
 * to well-formed content the app still refuses.
 */
export async function parseShareLink(urlOrHash: string): Promise<ExportedProject | null> {
  const data = shareFragmentOf(urlOrHash);
  if (data === null) return null;

  let json: string;
  try {
    json = new TextDecoder().decode(await inflate(base64UrlToBytes(data)));
  } catch {
    throw new Error(
      "That shared link is damaged — the part after the # didn't decode. " +
        "It may have been broken across a line or cut short in transit.",
    );
  }

  return parseExport(json);
}

/**
 * If the current URL is a share link, strip the fragment from the address bar
 * and return the original URL for {@link parseShareLink} to decode; otherwise
 * null, synchronously.
 *
 * Split from the decode, and synchronous, on purpose. An ordinary visit — which
 * is every visit but a shared one — must not pay a single async tick here: the
 * caller reads storage on the very next line, and a stray await before it widens
 * races that have nothing to do with sharing. The fragment is cleared the moment
 * one is seen, before any decoding, and unconditionally: a link's whole payload
 * should not survive a reload — it would re-import on every refresh and leave a
 * wall of base64 in the bar — and a damaged one should not keep re-raising.
 */
export function takeShareUrl(): string | null {
  if (typeof window === "undefined") return null;

  const { href, pathname, search } = window.location;
  if (shareFragmentOf(href) === null) return null;

  window.history.replaceState(null, "", pathname + search);
  return href;
}
