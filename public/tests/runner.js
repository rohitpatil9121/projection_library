/**
 * Tiny in-browser test runner (no build step, no dependencies).
 *   test("name", () => { assert(cond, msg); near(a, b, eps); });
 * @module tests/runner
 */
const tests = [];

/** @param {string} name @param {() => void | Promise<void>} fn */
export function test(name, fn) { tests.push({ name, fn }); }

export function assert(cond, message = "assertion failed") { if (!cond) throw new Error(message); }

export function near(a, b, eps = 1e-6, message = "") {
    if (!(Math.abs(a - b) <= eps)) throw new Error(`${message} expected ${b}, got ${a} (±${eps})`);
}

export function nearVec(a, b, eps = 1e-6, message = "") {
    for (let i = 0; i < b.length; i++) near(a[i], b[i], eps, `${message}[${i}]`);
}

export function throws(fn, check, message = "expected an error") {
    try { fn(); } catch (e) { if (check) check(e); return; }
    throw new Error(message);
}

/** Run everything registered so far and render results into `el`. */
export async function run(el) {
    let pass = 0, fail = 0;
    const rows = [];
    for (const t of tests) {
        const t0 = performance.now();
        try { await t.fn(); pass++; rows.push({ ok: true, name: t.name, ms: performance.now() - t0 }); }
        catch (e) { fail++; rows.push({ ok: false, name: t.name, ms: performance.now() - t0, error: e }); console.error(t.name, e); }
    }
    el.innerHTML = `<h2 class="${fail ? "bad" : "good"}">${pass} passed · ${fail} failed</h2>` + rows.map((r) =>
        `<div class="row ${r.ok ? "ok" : "ko"}"><span>${r.ok ? "✓" : "✗"}</span><span>${escape(r.name)}</span><span class="ms">${r.ms.toFixed(1)} ms</span>` +
        (r.ok ? "" : `<pre>${escape(r.error && (r.error.stack || r.error.message) || String(r.error))}</pre>`) + `</div>`).join("");
    const result = { pass, fail, total: tests.length, failures: rows.filter((r) => !r.ok).map((r) => `${r.name}: ${r.error && r.error.message}`) };
    window.__testResult = result;
    return result;
}

function escape(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]); }
