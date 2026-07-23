import * as monaco from "monaco-editor/esm/vs/editor/editor.api";

/**
 * A Monarch grammar for TASM/MASM-flavoured 16-bit assembly.
 *
 * Monaco ships tokenizers for some eighty languages and not one of them is x86
 * assembly — the closest is MIPS. Highlighting a .ASM file as C, which is what
 * the extension-to-language default did, makes the editor lie about what the
 * file is: `.MODEL` reads as a stray token and `mov ax, 0A000h` as an expression.
 *
 * Deliberately shallow. It knows enough to colour a listing out of a book
 * correctly and does not attempt to understand operand syntax or macros.
 */

export const ASM_LANGUAGE_ID = "asm";

/** Directives, in the sense of "instructions to the assembler, not the CPU". */
const DIRECTIVES = [
  "assume", "byte", "code", "comm", "const", "data", "dosseg", "dup", "else",
  "end", "endif", "endm", "endp", "ends", "equ", "even", "extrn", "extern",
  "far", "global", "group", "if", "ifdef", "ifndef", "include", "includelib",
  "label", "large", "local", "macro", "model", "name", "near", "offset", "org",
  "proc", "ptr", "public", "purge", "record", "rept", "seg", "segment", "short",
  "size", "small", "struc", "substr", "this", "tiny", "type", "union", "usdes",
  "word", "db", "dw", "dd", "dq", "dt",
];

/** The instruction set a mode 13h program is realistically going to reach for. */
const INSTRUCTIONS = [
  "aaa", "aad", "aam", "aas", "adc", "add", "and", "call", "cbw", "clc", "cld",
  "cli", "cmc", "cmp", "cmps", "cmpsb", "cmpsw", "cwd", "daa", "das", "dec",
  "div", "enter", "hlt", "idiv", "imul", "in", "inc", "int", "into", "iret",
  "ja", "jae", "jb", "jbe", "jc", "jcxz", "je", "jg", "jge", "jl", "jle", "jmp",
  "jna", "jnae", "jnb", "jnbe", "jnc", "jne", "jng", "jnge", "jnl", "jnle",
  "jno", "jnp", "jns", "jnz", "jo", "jp", "jpe", "jpo", "js", "jz", "lahf",
  "lds", "lea", "leave", "les", "lodsb", "lodsw", "loop", "loope", "loopne",
  "loopnz", "loopz", "mov", "movs", "movsb", "movsw", "mul", "neg", "nop",
  "not", "or", "out", "pop", "popa", "popf", "push", "pusha", "pushf", "rcl",
  "rcr", "rep", "repe", "repne", "repnz", "repz", "ret", "retf", "rol", "ror",
  "sahf", "sal", "sar", "sbb", "scasb", "scasw", "shl", "shr", "stc", "std",
  "sti", "stos", "stosb", "stosw", "sub", "test", "wait", "xchg", "xlat", "xor",
];

const REGISTERS = [
  "ah", "al", "ax", "bh", "bl", "bp", "bx", "ch", "cl", "cs", "cx", "dh", "di",
  "dl", "ds", "dx", "es", "si", "sp", "ss", "eax", "ebx", "ecx", "edx", "esi",
  "edi", "ebp", "esp", "fs", "gs",
];

let registered = false;

export function registerAsmLanguage(): void {
  if (registered) return;
  registered = true;

  monaco.languages.register({
    id: ASM_LANGUAGE_ID,
    extensions: [".asm", ".inc"],
  });

  monaco.languages.setLanguageConfiguration(ASM_LANGUAGE_ID, {
    comments: { lineComment: ";" },
    brackets: [
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
  });

  monaco.languages.setMonarchTokensProvider(ASM_LANGUAGE_ID, {
    ignoreCase: true,
    defaultToken: "",
    directives: DIRECTIVES,
    instructions: INSTRUCTIONS,
    registers: REGISTERS,

    tokenizer: {
      root: [
        [/;.*$/, "comment"],

        // A label at the start of a line. Assembly identifiers admit rather more
        // punctuation than C ones do.
        [/^\s*[A-Za-z_$@?][\w$@?]*:/, "type.identifier"],

        // .MODEL, .CODE, .386 and friends. Matched ahead of bare words so the
        // leading dot doesn't get dropped on the floor.
        [/\.[A-Za-z][\w]*/, "keyword.directive"],

        [
          /[A-Za-z_$@?][\w$@?]*/,
          {
            cases: {
              "@registers": "variable.predefined",
              "@instructions": "keyword",
              "@directives": "keyword.directive",
              "@default": "identifier",
            },
          },
        ],

        // Radix is a suffix here, not a prefix: 0A000h, 1101b, 64d.
        [/\d[\dA-Fa-f]*[hH]\b/, "number.hex"],
        [/[01]+[bB]\b/, "number.binary"],
        [/\d+[dD]?\b/, "number"],

        [/"([^"\\]|\\.)*"/, "string"],
        [/'([^'\\]|\\.)*'/, "string"],
      ],
    },
  });
}
