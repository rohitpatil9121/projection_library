/**
 * Drive a headless Chrome over the DevTools protocol, with no dependencies (Node 22+ has WebSocket built in).
 * Used by tools/test.mjs (run the browser tests) and tools/shots.mjs (capture example thumbnails).
 *
 *   const browser = await launch();
 *   const page = await browser.page("http://localhost:9600/tests/", { width: 800, height: 600 });
 *   const result = await page.evaluate("window.__testResult");
 *   await browser.close();
 *
 * Chrome is found through CHROME_PATH, then the usual install locations.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CANDIDATES = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser", "/usr/bin/chromium",
];

export function findChrome() {
    const path = CANDIDATES.find((p) => p && existsSync(p));
    if (!path) throw new Error("Chrome not found. Set CHROME_PATH to a Chrome, Chromium or Edge executable.");
    return path;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @param {{ gpu?: boolean }} [options] gpu: use the real GPU instead of the software renderer */
export async function launch(options = {}) {
    const profile = await mkdtemp(join(tmpdir(), "projection-lab-"));
    const args = [
        "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
        "--mute-audio", "--hide-scrollbars", "--ignore-gpu-blocklist", "--enable-webgl",
        // software WebGL works on machines with no GPU (CI); slower, but the same code paths
        ...(options.gpu ? ["--enable-gpu"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]),
        ...(process.platform === "linux" ? ["--no-sandbox"] : []),
        "about:blank",
    ];
    const child = spawn(findChrome(), args, { stdio: ["ignore", "ignore", "pipe"] });
    const endpoint = await new Promise((done, fail) => {
        let text = "";
        const timer = setTimeout(() => fail(new Error("Chrome did not start within 30 s\n" + text)), 30000);
        child.stderr.on("data", (d) => {
            text += d;
            const m = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
            if (m) { clearTimeout(timer); done(m[1]); }
        });
        child.once("exit", (code) => { clearTimeout(timer); fail(new Error(`Chrome exited (${code})\n${text}`)); });
    });
    const http = "http://" + new URL(endpoint).host;

    return {
        /** Open a page and wait for it to load. */
        async page(url, size = { width: 1280, height: 720 }) {
            const target = await (await fetch(`${http}/json/new?about:blank`, { method: "PUT" })).json();
            const ws = new WebSocket(target.webSocketDebuggerUrl);
            await new Promise((done, fail) => { ws.onopen = done; ws.onerror = () => fail(new Error("DevTools socket failed")); });
            let id = 0;
            const pending = new Map(), logs = [], errors = [];
            let loaded = null;
            ws.onmessage = (event) => {
                const msg = JSON.parse(event.data);
                if (msg.id && pending.has(msg.id)) {
                    const { done, fail } = pending.get(msg.id);
                    pending.delete(msg.id);
                    if (msg.error) fail(new Error(msg.error.message)); else done(msg.result);
                } else if (msg.method === "Runtime.consoleAPICalled") {
                    const line = msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
                    logs.push(`[${msg.params.type}] ${line}`);
                    if (msg.params.type === "error") errors.push(line);
                } else if (msg.method === "Runtime.exceptionThrown") {
                    const d = msg.params.exceptionDetails;
                    errors.push((d.exception && d.exception.description) || d.text);
                } else if (msg.method === "Page.loadEventFired" && loaded) loaded();
            };
            const send = (method, params = {}) => new Promise((done, fail) => { pending.set(++id, { done, fail }); ws.send(JSON.stringify({ id, method, params })); });
            await send("Page.enable");
            await send("Runtime.enable");
            await send("Emulation.setDeviceMetricsOverride", { width: size.width, height: size.height, deviceScaleFactor: size.scale || 1, mobile: !!size.mobile });
            const wait = new Promise((r) => { loaded = r; });
            await send("Page.navigate", { url });
            await Promise.race([wait, sleep(30000)]);

            const page = {
                logs, errors,
                /** Evaluate an expression in the page; promises are awaited and the value comes back as JSON. */
                async evaluate(expression) {
                    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
                    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
                    return r.result.value;
                },
                /** Poll until the expression is truthy. */
                async waitFor(expression, timeout = 60000) {
                    const end = Date.now() + timeout;
                    for (;;) {
                        const v = await page.evaluate(expression);
                        if (v) return v;
                        if (Date.now() > end) throw new Error(`Timed out waiting for: ${expression}`);
                        await sleep(100);
                    }
                },
                /** @returns {Promise<Buffer>} */
                async screenshot(format = "jpeg", quality = 82) {
                    const r = await send("Page.captureScreenshot", { format, quality: format === "jpeg" ? quality : undefined });
                    return Buffer.from(r.data, "base64");
                },
                close() { ws.close(); return fetch(`${http}/json/close/${target.id}`).catch(() => {}); },
            };
            return page;
        },
        async close() {
            child.kill();
            await sleep(300);
            await rm(profile, { recursive: true, force: true }).catch(() => {});
        },
    };
}
