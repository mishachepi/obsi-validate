/**
 * Minimal stand-in for the `obsidian` package (which only exists inside the
 * app) plus a fake App whose vault is a real directory on disk. Covers exactly
 * what src/bridge.ts touches: TFile/TFolder, getMarkdownFiles, getFiles,
 * getAbstractFileByPath, cachedRead. Like Obsidian, dot-folders are invisible.
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

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
  const byPath = new Map<string, TAbstractFile>();
  const files: TFile[] = [];
  const walk = (dir: string, folder: TFolder) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const rel = folder.path ? `${folder.path}/${e.name}` : e.name;
      if (e.isDirectory()) {
        const sub = new TFolder(rel, e.name, folder);
        folder.children.push(sub);
        byPath.set(rel, sub);
        walk(join(dir, e.name), sub);
      } else {
        const f = new TFile(rel, e.name, folder);
        folder.children.push(f);
        byPath.set(rel, f);
        files.push(f);
      }
    }
  };
  walk(root, new TFolder("", "", null));
  return {
    vault: {
      getFiles: () => files,
      getMarkdownFiles: () => files.filter((f) => f.extension === "md"),
      getAbstractFileByPath: (p: string) => byPath.get(p) ?? null,
      cachedRead: async (f: TFile) => readFileSync(join(root, f.path), "utf-8"),
    },
  };
}
