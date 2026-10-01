/**
 * Static file server for public/, with no dependencies. ES modules need HTTP, not file://.
 *
 *   node tools/serve.mjs            # http://localhost:9600 (or PORT)
 *   node tools/serve.mjs 9000       # another port
 *
 * Also used by the other tools: `const { url, close } = await serve({ port: 0 })`.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PUBLIC = resolve(fileURLToPath(new URL("../public", import.meta.url)));

const TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
    ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2",
    ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".bin": "application/octet-stream",
    ".obj": "text/plain; charset=utf-8", ".mtl": "text/plain; charset=utf-8", ".stl": "model/stl",
    ".md": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json",
};

/**
 * @param {{ root?: string, port?: number }} [options] port 0 picks a free one
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 */
export function serve(options = {}) {
    const root = resolve(options.root || PUBLIC);
    const server = createServer(async (req, res) => {
        try {
            let path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
            if (path.endsWith("/")) path += "index.html";
            const file = normalize(join(root, path));
            if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end("Forbidden"); return; }
            const info = await stat(file);
            // like GitHub Pages: /docs redirects to /docs/ so relative links resolve
            if (info.isDirectory()) { res.writeHead(302, { Location: path + "/" }).end(); return; }
            if (!info.isFile()) throw new Error("not a file");
            res.writeHead(200, { "Content-Type": TYPES[extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
            res.end(await readFile(file));
        } catch {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
        }
    });
    return new Promise((done, fail) => {
        server.once("error", fail);
        server.listen(options.port ?? 0, () => {
            const port = server.address().port;
            done({ url: `http://localhost:${port}`, port, close: () => new Promise((r) => server.close(() => r())) });
        });
    });
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
    const { url } = await serve({ port: Number(process.argv[2] || process.env.PORT || 9600) });
    console.log(`Projection Lab running at ${url}`);
}
