import { lazy, Suspense, useEffect, useState } from "react";

import { useProjects } from "./project/useProjects";
import { SetupPane } from "./toolchain/SetupPane";
import { clearToolchain, loadToolchain, type StoredToolchain } from "./toolchain/store";

/**
 * Monaco is by far the largest thing here, and a first-time visitor sees the
 * setup screen — which has no editor on it — while also downloading 7-Zip to
 * unpack their disks. Deferring it keeps those two off the same critical path,
 * and by the time the disks are unpacked the editor has long since arrived.
 */
const Workbench = lazy(() =>
  import("./ide/Workbench").then((module) => ({ default: module.Workbench })),
);

/**
 * Two states: no compiler, or the IDE. The setup screen is the whole page rather
 * than a modal over a disabled editor, because without a toolchain there is
 * nothing an editor could usefully do.
 */
export function App() {
  // undefined while the cache is being read, null when nothing is installed.
  const [toolchain, setToolchain] = useState<StoredToolchain | null | undefined>();
  const projects = useProjects();

  useEffect(() => {
    loadToolchain().then(setToolchain);
  }, []);

  if (toolchain === undefined) {
    return (
      <main className="setup">
        <p className="placeholder">Checking for an installed compiler…</p>
      </main>
    );
  }

  if (toolchain === null) {
    return (
      <main className="setup">
        <h1 className="brand brand-large">
          13h<span className="brand-dim">.dev</span>
        </h1>
        <p className="placeholder">Turbo C++ · mode 13h · entirely in your browser</p>

        <SetupPane onInstalled={setToolchain} />

        {/*
          A visible source link is how a web app meets the spirit of GPL section
          3: the code is served to every visitor, so every visitor should be able
          to find where it came from.
        */}
        <footer className="setup-footer">
          13h.dev is free software under the{" "}
          <a href="https://www.gnu.org/licenses/old-licenses/gpl-2.0.html">GPL-2.0</a>;
          the <a href="https://github.com/deadcast2/13h.dev">source is on GitHub</a>. DOS
          emulation by <a href="https://github.com/caiiiycuk/js-dos">js-dos</a>{" "}
          (GPL-2.0), archive handling by{" "}
          <a href="https://github.com/use-strict/7z-wasm">7-Zip</a> (LGPL). Turbo C++ is
          Borland/Embarcadero&apos;s and is supplied by you, not by this site.
        </footer>
      </main>
    );
  }

  if (!projects.ready || !projects.current) {
    return <p className="placeholder">Opening your project…</p>;
  }

  return (
    <Suspense fallback={<p className="placeholder">Loading the editor…</p>}>
      <Workbench
        // Remounts on a project switch, which is how the editor's models and the
        // build state get discarded along with the project they belonged to.
        key={projects.current.id}
        stored={projects.current}
        projects={projects}
        toolchain={toolchain}
        onToolchainChanged={setToolchain}
        onForget={async () => {
          await clearToolchain();
          setToolchain(null);
        }}
      />
    </Suspense>
  );
}
