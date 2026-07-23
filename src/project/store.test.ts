import "fake-indexeddb/auto";

import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

import {
  deleteProject,
  listProjects,
  newProject,
  saveProject,
  updateProject,
} from "./store";

/**
 * The storage layer, against a real IndexedDB implementation rather than a
 * stand-in for one. A hand-written fake would have to reproduce transaction
 * semantics to be worth anything here, and transaction semantics are the whole
 * subject.
 *
 * What is under test is mostly one rule: two things write to a project and they
 * must never undo each other. The workbench owns the contents and autosaves
 * them continuously; the project list owns the name and which project was
 * opened last. Both used to write the whole record, each built from a read
 * taken moments earlier, so a rename could put back file contents from before
 * the last few keystrokes. That was found by hand, at 60-80ms timings, and has
 * not been checked since.
 */

const files = (text: string) => [{ name: "MAIN.C", text }];

/** Each test gets an empty database; nothing here caches a connection. */
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe("newProject", () => {
  it("opens every file it was given, and shows the first", () => {
    const project = newProject("Starter", [
      { name: "MAIN.C", text: "" },
      { name: "VGA.H", text: "" },
    ]);

    expect(project.openNames).toEqual(["MAIN.C", "VGA.H"]);
    expect(project.activeName).toBe("MAIN.C");
  });

  it("copes with having no files at all", () => {
    expect(newProject("Empty", []).activeName).toBeNull();
  });

  it("hands out an id of its own", () => {
    expect(newProject("A", []).id).not.toBe(newProject("B", []).id);
  });
});

describe("saveProject and listProjects", () => {
  it("round-trips a project", async () => {
    const project = newProject("Starter", files("v1"));
    await saveProject(project);

    expect(await listProjects()).toEqual([project]);
  });

  it("lists most recently opened first, which is the switcher's order", async () => {
    const older = { ...newProject("Older", []), lastOpenedAt: 1_000 };
    const newer = { ...newProject("Newer", []), lastOpenedAt: 2_000 };

    await saveProject(older);
    await saveProject(newer);

    expect((await listProjects()).map((p) => p.name)).toEqual(["Newer", "Older"]);
  });

  it("returns nothing when there is nothing", async () => {
    expect(await listProjects()).toEqual([]);
  });
});

describe("updateProject", () => {
  it("merges a patch instead of replacing the record", async () => {
    const project = newProject("Starter", files("v1"));
    await saveProject(project);

    await updateProject(project.id, { name: "Renamed" });
    const [stored] = await listProjects();

    expect(stored.name).toBe("Renamed");
    expect(stored.files).toEqual(files("v1"));
    expect(stored.createdAt).toBe(project.createdAt);
  });

  it("returns what the project became, which is what callers must go on", async () => {
    const project = newProject("Starter", files("v1"));
    await saveProject(project);

    const updated = await updateProject(project.id, { name: "Renamed" });

    expect(updated?.name).toBe("Renamed");
    expect(updated).toEqual((await listProjects())[0]);
  });

  it("will not let a patch change the id it was looked up by", async () => {
    const project = newProject("Starter", []);
    await saveProject(project);

    const updated = await updateProject(project.id, { id: "something-else" });

    expect(updated?.id).toBe(project.id);
    expect(await listProjects()).toHaveLength(1);
  });

  it("does not resurrect a project deleted while a write was pending", async () => {
    const project = newProject("Starter", files("v1"));
    await saveProject(project);
    await deleteProject(project.id);

    expect(await updateProject(project.id, { files: files("v2") })).toBeNull();
    expect(await listProjects()).toEqual([]);
  });

  it("reports nothing for an id that was never there", async () => {
    expect(await updateProject("no-such-project", { name: "X" })).toBeNull();
  });
});

describe("two writers", () => {
  /**
   * The shape of the bug this replaced: a rename issued while an autosave is in
   * flight. Both are in the air at once, and neither may drop the other's
   * field.
   */
  it("keeps both changes when contents and name are written together", async () => {
    const project = newProject("Starter", files("v1"));
    await saveProject(project);

    await Promise.all([
      updateProject(project.id, { files: files("v2"), updatedAt: 2 }),
      updateProject(project.id, { name: "Renamed", updatedAt: 3 }),
    ]);

    const [stored] = await listProjects();
    expect(stored.files).toEqual(files("v2"));
    expect(stored.name).toBe("Renamed");
  });

  it("keeps both when they are issued the other way round", async () => {
    const project = newProject("Starter", files("v1"));
    await saveProject(project);

    await Promise.all([
      updateProject(project.id, { name: "Renamed" }),
      updateProject(project.id, { files: files("v2") }),
    ]);

    const [stored] = await listProjects();
    expect(stored.files).toEqual(files("v2"));
    expect(stored.name).toBe("Renamed");
  });

  it("survives a burst of writes from both sides at once", async () => {
    const project = newProject("Starter", files("v0"));
    await saveProject(project);

    await Promise.all([
      ...Array.from({ length: 10 }, (_, i) =>
        updateProject(project.id, { files: files(`v${i}`) }),
      ),
      updateProject(project.id, { name: "Renamed" }),
      updateProject(project.id, { lastOpenedAt: 9_999 }),
    ]);

    const [stored] = await listProjects();
    expect(stored.name).toBe("Renamed");
    expect(stored.lastOpenedAt).toBe(9_999);
    expect(stored.files).toEqual(files("v9"));
  });

  /**
   * Opening a project touches only lastOpenedAt for the same reason: the copy
   * in the switcher's list is a snapshot of a read, and the workbench has very
   * possibly saved over it since.
   */
  it("does not carry a stale list entry back over newer contents", async () => {
    const project = newProject("Starter", files("v1"));
    await saveProject(project);

    // What the project list is holding — read before the editing happened.
    const stale = { ...project };

    await updateProject(project.id, { files: files("typed since") });
    await updateProject(stale.id, { lastOpenedAt: 5_000 });

    const [stored] = await listProjects();
    expect(stored.files).toEqual(files("typed since"));
    expect(stored.lastOpenedAt).toBe(5_000);
  });
});

describe("write ordering", () => {
  it("lands queued writes in the order they were issued", async () => {
    const project = newProject("Starter", []);
    await saveProject(project);

    await Promise.all([
      updateProject(project.id, { name: "first" }),
      updateProject(project.id, { name: "second" }),
      updateProject(project.id, { name: "third" }),
    ]);

    expect((await listProjects())[0].name).toBe("third");
  });

  it("keeps going after a write that failed", async () => {
    const project = newProject("Starter", []);
    await saveProject(project);

    // A patch for a project that no longer exists resolves to null rather than
    // throwing, but the queue must survive either way.
    await updateProject("gone", { name: "X" });
    await updateProject(project.id, { name: "after" });

    expect((await listProjects())[0].name).toBe("after");
  });
});

describe("deleteProject", () => {
  it("removes only the one named", async () => {
    const keep = newProject("Keep", []);
    const drop = newProject("Drop", []);
    await saveProject(keep);
    await saveProject(drop);

    await deleteProject(drop.id);

    expect((await listProjects()).map((p) => p.name)).toEqual(["Keep"]);
  });

  it("is quiet about an id that is not there", async () => {
    await expect(deleteProject("no-such-project")).resolves.toBeUndefined();
  });
});
