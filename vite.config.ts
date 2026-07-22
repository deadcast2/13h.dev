import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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
});
