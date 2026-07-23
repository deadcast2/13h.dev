import { describe, expect, it } from "vitest";

import { countBySeverity, hasErrors, locate, parseDiagnostics } from "./diagnostics";

/**
 * The fixtures below are real build logs, captured verbatim from real failing
 * builds against Turbo C++ 1.01 and Turbo Assembler 4.1 — CRLF, banner, summary
 * counts and all. Nothing here is a paraphrase of what the manual says the
 * output looks like, because the three formats in play were only discovered by
 * reading actual output, and a fixture written from memory would test the
 * parser against the same guess that produced it.
 */

const SYNTAX_ERRORS =
  "Turbo C++  Version 1.01 Copyright (c) 1990 Borland International\r\n" +
  "main.c:\r\n" +
  "Error main.c 5: Declaration syntax error in function main\r\n" +
  "Error main.c 6: Expression syntax in function main\r\n" +
  "Error main.c 6: Undefined symbol 'i' in function main\r\n" +
  "Error main.c 6: Lvalue required in function main\r\n" +
  "Error main.c 6: Statement missing ; in function main\r\n" +
  "Warning main.c 8: 'x' is assigned a value that is never used in function main\r\n" +
  "*** 5 errors in Compile ***\r\n" +
  "\r\r\n\tAvailable memory 432272\r\r\n";

const LINK_ERROR =
  "Turbo C++  Version 1.01 Copyright (c) 1990 Borland International\r\n" +
  "main.c:\r\n" +
  "Turbo Link  Version 3.01 Copyright (c) 1987, 1990 Borland International\r\n" +
  "Error: Undefined symbol _missing_thing in module main.c\r\n" +
  "\r\r\n\tAvailable memory 443776\r\r\n";

const ASSEMBLER_ERRORS =
  "Turbo C++  Version 1.01 Copyright (c) 1990 Borland International\r\n" +
  "main.c:\r\n" +
  "clear.asm:\r\n" +
  "Turbo Assembler  Version 4.1  Copyright (c) 1988, 1996 Borland International\r\n" +
  "\r\n" +
  "Assembling file:   clear.ASM\r\n" +
  "**Error** clear.ASM(2) Code or data emission to undeclared segment\r\n" +
  "**Error** clear.ASM(3) Code or data emission to undeclared segment\r\n" +
  "**Error** clear.ASM(4) Code or data emission to undeclared segment\r\n" +
  "**Fatal** clear.ASM(6) Unexpected end of file encountered\r\n" +
  "Error messages:    4\r\n" +
  "Warning messages:  None\r\n" +
  "Passes:            1\r\n" +
  "Remaining memory:  369k\r\n";

const ERROR_IN_HEADER =
  "Turbo C++  Version 1.01 Copyright (c) 1990 Borland International\r\n" +
  "main.c:\r\n" +
  "Error VGA.H 3: ) expected\r\n" +
  "*** 1 errors in Compile ***\r\n";

const WARNING_ONLY =
  "Turbo C++  Version 1.01 Copyright (c) 1990 Borland International\r\n" +
  "main.c:\r\n" +
  "Warning main.c 1: 'unused' is assigned a value that is never used in function main\r\n" +
  "Turbo Link  Version 3.01 Copyright (c) 1987, 1990 Borland International\r\n" +
  "\r\r\n\tAvailable memory 444032\r\r\n";

const CLEAN_BUILD =
  "Turbo C++  Version 1.01 Copyright (c) 1990 Borland International\r\n" +
  "main.c:\r\n" +
  "vga.c:\r\n" +
  "Turbo Link  Version 3.01 Copyright (c) 1987, 1990 Borland International\r\n" +
  "\r\r\n\tAvailable memory 421824\r\r\n";

describe("the compiler's diagnostics", () => {
  const found = parseDiagnostics(SYNTAX_ERRORS);

  it("finds every one, and nothing else", () => {
    expect(found).toHaveLength(6);
  });

  it("reads the file, line, severity and message apart", () => {
    expect(found[0]).toEqual({
      severity: "error",
      file: "main.c",
      line: 5,
      message: "Declaration syntax error in function main",
    });
  });

  it("keeps warnings, which are not failures but are worth showing", () => {
    expect(found.at(-1)).toEqual({
      severity: "warning",
      file: "main.c",
      line: 8,
      message: "'x' is assigned a value that is never used in function main",
    });
  });

  it("keeps several on one line separate", () => {
    expect(found.filter((d) => d.line === 6)).toHaveLength(4);
  });

  it("reports them in the order the compiler did", () => {
    expect(found.map((d) => d.line)).toEqual([5, 6, 6, 6, 6, 8]);
  });

  it("ignores the summary count, which locates nothing", () => {
    expect(found.map((d) => d.message)).not.toContain("5 errors in Compile");
    expect(found.some((d) => d.message.includes("errors in Compile"))).toBe(false);
  });

  it("attributes an error inside a header to the header", () => {
    const [diagnostic] = parseDiagnostics(ERROR_IN_HEADER);
    expect(diagnostic.file).toBe("VGA.H");
    expect(diagnostic.line).toBe(3);
  });
});

