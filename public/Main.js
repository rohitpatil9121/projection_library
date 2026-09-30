import Space from "./Space.js";
import Structure from "./Shapes/Structure.js";

// ---------------------------------------------------------------------------
// Prime Walk 3D
// A walker takes one step (2 units) per integer. Every time the integer is
// prime it turns to the next direction in DIRS. Each step leaves a cube.
// ---------------------------------------------------------------------------

const canv = document.getElementById("myBoard");
/** @type {WebGLRenderingContext} */
const gl = canv.getContext("webgl", { antialias: true });
const space = new Space(gl);
space.clearScene();
space.alpha = Math.PI * 0.75;
space.beta = 0.55;
gl.clearColor(0.02, 0.02, 0.04, 1);

// Unit cube (half-size 1) built face by face: [normal axis, sign]; 2 triangles per face
const FACES = [[0, -1], [0, 1], [1, -1], [1, 1], [2, -1], [2, 1]];
const CUBE = [];
for (const [axis, sign] of FACES) {
    const u = (axis + 1) % 3, v = (axis + 2) % 3;
    const corner = (a, b) => { const p = [0, 0, 0, 1]; p[axis] = sign; p[u] = a; p[v] = b; return p; };
    CUBE.push(...corner(-1, -1), ...corner(1, -1), ...corner(1, 1));
    CUBE.push(...corner(-1, -1), ...corner(1, 1), ...corner(-1, 1));
}

// Baked lighting: one brightness per face from a fixed light direction
const LIGHT = normalize([0.45, -0.35, 0.82]);
const FACE_LIGHT = FACES.map(([axis, sign]) => 0.38 + 0.62 * Math.max(0, sign * LIGHT[axis]));

function normalize(v) { const m = Math.hypot(...v); return v.map((x) => x / m); }

function hsl(h, s, l) {
    const a = s * Math.min(l, 1 - l);
    const f = (n) => { const k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return [f(0), f(8), f(4)];
}

// y+, z+, x+, y-, z-, x-  (same turn order as the original walk)
const DIRS = [[0, 1, 0], [0, 0, 1], [1, 0, 0], [0, -1, 0], [0, 0, -1], [-1, 0, 0]];
const STEP = 2;

function isPrime(n) {
    if (n < 2) return false;
    if (n % 2 === 0) return n === 2;
    for (let i = 3; i * i <= n; i += 2) if (n % i === 0) return false;
    return true;
}

// ---------------------------------------------------------------- walk state
const walk = {};
function resetWalk() {
    walk.n = 1;             // next integer to visit
    walk.dir = 0;
    walk.pos = [0, 0, 0];
    walk.primes = 0;
    walk.min = [0, 0, 0];
    walk.max = [0, 0, 0];
    space.clearScene();
}

function addCube(center, rgb, size) {
    const pos = new Array(CUBE.length), col = new Array(CUBE.length);
    for (let i = 0; i < CUBE.length; i += 4) {
        pos[i] = CUBE[i] * size + center[0];
        pos[i + 1] = CUBE[i + 1] * size + center[1];
        pos[i + 2] = CUBE[i + 2] * size + center[2];
        pos[i + 3] = 1;
        const shade = FACE_LIGHT[Math.floor(i / 24)]; // 6 vertices * 4 floats per face
        col[i] = rgb[0] * shade;
        col[i + 1] = rgb[1] * shade;
        col[i + 2] = rgb[2] * shade;
        col[i + 3] = 1;
    }
    space.addStructure(new Structure(pos, col));
}

function step() {
    const n = walk.n++;
    const prime = isPrime(n);
    if (prime) { walk.dir = (walk.dir + 1) % DIRS.length; walk.primes++; }
    const d = DIRS[walk.dir];
    for (let k = 0; k < 3; k++) {
        walk.pos[k] += d[k] * STEP;
        walk.min[k] = Math.min(walk.min[k], walk.pos[k]);
        walk.max[k] = Math.max(walk.max[k], walk.pos[k]);
    }
    // primes: bright gold turning points; others: slow rainbow along the walk
    const rgb = prime ? [1, 0.82, 0.3] : hsl((n * 0.0015 + 0.55) % 1, 0.75, 0.55);
    addCube(walk.pos, rgb, prime ? 1.0 : 0.92);
}
function addSteps(count) { for (let i = 0; i < count; i++) step(); }

// ---------------------------------------------------------------- camera
// Space's camera: view point (X0, Y0, Z0), distance Rc, yaw alpha, pitch beta.
const view = { target: [0, 0, 0], Rc: 60, vAlpha: 0, vBeta: 0, autoFrame: true };

function frameTarget() {
    const c = [0, 1, 2].map((k) => (walk.min[k] + walk.max[k]) / 2);
    const r = Math.hypot(...[0, 1, 2].map((k) => walk.max[k] - walk.min[k])) / 2 + 4;
    // fit the bounding sphere in the smaller screen dimension
    const focal = space.magnifier * 1.25, aspect = canv.width / Math.max(1, canv.height);
    return { c, Rc: Math.max(12, (r * focal) / Math.min(1, aspect) * 1.15) };
}

function updateCamera(dt) {
    if (!drag) { // orbit inertia after a fling
        space.alpha += view.vAlpha * dt;
        space.beta += view.vBeta * dt;
        const decay = Math.exp(-dt * 3);
        view.vAlpha *= decay; view.vBeta *= decay;
    }
    space.beta = Math.max(-1.5, Math.min(1.5, space.beta));
    if (view.autoFrame) { const f = frameTarget(); view.target = f.c; view.Rc = f.Rc; }
    const k = 1 - Math.exp(-dt * 5);
    space.X0 += (view.target[0] - space.X0) * k;
    space.Y0 += (view.target[1] - space.Y0) * k;
    space.Z0 += (view.target[2] - space.Z0) * k;
    space.Rc += (view.Rc - space.Rc) * k;
    space.Xc = space.X0 + Math.cos(space.beta) * Math.cos(space.alpha) * space.Rc;
    space.Yc = space.Y0 + Math.cos(space.beta) * Math.sin(space.alpha) * space.Rc;
    space.Zc = space.Z0 + Math.sin(space.beta) * space.Rc;
}

function zoom(factor) {
    view.autoFrame = false;
    view.Rc = Math.max(4, Math.min(1800, view.Rc * factor));
}

// ---------------------------------------------------------------- pointer input
let drag = null;
const pointers = new Map();
canv.addEventListener("contextmenu", (e) => e.preventDefault());
canv.addEventListener("pointerdown", (e) => {
    canv.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    drag = { pan: e.button === 2 || e.shiftKey, t: performance.now() };
    view.vAlpha = view.vBeta = 0;
});
canv.addEventListener("pointermove", (e) => {
    const p = pointers.get(e.pointerId);
    if (!p || !drag) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (pointers.size === 2) { // pinch zoom
        const [a, b] = [...pointers.values()];
        const before = Math.hypot(a.x - b.x, a.y - b.y);
        p.x = e.clientX; p.y = e.clientY;
        const after = Math.hypot(a.x - b.x, a.y - b.y);
        if (before > 0 && after > 0) zoom(before / after);
        return;
    }
    p.x = e.clientX; p.y = e.clientY;
    if (drag.pan) {
        // screen-right is -xAxis (see Space.js), screen-down is -yAxis; content follows the cursor
        view.autoFrame = false;
        const focal = space.magnifier * 1.25;
        const k = 2 * space.Rc / focal / canv.clientHeight;
        const xa = space.xUnitVec, ya = space.yUnitVec;
        for (let i = 0; i < 3; i++) view.target[i] += (dx * xa[i] + dy * ya[i]) * k;
    } else {
        const now = performance.now(), dt = Math.max(1, now - drag.t) / 1000;
        drag.t = now;
        space.alpha -= dx / 250;
        space.beta += dy / 250;
        view.vAlpha = (-dx / 250) / dt;
        view.vBeta = (dy / 250) / dt;
    }
});
const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
        // keep the fling only if the pointer was still moving when released
        if (drag && performance.now() - drag.t > 80) view.vAlpha = view.vBeta = 0;
        drag = null;
    }
};
canv.addEventListener("pointerup", endPointer);
canv.addEventListener("pointercancel", endPointer);
canv.addEventListener("wheel", (e) => { e.preventDefault(); zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });

