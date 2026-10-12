/**
 * Minimal stand-in for the `obsidian` package (it only exists inside the app)
 * and a fake App whose vault is a real folder on disk. Covers what
 * src/bridge.ts uses. Like Obsidian, dot-folders are invisible.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "fs";
import matter from "gray-matter";
import { dirname, join } from "path";

export class TAbstractFile {
  constructor(public path: string, public name: string, public parent: TFolder | null) {}
}
export class TFile extends TAbstractFile {
  get extension() {
    return this.name.includes(".") ? this.name.split(".").pop()! : "";
  }
  get basename() {
    return this.name.replace(/\.[^.]+$/, "");
  }
}
export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
}

export const obsidianModule = { TAbstractFile, TFile, TFolder };

export function fakeApp(root: string) {
  /** The vault tree as it is on disk right now. */
  const scan = () => {
    const byPath = new Map<string, TAbstractFile>();
    const files: TFile[] = [];
    const visit = (folder: TFolder) => {
      for (const e of readdirSync(join(root, folder.path), { withFileTypes: true })) {
        if (e.name.startsWith(".")) continue;
        const path = folder.path ? `${folder.path}/${e.name}` : e.name;
        const node = e.isDirectory() ? new TFolder(path, e.name, folder) : new TFile(path, e.name, folder);
        folder.children.push(node);
        byPath.set(path, node);
        if (node instanceof TFolder) visit(node);
        else files.push(node as TFile);
      }
    };
    const rootFolder = new TFolder("", "", null);
    byPath.set("/", rootFolder);
    visit(rootFolder);
    return { byPath, files };
  };
  const read = (f: TAbstractFile) => readFileSync(join(root, f.path), "utf-8");

  return {
    vault: {
      getFiles: () => scan().files,
      getMarkdownFiles: () => scan().files.filter((f) => f.extension === "md"),
      getAbstractFileByPath: (p: string) => scan().byPath.get(p) ?? null,
      cachedRead: async (f: TFile) => read(f),
      read: async (f: TFile) => read(f),
      create: async (p: string, content: string) => {
        writeFileSync(join(root, p), content);
        return scan().byPath.get(p) as TFile;
      },
      createFolder: async (p: string) => {
        mkdirSync(join(root, p), { recursive: true });
      },
      rename: async (f: TAbstractFile, to: string) => {
        if (!existsSync(dirname(join(root, to)))) mkdirSync(dirname(join(root, to)), { recursive: true });
        renameSync(join(root, f.path), join(root, to));
      },
    },
    fileManager: {
      processFrontMatter: async (f: TFile, fn: (fm: Record<string, unknown>) => void) => {
        const parsed = matter(read(f), {});
        const data = { ...parsed.data };
        fn(data);
        writeFileSync(join(root, f.path), matter.stringify(parsed.content, data));
      },
    },
  };
}

/** Copy a folder tree (test fixtures) to `to`. */
export function copyTree(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from)) {
    const src = join(from, e);
    if (statSync(src).isDirectory()) copyTree(src, join(to, e));
    else writeFileSync(join(to, e), readFileSync(src));
  }
}
