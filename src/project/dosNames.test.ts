import { describe, expect, it } from "vitest";

import {
  compareDosNames,
  fileKind,
  normalizeDosName,
  splitDosName,
  validateDosName,
} from "./dosNames";

/**
 * These rules are the reason the editor can refuse a filename instead of
 * silently rewriting it, so every branch that produces a message is worth
 * holding still. The messages themselves are asserted loosely — on the fact
 * they name the offending thing — because the wording is meant to stay editable
 * and a test that pins it exactly would only punish improving it.
 */

describe("normalizeDosName", () => {
  it("uppercases, because that is what the disk stores", () => {
    expect(normalizeDosName("main.c")).toBe("MAIN.C");
  });

  it("trims, so a stray space from a paste is not a naming error", () => {
    expect(normalizeDosName("  vga.h  ")).toBe("VGA.H");
  });
});

describe("splitDosName", () => {
  it("splits on the dot", () => {
    expect(splitDosName("MAIN.C")).toEqual({ stem: "MAIN", ext: "C" });
  });

  it("treats a name with no dot as all stem", () => {
    expect(splitDosName("README")).toEqual({ stem: "README", ext: "" });
  });

  it("splits on the last dot, so a rejected name still reports sensibly", () => {
    expect(splitDosName("A.B.C")).toEqual({ stem: "A.B", ext: "C" });
  });
});

describe("fileKind", () => {
  it("counts .ASM as a source, since TCC compiles it via TASM", () => {
    expect(fileKind("CLEAR.ASM")).toBe("source");
    expect(fileKind("MAIN.C")).toBe("source");
    expect(fileKind("MAIN.CPP")).toBe("source");
  });

  it("counts .INC as a header — assembly's include, never built alone", () => {
    expect(fileKind("VGA.INC")).toBe("header");
    expect(fileKind("VGA.H")).toBe("header");
    expect(fileKind("VGA.HPP")).toBe("header");
  });

  it("is indifferent to case", () => {
    expect(fileKind("main.c")).toBe("source");
    expect(fileKind("vga.h")).toBe("header");
  });

  it("calls everything else other", () => {
    expect(fileKind("README.TXT")).toBe("other");
    expect(fileKind("MAIN.OBJ")).toBe("other");
  });
});

describe("validateDosName", () => {
  it("accepts an ordinary name", () => {
    expect(validateDosName("MAIN.C")).toBeNull();
  });

  it("accepts a name given in lower case", () => {
    expect(validateDosName("main.c")).toBeNull();
  });

  it("accepts the full eight and three", () => {
    expect(validateDosName("ABCDEFGH.CPP")).toBeNull();
  });

  it("accepts the punctuation FAT allows", () => {
    for (const char of "$%'-_@~`!(){}^#&") {
      expect(validateDosName(`A${char}.C`), `rejected ${char}`).toBeNull();
    }
  });

  it.each([
    ["", "empty"],
    ["   ", "blank"],
  ])("rejects a %s name", (name) => {
    expect(validateDosName(name)).toMatch(/name/i);
  });

  it("rejects spaces", () => {
    expect(validateDosName("MY FILE.C")).toMatch(/space/i);
  });

  it("rejects paths, because a project is one flat directory", () => {
    expect(validateDosName("SRC\\MAIN.C")).toMatch(/subfolder/i);
    expect(validateDosName("SRC/MAIN.C")).toMatch(/subfolder/i);
  });

  it("requires an extension", () => {
    expect(validateDosName("MAIN")).toMatch(/extension/i);
  });

  it("allows exactly one dot", () => {
    expect(validateDosName("MAIN.OLD.C")).toMatch(/one dot/i);
  });

  it("rejects an empty stem or extension", () => {
    expect(validateDosName(".C")).toMatch(/before the dot/i);
    expect(validateDosName("MAIN.")).toMatch(/after the dot/i);
  });

  it("reports the length of an over-long stem, and its own text", () => {
    const problem = validateDosName("player_movement.c");
    expect(problem).toContain("PLAYER_MOVEMENT");
    expect(problem).toContain("15");
    expect(problem).toContain("8");
  });

  it("rejects an over-long extension", () => {
    expect(validateDosName("MAIN.CPPP")).toMatch(/4 characters|allows 3/);
  });

  it("names the character it did not like", () => {
    for (const char of "+,;=[]\"|?*") {
      expect(validateDosName(`A${char}B.C`), `allowed ${char}`).toContain(char);
    }
  });

  it("rejects reserved device names, which DOS will not let you create", () => {
    for (const device of ["CON", "PRN", "AUX", "NUL", "COM1", "COM9", "LPT1", "LPT9"]) {
      expect(validateDosName(`${device}.C`), device).toMatch(/reserved/i);
    }
    expect(validateDosName("CLOCK$.C")).toMatch(/reserved/i);
  });

  it("allows a device name as a prefix — only the whole stem is reserved", () => {
    expect(validateDosName("CONFIG.C")).toBeNull();
    expect(validateDosName("CONS.C")).toBeNull();
  });

  it("rejects a name already taken", () => {
    expect(validateDosName("MAIN.C", ["MAIN.C"])).toContain("MAIN.C");
  });

  it("compares taken names case-insensitively, as the emulated disk does", () => {
    expect(validateDosName("main.c", ["MAIN.C"])).toContain("MAIN.C");
    expect(validateDosName("MAIN.C", ["main.c"])).toContain("MAIN.C");
  });

  it("does not consider a different name taken", () => {
    expect(validateDosName("VGA.C", ["MAIN.C", "VGA.H"])).toBeNull();
  });
});

describe("compareDosNames", () => {
  const sorted = (names: string[]) => [...names].sort(compareDosNames);

  it("puts sources first, then headers, then everything else", () => {
    expect(sorted(["NOTES.TXT", "VGA.H", "MAIN.C"])).toEqual([
      "MAIN.C",
      "VGA.H",
      "NOTES.TXT",
    ]);
  });

  it("sorts alphabetically within a kind", () => {
    expect(sorted(["VGA.C", "MAIN.C", "ASM.ASM"])).toEqual([
      "ASM.ASM",
      "MAIN.C",
      "VGA.C",
    ]);
  });

  it("keeps assembly among the sources rather than at the bottom", () => {
    expect(sorted(["VGA.H", "CLEAR.ASM"])).toEqual(["CLEAR.ASM", "VGA.H"]);
  });
});
