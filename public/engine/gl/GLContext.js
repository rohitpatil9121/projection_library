/**
 * WebGL context creation: WebGL2 first, WebGL1 as a fallback.
 *
 * The engine writes its shaders in GLSL ES 1.00, which both WebGL1 and WebGL2 accept, and calls the
 * WebGL2 names for vertex array objects and instancing. On WebGL1 those names are patched onto the context
 * from the OES_vertex_array_object and ANGLE_instanced_arrays extensions, so the rest of the engine never
 * branches on the version.
 * @module engine/gl/GLContext
 */

/**
 * @typedef {Object} GLCaps
 * @property {boolean} webgl2
 * @property {boolean} instancing
 * @property {boolean} vao
 * @property {boolean} uint32Indices
 * @property {number} maxTextureSize
 */

/**
 * @typedef {Object} GLContextResult
 * @property {WebGL2RenderingContext | WebGLRenderingContext} gl
 * @property {GLCaps} caps
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ preferWebGL2?: boolean, antialias?: boolean, alpha?: boolean, preserveDrawingBuffer?: boolean }} [options]
 * @returns {GLContextResult | null} null when WebGL is not available at all
 */
export function createContext(canvas, options = {}) {
    const attrs = {
        antialias: options.antialias ?? true,
        alpha: options.alpha ?? false,
        depth: true,
        stencil: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
        powerPreference: "high-performance",
    };
    let gl = null;
    if (options.preferWebGL2 !== false) gl = canvas.getContext("webgl2", attrs);
    const webgl2 = !!gl;
    if (!gl) gl = canvas.getContext("webgl", attrs) || canvas.getContext("experimental-webgl", attrs);
    if (!gl) return null;

    const caps = { webgl2, instancing: true, vao: true, uint32Indices: true, maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
    if (!webgl2) patchWebGL1(gl, caps);
    return { gl, caps };
}

/** Give a WebGL1 context the WebGL2 method names the engine uses. */
function patchWebGL1(gl, caps) {
    const vao = gl.getExtension("OES_vertex_array_object");
    if (vao) {
        gl.createVertexArray = () => vao.createVertexArrayOES();
        gl.bindVertexArray = (v) => vao.bindVertexArrayOES(v);
        gl.deleteVertexArray = (v) => vao.deleteVertexArrayOES(v);
    } else {
        caps.vao = false;
    }
    const inst = gl.getExtension("ANGLE_instanced_arrays");
    if (inst) {
        gl.drawArraysInstanced = (m, f, c, n) => inst.drawArraysInstancedANGLE(m, f, c, n);
        gl.drawElementsInstanced = (m, c, t, o, n) => inst.drawElementsInstancedANGLE(m, c, t, o, n);
        gl.vertexAttribDivisor = (i, d) => inst.vertexAttribDivisorANGLE(i, d);
    } else {
        caps.instancing = false;
    }
    caps.uint32Indices = !!gl.getExtension("OES_element_index_uint");
}

/**
 * Replace (or fill) a container with a readable "WebGL unavailable" panel. Never leaves a blank screen.
 * @param {HTMLElement} container
 * @param {string} [detail]
 */
export function showWebGLFailure(container, detail = "") {
    const box = document.createElement("div");
    box.setAttribute("role", "alert");
    box.style.cssText = "position:absolute;inset:0;display:grid;place-items:center;padding:24px;background:#05050A;color:#E6E8F2;font:16px/1.5 system-ui,sans-serif;text-align:center;z-index:10";
    box.innerHTML = `<div style="max-width:460px">
        <div style="font-size:13px;letter-spacing:.2em;color:#9B8CFF;margin-bottom:8px">PROJECTION LAB</div>
        <h2 style="margin:0 0 8px;font-size:20px">WebGL isn't available</h2>
        <p style="margin:0;color:#A9AEC4">This page needs WebGL to draw 3D graphics. Try an up-to-date browser,
        enable hardware acceleration, or open the page on another device.</p>
        ${detail ? `<p style="margin-top:12px;color:#7C829C;font-size:13px">${detail.replace(/[<>&]/g, "")}</p>` : ""}
    </div>`;
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    container.appendChild(box);
    return box;
}
