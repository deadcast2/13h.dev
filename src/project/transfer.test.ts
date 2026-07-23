import { describe, expect, it } from "vitest";

import { MAX_PROJECT_NAME } from "./store";
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  exportFilename,
  parseExport,
  serializeExport,
  toExport,
  uniqueProjectName,
  type ExportedProject,
} from "./transfer";

/**
 * An export is the only copy of a project that outlives the browser it was
 * typed in, which puts two things under test here. That what goes out can come
 * back unchanged — and that what comes back is checked, since this is the one
 * path turning data the app never wrote into a project.
 *
 * The rejection cases were each run by hand against the real file input once.
 * They are here so that stays true.
 */

const snapshot = {
  files: [
    { name: "MAIN.C", text: "#include \"VGA.H\"\nint main(){return 0;}\n" },
    { name: "VGA.C", text: "void vga(void){}\n" },
    { name: "VGA.H", text: "#ifndef VGA_H\n#define VGA_H\n#endif\n" },
  ],
  openNames: ["MAIN.C", "VGA.C"],
  activeName: "MAIN.C",
};

const valid = (): ExportedProject => toExport("Mode 13h starter", snapshot);
const parsed = (body: unknown) =>
  parseExport(typeof body === "string" ? body : JSON.stringify(body));

describe("toExport", () => {
  it("stamps the format and version so a reader can tell what it has", () => {
    const exported = valid();
    expect(exported.format).toBe(EXPORT_FORMAT);
    expect(exported.version).toBe(EXPORT_VERSION);
  });

  it("carries the files, the open tabs and the active one", () => {
    const exported = valid();
    expect(exported.files.map((file) => file.name)).toEqual([
      "MAIN.C",
      "VGA.C",
      "VGA.H",
    ]);
    expect(exported.openNames).toEqual(["MAIN.C", "VGA.C"]);
    expect(exported.activeName).toBe("MAIN.C");
  });

  it("leaves out everything that means something only to one browser", () => {
    expect(valid()).not.toHaveProperty("id");
    expect(valid()).not.toHaveProperty("lastOpenedAt");
    expect(valid()).not.toHaveProperty("updatedAt");
  });

  it("copies rather than aliasing, so later edits cannot reach the export", () => {
    const live = {
      files: [{ name: "MAIN.C", text: "before" }],
      openNames: ["MAIN.C"],
      activeName: "MAIN.C",
    };
    const exported = toExport("P", live);

    live.files[0].text = "after";
    live.openNames.push("LATER.C");

    expect(exported.files[0].text).toBe("before");
    expect(exported.openNames).toEqual(["MAIN.C"]);
  });
});

describe("serializeExport", () => {
  it("indents, because the point of JSON here is that a human can read it", () => {
    expect(serializeExport(valid())).toContain('\n  "format"');
  });

  it("round-trips a project unchanged", () => {
    const there = valid();
    const back = parseExport(serializeExport(there));

    expect(back.files).toEqual(there.files);
    expect(back.openNames).toEqual(there.openNames);
    expect(back.activeName).toBe(there.activeName);
    expect(back.name).toBe(there.name);
  });
});

describe("exportFilename", () => {
  it("slugs the project's name", () => {
    expect(exportFilename("Mode 13h starter")).toBe("mode-13h-starter.13h.json");
  });

  it("collapses runs of punctuation into one dash", () => {
    expect(exportFilename("Chapter 4 -- fire!")).toBe("chapter-4-fire.13h.json");
  });

  it("drops characters a slug cannot carry", () => {
    expect(exportFilename("Über Projekt")).toBe("ber-projekt.13h.json");
  });

  it("falls back when a name slugs away to nothing", () => {
    expect(exportFilename("!!!")).toBe("project.13h.json");
    expect(exportFilename("")).toBe("project.13h.json");
  });

  it("caps the length without leaving a trailing dash", () => {
    const name = exportFilename("a".repeat(30) + " " + "b".repeat(30));
    expect(name).toBe("a".repeat(30) + "-" + "b".repeat(9) + ".13h.json");

    // The cut lands exactly on the separator; it must not survive it.
    expect(exportFilename("a".repeat(40) + " tail")).toBe("a".repeat(40) + ".13h.json");
  });
});

