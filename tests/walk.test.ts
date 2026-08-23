import { describe, test, expect, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { walkMdFiles, walkLinkableFiles } from "../src/walk.js";

/** Build a small on-disk tree under a fresh temp dir. `files` are
 * vault-relative paths; each gets minimal content so it's a real .md. */
async function buildTree(files: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "obsi-validate-walk-"));
  for (const rel of files) {
    const full = join(root, rel);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, "---\ntype_key: page\n---\n");
  }
  return root;
}

const dirsCreated: string[] = [];
afterEach(async () => {
  await Promise.all(dirsCreated.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function tree(files: string[]): Promise<string> {
  const root = await buildTree(files);
  dirsCreated.push(root);
  return root;
}

describe("walkVaultFiles — fixed defaults (always on)", () => {
  test("dot-directories are skipped", async () => {
    const root = await tree([".hidden/Note.md", "Visible.md"]);
    const paths = await walkMdFiles(root);
    expect(paths.map((p) => p.replace(root + "/", ""))).toEqual(["Visible.md"]);
  });

  test("_archive and _skill are skipped even without any configured exclude", async () => {
    const root = await tree(["_archive/Old.md", "_skill/Prompt.md", "Real.md"]);
    const paths = await walkMdFiles(root);
    expect(paths.map((p) => p.replace(root + "/", ""))).toEqual(["Real.md"]);
  });
});

describe("walkVaultFiles — configurable excludeDirs", () => {
  test("an excluded directory is skipped in target mode", async () => {
    const root = await tree(["_templates/task-template.md", "tasks/real-task.md"]);
    const paths = await walkMdFiles(root, new Set(["_templates"]));
    expect(paths.map((p) => p.replace(root + "/", ""))).toEqual(["tasks/real-task.md"]);
  });

  test("an excluded directory is also kept out of the link index (index mode)", async () => {
    const root = await tree(["_templates/task-template.md", "tasks/real-task.md"]);
    const paths = await walkLinkableFiles(root, new Set(["_templates"]));
    expect(paths.map((p) => p.replace(root + "/", ""))).toEqual(["tasks/real-task.md"]);
  });

  test("no excludeDirs argument behaves exactly as before (defaults only)", async () => {
    const root = await tree(["_templates/task-template.md", "tasks/real-task.md"]);
    const paths = await walkMdFiles(root);
    expect(paths.map((p) => p.replace(root + "/", "")).sort()).toEqual(
      ["_templates/task-template.md", "tasks/real-task.md"].sort(),
    );
  });

  test("excludeDirs matches by exact basename, not a path prefix or substring", async () => {
    // "templates" (no underscore) must not accidentally match "_templates",
    // and a file merely containing the excluded word must not be skipped.
    const root = await tree(["_templates/task-template.md", "not_templates_at_all/Note.md"]);
    const paths = await walkMdFiles(root, new Set(["templates"]));
    expect(paths.map((p) => p.replace(root + "/", "")).sort()).toEqual(
      ["_templates/task-template.md", "not_templates_at_all/Note.md"].sort(),
    );
  });

  test("index mode still keeps _index.md and .canvas files outside excluded dirs", async () => {
    const root = await tree(["_templates/x.md", "_system/entities/_index.md"]);
    await writeFile(join(root, "arch.canvas"), "{}");
    const paths = await walkLinkableFiles(root, new Set(["_templates"]));
    const rel = paths.map((p) => p.replace(root + "/", "")).sort();
    expect(rel).toEqual(["_system/entities/_index.md", "arch.canvas"]);
  });
});
