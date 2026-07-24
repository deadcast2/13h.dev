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

// Content Security Policy. The strict form (dev = false) is the production
// policy and must stay in step with public/_headers. Real violations — a CDN
// font, a remote image — break loudly on the dev server too, which is the point
// of running the policy there. Scripts are the one exception, below.
//
// Every source here was settled by driving a real build under the policy and
// removing nothing the emulator, 7-Zip or Monaco did not turn out to need:
//
//   'unsafe-eval'    js-dos's emulators.js evaluates a string as JS at boot; the
//                    build dies at emulator start without it (measured, not
//                    guessed). It does NOT grant 'unsafe-inline', so injected
//                    inline <script> and on*= handlers — the usual XSS vectors —
//                    stay blocked in production. It opens only the eval sink,
//                    which here is js-dos's own bootstrap and is never handed
//                    user data.
//   blob:            Vite instantiates bundled workers (Monaco's, and js-dos's
//                    DOSBox worker) from blob URLs in a production build.
//   'unsafe-inline'  on style always — Monaco injects styles at runtime. On
//                    script ONLY on the dev server: @vitejs/plugin-react injects
//                    its Fast Refresh preamble as an inline <script>, and without
//                    this the CSP blocks it, the preamble never installs, and the
//                    app throws "can't detect preamble" and renders a blank page.
//                    A build ships no preamble, so production and the built-app
//                    `preview` stay strict — where a stray inline <script> is
//                    still caught, `vite preview` mirroring prod exactly.
//   frame-ancestors  refuses framing, which COOP does not cover.
const contentSecurityPolicy = (dev: boolean) =>
  [
    "default-src 'self'",
    `script-src 'self' 'unsafe-eval' blob:${dev ? " 'unsafe-inline'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' blob: data:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

const securityHeaders = (dev: boolean) => ({
  ...crossOriginIsolation,
  "Content-Security-Policy": contentSecurityPolicy(dev),
});

export default defineConfig({
  plugins: [react()],
  server: { headers: securityHeaders(true) },
  preview: { headers: securityHeaders(false) },

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
