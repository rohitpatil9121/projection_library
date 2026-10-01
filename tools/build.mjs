/**
 * Bundle the engine into one minified ES module: public/dist/projection-lab.min.js.
 *
 *   npm run build
 *
 * The engine itself needs no build step; this is for people who would rather load one file than copy
 * three folders. The bundle exports exactly what engine/index.js exports, and this script checks that
 * by importing both and comparing the names. esbuild is the only build-time dependency.
 */
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { PUBLIC } from "./serve.mjs";

const entry = join(PUBLIC, "engine", "index.js"), outdir = join(PUBLIC, "dist"), outfile = join(outdir, "projection-lab.min.js");
await mkdir(outdir, { recursive: true });
await build({
    entryPoints: [entry], outfile, bundle: true, format: "esm", minify: true, target: "es2020", sourcemap: true, legalComments: "none",
    banner: { js: "/* Projection Lab engine. https://github.com/rohitpatil9121/projection_library  Includes gl-matrix 3.4.4 (MIT). */" },
});

const names = async (file) => Object.keys(await import(pathToFileURL(file).href)).sort();
const source = await names(entry), bundled = await names(outfile);
const missing = source.filter((n) => !bundled.includes(n));
if (missing.length || bundled.length !== source.length) {
    console.error(`bundle exports differ from engine/index.js: missing ${missing.join(", ") || "none"}; ${bundled.length} vs ${source.length}`);
    process.exit(1);
}
console.log(`dist/projection-lab.min.js  ${((await stat(outfile)).size / 1024).toFixed(0)} KB, ${bundled.length} exports`);
