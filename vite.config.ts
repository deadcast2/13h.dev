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

// Content Security Policy. This string must stay in step with public/_headers,
// which is the production copy — the same split COOP/COEP already live under.
// Keeping it on the dev server too means a violation (a CDN font, an inline
// <script>) breaks loudly during `npm run dev` rather than silently in prod.
//
// Every source here was settled by driving a real build under the policy and
// removing nothing the emulator, 7-Zip or Monaco did not turn out to need:
//
//   'unsafe-eval'    js-dos's emulators.js evaluates a string as JS at boot; the
//                    build dies at emulator start without it (measured, not
//                    guessed). It does NOT grant 'unsafe-inline', so injected
//                    inline <script> and on*= handlers — the usual XSS vectors —
//                    stay blocked. It opens only the eval sink, which here is
//                    js-dos's own bootstrap and is never handed user data.
//   blob:            Vite instantiates bundled workers (Monaco's, and js-dos's
//                    DOSBox worker) from blob URLs in a production build.
//   'unsafe-inline'  on style only — Monaco injects styles at runtime. Scripts
//                    get no such grant.
//   frame-ancestors  refuses framing, which COOP does not cover.
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = {
  ...crossOriginIsolation,
  "Content-Security-Policy": contentSecurityPolicy,
};

export default defineConfig({
  plugins: [react()],
  server: { headers: securityHeaders },
  preview: { headers: securityHeaders },

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
