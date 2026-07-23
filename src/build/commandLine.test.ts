import { describe, expect, it } from "vitest";

import {
  buildBat,
  DOS_COMMAND_LIMIT,
  toDos,
  translationUnits,
  turbocCfg,
  type SourceFile,
} from "./commandLine";

/**
 * The rules here fail quietly when they are wrong, which is what makes them
 * worth pinning. A header named as a translation unit links to nothing; a file
 * left off the command line is written to the disk, shown in the tree and never
 * built; and a command line one character too long is truncated by COMMAND.COM
 * without a word, surfacing much later as a linker error naming symbols whose
 * source is sitting right there in the project.
 */

const file = (name: string): SourceFile => ({ name, text: "" });

/** A source file whose name is exactly `length` characters, and still valid 8.3. */
const sized = (length: number, index: number): SourceFile =>
  file(`${"A".repeat(length - 3)}${index}.C`);

describe("translationUnits", () => {
  it("takes .C, .CPP and .ASM", () => {
    const names = translationUnits([
      file("MAIN.C"),
      file("GAME.CPP"),
      file("CLEAR.ASM"),
    ]).map((unit) => unit.name);

    expect(names).toEqual(["MAIN.C", "GAME.CPP", "CLEAR.ASM"]);
  });

  it("leaves headers out — they travel on the disk, not the command line", () => {
    expect(translationUnits([file("VGA.H"), file("VGA.HPP"), file("VGA.INC")])).toEqual(
      [],
    );
  });

  it("leaves out anything else the project happens to hold", () => {
    expect(translationUnits([file("NOTES.TXT"), file("MAIN.OBJ")])).toEqual([]);
  });

  it("matches regardless of case", () => {
    expect(translationUnits([file("main.c"), file("clear.asm")])).toHaveLength(2);
  });

  it("keeps the order it was given", () => {
    const units = translationUnits([file("Z.C"), file("VGA.H"), file("A.C")]);
    expect(units.map((unit) => unit.name)).toEqual(["Z.C", "A.C"]);
  });
});

describe("buildBat", () => {
  const batch = buildBat([file("MAIN.C"), file("VGA.C")]);

  it("names every unit on one TCC invocation", () => {
    expect(batch).toContain("TCC -eMAIN.EXE MAIN.C VGA.C");
  });

  it("redirects the compiler's own output to a file", () => {
    // Not onStdout: the guest captures TCC verbatim this way, without DOSBox's
    // banner and shell echoes mixed in.
    expect(batch).toContain("> BUILD.LOG");
  });

  it("writes the sentinel last, since its presence is what ends the poll", () => {
    const lines = batch.trimEnd().split("\r\n");
    expect(lines.at(-1)).toBe("ECHO DONE > DONE.FLG");
  });

  it("uses CRLF throughout, which DOSBox's shell insists on", () => {
    expect(batch).not.toMatch(/[^\r]\n/);
    expect(batch.endsWith("\r\n")).toBe(true);
  });

  it("never puts a header on the command line", () => {
    const project = [file("MAIN.C"), file("VGA.H"), file("VGA.INC")];
    const composed = buildBat(translationUnits(project));

    expect(composed).toContain("MAIN.C");
    expect(composed).not.toContain("VGA.H");
    expect(composed).not.toContain("VGA.INC");
  });

  it("refuses a project with nothing to compile", () => {
    expect(() => buildBat([])).toThrow(/Nothing to compile/i);
  });

  it("says .ASM counts, so a project of only assembly is not a puzzle", () => {
    expect(() => buildBat([])).toThrow(/\.ASM/);
  });

  describe("the 127-character DOS command line", () => {
    // Ten files whose names and separators come to exactly the longest list
    // that still fits once "TCC -eMAIN.EXE " and " > BUILD.LOG" are counted.
    const atTheLimit = [
      ...Array.from({ length: 9 }, (_, i) => sized(9, i)),
      sized(10, 9),
    ];

    it("accepts a command line of exactly the limit", () => {
      const composed = buildBat(atTheLimit);
      const command = composed.split("\r\n")[1];

      expect(command).toHaveLength(DOS_COMMAND_LIMIT);
      expect(() => buildBat(atTheLimit)).not.toThrow();
    });

    it("refuses one character more", () => {
      const oneOver = [...atTheLimit.slice(0, 8), sized(10, 8), sized(10, 9)];
      expect(() => buildBat(oneOver)).toThrow(/too many source files/i);
    });

    it("explains itself with the numbers rather than just failing", () => {
      const many = Array.from({ length: 20 }, (_, i) => sized(12, i));

      expect(() => buildBat(many)).toThrow(/20 files/);
      expect(() => buildBat(many)).toThrow(/115/);
      expect(() => buildBat(many)).toThrow(/Shorter filenames/i);
    });
  });
});

describe("turbocCfg", () => {
  it("defaults to the large model, which mode 13h work wants", () => {
    expect(turbocCfg()).toContain("-ml");
  });

  it("maps each memory model to its flag", () => {
    const flags = {
      tiny: "-mt",
      small: "-ms",
      medium: "-mm",
      compact: "-mc",
      large: "-ml",
      huge: "-mh",
    } as const;

    for (const [model, flag] of Object.entries(flags)) {
      expect(turbocCfg({ memoryModel: model as keyof typeof flags })).toContain(flag);
    }
  });

  it("points the compiler at the installed tree", () => {
    const cfg = turbocCfg();
    expect(cfg).toContain("-IC:\\TC\\INCLUDE");
    expect(cfg).toContain("-LC:\\TC\\LIB");
  });

  it("appends extra flags verbatim, one per line", () => {
    expect(turbocCfg({ extraFlags: ["-w-par", "-O"] })).toContain("-w-par\r\n-O\r\n");
  });

  it("uses CRLF, as every file handed to a DOS tool does", () => {
    expect(turbocCfg()).not.toMatch(/[^\r]\n/);
  });
});

describe("toDos", () => {
  it("converts bare newlines", () => {
    expect(toDos("a\nb\n")).toBe("a\r\nb\r\n");
  });

  it("leaves CRLF alone rather than doubling it", () => {
    expect(toDos("a\r\nb\r\n")).toBe("a\r\nb\r\n");
  });
});