describe("the linker's diagnostics", () => {
  const [diagnostic] = parseDiagnostics(LINK_ERROR);

  it("has no line to point at, and does not invent one", () => {
    expect(diagnostic.line).toBeNull();
  });

  it("recovers the module, which is as much as can honestly be said", () => {
    expect(diagnostic.file).toBe("main.c");
    expect(diagnostic.severity).toBe("error");
    expect(diagnostic.message).toBe("Undefined symbol _missing_thing in module main.c");
  });

  it("finds nothing else in the log", () => {
    expect(parseDiagnostics(LINK_ERROR)).toHaveLength(1);
  });
});

describe("the assembler's diagnostics", () => {
  const found = parseDiagnostics(ASSEMBLER_ERRORS);

  it("reads the parenthesised line number", () => {
    expect(found[0]).toEqual({
      severity: "error",
      file: "clear.ASM",
      line: 2,
      message: "Code or data emission to undeclared segment",
    });
  });

  it("treats Fatal as an error rather than a third thing to render", () => {
    expect(found.at(-1)).toEqual({
      severity: "error",
      file: "clear.ASM",
      line: 6,
      message: "Unexpected end of file encountered",
    });
  });

  it("ignores the summary lines, which look like diagnostics and are not", () => {
    // "Error messages:    4" and "Warning messages:  None" both begin with a
    // severity word.
    expect(found).toHaveLength(4);
    expect(found.some((d) => d.message.includes("messages"))).toBe(false);
  });
});

describe("a log with nothing wrong in it", () => {
  it("yields no diagnostics", () => {
    expect(parseDiagnostics(CLEAN_BUILD)).toEqual([]);
  });

  it("is not confused by the banner or the memory report", () => {
    expect(parseDiagnostics("")).toEqual([]);
    expect(parseDiagnostics("\r\n\r\n")).toEqual([]);
  });

  it("still reports warnings from a build that succeeded", () => {
    const found = parseDiagnostics(WARNING_ONLY);
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("warning");
  });
});

describe("locate", () => {
  const files = [{ name: "MAIN.C" }, { name: "CLEAR.ASM" }, { name: "VGA.H" }];

  it("matches what the compiler lower-cased", () => {
    const [diagnostic] = parseDiagnostics(SYNTAX_ERRORS);
    expect(locate(diagnostic, files)).toEqual({ name: "MAIN.C" });
  });

  it("matches what the assembler left in mixed case", () => {
    const [diagnostic] = parseDiagnostics(ASSEMBLER_ERRORS);
    expect(locate(diagnostic, files)).toEqual({ name: "CLEAR.ASM" });
  });

  it("matches a header the compiler named in upper case", () => {
    const [diagnostic] = parseDiagnostics(ERROR_IN_HEADER);
    expect(locate(diagnostic, files)).toEqual({ name: "VGA.H" });
  });

  it("finds the module a linker error came from", () => {
    const [diagnostic] = parseDiagnostics(LINK_ERROR);
    expect(locate(diagnostic, files)).toEqual({ name: "MAIN.C" });
  });

  it("has nothing to offer for a diagnostic that named no file", () => {
    expect(
      locate({ severity: "error", file: null, line: null, message: "x" }, files),
    ).toBeNull();
  });

  it("does not invent a match for a file the project does not have", () => {
    expect(
      locate({ severity: "error", file: "OTHER.C", line: 1, message: "x" }, files),
    ).toBeNull();
  });
});

describe("hasErrors", () => {
  /**
   * This is what decides whether a build is reported as having worked. TLINK
   * writes MAIN.EXE and then reports the undefined symbol, so a program calling
   * a function that does not exist produces a file exactly the size of a
   * working one — measured, both 4,937 bytes. The executable existing proves
   * nothing; this is what proves it.
   */
  it("is true for a link that left an executable behind anyway", () => {
    expect(hasErrors(parseDiagnostics(LINK_ERROR))).toBe(true);
  });

  it("is true for a failed compile", () => {
    expect(hasErrors(parseDiagnostics(SYNTAX_ERRORS))).toBe(true);
  });

  it("is true when the assembler reports a fatal", () => {
    expect(hasErrors(parseDiagnostics(ASSEMBLER_ERRORS))).toBe(true);
  });

  it("is false for warnings alone, which do not stop a build", () => {
    expect(hasErrors(parseDiagnostics(WARNING_ONLY))).toBe(false);
  });

  it("is false for a clean build", () => {
    expect(hasErrors(parseDiagnostics(CLEAN_BUILD))).toBe(false);
  });
});

describe("countBySeverity", () => {
  it("counts each kind", () => {
    expect(countBySeverity(parseDiagnostics(SYNTAX_ERRORS))).toEqual({
      errors: 5,
      warnings: 1,
    });
  });

  it("counts a fatal as an error", () => {
    expect(countBySeverity(parseDiagnostics(ASSEMBLER_ERRORS))).toEqual({
      errors: 4,
      warnings: 0,
    });
  });

  it("counts nothing in a clean build", () => {
    expect(countBySeverity(parseDiagnostics(CLEAN_BUILD))).toEqual({
      errors: 0,
      warnings: 0,
    });
  });
});
