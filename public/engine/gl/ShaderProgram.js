import { ATTRIB_NAMES } from "../config.js";

/**
 * A linked GLSL program with cached uniform locations and typed setters.
 *
 * - Attribute locations are fixed engine-wide (config.ATTRIB) and bound before linking, so any VAO
 *   works with any program.
 * - Uniform locations are read once after linking (never per frame).
 * - `#define`s are injected as a header, so one source can produce variants (INSTANCED, VERTEX_COLORS...).
 * - Compile/link failures throw a ShaderError with the stage, parsed line numbers and the source.
 * @module engine/gl/ShaderProgram
 */

/** @typedef {{ line: number, message: string }} ShaderLogEntry */

/**
 * Parse a driver info log into line/message pairs. Handles the common formats:
 *   "ERROR: 0:12: 'foo' : undeclared identifier"   (ANGLE / most browsers)
 *   "0(12) : error C0000: ..."                       (some desktop drivers)
 * @param {string} log
 * @returns {ShaderLogEntry[]}
 */
export function parseShaderLog(log) {
    const out = [];
    for (const raw of String(log || "").split("\n")) {
        const line = raw.trim();
        if (!line) continue;
        let m = line.match(/^(?:ERROR|WARNING):\s*\d+:(\d+):\s*(.*)$/i);
        if (!m) m = line.match(/^\d+\((\d+)\)\s*:\s*(?:error|warning)[^:]*:\s*(.*)$/i);
        if (m) out.push({ line: Number(m[1]), message: m[2] });
        else out.push({ line: 0, message: line });
    }
    return out;
}

/** Error thrown when a shader fails to compile or link. Carries everything a debug panel needs. */
export class ShaderError extends Error {
    /**
     * @param {"vertex" | "fragment" | "link"} stage
     * @param {string} log raw driver log
     * @param {string} source the full source that was compiled (with injected header)
     * @param {string} [name] program name
     */
    constructor(stage, log, source, name = "program") {
        const entries = parseShaderLog(log);
        const first = entries[0];
        super(`[${name}] ${stage} shader error${first && first.line ? ` at line ${first.line}` : ""}: ${first ? first.message : log}`);
        this.name = "ShaderError";
        this.stage = stage;
        this.log = log;
        this.entries = entries;
        this.source = source;
        this.programName = name;
    }
}

// Setters close over a specific context, so the cache is per context (several canvases may share a page).
/** @type {WeakMap<object, Map<number, Function>>} */
const SETTERS = new WeakMap();
function setterFor(gl, type, size) {
    let cache = SETTERS.get(gl);
    if (!cache) { cache = new Map(); SETTERS.set(gl, cache); }
    const key = type * 1000 + (size > 1 ? 1 : 0);
    if (cache.has(key)) return cache.get(key);
    let fn;
    switch (type) {
        case gl.FLOAT: fn = size > 1 ? (l, v) => gl.uniform1fv(l, v) : (l, v) => gl.uniform1f(l, v); break;
        case gl.FLOAT_VEC2: fn = (l, v) => gl.uniform2fv(l, v); break;
        case gl.FLOAT_VEC3: fn = (l, v) => gl.uniform3fv(l, v); break;
        case gl.FLOAT_VEC4: fn = (l, v) => gl.uniform4fv(l, v); break;
        case gl.FLOAT_MAT3: fn = (l, v) => gl.uniformMatrix3fv(l, false, v); break;
        case gl.FLOAT_MAT4: fn = (l, v) => gl.uniformMatrix4fv(l, false, v); break;
        case gl.INT: case gl.BOOL: case gl.SAMPLER_2D: case gl.SAMPLER_CUBE:
            fn = size > 1 ? (l, v) => gl.uniform1iv(l, v) : (l, v) => gl.uniform1i(l, typeof v === "boolean" ? (v ? 1 : 0) : v); break;
        case gl.INT_VEC2: case gl.BOOL_VEC2: fn = (l, v) => gl.uniform2iv(l, v); break;
        case gl.INT_VEC3: case gl.BOOL_VEC3: fn = (l, v) => gl.uniform3iv(l, v); break;
        case gl.INT_VEC4: case gl.BOOL_VEC4: fn = (l, v) => gl.uniform4iv(l, v); break;
        default: fn = () => { throw new Error(`Unsupported uniform type 0x${type.toString(16)}`); };
    }
    cache.set(key, fn);
    return fn;
}

export class ShaderProgram {
    /**
     * @param {WebGLRenderingContext | WebGL2RenderingContext} gl
     * @param {string} vertexSource GLSL ES 1.00 source (no #version line)
     * @param {string} fragmentSource
     * @param {{ name?: string, defines?: Record<string, string | number | boolean> }} [options]
     */
    constructor(gl, vertexSource, fragmentSource, options = {}) {
        this.gl = gl;
        this.name = options.name || "program";
        this.defines = options.defines || {};
        const header = ShaderProgram.defineHeader(this.defines);
        this.vertexSource = header + vertexSource;
        this.fragmentSource = "precision highp float;\n" + header + fragmentSource;

        const vs = this.compile(gl.VERTEX_SHADER, this.vertexSource, "vertex");
        const fs = this.compile(gl.FRAGMENT_SHADER, this.fragmentSource, "fragment");
        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        // a context with few attribute slots (some WebGL1 devices have 8) simply does without the high ones
        const maxAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
        for (const name in ATTRIB_NAMES) if (ATTRIB_NAMES[name] < maxAttribs) gl.bindAttribLocation(program, ATTRIB_NAMES[name], name);
        gl.linkProgram(program);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const log = gl.getProgramInfoLog(program);
            gl.deleteProgram(program);
            throw new ShaderError("link", log, this.vertexSource + "\n\n" + this.fragmentSource, this.name);
        }
        this.program = program;

        /** @type {Map<string, { location: WebGLUniformLocation, set: Function }>} */
        this.uniforms = new Map();
        const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < count; i++) {
            const info = gl.getActiveUniform(program, i);
            const location = gl.getUniformLocation(program, info.name);
            const base = info.name.replace(/\[0\]$/, "");
            this.uniforms.set(base, { location, set: setterFor(gl, info.type, info.size) });
        }
        /** frame id for which per-frame uniforms (camera, lights) were last set; see Renderer */
        this.frameStamp = -1;
    }

    /** @param {Record<string, string | number | boolean>} defines */
    static defineHeader(defines) {
        let out = "";
        for (const key in defines) {
            const v = defines[key];
            if (v === false || v == null) continue;
            out += v === true ? `#define ${key}\n` : `#define ${key} ${v}\n`;
        }
        return out;
    }

    compile(type, source, stage) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const log = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new ShaderError(stage, log, source, this.name);
        }
        return shader;
    }

    use() { this.gl.useProgram(this.program); return this; }

    /** Does the program use this uniform? (unused uniforms are optimised away by the driver) */
    has(name) { return this.uniforms.has(name); }

    /**
     * Set one uniform. Unknown / optimised-away names are ignored, so materials can set
     * everything they own without knowing which variant is bound.
     * @param {string} name
     * @param {number | boolean | ArrayLike<number>} value
     */
    set(name, value) {
        const u = this.uniforms.get(name);
        if (u) u.set(u.location, value);
        return this;
    }

    /** @param {Record<string, any>} values */
    setAll(values) {
        for (const k in values) this.set(k, values[k]);
        return this;
    }

    dispose() { this.gl.deleteProgram(this.program); this.uniforms.clear(); }
}
