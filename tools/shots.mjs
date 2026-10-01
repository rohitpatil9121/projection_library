/**
 * Capture the thumbnails the site uses (public/assets/shots/) by opening each example in headless Chrome.
 * Run it after changing how an example looks.
 *
 *   npm run shots                 # all of them
 *   node tools/shots.mjs pbr      # only the ones whose name contains "pbr"
 *
 * A page says it is ready by setting window.__ready (examples/shared.js does, after a few frames).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { serve, PUBLIC } from "./serve.mjs";
import { launch } from "./chrome.mjs";

const THUMB = { width: 960, height: 600, scheme: "dark" };
const SHOTS = [
    { name: "lit-scene", url: "/examples/lit-scene.html", wait: 1200 },
    { name: "open-world", url: "/examples/open-world.html", wait: 2500 },
    { name: "materials", url: "/examples/materials.html", wait: 1200 },
    { name: "characters", url: "/examples/characters.html", wait: 2500 },
    { name: "particles", url: "/examples/particles.html", wait: 3500 },
    { name: "picking", url: "/examples/picking.html", wait: 1200 },
    { name: "water", url: "/examples/water.html", wait: 1500 },
    { name: "instancing", url: "/experiments/instancing/", wait: 1500 },
    { name: "first-scene", url: "/examples/first-scene.html", wait: 1200 },
    { name: "prime-walk", url: "/prime-walk.html", wait: 2500 },
    // the games built on the engine live in their own repositories; their title screens are captured from the live sites
    { name: "game-night-market", url: "https://rohitpatil9121.github.io/night-market/", wait: 15000, keepUI: true },
    { name: "game-orbital", url: "https://rohitpatil9121.github.io/orbital/", wait: 5000, keepUI: true },
    { name: "game-neon-rush", url: "https://rohitpatil9121.github.io/neon-rush/", wait: 5000, keepUI: true },
    { name: "game-rewind-heist", url: "https://rohitpatil9121.github.io/rewind-heist/", wait: 5000, keepUI: true },
    // the still shown under the landing page's live scene until it starts (and instead of it without WebGL)
    { name: "hero", url: "/?shot", wait: 2500, size: { width: 1440, height: 900, scheme: "dark" }, keepUI: true, clip: "#hero" },
    // the card shown when the site's link is shared
    { name: "og", url: "/?shot", wait: 2500, size: { width: 1200, height: 630, scheme: "dark" }, keepUI: true },
];

const only = process.argv[2];
const out = join(PUBLIC, "assets", "shots");
await mkdir(out, { recursive: true });
const server = await serve({ port: 0 });
const browser = await launch({ gpu: !process.argv.includes("--software") });
let failed = 0;
try {
    for (const shot of SHOTS) {
        if (only && !shot.name.includes(only)) continue;
        const page = await browser.page(shot.url.startsWith("http") ? shot.url : server.url + shot.url, shot.size || THUMB);
        try {
            await page.waitFor("window.__ready === true || document.readyState === 'complete' && !document.querySelector('canvas')", 20000).catch(() => {});
            await new Promise((r) => setTimeout(r, shot.wait));
            if (!shot.keepUI) await page.evaluate("document.querySelectorAll('.panel, #panel, [data-chrome]').forEach((e) => e.style.display = 'none'); new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
            const image = await page.screenshot("jpeg", 84, shot.clip);
            await writeFile(join(out, shot.name + ".jpg"), image);
            console.log(`${shot.name}.jpg  ${(image.length / 1024).toFixed(0)} KB${page.errors.length ? "  (console errors: " + page.errors[0] + ")" : ""}`);
            if (page.errors.length) failed++;
        } finally { await page.close(); }
    }
} finally {
    await browser.close();
    await server.close();
}
setTimeout(() => process.exit(failed ? 1 : 0), 300);
