import Space from "../Space.js";

// ---------------------------------------------------------------------------
// RunnerSpace: Space with game shaders.
//
// Everything camera-related is Space's own: the orbit camera (X0/Y0/Z0, Rc, alpha, beta),
// getX/Y/ZaxisUnitVector, the dot-product projection and the incremental vertex upload in
// reDraw(). This subclass only swaps in richer shaders and adds:
//   - a second, per-frame "dynamic" vertex stream (ship, pickups, particles)
//   - an offscreen pass + post-processing (bloom, chromatic aberration, vignette, scanlines)
//
// Vertex format is unchanged: pos = vec4, col = vec4. col.a is used as a material code:
//   0..1  glow amount (0 = lit surface, 1 = full neon)
//   -1    procedural neon floor grid
//   -2    synthwave sun (procedural bands, never fogged)
// ---------------------------------------------------------------------------

const VERT = `
attribute vec4 pos;
attribute vec4 col;
uniform vec3 cPoint;
uniform vec3 xAxis;
uniform vec3 yAxis;
uniform vec3 zAxis;
uniform vec3 veriables;          // aspect, magnifier, far (same as Space.js)
varying vec4 vcol;
varying vec3 vWorld;
varying float vDepth;
void main(){
    vcol = col;
    vWorld = pos.xyz;
    vec3 v = pos.xyz - cPoint;
    float xProj = dot(v, xAxis);
    float yProj = dot(v, yAxis);
    float zProj = dot(v, zAxis);
    float focal = veriables.y * 1.25;
    float n = 0.5;
    float f = veriables.z;
    gl_Position = vec4(-xProj * focal / veriables.x, yProj * focal,
                       zProj * (f + n) / (f - n) - 2.0 * f * n / (f - n), zProj);
    vDepth = zProj;
}`;

const FRAG = `
precision highp float;
varying vec4 vcol;
varying vec3 vWorld;
varying float vDepth;
uniform float uTime;
uniform float uScroll;           // world-origin offset along the track (keeps the grid continuous)
uniform vec3 uFog;
uniform vec2 uFogRange;
uniform vec4 uSun;               // x, z, radius, unused
uniform vec3 uGridColor;
uniform vec3 uSunA;              // sun colour at the bottom
uniform vec3 uSunB;              // sun colour at the top

float gridLine(float coord, float spacing, float width) {
    float d = abs(fract(coord / spacing + 0.5) - 0.5) * spacing;
    return 1.0 - smoothstep(0.0, width, d);
}

void main(){
    vec3 c = vcol.rgb;
    float glow = vcol.a;

    if (glow < -1.5) {
        // synthwave sun: gold -> magenta gradient with scrolling horizontal cut bands
        vec2 d = vec2(vWorld.x - uSun.x, vWorld.z - uSun.y) / uSun.z;
        if (dot(d, d) > 1.0) discard;
        float t = d.y * 0.5 + 0.5;
        if (t < 0.55) {
            float band = fract(t * 9.0 - uTime * 0.35);
            if (band < (0.55 - t) * 1.1) discard;
        }
        c = mix(uSunA, uSunB, t);
        gl_FragColor = vec4(c, 0.9);
        return;
    }

    if (glow < -0.5) {
        // neon floor: lane lines on the track, cross lines scrolling with the world
        float y = vWorld.y + uScroll;
        float onTrack = 1.0 - smoothstep(5.0, 5.4, abs(vWorld.x));
        float lanes = gridLine(vWorld.x + 1.5, 3.0, 0.06) * onTrack;
        float cross = gridLine(y, 4.0, 0.05);
        float outer = (gridLine(vWorld.x, 6.0, 0.08) + gridLine(y, 6.0, 0.08)) * (1.0 - onTrack) * 0.6;
        float line = clamp(lanes + cross * (0.45 + 0.55 * onTrack) + outer, 0.0, 1.0);
        c = mix(vec3(0.03, 0.02, 0.07), uGridColor, line);
        c += vec3(0.04, 0.0, 0.08) * onTrack;
        glow = line * 0.9;
    }

    float f = smoothstep(uFogRange.x, uFogRange.y, vDepth);
    c = mix(c, uFog, f);
    gl_FragColor = vec4(c, clamp(glow, 0.0, 1.0) * (1.0 - f));
}`;

