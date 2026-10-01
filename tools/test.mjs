/**
 * Run the browser test page (public/tests/) in headless Chrome and report in the terminal.
 * Exit code 1 if any test fails, so CI can stop a deploy.
 *
 *   npm test
 *   node tools/test.mjs --gpu      # use the real GPU instead of the software renderer
 */
import { serve } from "./serve.mjs";
import { launch } from "./chrome.mjs";

const server = await serve({ port: 0 });
const browser = await launch({ gpu: process.argv.includes("--gpu") });
let code = 1;
try {
    const page = await browser.page(`${server.url}/tests/`, { width: 900, height: 700 });
    const result = await page.waitFor("window.__testResult", 180000);
    for (const line of result.rows) console.log(line);
    console.log(`\n${result.pass} passed, ${result.fail} failed (${result.total} tests)`);
    for (const f of result.failures) console.error("FAILED  " + f);
    if (page.errors.length && result.fail) console.error("\nconsole errors:\n" + page.errors.join("\n"));
    code = result.fail ? 1 : 0;
} catch (e) {
    console.error(e.message);
} finally {
    await browser.close();
    await server.close();
}
process.exit(code);
