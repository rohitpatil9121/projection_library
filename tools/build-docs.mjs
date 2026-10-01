/**
 * Build public/docs/api.html from the JSDoc comments in the engine source. No dependencies.
 *
 *   npm run docs
 *
 * The engine's comments are written to be read as they are, so this does not try to be clever: for every
 * module it prints the opening comment, then each exported class, function and constant with the comment
 * above it, and for classes each public member with its comment. Names starting with "_" are internal
 * and left out.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PUBLIC } from "./serve.mjs";

const GROUPS = [
    ["Core", ["engine/Game.js", "engine/Renderer.js", "engine/Scene.js", "engine/Entity.js", "engine/Transform.js", "engine/Camera.js", "engine/Loop.js", "engine/config.js"]],
    ["Geometry and materials", ["engine/Geometry.js", "engine/geometry/primitives.js", "engine/Mesh.js", "engine/Material.js", "engine/Texture.js"]],
    ["Light and effects", ["engine/ShadowMap.js", "engine/PostFX.js", "engine/Sky.js", "engine/ParticleSystem.js", "engine/Trail.js", "shaders/chunks/projection.js", "shaders/chunks/lighting.js"]],
    ["Models and animation", ["engine/loaders/GLTF.js", "engine/Animation.js"]],
    ["Input and gameplay", ["engine/Input.js", "engine/TouchControls.js", "engine/Collision.js", "engine/Tween.js", "engine/Juice.js", "engine/Audio.js", "engine/DebugOverlay.js"]],
    ["WebGL plumbing", ["engine/gl/GLContext.js", "engine/gl/ShaderProgram.js", "engine/gl/RenderTarget.js"]],
];

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const slug = (s) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Comment body without the leading " * " on each line. */
function clean(block) {
    return block.split("\n").map((l) => l.replace(/^\s*\*? ?/, "")).filter((l) => !/^@module\b/.test(l.trim())).join("\n").trim();
}

/** The declaration without its body: up to the parenthesis that closes the parameters, or the "{" or "=" otherwise. */
function signature(line) {
    const s = line.trim().replace(/^export\s+/, "");
    if (/^class\b/.test(s)) return s.replace(/\s*\{.*$/, "");
    if (/^const\b/.test(s)) return s.replace(/\s*=.*$/, "");
    const open = s.indexOf("(");
    if (open < 0) return s;
    let depth = 0;
    for (let i = open; i < s.length; i++) {
        if (s[i] === "(") depth++;
        else if (s[i] === ")" && --depth === 0) return s.slice(0, i + 1);
    }
    return s;
}

function parse(source) {
    source = source.replace(/\r\n/g, "\n");
    const out = { doc: "", items: [] };
    let current = null;
    const re = /\/\*\*([\s\S]*?)\*\/\n?([^\n]*)/g;
    // exports with no comment still deserve a line: collect them all first
    const exported = [...source.matchAll(/^export (class|function|async function|const) ([A-Za-z0-9_]+)[^\n]*/gm)];
    const documented = new Set();
    for (const m of source.matchAll(re)) {
        const body = m[1], next = m[2];
        if (/@module\b/.test(body)) { out.doc = clean(body); if (!/^\s*export /.test(next)) continue; }
        if (/@typedef\b/.test(body) && !/^\s*export /.test(next)) continue;
        let k;
        if ((k = next.match(/^export (?:async )?(class|function|const) ([A-Za-z0-9_]+)/))) {
            const item = { kind: k[1], name: k[2], sig: signature(next), doc: /@module\b/.test(body) ? "" : clean(body), members: [] };
            out.items.push(item);
            documented.add(k[2]);
            current = k[1] === "class" ? item : null;
        } else if (current && (k = next.match(/^ {4}(static |get |set |async )?([A-Za-z0-9]+)\s*\(/)) && !next.includes("function")) {
            if (k[2].startsWith("_")) continue;
            current.members.push({ sig: signature(next), doc: clean(body) });
        }
    }
    for (const m of exported) if (!documented.has(m[2])) out.items.push({ kind: m[1].replace("async ", ""), name: m[2], sig: signature(m[0]), doc: "", members: [] });
    return out;
}

let nav = "", body = "", modules = 0, entries = 0;
for (const [group, files] of GROUPS) {
    nav += `<h2>${esc(group)}</h2>\n`;
    for (const file of files) {
        const parsed = parse(await readFile(join(PUBLIC, file), "utf8"));
        const title = file.replace(/^(engine|shaders)\//, "").replace(/\.js$/, ""), id = slug(file);
        modules++;
        nav += `<a href="#${id}">${esc(title)}</a>\n`;
        body += `<section class="api-module" id="${id}">\n<h2>${esc(title)}</h2>\n<p class="path">public/${esc(file)}</p>\n`;
        if (parsed.doc) body += `<div class="api-doc">${esc(parsed.doc)}</div>\n`;
        for (const item of parsed.items) {
            entries++;
            body += `<div class="api-item" id="${id}-${slug(item.name)}"><h3><span class="kind">${item.kind}</span>${esc(item.sig.replace(/^(class|function|const|async function)\s+/, ""))}</h3>\n`;
            if (item.doc) body += `<div class="api-doc">${esc(item.doc)}</div>\n`;
            if (item.members.length) {
                body += `<div class="api-members">\n`;
                for (const m of item.members) { entries++; body += `<div><div class="sig">${esc(m.sig)}</div><div class="api-doc">${esc(m.doc)}</div></div>\n`; }
                body += `</div>\n`;
            }
            body += `</div>\n`;
        }
        body += `</section>\n`;
    }
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>API reference · Projection Lab</title>
    <meta name="description" content="Every exported class, function and constant of the Projection Lab engine, with the comments from the source.">
    <link rel="icon" href="../favicon.svg" type="image/svg+xml">
    <link rel="stylesheet" href="../site/site.css">
</head>
<body>
    <a class="skip" href="#main">Skip to content</a>
    <header class="nav">
        <div class="wrap">
            <a class="brand" href="../"><img src="../favicon.svg" alt="" width="26" height="26"><span>Projection Lab</span></a>
            <nav aria-label="Main">
                <a href="../examples/">Examples</a>
                <a href="./" aria-current="page">Docs</a>
                <a href="../#games">Games</a>
                <a href="https://github.com/rohitpatil9121/projection_library">GitHub</a>
            </nav>
        </div>
    </header>
    <div class="wrap docs">
        <aside aria-label="Modules">
            <h2>Docs</h2>
            <a href="./">Getting started</a>
${nav}        </aside>
        <article id="main">
            <h1>API reference</h1>
            <p class="lede">Generated from the comments in the source by <code>npm run docs</code>. Import everything from <code>engine/index.js</code>.</p>
${body}        </article>
    </div>
    <script type="module" src="../site/site.js"></script>
</body>
</html>
`;
await writeFile(join(PUBLIC, "docs", "api.html"), html);
console.log(`docs/api.html: ${modules} modules, ${entries} entries, ${(html.length / 1024).toFixed(0)} KB`);