const POST_VERT = `
attribute vec2 p;
varying vec2 vUv;
void main(){ vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const POST_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uTime;
uniform float uAberr;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform float uSpeed;
uniform vec4 uTint;              // rgb + amount: power-up screen tint

float rand(vec2 c){ return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }

void main(){
    vec2 uv = vUv;
    vec2 d = uv - 0.5;
    float ab = 0.002 + uAberr * 0.025 + uSpeed * 0.004;
    vec3 col = vec3(texture2D(uTex, uv + d * ab).r, texture2D(uTex, uv).g, texture2D(uTex, uv - d * ab).b);

    // bloom: golden-spiral taps, weighted by the glow stored in alpha
    vec3 bloom = vec3(0.0);
    for (int i = 0; i < 24; i++) {
        float a = float(i) * 2.39996;
        float r = sqrt((float(i) + 0.5) / 24.0);
        vec4 s = texture2D(uTex, uv + vec2(cos(a), sin(a)) * r * 30.0 / uRes);
        bloom += s.rgb * s.a;
    }
    col += bloom / 24.0 * 2.4;

    // speed streaks toward the edges
    float edge = smoothstep(0.2, 0.7, length(d));
    vec4 smear = texture2D(uTex, uv - d * 0.04 * uSpeed);
    col = mix(col, col + smear.rgb * smear.a * 0.6, edge * uSpeed);

    col *= 1.0 - dot(d, d) * 1.05;                       // vignette
    col *= 0.95 + 0.05 * sin(uv.y * uRes.y * 1.6);        // scanlines
    col = mix(col, col * uTint.rgb * 1.15, uTint.a);       // power-up grading
    col = mix(col, uFlashColor, uFlash * 0.45);           // hit / pickup flash
    col += (rand(uv + fract(uTime)) - 0.5) * 0.035;       // film grain
    col = col / (1.0 + col * 0.12);                       // soft tone map
    gl_FragColor = vec4(col, 1.0);
}`;

function link(gl, vs, fs) {
    const mk = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
}

export default class RunnerSpace extends Space {
    constructor(gl) {
        super(gl);
        this.clearScene();
        this.far = 460;
        this.magnifier = 1.1;

        // swap Space's program for the game program; Space.reDraw() uses these fields
        const prog = this.program = link(gl, VERT, FRAG);
        gl.useProgram(prog);
        this.posId = gl.getAttribLocation(prog, "pos");
        this.colId = gl.getAttribLocation(prog, "col");
        gl.enableVertexAttribArray(this.posId);
        gl.enableVertexAttribArray(this.colId);
        this.cPointLoc = gl.getUniformLocation(prog, "cPoint");
        this.vPointLoc = null;
        this.xAxisLoc = gl.getUniformLocation(prog, "xAxis");
        this.yAxisLoc = gl.getUniformLocation(prog, "yAxis");
        this.zAxisLoc = gl.getUniformLocation(prog, "zAxis");
        this.varsLocation = gl.getUniformLocation(prog, "veriables");
        this.u = {};
        for (const n of ["uTime", "uScroll", "uFog", "uFogRange", "uSun", "uGridColor", "uSunA", "uSunB"]) this.u[n] = gl.getUniformLocation(prog, n);

        this.post = link(gl, POST_VERT, POST_FRAG);
        this.pu = { p: gl.getAttribLocation(this.post, "p") };
        for (const n of ["uTex", "uRes", "uTime", "uAberr", "uFlash", "uFlashColor", "uSpeed", "uTint"]) this.pu[n] = gl.getUniformLocation(this.post, n);
        this.quad = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

        this.dynPosBuf = gl.createBuffer();
        this.dynColBuf = gl.createBuffer();

        this.fog = [0.07, 0.02, 0.13];
        this.fogRange = [60, 300];
        this.gridColor = [0.2, 0.9, 1.0];
        this.sun = [0, 60, 110, 0];
        this.sunA = [1, 0.15, 0.55];
        this.sunB = [1, 0.85, 0.3];
        this.tint = [1, 1, 1, 0];
        this.scroll = 0;
        this.time = 0;
        this.fx = { aberr: 0, flash: 0, flashColor: [1, 0.2, 0.35], speed: 0 };
        this.fbo = null;
    }