describe("parseExport", () => {
  it("accepts what toExport wrote", () => {
    expect(parsed(valid()).files).toHaveLength(3);
  });

  it("uppercases filenames on the way in, as the editor would have", () => {
    const back = parsed({ ...valid(), files: [{ name: "main.c", text: "" }] });
    expect(back.files[0].name).toBe("MAIN.C");
  });

  it("ignores fields it does not know, so a newer minor format still opens", () => {
    expect(parsed({ ...valid(), somethingLater: 42 }).files).toHaveLength(3);
  });

  it("accepts a version below its own", () => {
    expect(parsed({ ...valid(), version: EXPORT_VERSION - 1 }).files).toHaveLength(3);
  });

  it("drops tabs naming files that are not in the export", () => {
    const back = parsed({ ...valid(), openNames: ["MAIN.C", "GONE.C"] });
    expect(back.openNames).toEqual(["MAIN.C"]);
  });

  it("drops an active file that is not in the export rather than pointing at nothing", () => {
    expect(parsed({ ...valid(), activeName: "GONE.C" }).activeName).toBeNull();
    expect(parsed({ ...valid(), activeName: 7 }).activeName).toBeNull();
  });

  it("tolerates missing tab information", () => {
    const back = parsed({ ...valid(), openNames: undefined, activeName: undefined });
    expect(back.openNames).toEqual([]);
    expect(back.activeName).toBeNull();
  });

  it("trims a project name and caps it where the rename field would", () => {
    expect(parsed({ ...valid(), name: "  Spaced  " }).name).toBe("Spaced");
    expect(parsed({ ...valid(), name: "x".repeat(80) }).name).toHaveLength(
      MAX_PROJECT_NAME,
    );
  });

  describe("refuses", () => {
    it("a file that is not JSON at all", () => {
      expect(() => parsed("#include <stdio.h>\nint main(){}\n")).toThrow(/isn't JSON/i);
    });

    it("JSON that is not a 13h.dev export", () => {
      expect(() => parsed({ hello: "world" })).toThrow(/isn't a 13h\.dev/i);
      expect(() => parsed([1, 2, 3])).toThrow(/isn't a 13h\.dev/i);
      expect(() => parsed(null)).toThrow(/isn't a 13h\.dev/i);
      expect(() => parsed('"a string"')).toThrow(/isn't a 13h\.dev/i);
    });

    it("an export from a newer version than it can read", () => {
      expect(() => parsed({ ...valid(), version: EXPORT_VERSION + 1 })).toThrow(
        /newer version/i,
      );
      expect(() => parsed({ ...valid(), version: "1" })).toThrow(/newer version/i);
    });

    it("an export with no files", () => {
      expect(() => parsed({ ...valid(), files: [] })).toThrow(/no files/i);
      expect(() => parsed({ ...valid(), files: "MAIN.C" })).toThrow(/no files/i);
    });

    it("a file entry missing a name or its contents", () => {
      expect(() => parsed({ ...valid(), files: [{ name: "MAIN.C" }] })).toThrow(
        /no name or no contents/i,
      );
      expect(() => parsed({ ...valid(), files: [{ text: "x" }] })).toThrow(
        /no name or no contents/i,
      );
      expect(() => parsed({ ...valid(), files: ["MAIN.C"] })).toThrow(
        /no name or no contents/i,
      );
    });

    it("a filename the editor itself would have rejected", () => {
      expect(() =>
        parsed({ ...valid(), files: [{ name: "player_movement.c", text: "" }] }),
      ).toThrow(/player_movement\.c: .*8/);
    });

    it("two files whose names differ only in case", () => {
      expect(() =>
        parsed({
          ...valid(),
          files: [
            { name: "MAIN.C", text: "" },
            { name: "main.c", text: "" },
          ],
        }),
      ).toThrow(/already exists/i);
    });
  });
});

describe("uniqueProjectName", () => {
  it("leaves a free name alone", () => {
    expect(uniqueProjectName("Fresh", [{ name: "Other" }])).toBe("Fresh");
  });

  it("suffixes a name already in use", () => {
    expect(uniqueProjectName("Starter", [{ name: "Starter" }])).toBe("Starter (2)");
  });

  it("keeps counting when the suffixed name is taken too", () => {
    expect(
      uniqueProjectName("Starter", [{ name: "Starter" }, { name: "Starter (2)" }]),
    ).toBe("Starter (3)");
  });

  it("compares case-insensitively, since the switcher shows only names", () => {
    expect(uniqueProjectName("starter", [{ name: "STARTER" }])).toBe("starter (2)");
  });

  it("names an export that has no name of its own", () => {
    expect(uniqueProjectName("", [])).toBe("Imported project");
  });

  it("keeps the suffix inside the length the rename field allows", () => {
    const long = "x".repeat(MAX_PROJECT_NAME);
    const result = uniqueProjectName(long, [{ name: long }]);

    expect(result).toHaveLength(MAX_PROJECT_NAME);
    expect(result.endsWith(" (2)")).toBe(true);
  });
});
