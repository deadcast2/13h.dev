import react from "@vitejs/plugin-react";
// Vitest's defineConfig is Vite's with the `test` block added; the tests go
// through the same transform pipeline as the app, so there is no second build
// setup to keep in step with this one.
import { defineConfig } from "vitest/config";

// js-dos runs DOSBox in a worker and reaches for SharedArrayBuffer, which browsers
// only hand out to cross-origin-isolated pages. These headers provide that
// isolation; any production host needs to send them too.
const crossOriginIsolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  plugins: [react()],
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },

  /**
   * Node, not jsdom. What is covered here is the pure rule-dense logic — DOS
   * naming, the export format, what TCC is told to build — and none of it
   * touches the DOM. Anything that needs a browser needs a real one: the
   * emulator, Monaco, and a build are verified by driving the app, and a
   * plausible-looking fake would only make that coverage look accounted for.
   */
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