    resizeTargets() {
        const gl = this.gl, w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
        if (this.fbo && this.fboW === w && this.fboH === h) return;
        if (this.fbo) { gl.deleteFramebuffer(this.fbo); gl.deleteTexture(this.fboTex); gl.deleteRenderbuffer(this.fboDepth); }
        this.fboW = w; this.fboH = h;
        this.fboTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        this.fboDepth = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.fboDepth);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
        this.fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.fboDepth);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // draw the static world (Space.reDraw) + a dynamic stream, then post-process to the screen
    // world point -> CSS pixels (same maths as the vertex shader); null when behind the camera
    project(x, y, z) {
        const v = [x - this.Xc, y - this.Yc, z - this.Zc], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        const d = dot(v, this.zUnitVec);
        if (d < 0.5) return null;
        const c = this.gl.canvas, focal = this.magnifier * 1.25, aspect = c.clientWidth / Math.max(1, c.clientHeight);
        const nx = -dot(v, this.xUnitVec) * focal / aspect / d, ny = dot(v, this.yUnitVec) * focal / d;
        return { x: (nx + 1) / 2 * c.clientWidth, y: (1 - ny) / 2 * c.clientHeight };
    }

    render(dynPos, dynCol) {
        const gl = this.gl;
        this.resizeTargets();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        gl.enable(gl.DEPTH_TEST);
        gl.clearColor(this.fog[0], this.fog[1], this.fog[2], 0);

        gl.useProgram(this.program);
        gl.enableVertexAttribArray(this.posId);
        gl.enableVertexAttribArray(this.colId);
        gl.uniform1f(this.u.uTime, this.time);
        gl.uniform1f(this.u.uScroll, this.scroll);
        gl.uniform3fv(this.u.uFog, this.fog);
        gl.uniform2fv(this.u.uFogRange, this.fogRange);
        gl.uniform4fv(this.u.uSun, this.sun);
        gl.uniform3fv(this.u.uGridColor, this.gridColor);
        gl.uniform3fv(this.u.uSunA, this.sunA);
        gl.uniform3fv(this.u.uSunB, this.sunB);

        this.reDraw(); // Space: camera basis, uniforms, incremental upload, static world

        if (dynPos.length) {
            gl.bindBuffer(gl.ARRAY_BUFFER, this.dynPosBuf);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(dynPos), gl.DYNAMIC_DRAW);
            gl.vertexAttribPointer(this.posId, 4, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.dynColBuf);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(dynCol), gl.DYNAMIC_DRAW);
            gl.vertexAttribPointer(this.colId, 4, gl.FLOAT, false, 0, 0);
            gl.drawArrays(gl.TRIANGLES, 0, dynPos.length / 4);
        }

        // post pass
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.disable(gl.DEPTH_TEST);
        gl.disableVertexAttribArray(this.colId);
        gl.useProgram(this.post);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
        gl.enableVertexAttribArray(this.pu.p);
        gl.vertexAttribPointer(this.pu.p, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
        gl.uniform1i(this.pu.uTex, 0);
        gl.uniform2f(this.pu.uRes, this.fboW, this.fboH);
        gl.uniform1f(this.pu.uTime, this.time);
        gl.uniform1f(this.pu.uAberr, this.fx.aberr);
        gl.uniform1f(this.pu.uFlash, this.fx.flash);
        gl.uniform3fv(this.pu.uFlashColor, this.fx.flashColor);
        gl.uniform1f(this.pu.uSpeed, this.fx.speed);
        gl.uniform4fv(this.pu.uTint, this.tint);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.enable(gl.DEPTH_TEST);
    }
}
