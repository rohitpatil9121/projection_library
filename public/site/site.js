/**
 * Behaviour shared by the site's pages: content that rises in as it is first seen, code colouring,
 * and copy buttons on code blocks. No dependencies.
 * @module site/site
 */
document.documentElement.classList.add("js");

// reveal: observe once, then let go
const seen = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); seen.unobserve(e.target); }
}, { rootMargin: "0px 0px -8% 0px" });
for (const el of document.querySelectorAll(".reveal")) seen.observe(el);

const KEYWORDS = "import|from|export|const|let|new|function|return|if|else|for|of|await|async|class|extends|uniform|attribute|varying|void|vec2|vec3|vec4|mat4|float";
const TOKEN = new RegExp(`(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)|("(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)|\\b(${KEYWORDS})\\b`, "g");
const escape = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

/** Colour comments, strings and keywords in a snippet of JavaScript or GLSL. Returns HTML. */
export function highlight(source) {
    let out = "", last = 0;
    for (const m of source.matchAll(TOKEN)) {
        out += escape(source.slice(last, m.index));
        out += `<span class="tok-${m[1] ? "c" : m[2] ? "s" : "k"}">${escape(m[0])}</span>`;
        last = m.index + m[0].length;
    }
    return out + escape(source.slice(last));
}

for (const code of document.querySelectorAll("pre code[data-lang]")) code.innerHTML = highlight(code.textContent);

for (const button of document.querySelectorAll("[data-copy]")) {
    button.addEventListener("click", async () => {
        const code = button.closest(".code").querySelector("pre code");
        try { await navigator.clipboard.writeText(code.textContent); button.textContent = "Copied"; }
        catch { button.textContent = "Select and copy"; }
        setTimeout(() => { button.textContent = "Copy"; }, 1600);
    });
}
