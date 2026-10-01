/**
 * Take one screenshot of any page of the site, for checking a layout by eye.
 *
 *   node tools/look.mjs index.html out.jpg                       # 1440×900, dark
 *   node tools/look.mjs docs/ out.jpg  390 844 light full        # phone width, light, whole page
 */
import { writeFile } from "node:fs/promises";
import { serve } from "./serve.mjs";
import { launch } from "./chrome.mjs";

const [path = "/", file = "look.jpg", width = "1440", height = "900", scheme = "dark", full = ""] = process.argv.slice(2);
const server = await serve({ port: 0 });
const browser = await launch({ gpu: true });
try {
    const page = await browser.page(server.url + (path.startsWith("/") ? path : "/" + path), { width: +width, height: +height, scheme, mobile: +width < 700 });
    await page.waitFor("window.__ready === true || document.readyState === 'complete'", 15000).catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));
    if (full) {
        // reveal everything, then grow the viewport to the page's height
        const h = await page.evaluate("document.querySelectorAll('.reveal').forEach((e) => e.classList.add('in')); document.documentElement.scrollHeight");
        await page.resize(+width, Math.min(h, 12000));
        await new Promise((r) => setTimeout(r, 1200));
    }
    await writeFile(file, await page.screenshot("jpeg", 80));
    const overflow = await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth");
    console.log(`${file}  horizontal overflow: ${overflow}px${page.errors.length ? "\nconsole errors:\n" + page.errors.join("\n") : ""}`);
} finally {
    await browser.close();
    await server.close();
}
setTimeout(() => process.exit(0), 300);
