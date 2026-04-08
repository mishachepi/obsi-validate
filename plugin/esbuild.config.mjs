import esbuild from "esbuild";

const production = process.argv[2] === "production";

esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*"],
  format: "cjs",
  target: "es2022",
  outfile: "main.js",
  platform: "node",
  alias: {
    fs: "./src/shims/empty-fs.ts",
  },
  sourcemap: production ? false : "inline",
  logLevel: "info",
}).catch(() => process.exit(1));
