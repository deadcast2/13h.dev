/**
 * Browser `KeyboardEvent.code` -> DOSBox key code.
 *
 * The codes `sendKeyEvent` expects are GLFW key constants, which is worth knowing
 * because it means they are a documented public standard rather than something
 * internal to js-dos: letters are ASCII uppercase, digits are ASCII, and the
 * non-printing keys start at 256.
 *
 * Keying off `code` rather than `key` is deliberate. `code` is the physical key,
 * so WASD stays under the same fingers on an AZERTY keyboard and shifted symbols
 * do not change identity mid-keypress — which is what a DOS game expects, since
 * it reads scancodes.
 */

const GLFW = {
  SPACE: 32,
  APOSTROPHE: 39,
  COMMA: 44,
  MINUS: 45,
  PERIOD: 46,
  SLASH: 47,
  SEMICOLON: 59,
  EQUAL: 61,
  LEFT_BRACKET: 91,
  BACKSLASH: 92,
  RIGHT_BRACKET: 93,
  GRAVE: 96,
  ESCAPE: 256,
  ENTER: 257,
  TAB: 258,
  BACKSPACE: 259,
  INSERT: 260,
  DELETE: 261,
  RIGHT: 262,
  LEFT: 263,
  DOWN: 264,
  UP: 265,
  PAGE_UP: 266,
  PAGE_DOWN: 267,
  HOME: 268,
  END: 269,
  CAPS_LOCK: 280,
  SCROLL_LOCK: 281,
  NUM_LOCK: 282,
  PRINT_SCREEN: 283,
  PAUSE: 284,
  F1: 290,
  KP_0: 320,
  KP_DECIMAL: 330,
  KP_DIVIDE: 331,
  KP_MULTIPLY: 332,
  KP_SUBTRACT: 333,
  KP_ADD: 334,
  KP_ENTER: 335,
  LEFT_SHIFT: 340,
  LEFT_CONTROL: 341,
  LEFT_ALT: 342,
  RIGHT_SHIFT: 344,
  RIGHT_CONTROL: 345,
  RIGHT_ALT: 346,
} as const;

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const KEY_CODES: Readonly<Record<string, number>> = {
  // Letters and digits are contiguous in both namespaces.
  ...Object.fromEntries(
    [...LETTERS].map((letter) => [`Key${letter}`, letter.charCodeAt(0)]),
  ),
  ...Object.fromEntries(
    Array.from({ length: 10 }, (_, n) => [`Digit${n}`, 48 + n]),
  ),
  ...Object.fromEntries(
    Array.from({ length: 12 }, (_, n) => [`F${n + 1}`, GLFW.F1 + n]),
  ),
  ...Object.fromEntries(
    Array.from({ length: 10 }, (_, n) => [`Numpad${n}`, GLFW.KP_0 + n]),
  ),

  Space: GLFW.SPACE,
  Quote: GLFW.APOSTROPHE,
  Comma: GLFW.COMMA,
  Minus: GLFW.MINUS,
  Period: GLFW.PERIOD,
  Slash: GLFW.SLASH,
  Semicolon: GLFW.SEMICOLON,
  Equal: GLFW.EQUAL,
  BracketLeft: GLFW.LEFT_BRACKET,
  Backslash: GLFW.BACKSLASH,
  BracketRight: GLFW.RIGHT_BRACKET,
  Backquote: GLFW.GRAVE,

  Escape: GLFW.ESCAPE,
  Enter: GLFW.ENTER,
  Tab: GLFW.TAB,
  Backspace: GLFW.BACKSPACE,
  Insert: GLFW.INSERT,
  Delete: GLFW.DELETE,

  ArrowRight: GLFW.RIGHT,
  ArrowLeft: GLFW.LEFT,
  ArrowDown: GLFW.DOWN,
  ArrowUp: GLFW.UP,
  PageUp: GLFW.PAGE_UP,
  PageDown: GLFW.PAGE_DOWN,
  Home: GLFW.HOME,
  End: GLFW.END,

  CapsLock: GLFW.CAPS_LOCK,
  ScrollLock: GLFW.SCROLL_LOCK,
  NumLock: GLFW.NUM_LOCK,
  PrintScreen: GLFW.PRINT_SCREEN,
  Pause: GLFW.PAUSE,

  NumpadDecimal: GLFW.KP_DECIMAL,
  NumpadDivide: GLFW.KP_DIVIDE,
  NumpadMultiply: GLFW.KP_MULTIPLY,
  NumpadSubtract: GLFW.KP_SUBTRACT,
  NumpadAdd: GLFW.KP_ADD,
  NumpadEnter: GLFW.KP_ENTER,

  ShiftLeft: GLFW.LEFT_SHIFT,
  ControlLeft: GLFW.LEFT_CONTROL,
  AltLeft: GLFW.LEFT_ALT,
  ShiftRight: GLFW.RIGHT_SHIFT,
  ControlRight: GLFW.RIGHT_CONTROL,
  AltRight: GLFW.RIGHT_ALT,
};

export function toDosKeyCode(code: string): number | undefined {
  return KEY_CODES[code];
}
