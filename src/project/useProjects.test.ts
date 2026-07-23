// @vitest-environment jsdom
import "fake-indexeddb/auto";

import { renderHook, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listProjects, newProject, saveProject } from "./store";
import { toExport } from "./transfer";
import { useProjects } from "./useProjects";

/**
 * Which projects exist, and which one is open.
 *
 * The trap this exists to hold down is first-run seeding. "No projects yet, so
 * write a starter" is not idempotent, and StrictMode runs effects twice on
 * purpose: both passes read an empty store and both write, and the user opens
 * the app to two identical projects. The tests below therefore run the hook
 * under StrictMode, because running it without would not be a test of anything.
 */

const realIndexedDB = globalThis.indexedDB;

const open = () => renderHook(() => useProjects(), { wrapper: StrictMode });

const ready = async (hook: ReturnType<typeof open>) => {
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  return hook;
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  globalThis.indexedDB = realIndexedDB;
});

describe("first run", () => {
  it("seeds exactly one starter project under StrictMode", async () => {
    const hook = await ready(open());

    expect(hook.result.current.projects).toHaveLength(1);
    // The store is checked as well as the hook's state: two writes could land
    // while only one of them is what the hook happens to be showing.
    expect(await listProjects()).toHaveLength(1);
  });

  it("gives the starter something to compile", async () => {
    const hook = await ready(open());
    expect(hook.result.current.current?.files.length).toBeGreaterThan(0);
  });

  it("reports storage as working", async () => {
    const hook = await ready(open());
    expect(hook.result.current.persistent).toBe(true);
  });
});

describe("returning", () => {
  it("reopens the project that was open last", async () => {
    const older = { ...newProject("Older", []), lastOpenedAt: 1_000 };
    const newer = { ...newProject("Newer", []), lastOpenedAt: 2_000 };
    await saveProject(older);
    await saveProject(newer);

    const hook = await ready(open());

    expect(hook.result.current.current?.name).toBe("Newer");
    expect(hook.result.current.projects).toHaveLength(2);
  });

  it("seeds nothing when projects already exist", async () => {
    await saveProject(newProject("Mine", []));
    await ready(open());

    expect(await listProjects()).toHaveLength(1);
  });
});

describe("import", () => {
  const exported = () =>
    toExport("Carried in", {
      files: [
        { name: "MAIN.C", text: "int main(){return 0;}" },
        { name: "VGA.H", text: "" },
      ],
      openNames: ["MAIN.C"],
      activeName: "MAIN.C",
    });

  it("arrives as a new project and opens it", async () => {
    const hook = await ready(open());
    const before = hook.result.current.current?.id;

    hook.result.current.importFrom(exported());

    await waitFor(() => expect(hook.result.current.projects).toHaveLength(2));
    expect(hook.result.current.current?.name).toBe("Carried in");
    expect(hook.result.current.current?.id).not.toBe(before);
  });

  it("keeps the tabs the export recorded rather than opening everything", async () => {
    const hook = await ready(open());

    hook.result.current.importFrom(exported());
    await waitFor(() => expect(hook.result.current.current?.name).toBe("Carried in"));

    expect(hook.result.current.current?.files).toHaveLength(2);
    expect(hook.result.current.current?.openNames).toEqual(["MAIN.C"]);
  });

  it("never writes over the project that is open", async () => {
    await saveProject(newProject("Mine", [{ name: "MAIN.C", text: "my work" }]));
    const hook = await ready(open());

    hook.result.current.importFrom(exported());
    await waitFor(() => expect(hook.result.current.projects).toHaveLength(2));

    const mine = (await listProjects()).find((p) => p.name === "Mine");
    expect(mine?.files[0].text).toBe("my work");
  });

  it("distinguishes a second copy of the same file", async () => {
    const hook = await ready(open());

    hook.result.current.importFrom(exported());
    await waitFor(() => expect(hook.result.current.projects).toHaveLength(2));

    hook.result.current.importFrom(exported());
    await waitFor(() => expect(hook.result.current.projects).toHaveLength(3));

    expect((await listProjects()).map((p) => p.name).sort()).toEqual([
      "Carried in",
      "Carried in (2)",
      "Mode 13h starter",
    ]);
  });
});

describe("rename", () => {
  it("changes the name and leaves the contents alone", async () => {
    const hook = await ready(open());
    const id = hook.result.current.current!.id;

    hook.result.current.rename(id, "Renamed");
    await waitFor(() => expect(hook.result.current.current?.name).toBe("Renamed"));

    const [stored] = await listProjects();
    expect(stored.name).toBe("Renamed");
    expect(stored.files.length).toBeGreaterThan(0);
  });
});

describe("delete", () => {
  it("opens another project when the open one goes", async () => {
    // Two projects, so deleting the open one leaves a different one to fall
    // back to. The newer opens on load; the older is what should surface after.
    await saveProject({ ...newProject("Kept", []), lastOpenedAt: 1 });
    await saveProject({ ...newProject("Open", []), lastOpenedAt: 2 });
    const hook = await ready(open());
    expect(hook.result.current.current?.name).toBe("Open");

    hook.result.current.remove(hook.result.current.current!.id);

    // Waiting on the name genuinely waits for `remove` to finish reopening: the
    // fallback name differs from what was open, so this can't pass on the stale
    // pre-delete state the way a project count of one — true throughout — would.
    await waitFor(() => expect(hook.result.current.current?.name).toBe("Kept"));
    expect(hook.result.current.projects).toHaveLength(1);
  });

  it("leaves a fresh starter rather than an empty application", async () => {
    const hook = await ready(open());
    const goneId = hook.result.current.current!.id;

    hook.result.current.remove(goneId);

    // The replacement is also called "Mode 13h starter", so the name is the same
    // before and after and cannot tell the delete apart from its own starting
    // state. The id turning over is the signal that the fresh one is now current.
    await waitFor(() => expect(hook.result.current.current?.id).not.toBe(goneId));
    expect(hook.result.current.current?.name).toBe("Mode 13h starter");
    expect(await listProjects()).toHaveLength(1);
  });
});

describe("when storage is unavailable", () => {
  // Private mode, or storage blocked outright.
  beforeEach(() => {
    globalThis.indexedDB = undefined as unknown as IDBFactory;
  });

  it("still opens, on a single project, and says so", async () => {
    const hook = await ready(open());

    expect(hook.result.current.persistent).toBe(false);
    expect(hook.result.current.current?.files.length).toBeGreaterThan(0);
  });

  it("still accepts an import, which is the only way work can arrive", async () => {
    const hook = await ready(open());

    hook.result.current.importFrom(
      toExport("Carried in", {
        files: [{ name: "MAIN.C", text: "" }],
        openNames: ["MAIN.C"],
        activeName: "MAIN.C",
      }),
    );

    await waitFor(() => expect(hook.result.current.current?.name).toBe("Carried in"));
    expect(hook.result.current.persistent).toBe(false);
  });
});