// ---------------------------------------------------------------- keyboard + buttons
let autoGrow = false;
const growBtn = document.getElementById("growBtn");
function setAutoGrow(on) { autoGrow = on; growBtn.textContent = on ? "❚❚ Pause" : "▶ Grow"; }
function reset() { resetWalk(); view.autoFrame = true; }

document.addEventListener("keydown", (e) => {
    const nudge = 0.06;
    const shift = (vec, amt) => { view.autoFrame = false; for (let i = 0; i < 3; i++) view.target[i] += vec[i] * amt; };
    switch (e.code) {
        case "Space": case "Enter": e.preventDefault(); addSteps(e.shiftKey ? 50 : 1); break;
        case "KeyG": setAutoGrow(!autoGrow); break;
        case "KeyF": view.autoFrame = true; break;
        case "KeyR": reset(); break;
        // original keyboard camera controls
        case "KeyA": space.alpha += nudge; break;
        case "KeyD": space.alpha -= nudge; break;
        case "KeyS": space.beta += nudge; break;
        case "KeyW": space.beta -= nudge; break;
        case "KeyJ": shift(space.xUnitVec, STEP); break;    // left
        case "KeyL": shift(space.xUnitVec, -STEP); break;   // right
        case "KeyO": shift(space.yUnitVec, STEP); break;    // up
        case "KeyM": shift(space.yUnitVec, -STEP); break;   // down
        case "KeyI": shift(space.zUnitVec, STEP); break;    // forward
        case "KeyK": shift(space.zUnitVec, -STEP); break;   // back
        case "KeyV": zoom(1.1); break;
        case "KeyC": zoom(1 / 1.1); break;
    }
});
growBtn.addEventListener("click", () => setAutoGrow(!autoGrow));
document.getElementById("frameBtn").addEventListener("click", () => { view.autoFrame = true; });
document.getElementById("resetBtn").addEventListener("click", reset);

// ---------------------------------------------------------------- loop
function fitCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canv.width = Math.round(canv.clientWidth * dpr);
    canv.height = Math.round(canv.clientHeight * dpr);
}
window.addEventListener("resize", fitCanvas);

const info = document.getElementById("info");
let last = performance.now();
function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (autoGrow) addSteps(Math.max(1, Math.round(4 + walk.n / 400)));
    updateCamera(dt);
    space.reDraw();
    info.textContent = `n = ${walk.n - 1}  ·  prime turns = ${walk.primes}`;
    requestAnimationFrame(frame);
}

fitCanvas();
resetWalk();
addSteps(400);
space.Rc = 80;
requestAnimationFrame(frame);

// handy for experimenting from the console
window.space = space;
window.addSteps = addSteps;
