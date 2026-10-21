// Fails when the plugin bundle (main.js) requires anything but `obsidian`:
// node builtins are marked external in esbuild.config.mjs, so an accidental
// `fs`/`path` import would build fine and only break the plugin on mobile.
import { readFileSync, statSync } from "fs";

const file = process.argv[2] ?? "main.js";
const src = readFileSync(file, "utf-8");
const required = [...new Set([...src.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]))];
const extra = required.filter((m) => m !== "obsidian");
const kb = Math.round(statSync(file).size / 1024);
console.log(`${file}: ${kb} KB, requires ${required.join(", ") || "nothing"}`);
if (extra.length) {
  console.error(`plugin bundle must only require "obsidian", found: ${extra.join(", ")}`);
  process.exit(1);
}
