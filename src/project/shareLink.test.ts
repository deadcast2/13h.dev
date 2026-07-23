import { describe, expect, it } from "vitest";

import {
  buildShareUrl,
  encodeShareFragment,
  parseShareLink,
  SHARE_URL_SOFT_LIMIT,
} from "./shareLink";
import { toExport, type ExportedProject } from "./transfer";

/**
 * A share link is the export format again, compressed into a URL fragment, so the
 * two things under test are the two the format itself is: that a project survives
 * the round trip through a link unchanged, and that a URL which is not one — or is
 * one but arrived damaged — is told apart from a valid project rather than
 * producing a broken one.
 *
 * The decode delegates content validation to `parseExport`, which has its own
 * exhaustive suite; this only checks that a share link reaches it and surfaces
 * what it says.
 */

const snapshot = {
  files: [
    { name: "MAIN.C", text: '#include "VGA.H"\nint main(){return 0;}\n' },
    { name: "VGA.C", text: "void vga(void){}\n" },
    { name: "VGA.H", text: "#ifndef VGA_H\n#define VGA_H\n#endif\n" },
  ],
  openNames: ["MAIN.C", "VGA.C"],
  activeName: "MAIN.C",
};

const project = (): ExportedProject => toExport("Mode 13h starter", snapshot);
const BASE = "https://13h.dev/";

describe("buildShareUrl", () => {
  it("puts the payload in the fragment, on the given base", async () => {
    const url = await buildShareUrl(project(), BASE);
    expect(url.startsWith("https://13h.dev/#p=")).toBe(true);
  });

  it("keeps the project out of the part the browser sends to the server", async () => {
    // Everything before the # is the request; the payload must live after it.
    const url = await buildShareUrl(project(), BASE);
    const [sent] = url.split("#");
    expect(sent).toBe("https://13h.dev/");
    expect(url.indexOf("#")).toBeGreaterThan(0);
  });

  it("replaces a fragment already on the base rather than appending a second", async () => {
    const url = await buildShareUrl(project(), "https://13h.dev/#p=stale");
    expect(url.match(/#/g)).toHaveLength(1);
    expect(url).not.toContain("stale");
  });
});

describe("round trip", () => {
  it("brings a project back unchanged", async () => {
    const there = project();
    const back = await parseShareLink(await buildShareUrl(there, BASE));

    expect(back).not.toBeNull();
    expect(back!.files).toEqual(there.files);
    expect(back!.openNames).toEqual(there.openNames);
    expect(back!.activeName).toBe(there.activeName);
    expect(back!.name).toBe(there.name);
  });

  it("survives a project far larger than one screen of code", async () => {
    const big = toExport("Big", {
      files: Array.from({ length: 12 }, (_, i) => ({
        name: `FILE${i}.C`,
        text: `/* file ${i} */\n`.repeat(200),
      })),
      openNames: ["FILE0.C"],
      activeName: "FILE0.C",
    });

    const back = await parseShareLink(await buildShareUrl(big, BASE));
    expect(back!.files).toEqual(big.files);
  });

  it("compresses — repetitive source packs far smaller than its own JSON", async () => {
    const repetitive = toExport("Repetitive", {
      files: [{ name: "MAIN.C", text: "putpixel(x, y, c);\n".repeat(500) }],
      openNames: ["MAIN.C"],
      activeName: "MAIN.C",
    });

    const fragment = await encodeShareFragment(repetitive);
    expect(fragment.length).toBeLessThan(JSON.stringify(repetitive).length / 4);
  });

  it("accepts a raw fragment, not only a whole URL", async () => {
    const fragment = await encodeShareFragment(project());
    const back = await parseShareLink(`#${fragment}`);
    expect(back!.name).toBe("Mode 13h starter");
  });
});

describe("parseShareLink", () => {
  it("returns null for a URL with no fragment — an ordinary visit", async () => {
    expect(await parseShareLink("https://13h.dev/")).toBeNull();
  });

  it("returns null for a fragment meant for something else", async () => {
    // A share link is specifically `#p=`; anything else is not ours to read.
    expect(await parseShareLink("https://13h.dev/#section-2")).toBeNull();
    expect(await parseShareLink("https://13h.dev/#q=other")).toBeNull();
  });

  it("throws on a share fragment that will not decode", async () => {
    await expect(parseShareLink("https://13h.dev/#p=not-real-base64!!")).rejects.toThrow(
      /damaged/i,
    );
  });

  it("throws on base64 that decodes but is not deflated data", async () => {
    // "aGVsbG8" is base64url for "hello" — valid base64, not a deflate stream.
    await expect(parseShareLink("https://13h.dev/#p=aGVsbG8")).rejects.toThrow(/damaged/i);
  });

  it("hands decoded content to parseExport and surfaces its refusal", async () => {
    // Well-formed link, but the project inside is one the app would never accept:
    // no files. The message is parseExport's, proving the link reached it.
    const empty = { ...project(), files: [] } as ExportedProject;
    const fragment = await encodeShareFragment(empty);
    await expect(parseShareLink(`#${fragment}`)).rejects.toThrow(/no files/i);
  });
});

describe("SHARE_URL_SOFT_LIMIT", () => {
  it("leaves the starter comfortably under the limit", async () => {
    const url = await buildShareUrl(project(), BASE);
    expect(url.length).toBeLessThan(SHARE_URL_SOFT_LIMIT);
  });
});
