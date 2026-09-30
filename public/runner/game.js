import RunnerSpace from "./RunnerSpace.js";

// ===========================================================================
// NEON RUSH: a synthwave runner built on projection_library's Space.
// World is Z-up (Space convention). The track runs along +Y, lanes along X.
// UI animation uses GSAP when it is available (the game works without it).
// ===========================================================================

const Gs = window.gsap || null;
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

const LANES = [-3, 0, 3];
const CHUNK = 48;
const AHEAD = 7;
const GRAVITY = -32, JUMP_V = 10.5, AIR_JUMP_V = 9.2;

// ---------------------------------------------------------------- themes, levels, power-ups
const THEMES = [
    { name: "Neon Boulevard", fog: [0.07, 0.02, 0.13], grid: [0.2, 0.9, 1.0], sunA: [1, 0.15, 0.55], sunB: [1, 0.85, 0.3], hue: 0.9, rail: 0.52, css: "#ff3fa4,#3fe8ff" },
    { name: "Laser Alley", fog: [0.09, 0.02, 0.05], grid: [1.0, 0.25, 0.35], sunA: [0.9, 0.05, 0.2], sunB: [1, 0.6, 0.25], hue: 0.98, rail: 0.0, css: "#ff2a4a,#ffb347" },
    { name: "Traffic Grid", fog: [0.02, 0.07, 0.07], grid: [0.3, 1.0, 0.6], sunA: [0.05, 0.7, 0.5], sunB: [0.9, 1, 0.4], hue: 0.38, rail: 0.45, css: "#2dffb0,#e8ff5a" },
    { name: "Pulse Canyon", fog: [0.09, 0.04, 0.02], grid: [1.0, 0.6, 0.15], sunA: [1, 0.25, 0.1], sunB: [1, 0.9, 0.5], hue: 0.07, rail: 0.1, css: "#ff7a1a,#ffe27a" },
    { name: "Overdrive", fog: [0.05, 0.02, 0.1], grid: [0.7, 0.45, 1.0], sunA: [0.55, 0.15, 1], sunB: [0.3, 0.95, 1], hue: 0.76, rail: 0.8, css: "#9b6bff,#3fe8ff" },
];

const POWERS = {
    shield: { name: "Shield", icon: "🛡️", color: [0.3, 0.8, 1], css: "#3fe8ff", dur: 0, desc: "Absorbs one crash" },
    magnet: { name: "Magnet", icon: "🧲", color: [1, 0.3, 0.45], css: "#ff4f73", dur: 8, desc: "Pulls in nearby orbs" },
    double: { name: "Double", icon: "✖2", color: [0.4, 1, 0.5], css: "#5dff7a", dur: 10, desc: "Double score" },
    slowmo: { name: "Slow-mo", icon: "⏳", color: [0.65, 0.45, 1], css: "#a57bff", dur: 5, desc: "Slows time" },
    boost: { name: "Boost", icon: "🚀", color: [1, 0.6, 0.15], css: "#ffa51a", dur: 4, desc: "Speed + smash through walls" },
};

const LEVELS = [
    { name: "Neon Boulevard", tag: "Learn the lanes", theme: 0, goal: 1200, start: 18, max: 32, hazards: { low: false, laser: false, mover: false }, powers: ["shield", "magnet"], stars: [30, 60], intro: "Dodge the walls · swipe or A / D" },
    { name: "Laser Alley", tag: "Jump the lit beams", theme: 1, goal: 1700, start: 20, max: 38, hazards: { low: true, laser: true, mover: false }, powers: ["shield", "magnet", "double"], stars: [45, 85], intro: "Laser gates: jump when they're lit" },
    { name: "Traffic Grid", tag: "Blocks on the move", theme: 2, goal: 2200, start: 22, max: 44, hazards: { low: true, laser: false, mover: true }, powers: ["shield", "magnet", "double", "slowmo"], stars: [55, 100], intro: "Sliding blocks: read their rhythm" },
    { name: "Pulse Canyon", tag: "Everything, faster", theme: 3, goal: 2800, start: 24, max: 52, hazards: { low: true, laser: true, mover: true }, powers: ["shield", "magnet", "double", "slowmo", "boost"], stars: [70, 125], intro: "All hazards · grab a Boost to smash through" },
    { name: "Overdrive", tag: "Top speed finale", theme: 4, goal: 3600, start: 28, max: 62, hazards: { low: true, laser: true, mover: true }, powers: ["shield", "magnet", "double", "slowmo", "boost"], stars: [90, 160], intro: "Final sector · hold on" },
];
const ENDLESS = { name: "Endless", tag: "How far can you go?", theme: 0, goal: Infinity, start: 20, max: 64, powers: Object.keys(POWERS), endless: true };

// ---------------------------------------------------------------- save data + settings
const SAVE_KEY = "neonRushSave2";
const save = (() => {
    const base = { unlocked: 1, stars: {}, best: {}, endless: 0, settings: { volume: 0.8, fx: "full", shake: true } };
    try {
        const s = JSON.parse(localStorage.getItem(SAVE_KEY) || "{}");
        const merged = Object.assign(base, s, { settings: Object.assign(base.settings, s.settings || {}) });
        const old = +localStorage.getItem("neonRushBest") || 0; // v1 best score
        if (old > merged.endless) merged.endless = old;
        return merged;
    } catch (e) { return base; }
})();
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* storage unavailable */ } }

// ---------------------------------------------------------------- renderer
const canvas = $("view");
const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
if (!gl) { $("nogl").classList.remove("hidden"); throw new Error("WebGL unavailable"); }
const space = new RunnerSpace(gl);

// ---------------------------------------------------------------- geometry helpers (Space vec4 format)
const FACES = [[0, -1], [0, 1], [1, -1], [1, 1], [2, -1], [2, 1]];
const LIGHT = (() => { const v = [0.35, -0.55, 0.76], m = Math.hypot(...v); return v.map((x) => x / m); })();
function box(P, C, cx, cy, cz, sx, sy, sz, rgb, glow = 0, yaw = 0) {
    const cs = Math.cos(yaw), sn = Math.sin(yaw), h = [sx / 2, sy / 2, sz / 2];
    for (const [axis, sign] of FACES) {
        const u = (axis + 1) % 3, v = (axis + 2) % 3;
        const n = [0, 0, 0]; n[axis] = sign;
        const nx = n[0] * cs - n[1] * sn, ny = n[0] * sn + n[1] * cs;
        const shade = glow > 0 ? 1 : 0.32 + 0.68 * Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + n[2] * LIGHT[2]);
        const r = rgb[0] * shade, g = rgb[1] * shade, b = rgb[2] * shade;
        const corner = (a, bb) => {
            const p = [0, 0, 0]; p[axis] = sign * h[axis]; p[u] = a * h[u]; p[v] = bb * h[v];
            P.push(cx + p[0] * cs - p[1] * sn, cy + p[0] * sn + p[1] * cs, cz + p[2], 1);
            C.push(r, g, b, glow);
        };
        corner(-1, -1); corner(1, -1); corner(1, 1);
        corner(-1, -1); corner(1, 1); corner(-1, 1);
    }
}
function edges(P, C, cx, cy, cz, sx, sy, sz, t, rgb, glow = 1) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    for (const y of [-hy, hy]) for (const z of [-hz, hz]) box(P, C, cx, cy + y, cz + z, sx + t, t, t, rgb, glow);
    for (const x of [-hx, hx]) for (const z of [-hz, hz]) box(P, C, cx + x, cy, cz + z, t, sy + t, t, rgb, glow);
    for (const x of [-hx, hx]) for (const y of [-hy, hy]) box(P, C, cx + x, cy + y, cz, t, t, sz, rgb, glow);
}
function quad(P, C, x0, x1, y0, y1, z, code) {
    for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y0], [x1, y1], [x0, y1]]) { P.push(x, y, z, 1); C.push(0, 0, 0, code); }
}
function quadVertical(P, C, x0, x1, y, z0, z1, code) {
    for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z0], [x1, z1], [x0, z1]]) { P.push(x, y, z, 1); C.push(0, 0, 0, code); }
}
function hsl(h, s, l) {
    const a = s * Math.min(l, 1 - l);
    const f = (n) => { const k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return [f(0), f(8), f(4)];
}
function mulberry32(a) {
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------------------------------------------------------------- audio
const Sound = {
    ctx: null, master: null, muted: false, hum: null,
    init() {
        if (this.ctx) return;
        try {
            this.ctx = new AudioContext();
            this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
            this.applyVolume();
        } catch (e) { this.ctx = null; }
    },
    applyVolume() { if (this.master) this.master.gain.value = this.muted ? 0 : save.settings.volume * 0.55; },
    tone(freq, dur, type = "square", vol = 0.08, slide = 0, delay = 0) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime + delay, o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = type; o.frequency.setValueAtTime(freq, t);
        if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
        g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.02);
    },
    noise(dur, vol, f0, f1) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime, n = Math.ceil(this.ctx.sampleRate * dur);
        const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
        const src = this.ctx.createBufferSource(); src.buffer = buf;
        const flt = this.ctx.createBiquadFilter(); flt.type = "bandpass";
        flt.frequency.setValueAtTime(f0, t); flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
        const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(flt).connect(g).connect(this.master); src.start(t);
    },
    startHum() {
        if (!this.ctx || this.hum) return;
        const o = this.ctx.createOscillator(), o2 = this.ctx.createOscillator(), g = this.ctx.createGain(), f = this.ctx.createBiquadFilter();
        o.type = "sawtooth"; o2.type = "sawtooth"; o2.detune.value = 12; f.type = "lowpass"; f.frequency.value = 500; g.gain.value = 0.03;
        o.connect(f); o2.connect(f); f.connect(g).connect(this.master); o.start(); o2.start();
        this.hum = { o, o2, g, f };
    },
    setHum(speed01, on = true) {
        if (!this.hum) return;
        const t = this.ctx.currentTime;
        for (const osc of [this.hum.o, this.hum.o2]) osc.frequency.setTargetAtTime(55 + speed01 * 55, t, 0.1);
        this.hum.f.frequency.setTargetAtTime(400 + speed01 * 1400, t, 0.1);
        this.hum.g.gain.setTargetAtTime(on ? 0.03 : 0, t, 0.05);
    },
    stopHum() { if (this.hum) { this.hum.o.stop(); this.hum.o2.stop(); this.hum = null; } },
    orb(streak) { const f = 660 * Math.pow(2, Math.min(streak, 24) / 12); this.tone(f, 0.09, "triangle", 0.09); this.tone(f * 1.5, 0.12, "triangle", 0.05, 0, 0.04); },
    jump(air) { this.tone(air ? 330 : 220, 0.18, "square", 0.05, air ? 420 : 260); },
    land() { this.noise(0.08, 0.12, 300, 120); },
    lane() { this.noise(0.07, 0.07, 1800, 900); },
    power() { [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.14, "triangle", 0.07, 0, i * 0.045)); },
    smash() { this.tone(900, 0.3, "sawtooth", 0.08, -700); this.noise(0.3, 0.25, 2000, 200); },
    near() { this.noise(0.18, 0.12, 3000, 700); this.tone(1200, 0.08, "sine", 0.04, 400); },
    crash() { this.noise(0.8, 0.5, 1200, 60); this.tone(140, 0.7, "sawtooth", 0.12, -100); },
    clear() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.22, "triangle", 0.09, 0, i * 0.11)); },
    click() { this.tone(880, 0.05, "square", 0.04); },
};

// ---------------------------------------------------------------- run state
const S = { mode: "menu", t: 0, gameT: 0, level: LEVELS[0], levelIndex: 0, menuTheme: 0 };
let P = null, chunks = [], particles = [], rng = mulberry32(1), origin = 0, nextRowY = 0;
const seenHazard = {};
let lastZone = 0;

const isEndless = () => !!S.level.endless;
const themeIndexAt = (y) => (isEndless() ? Math.floor(y / 1200) % THEMES.length : S.level.theme);
function difficultyAt(y) { return isEndless() ? clamp(y / 6000, 0, 1) : clamp(y / S.level.goal, 0, 1); }
function speedAt(d) {
    const L = S.level;
    return isEndless() ? Math.min(L.max, L.start + d * 0.011) : L.start + (L.max - L.start) * clamp(d / L.goal * 1.1, 0, 1);
}
function hazardsAt(y) {
    if (!isEndless()) return S.level.hazards;
    return { low: y > 250, laser: y > 900, mover: y > 1800 };
}

function newRun(levelIndex) {
    S.levelIndex = levelIndex;
    S.level = levelIndex < 0 ? ENDLESS : LEVELS[levelIndex];
    rng = mulberry32((Math.random() * 1e9) | 0);
    P = {
        lane: 1, x: 0, y: 0, z: 0, vz: 0, grounded: true, airJumps: 1, tilt: 0,
        speed: S.level.start, dist: 0, score: 0, orbs: 0, streak: 0, streakTimer: 0, nearMisses: 0, smashed: 0,
        shield: false, power: { magnet: 0, double: 0, slowmo: 0, boost: 0 },
        dead: false, deadT: 0, finished: false, finishT: 0,
    };
    for (const k in seenHazard) delete seenHazard[k];
    lastZone = 0;
    S.gameT = 0;
    chunks = []; particles = []; origin = 0; nextRowY = 70;
    clearPopups();
    for (let i = 0; i < AHEAD; i++) chunks.push(makeChunk(i));
    rebuildWorld();
}

// ---------------------------------------------------------------- track generation
const ROWS = {
    basic: ["B..", ".B.", "..B", "BB.", "B.B", ".BB"],
    low: ["LLL", "LB.", ".BL", "L.L", "BLB", ".L.", "L..", "..L"],
    laser: ["ZZZ", "ZZ.", ".ZZ", "Z.Z", "Z..", ".Z.", "..Z"],
    mixed: ["BZ.", ".ZB", "LZL", "ZBZ", "B.L", "Z.B"],
};
function pickRow(y) {
    const h = hazardsAt(y), d = difficultyAt(y), pool = [];
    ROWS.basic.forEach((r) => pool.push([r, 3 - d * 1.5]));
    if (h.low) ROWS.low.forEach((r) => pool.push([r, 1.1]));
    if (h.laser) ROWS.laser.forEach((r) => pool.push([r, 1.3]));
    if (h.mover) pool.push(["M", 4 + d * 3]);
    if (h.low && h.laser && d > 0.35) ROWS.mixed.forEach((r) => pool.push([r, 1]));
    let r = rng() * pool.reduce((s, p) => s + p[1], 0);
    for (const [row, w] of pool) { r -= w; if (r <= 0) return row; }
    return pool[0][0];
}

function addPickups(c, y, freeLanes) {
    if (!freeLanes.length || rng() > 0.78) return;
    const lane = freeLanes[(rng() * freeLanes.length) | 0], x = LANES[lane];
    const powers = S.level.powers;
    if (rng() < 0.085) c.pickups.push({ x, y: y - 7, z: 1.0, kind: powers[(rng() * powers.length) | 0] });
    else for (let j = 1; j <= 4; j++) c.pickups.push({ x, y: y - j * 2.4, z: 0.9, kind: "orb" });
}

function makeChunk(index) {
    const y0 = index * CHUNK, y1 = y0 + CHUNK;
    const c = { index, y0, y1, obstacles: [], lasers: [], movers: [], pickups: [], towers: [], theme: themeIndexAt(y0), finish: null };
    const goal = S.level.goal;
    while (nextRowY < y1) {
        const y = nextRowY;
        if (y > goal - 45) { nextRowY = Infinity; break; }  // clear run-out to the finish gate
        const row = pickRow(y), free = [];
        if (row === "M") {
            c.movers.push({ y, phase: rng() * Math.PI * 2, w: 1.1 + difficultyAt(y) * 1.0, amp: 3, w2: 2.3, d: 1.4, h: 2.6 });
            c.pickups.push({ x: 0, y: y + 8, z: 0.9, kind: "orb" });
        } else {
            const offset = rng() * 2;
            for (let i = 0; i < 3; i++) {
                const k = row[i], x = LANES[i];
                if (k === "B") c.obstacles.push({ x, y, w: 2.3, d: 1.4, h: 2.6, type: "B" });
                else if (k === "L") {
                    c.obstacles.push({ x, y, w: 2.6, d: 0.8, h: 0.95, type: "L" });
                    if (rng() < 0.5) for (let j = -2; j <= 2; j++) c.pickups.push({ x, y: y + j * 1.6, z: 1.3 + (2 - Math.abs(j)) * 0.55, kind: "orb" });
                } else if (k === "Z") c.lasers.push({ x, y, period: 2.0, onTime: 1.0, offset });
                else free.push(i);
            }
            addPickups(c, y, free);
        }
        nextRowY += 14 + speedAt(y) * 0.34 + rng() * 6;
    }
    if (goal >= y0 && goal < y1) c.finish = goal;
    for (let i = 0; i < 7; i++) {
        const side = rng() < 0.5 ? -1 : 1;
        c.towers.push({ x: side * (11 + rng() * 34), y: y0 + rng() * CHUNK, w: 3 + rng() * 5, d: 3 + rng() * 5, h: 5 + rng() * 26 });
    }
    return c;
}

function rebuildWorld() {
    origin = Math.floor(P.y / 100) * 100;
    space.clearScene();
    for (const c of chunks) appendChunk(c);
}
function appendChunk(c) {
    const Pa = [], Ca = [], o = origin, th = THEMES[c.theme];
    const y0 = c.y0 - o, y1 = c.y1 - o;
    quad(Pa, Ca, -60, 60, y0, y1, 0, -1);
    const rail = hsl(th.rail, 1, 0.55), post = hsl(th.hue, 1, 0.6);
    for (const s of [-1, 1]) {
        box(Pa, Ca, s * 5.3, (y0 + y1) / 2, 0.15, 0.25, CHUNK, 0.3, rail, 1);
        for (let y = y0; y < y1; y += 8) box(Pa, Ca, s * 5.3, y, 0.55, 0.35, 0.35, 1.1, post, 0.9);
    }
    const archCol = hsl((th.hue + c.index * 0.03) % 1, 1, 0.6), ay = y0 + CHUNK / 2;
    for (const s of [-1, 1]) box(Pa, Ca, s * 6.4, ay, 3.2, 0.5, 0.5, 6.4, archCol, 1);
    box(Pa, Ca, 0, ay, 6.5, 13.3, 0.5, 0.5, archCol, 1);
    for (const t of c.towers) {
        const ty = t.y - o;
        box(Pa, Ca, t.x, ty, t.h / 2, t.w, t.d, t.h, [0.06, 0.05, 0.12]);
        box(Pa, Ca, t.x, ty, t.h + 0.08, t.w + 0.1, t.d + 0.1, 0.16, hsl((th.hue + 0.5) % 1, 1, 0.6), 1);
        if (t.h > 12) box(Pa, Ca, t.x, ty, t.h * 0.55, t.w + 0.05, t.d + 0.05, 0.25, hsl(th.hue, 0.9, 0.55), 0.8);
    }
    for (const ob of c.obstacles) {
        const oy = ob.y - o;
        if (ob.type === "B") {
            box(Pa, Ca, ob.x, oy, ob.h / 2, ob.w, ob.d, ob.h, [0.12, 0.04, 0.16]);
            edges(Pa, Ca, ob.x, oy, ob.h / 2, ob.w, ob.d, ob.h, 0.12, hsl(th.hue, 1, 0.6), 1);
            box(Pa, Ca, ob.x, oy - ob.d / 2 - 0.01, ob.h * 0.55, ob.w * 0.7, 0.02, 0.25, hsl(th.hue, 1, 0.6), 1);
        } else {
            box(Pa, Ca, ob.x, oy, ob.h / 2, ob.w, ob.d, ob.h, [1, 0.55, 0.1], 0.85);
            for (const k of [-1, 1]) box(Pa, Ca, ob.x + k * (ob.w / 2 - 0.15), oy, ob.h / 2, 0.3, ob.d + 0.1, ob.h + 0.05, [0.15, 0.08, 0.05]);
        }
    }
    for (const lz of c.lasers) for (const s of [-1, 1]) box(Pa, Ca, lz.x + s * 1.35, lz.y - o, 0.6, 0.22, 0.22, 1.2, [0.18, 0.18, 0.24]);
    if (c.finish != null) {
        const fy = c.finish - o;
        for (const s of [-1, 1]) box(Pa, Ca, s * 6, fy, 4, 0.8, 0.8, 8, [1, 1, 1], 1);
        for (let i = 0; i < 13; i++) for (let j = 0; j < 2; j++) {
            const white = (i + j) % 2 === 0;
            box(Pa, Ca, -6 + i, fy, 7.2 + j * 0.9, 0.98, 0.3, 0.88, white ? [1, 1, 1] : [0.05, 0.05, 0.08], white ? 1 : 0);
        }
        for (let i = 0; i < 10; i++) box(Pa, Ca, -4.5 + i, fy, 0.02, 1, 1, 0.03, i % 2 ? [1, 1, 1] : [0.05, 0.05, 0.08], i % 2 ? 0.8 : 0);
    }
    space.addElements(Pa, Ca);
}

// ---------------------------------------------------------------- particles + popups
function burst(x, y, z, rgb, n, speed = 8) {
    for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2 - 0.2, s = speed * (0.3 + Math.random() * 0.7);
        particles.push({ x, y, z, vx: Math.cos(a) * Math.cos(e) * s, vy: Math.sin(a) * Math.cos(e) * s + (P ? P.speed * 0.5 : 0), vz: Math.sin(e) * s + 2,
            life: 0.5 + Math.random() * 0.6, rgb, size: 0.12 + Math.random() * 0.18 });
    }
}
const popLayer = $("popups"), pops = [];
function popup(text, x, y, z, cls = "") {
    const el = document.createElement("div");
    el.className = "pop " + cls; el.textContent = text;
    popLayer.appendChild(el);
    pops.push({ el, x, y, z, t: 0 });
}
function clearPopups() { for (const p of pops) p.el.remove(); pops.length = 0; }
function updatePopups(dt) {
    for (let i = pops.length - 1; i >= 0; i--) {
        const p = pops[i];
        p.t += dt;
        const pt = space.project(p.x, p.y - origin, p.z + p.t * 1.8);
        if (!pt || p.t > 1) { p.el.remove(); pops.splice(i, 1); continue; }
        p.el.style.transform = `translate(${pt.x}px, ${pt.y}px) translate(-50%, -50%) scale(${1 + Math.min(p.t * 4, 0.3) - p.t * 0.2})`;
        p.el.style.opacity = String(1 - Math.max(0, p.t - 0.6) / 0.4);
    }
}

// ---------------------------------------------------------------- UI helpers (GSAP when present)
function show(id, on) { $(id).classList.toggle("hidden", !on); }
function animateIn(el) {
    if (!Gs) return;
    Gs.fromTo(el, { y: 26, opacity: 0, scale: 0.97 }, { y: 0, opacity: 1, scale: 1, duration: 0.5, ease: "back.out(1.6)" });
}
function staggerIn(nodes) {
    if (!Gs || !nodes.length) return;
    Gs.fromTo(nodes, { y: 22, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, stagger: 0.06, ease: "power3.out" });
}
function banner(title, sub = "", color = "#fff") {
    const el = $("banner");
    $("bannerTitle").textContent = title; $("bannerSub").textContent = sub;
    el.style.setProperty("--c", color);
    el.classList.remove("hidden");
    if (Gs) {
        Gs.killTweensOf(el);
        Gs.timeline()
            .fromTo(el, { opacity: 0, scale: 1.25, y: 0 }, { opacity: 1, scale: 1, duration: 0.45, ease: "expo.out" })
            .to(el, { opacity: 0, y: -20, duration: 0.5, delay: 1.6, ease: "power2.in", onComplete: () => el.classList.add("hidden") });
    } else setTimeout(() => el.classList.add("hidden"), 2200);
}
function countUp(el, to, dur = 1.1) {
    if (!Gs) { el.textContent = Math.floor(to).toLocaleString(); return; }
    const o = { v: 0 };
    Gs.to(o, { v: to, duration: dur, ease: "power2.out", onUpdate: () => (el.textContent = Math.floor(o.v).toLocaleString()) });
}
let bumpCooldown = 0;
function bumpScore() {
    if (!Gs || bumpCooldown > 0) return;
    bumpCooldown = 0.08;
    Gs.fromTo("#score", { scale: 1.14 }, { scale: 1, duration: 0.25, ease: "power2.out" });
}
function flash(rgb, amount) { space.fx.flashColor = rgb; space.fx.flash = Math.max(space.fx.flash, amount); }

// ---------------------------------------------------------------- input
function laneMove(dir) {
    if (S.mode !== "play" || P.dead || P.finished) return;
    const nl = clamp(P.lane + dir, 0, 2);
    if (nl !== P.lane) { P.lane = nl; Sound.lane(); }
}
function jump() {
    if (S.mode !== "play" || P.dead) return;
    if (P.grounded) { P.vz = JUMP_V; P.grounded = false; Sound.jump(false); }
    else if (P.airJumps > 0) {
        P.airJumps--; P.vz = AIR_JUMP_V; Sound.jump(true);
        burst(P.x, P.y - 0.4, P.z + 0.2, [0.4, 0.9, 1], 14, 4);
    }
}
function drop() { if (S.mode === "play" && !P.grounded) P.vz = Math.min(P.vz, -20); }

addEventListener("keydown", (e) => {
    Sound.init();
    if (e.repeat) return;
    if (!$("settings").classList.contains("hidden") || !$("howto").classList.contains("hidden")) {
        if (e.code === "Escape") closeModals();
        return;
    }
    switch (e.code) {
        case "ArrowLeft": case "KeyA": laneMove(-1); break;
        case "ArrowRight": case "KeyD": laneMove(1); break;
        case "ArrowUp": case "KeyW": case "Space":
            e.preventDefault();
            if (S.mode === "play") jump();
            else if (S.mode === "over") startLevel(S.levelIndex);
            else if (S.mode === "complete") nextLevel();
            break;
        case "ArrowDown": case "KeyS": drop(); break;
        case "Enter":
            if (S.mode === "pause") resume();
            else if (S.mode === "over") startLevel(S.levelIndex);
            else if (S.mode === "complete") nextLevel();
            break;
        case "KeyP": case "Escape": if (S.mode === "play") pause(); else if (S.mode === "pause") resume(); break;
        case "KeyM": toggleMute(); break;
        case "KeyR": if (S.mode === "play" || S.mode === "pause") startLevel(S.levelIndex); break;
    }
});
let touch = null;
canvas.addEventListener("pointerdown", (e) => { Sound.init(); touch = { x: e.clientX, y: e.clientY, t: performance.now(), used: false }; });
canvas.addEventListener("pointermove", (e) => {
    if (!touch || touch.used) return;
    const dx = e.clientX - touch.x, dy = e.clientY - touch.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 28) return;
    touch.used = true;
    if (Math.abs(dx) > Math.abs(dy)) laneMove(dx > 0 ? 1 : -1); else if (dy < 0) jump(); else drop();
});
canvas.addEventListener("pointerup", () => { if (touch && !touch.used && performance.now() - touch.t < 300) jump(); touch = null; });
document.addEventListener("visibilitychange", () => { if (document.hidden && S.mode === "play") pause(); });

// ---------------------------------------------------------------- menus
function renderLevelCards() {
    const grid = $("levelGrid");
    grid.innerHTML = "";
    LEVELS.forEach((L, i) => {
        const locked = i + 1 > save.unlocked, stars = save.stars[i] || 0, best = save.best[i] || 0;
        const th = THEMES[L.theme];
        const card = document.createElement("button");
        card.className = "lvl" + (locked ? " locked" : "");
        card.style.setProperty("--grad", `linear-gradient(135deg, ${th.css})`);
        card.innerHTML = `
            <div class="lvlTop"><span class="lvlNum">${String(i + 1).padStart(2, "0")}</span><span class="lvlStars">${[0, 1, 2].map((k) => `<i class="${k < stars ? "on" : ""}">★</i>`).join("")}</span></div>
            <div class="lvlName">${L.name}</div>
            <div class="lvlTag">${locked ? "🔒 Clear level " + i + " to unlock" : L.tag}</div>
            <div class="lvlMeta"><span>${(L.goal / 1000).toFixed(1)} km</span><span>${best ? "Best " + best.toLocaleString() : ""}</span></div>
            <div class="lvlPowers">${L.powers.map((p) => `<span title="${POWERS[p].name}">${POWERS[p].icon}</span>`).join("")}</div>`;
        card.addEventListener("mouseenter", () => { S.menuTheme = L.theme; });
        card.addEventListener("focus", () => { S.menuTheme = L.theme; });
        card.addEventListener("click", () => {
            Sound.init();
            if (!locked) { Sound.click(); startLevel(i); }
            else if (Gs) Gs.fromTo(card, { x: -6 }, { x: 0, duration: 0.4, ease: "elastic.out(1, 0.3)" });
        });
        grid.appendChild(card);
    });
    $("endlessBest").textContent = save.endless ? "Best " + save.endless.toLocaleString() : "No run yet";
    const total = Object.values(save.stars).reduce((a, b) => a + b, 0);
    $("starTotal").textContent = `${total} / ${LEVELS.length * 3}`;
}
function openMenu() {
    S.mode = "menu";
    Sound.stopHum();
    ["hud", "over", "complete", "pause"].forEach((id) => show(id, false));
    show("menu", true);
    renderLevelCards();
    newRun(0); S.menuTheme = 0;
    animateIn($("menuCard"));
    staggerIn(document.querySelectorAll("#levelGrid .lvl, #endlessCard"));
}
$("endlessCard").addEventListener("click", () => { Sound.init(); Sound.click(); startLevel(-1); });
$("endlessCard").addEventListener("mouseenter", () => { S.menuTheme = 4; });

function startLevel(i) {
    Sound.init(); Sound.startHum();
    newRun(i);
    S.mode = "play";
    ["menu", "over", "complete", "pause"].forEach((id) => show(id, false));
    show("hud", true);
    const L = S.level;
    $("lvlLabel").textContent = L.endless ? "ENDLESS" : `LEVEL ${i + 1} · ${L.name.toUpperCase()}`;
    renderPowerChips(true);
    banner(L.endless ? "ENDLESS" : L.name.toUpperCase(), L.endless ? "Zones change every 1.2 km" : L.intro, THEMES[L.theme].css.split(",")[0]);
    flash([0.3, 0.9, 1], 0.6);
    if (Gs) Gs.fromTo("#hud .glass, #scoreBox", { opacity: 0, y: -12 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.05 });
}
function nextLevel() {
    if (S.levelIndex >= 0 && S.levelIndex < LEVELS.length - 1) startLevel(S.levelIndex + 1);
    else openMenu();
}
function pause() { S.mode = "pause"; show("pause", true); Sound.setHum(0, false); animateIn($("pauseCard")); }
function resume() { S.mode = "play"; show("pause", false); }
function toggleMute() {
    Sound.muted = !Sound.muted;
    $("muteBtn").textContent = Sound.muted ? "🔇" : "🔊";
    Sound.applyVolume();
}

function gameOver() {
    S.mode = "over";
    Sound.stopHum();
    const score = Math.floor(P.score);
    let isBest = false;
    if (isEndless()) { if (score > save.endless) { save.endless = score; isBest = true; } }
    else if (score > (save.best[S.levelIndex] || 0)) { save.best[S.levelIndex] = score; isBest = true; }
    persist();
    countUp($("finalScore"), score);
    $("newBest").classList.toggle("hidden", !isBest);
    $("overProgress").classList.toggle("hidden", isEndless());
    if (!isEndless()) {
        const pct = clamp(P.dist / S.level.goal, 0, 1);
        $("overFill").style.width = (pct * 100).toFixed(1) + "%";
        $("overPct").textContent = Math.floor(pct * 100) + "% of the sector";
    }
    $("statDist").textContent = Math.floor(P.dist) + " m";
    $("statOrbs").textContent = P.orbs;
    $("statNear").textContent = P.nearMisses;
    $("statBest").textContent = (isEndless() ? save.endless : save.best[S.levelIndex] || 0).toLocaleString();
    show("hud", false); show("over", true);
    animateIn($("overCard"));
}

function levelComplete() {
    S.mode = "complete";
    Sound.stopHum();
    const i = S.levelIndex, L = S.level, score = Math.floor(P.score);
    const stars = 1 + (P.orbs >= L.stars[0] ? 1 : 0) + (P.orbs >= L.stars[1] ? 1 : 0);
    save.stars[i] = Math.max(save.stars[i] || 0, stars);
    if (score > (save.best[i] || 0)) save.best[i] = score;
    save.unlocked = Math.max(save.unlocked, Math.min(LEVELS.length, i + 2));
    persist();
    $("cLevel").textContent = `LEVEL ${i + 1} · ${L.name.toUpperCase()}`;
    const starEls = [...document.querySelectorAll("#cStars i")];
    starEls.forEach((el, k) => el.classList.toggle("on", k < stars));
    $("cHint").textContent = stars < 3 ? `Collect ${L.stars[stars - 1]} orbs for ${stars + 1}★` : "Perfect run!";
    countUp($("cScore"), score);
    $("cOrbs").textContent = P.orbs;
    $("cNear").textContent = P.nearMisses;
    $("cSmash").textContent = P.smashed;
    $("nextBtn").textContent = i < LEVELS.length - 1 ? "NEXT LEVEL →" : "BACK TO MENU";
    show("hud", false); show("complete", true);
    animateIn($("completeCard"));
    if (Gs) Gs.fromTo(starEls, { scale: 0, rotation: -120 }, { scale: 1, rotation: 0, duration: 0.6, stagger: 0.18, delay: 0.3, ease: "back.out(2.2)" });
}

$("retryBtn").addEventListener("click", () => startLevel(S.levelIndex));
$("overMenuBtn").addEventListener("click", openMenu);
$("nextBtn").addEventListener("click", nextLevel);
$("replayBtn").addEventListener("click", () => startLevel(S.levelIndex));
$("completeMenuBtn").addEventListener("click", openMenu);
$("resumeBtn").addEventListener("click", resume);
$("restartBtn").addEventListener("click", () => startLevel(S.levelIndex));
$("quitBtn").addEventListener("click", openMenu);
$("pauseBtn").addEventListener("click", () => (S.mode === "play" ? pause() : S.mode === "pause" && resume()));
$("muteBtn").addEventListener("click", toggleMute);

// modals: settings + how to play
function openModal(id) { show(id, true); animateIn($(id).querySelector(".card")); }
function closeModals() { show("settings", false); show("howto", false); }
document.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => { Sound.init(); Sound.click(); if (S.mode === "play") pause(); openModal(b.dataset.open); }));
document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModals));
$("volume").value = save.settings.volume;
$("volume").addEventListener("input", (e) => { save.settings.volume = +e.target.value; Sound.applyVolume(); persist(); });
$("fxToggle").checked = save.settings.fx === "full";
$("fxToggle").addEventListener("change", (e) => { save.settings.fx = e.target.checked ? "full" : "reduced"; persist(); });
$("shakeToggle").checked = save.settings.shake;
$("shakeToggle").addEventListener("change", (e) => { save.settings.shake = e.target.checked; persist(); });
$("resetProgress").addEventListener("click", () => {
    const btn = $("resetProgress");
    if (btn.dataset.armed !== "1") {
        btn.dataset.armed = "1"; btn.textContent = "Tap again to erase";
        setTimeout(() => { btn.dataset.armed = ""; btn.textContent = "Reset progress"; }, 2500);
        return;
    }
    Object.assign(save, { unlocked: 1, stars: {}, best: {}, endless: 0 });
    persist(); renderLevelCards(); btn.dataset.armed = ""; btn.textContent = "Progress erased";
});
$("howPowers").innerHTML = Object.values(POWERS).map((p) => `<div class="pw"><span class="pwIcon" style="--c:${p.css}">${p.icon}</span><b>${p.name}</b><small>${p.desc}${p.dur ? " · " + p.dur + "s" : ""}</small></div>`).join("");

// ---------------------------------------------------------------- simulation
let shake = 0;
function applyPower(kind, x, y, z) {
    const def = POWERS[kind];
    if (kind === "shield") P.shield = true; else P.power[kind] = def.dur;
    Sound.power();
    flash(def.color, 0.55);
    burst(x, y, z, def.color, 36, 7);
    popup(def.icon + " " + def.name.toUpperCase(), x, y, z + 0.6, "power");
    renderPowerChips(true);
}
function smash(x, y, z, rgb) {
    P.smashed++;
    const pts = 50 * multiplier();
    P.score += pts;
    burst(x, y, z, rgb, 60, 12);
    popup("SMASH +" + pts, x, y, z + 1, "smash");
    flash([1, 0.7, 0.3], 0.5); addShake(0.5); space.fx.aberr = 1;
    Sound.smash();
}
function die() {
    P.dead = true;
    burst(P.x, P.y, P.z + 0.4, [1, 0.5, 0.2], 90, 14);
    burst(P.x, P.y, P.z + 0.4, [0.3, 0.9, 1], 50, 10);
    flash([1, 0.2, 0.35], 1); addShake(1.2); space.fx.aberr = 1.6;
    Sound.stopHum(); Sound.crash();
}
// true when the collision was absorbed (boost / shield)
function absorbHit(x, y, z, rgb) {
    if (P.power.boost > 0) { smash(x, y, z, rgb); return true; }
    if (P.shield) { P.shield = false; smash(x, y, z, rgb); renderPowerChips(true); return true; }
    die();
    return false;
}
function addShake(v) { if (save.settings.shake) shake = Math.max(shake, v); }
function multiplier() { return (1 + Math.min(4, Math.floor(P.streak / 8))) * (P.power.double > 0 ? 2 : 1); }

function update(realDt) {
    const dt = realDt * (P.power.slowmo > 0 ? 0.55 : 1);
    S.gameT += dt;
    bumpCooldown -= realDt;

    let expired = false; // power-up timers run in real time
    for (const k in P.power) if (P.power[k] > 0) { P.power[k] = Math.max(0, P.power[k] - realDt); if (P.power[k] === 0) expired = true; }
    if (expired) renderPowerChips(true);

    if (!P.dead) {
        const boost = P.power.boost > 0 ? 1.45 : 1;
        P.speed = speedAt(P.dist) * boost * (P.finished ? Math.max(0.2, 1 - P.finishT * 0.6) : 1);
        P.y += P.speed * dt;
        P.dist += P.speed * dt;
        if (!P.finished) P.score += P.speed * dt * 0.5 * multiplier();
        P.streakTimer -= dt;
        if (P.streakTimer <= 0) P.streak = 0;
    }
    const prevX = P.x;
    P.x += (LANES[P.lane] - P.x) * (1 - Math.exp(-dt * 14));
    P.tilt = (P.x - prevX) / Math.max(dt, 1e-3) * 0.035;

    if (!P.grounded) {
        P.vz += GRAVITY * dt; P.z += P.vz * dt;
        if (P.z <= 0) { P.z = 0; P.vz = 0; P.grounded = true; P.airJumps = 1; Sound.land(); burst(P.x, P.y - 0.8, 0.1, [0.3, 0.9, 1], 8, 3); }
    }

    if (P.y > chunks[1].y0 + 4) {
        chunks.shift();
        chunks.push(makeChunk(chunks[chunks.length - 1].index + 1));
        rebuildWorld();
    }

    if (isEndless()) {
        const zone = Math.floor(P.dist / 1200);
        if (zone !== lastZone) { lastZone = zone; const th = THEMES[zone % THEMES.length]; banner("ZONE " + (zone + 1), th.name, th.css.split(",")[0]); }
    }
    announceHazards();

    if (!P.dead && !P.finished) collide();
    if (!P.dead) magnetPull(dt);

    if (!isEndless() && !P.finished && !P.dead && P.dist >= S.level.goal) {
        P.finished = true; P.finishT = 0;
        Sound.clear();
        banner("SECTOR CLEAR", `${P.orbs} orbs collected`, "#5dff7a");
        for (let i = 0; i < 6; i++) burst(P.x + (Math.random() - 0.5) * 8, P.y + 6, 4 + Math.random() * 3, hsl(Math.random(), 1, 0.6), 20, 8);
    }
    if (P.finished) { P.finishT += realDt; if (P.finishT > 1.8 && S.mode === "play") levelComplete(); }

    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        p.vz += GRAVITY * 0.5 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z = Math.max(0.05, p.z + p.vz * dt);
    }
    if (!P.dead && Math.random() < 0.8) {
        const boost = P.power.boost > 0;
        particles.push({ x: P.x + (Math.random() - 0.5) * 0.5, y: P.y - 1.1, z: P.z + 0.35, vx: 0, vy: -2, vz: 0.3,
            life: boost ? 0.55 : 0.35, rgb: boost ? [1, 0.8, 0.2] : [1, 0.45, 0.15], size: boost ? 0.24 : 0.14 });
    }
    if (P.dead) { P.deadT += realDt; if (P.deadT > 1.3 && S.mode === "play") gameOver(); }
}

function announceHazards() {
    for (const c of chunks) {
        if (c.y0 > P.y + 90) break;
        const check = (list, key, title, sub, color) => {
            if (seenHazard[key]) return;
            if (list.some((o) => o.y > P.y + 20 && o.y < P.y + 90)) { seenHazard[key] = true; banner(title, sub, color); }
        };
        check(c.lasers, "laser", "⚠ LASER GATES", "Jump over them while they're lit", "#ff3a5a");
        check(c.movers, "mover", "⚠ SLIDING BLOCKS", "Watch their rhythm and slip past", "#ffe066");
    }
}

function laserOn(lz) { return ((S.gameT + lz.offset) % lz.period) < lz.onTime; }
function moverX(m) { return m.amp * Math.sin(m.phase + S.gameT * m.w); }

function collide() {
    const px0 = P.x - 0.6, px1 = P.x + 0.6, py0 = P.y - 0.85, py1 = P.y + 0.85, pz0 = P.z, pz1 = P.z + 0.8;
    const overlap = (x, y, w, d, h) => px1 > x - w / 2 && px0 < x + w / 2 && py1 > y - d / 2 && py0 < y + d / 2 && pz0 < h && pz1 > 0;
    for (const c of chunks) {
        if (c.y1 < P.y - 6 || c.y0 > P.y + 6) continue;
        for (let i = c.obstacles.length - 1; i >= 0; i--) {
            const o = c.obstacles[i];
            if (overlap(o.x, o.y, o.w, o.d, o.h)) {
                c.obstacles.splice(i, 1);
                if (absorbHit(o.x, o.y, o.h / 2, o.type === "B" ? hsl(THEMES[c.theme].hue, 1, 0.6) : [1, 0.6, 0.1])) rebuildWorld();
                return;
            }
            if (o.type === "B" && !o.passed && P.y - 0.85 > o.y + o.d / 2) { // near miss beside a tall block
                o.passed = true;
                if (Math.abs(P.x - o.x) < 3.3) nearMiss(o.x, o.y);
            }
        }
        for (const lz of c.lasers) {
            if (lz.dead) continue;
            if (laserOn(lz) && overlap(lz.x, lz.y, 2.5, 0.3, 0.95)) { lz.dead = true; absorbHit(lz.x, lz.y, 0.6, [1, 0.2, 0.3]); return; }
        }
        for (const m of c.movers) {
            if (m.dead) continue;
            const mx = moverX(m);
            if (overlap(mx, m.y, m.w2, m.d, m.h)) { m.dead = true; absorbHit(mx, m.y, m.h / 2, [1, 0.9, 0.3]); return; }
            if (!m.passed && P.y - 0.85 > m.y + m.d / 2) { m.passed = true; if (Math.abs(P.x - mx) < 3.3) nearMiss(mx, m.y); }
        }
        for (const k of c.pickups) {
            if (k.taken) continue;
            if (Math.abs(k.x - P.x) < 1.15 && Math.abs(k.y - P.y) < 1.25 && Math.abs(k.z - (P.z + 0.5)) < 1.15) {
                k.taken = true;
                if (k.kind === "orb") {
                    P.orbs++; P.streak++; P.streakTimer = 3;
                    P.score += 25 * multiplier();
                    Sound.orb(P.streak);
                    burst(k.x, k.y, k.z, [1, 0.85, 0.3], 10, 4);
                    if (P.streak % 8 === 0) popup(`STREAK x${multiplier()}`, P.x, P.y + 3, 2.4, "streak");
                    bumpScore();
                } else applyPower(k.kind, k.x, k.y, k.z);
            }
        }
    }
}
function nearMiss(x, y) {
    P.nearMisses++;
    const pts = 30 * multiplier();
    P.score += pts;
    popup("CLOSE! +" + pts, (x + P.x) / 2, y, 2.2, "near");
    Sound.near();
    space.fx.aberr = Math.max(space.fx.aberr, 0.35);
}
function magnetPull(dt) {
    if (P.power.magnet <= 0) return;
    const f = 1 - Math.exp(-dt * 7);
    for (const c of chunks) {
        if (c.y0 > P.y + 20) break;
        for (const k of c.pickups) {
            if (k.taken || k.kind !== "orb" || k.y < P.y - 2 || k.y > P.y + 16) continue;
            k.x += (P.x - k.x) * f; k.z += (P.z + 0.5 - k.z) * f; k.y += (P.y - k.y) * f * 0.5;
        }
    }
}

// ---------------------------------------------------------------- per-frame dynamic geometry
function drawPowerModel(Pa, Ca, kind, x, y, z, t) {
    const col = POWERS[kind].color, spin = t * 2;
    if (kind === "shield") { box(Pa, Ca, x, y, z, 0.6, 0.6, 0.6, col, 1, spin); edges(Pa, Ca, x, y, z, 1.15, 1.15, 1.15, 0.05, col, 1); return; }
    if (kind === "magnet") {
        const cs = Math.cos(spin), sn = Math.sin(spin);
        for (const s of [-1, 1]) {
            box(Pa, Ca, x + s * 0.35 * cs, y + s * 0.35 * sn, z + 0.1, 0.22, 0.22, 0.7, col, 1, spin);
            box(Pa, Ca, x + s * 0.35 * cs, y + s * 0.35 * sn, z + 0.52, 0.24, 0.24, 0.16, [0.9, 0.9, 1], 1, spin);
        }
        box(Pa, Ca, x, y, z - 0.3, 0.92, 0.22, 0.22, col, 1, spin);
        return;
    }
    if (kind === "double") { box(Pa, Ca, x - 0.25, y, z, 0.42, 0.42, 0.42, col, 1, spin); box(Pa, Ca, x + 0.25, y, z + 0.25, 0.42, 0.42, 0.42, col, 1, -spin); return; }
    if (kind === "slowmo") {
        box(Pa, Ca, x, y, z + 0.28, 0.6, 0.6, 0.12, col, 1, spin); box(Pa, Ca, x, y, z - 0.28, 0.6, 0.6, 0.12, col, 1, spin);
        box(Pa, Ca, x, y, z, 0.18, 0.18, 0.5, [1, 0.95, 0.7], 1, spin);
        return;
    }
    box(Pa, Ca, x, y, z, 0.28, 0.9, 0.28, col, 1); // boost: chevron arrow
    for (const s of [-1, 1]) box(Pa, Ca, x + s * 0.28, y + 0.25, z, 0.5, 0.2, 0.24, col, 1, s * 0.8);
}

function buildDynamic(t) {
    const Pa = [], Ca = [], o = origin;
    if (P && !P.dead && S.mode !== "menu") {
        const x = P.x, y = P.y - o, z = P.z + 0.35 + Math.sin(t * 6) * 0.05, yaw = -P.tilt * 0.6;
        const cs = Math.cos(yaw), sn = Math.sin(yaw);
        const part = (lx, ly, lz, sx, sy, sz, rgb, glow) => box(Pa, Ca, x + lx * cs - ly * sn, y + lx * sn + ly * cs, z + lz, sx, sy, sz, rgb, glow, yaw);
        const boost = P.power.boost > 0, accent = P.power.double > 0 ? [0.4, 1, 0.5] : [0.3, 0.95, 1];
        part(0, 0, 0, 1.1, 1.8, 0.35, [0.14, 0.16, 0.3], 0);
        part(0, 0.35, 0.25, 0.55, 0.7, 0.25, accent, 0.9);
        part(0, 0.95, -0.02, 0.5, 0.3, 0.2, [0.14, 0.16, 0.3], 0);
        for (const s of [-1, 1]) {
            part(s * 0.85, -0.25, -0.05, 0.7, 0.9, 0.1, [0.9, 0.25, 0.7], 0.6);
            part(s * 1.2, -0.3, 0.1, 0.08, 0.8, 0.3, accent, 1);
        }
        part(0, -0.95, 0, 0.8, 0.12, 0.25, boost ? [1, 0.9, 0.3] : [1, 0.5, 0.15], 1);
        if (boost) for (let k = 1; k <= 3; k++) part(0, -1 - k * 0.45, 0, 0.6 - k * 0.12, 0.4, 0.2 - k * 0.03, [1, 0.6 - k * 0.12, 0.1], 1);
        box(Pa, Ca, x, y, 0.02, 1.2 - P.z * 0.1, 1.8 - P.z * 0.1, 0.02, [0.02, 0.0, 0.05], 0);
        if (P.shield) { const pulse = 1.4 + Math.sin(t * 8) * 0.06; edges(Pa, Ca, x, y, z + 0.1, 2.4 * pulse, 2.6 * pulse, 1.4 * pulse, 0.05, [0.3, 0.8, 1], 1); }
        if (P.power.magnet > 0) {
            const ph = t * 3 % 1, r = 2.2 + ph * 1.8;
            for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2 + t; box(Pa, Ca, x + Math.cos(a) * r, y + Math.sin(a) * r, 0.05, 0.25, 0.25, 0.04, [1, 0.3, 0.45], 1 - ph); }
        }
        if (!P.grounded && P.airJumps > 0) box(Pa, Ca, x, y, z - 0.35, 0.3, 0.3, 0.05, [0.4, 0.9, 1], 0.8);
    }
    for (const c of chunks) {
        if (c.y0 > P.y + 230) break;
        for (const lz of c.lasers) {
            if (lz.y < P.y - 6 || lz.dead) continue;
            const on = laserOn(lz), phase = (S.gameT + lz.offset) % lz.period;
            const warn = !on && phase > lz.period - 0.35 && Math.sin(t * 60) > 0;
            const col = on ? [1, 0.15, 0.25] : warn ? [1, 0.5, 0.5] : [0.35, 0.08, 0.12];
            for (const h of [0.3, 0.6, 0.9]) box(Pa, Ca, lz.x, lz.y - o, h, 2.5, 0.06, 0.06, col, on ? 1 : warn ? 0.6 : 0.15);
            for (const s of [-1, 1]) box(Pa, Ca, lz.x + s * 1.35, lz.y - o, 1.25, 0.26, 0.26, 0.1, col, on ? 1 : 0.3);
        }
        for (const m of c.movers) {
            if (m.y < P.y - 6 || m.dead) continue;
            const mx = moverX(m), my = m.y - o;
            box(Pa, Ca, mx, my, m.h / 2, m.w2, m.d, m.h, [0.1, 0.09, 0.03]);
            edges(Pa, Ca, mx, my, m.h / 2, m.w2, m.d, m.h, 0.12, [1, 0.9, 0.3], 1);
            for (let k = 0; k < 3; k++) box(Pa, Ca, mx - 0.7 + k * 0.7, my - m.d / 2 - 0.01, m.h * 0.5, 0.35, 0.02, 0.35, [1, 0.9, 0.3], 1, 0.6);
            box(Pa, Ca, 0, my, 0.03, 8.6, 0.08, 0.02, [1, 0.9, 0.3], 0.35);
        }
        for (const k of c.pickups) {
            if (k.taken || k.y < P.y - 5) continue;
            const ky = k.y - o, bob = Math.sin(t * 4 + k.y) * 0.12;
            if (k.kind === "orb") box(Pa, Ca, k.x, ky, k.z + bob, 0.45, 0.45, 0.45, [1, 0.8, 0.25], 1, t * 3 + k.y);
            else {
                drawPowerModel(Pa, Ca, k.kind, k.x, ky, k.z + bob + 0.2, t);
                box(Pa, Ca, k.x, ky, 0.03, 1.5, 1.5, 0.02, POWERS[k.kind].color, 0.5 + Math.sin(t * 6) * 0.3, t);
            }
        }
    }
    for (const p of particles) box(Pa, Ca, p.x, p.y - o, p.z, p.size, p.size, p.size, p.rgb, Math.min(1, p.life * 2));
    quadVertical(Pa, Ca, -140, 140, P.y - o + 360, -20, 200, -2);
    return [Pa, Ca];
}

// ---------------------------------------------------------------- camera + palette
const pal = { fog: [...THEMES[0].fog], grid: [...THEMES[0].grid], sunA: [...THEMES[0].sunA], sunB: [...THEMES[0].sunB] };
function updatePalette(dt) {
    const idx = S.mode === "menu" ? S.menuTheme : themeIndexAt(P.dist);
    const th = THEMES[idx], k = 1 - Math.exp(-dt * 2.5);
    for (const key of ["fog", "grid", "sunA", "sunB"]) for (let i = 0; i < 3; i++) pal[key][i] = lerp(pal[key][i], th[key][i], k);
    space.fog = pal.fog; space.gridColor = pal.grid; space.sunA = pal.sunA; space.sunB = pal.sunB;
    let tint = [1, 1, 1, 0];
    if (P.power.slowmo > 0) tint = [0.8, 0.65, 1, 0.35];
    else if (P.power.boost > 0) tint = [1, 0.75, 0.45, 0.25];
    for (let i = 0; i < 4; i++) space.tint[i] = lerp(space.tint[i], tint[i], Math.min(1, k * 2));
}
function updateCamera(dt, t) {
    const o = origin, menu = S.mode === "menu";
    const tx = menu ? Math.sin(t * 0.2) * 2 : P.x * 0.55;
    const ty = P.y - o + (menu ? 12 : 4.5);
    const tz = menu ? 2.5 : 1.3 + P.z * 0.35;
    const k = 1 - Math.exp(-dt * 8);
    space.X0 += (tx - space.X0) * k;
    space.Y0 = ty;
    space.Z0 += (tz - space.Z0) * k;
    const speed01 = clamp((P.speed - 18) / 44, 0, 1.3);
    space.Rc = menu ? 16 : 12.5 - speed01 * 1.5 + (P.power.boost > 0 ? 1 : 0);
    space.alpha = -Math.PI / 2 + (menu ? Math.sin(t * 0.15) * 0.35 : -P.x * 0.018);
    space.beta = menu ? 0.28 : 0.4 - speed01 * 0.05;
    space.magnifier = menu ? 1.1 : 1.1 - speed01 * 0.18;
    if (shake > 0) { space.X0 += (Math.random() - 0.5) * shake; space.Z0 += (Math.random() - 0.5) * shake * 0.6; }
    space.Xc = space.X0 + Math.cos(space.beta) * Math.cos(space.alpha) * space.Rc;
    space.Yc = space.Y0 + Math.cos(space.beta) * Math.sin(space.alpha) * space.Rc;
    space.Zc = space.Z0 + Math.sin(space.beta) * space.Rc;
    space.scroll = o;
    space.sun = [0, 34, 95, 0];
}

// ---------------------------------------------------------------- HUD
let hudKey = "", chipKey = "";
function renderPowerChips(force) {
    const active = [];
    if (P.shield) active.push("shield");
    for (const k of ["magnet", "double", "slowmo", "boost"]) if (P.power[k] > 0) active.push(k);
    const key = active.join(",");
    if (!force && key === chipKey) return;
    chipKey = key;
    const el = $("powers");
    el.innerHTML = active.map((k) => `<div class="chip" data-k="${k}" style="--c:${POWERS[k].css}"><span class="ic">${POWERS[k].icon}</span><span class="nm">${POWERS[k].name}</span></div>`).join("");
    if (Gs) Gs.fromTo(el.querySelectorAll(".chip"), { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: "back.out(2)", stagger: 0.04 });
}
function updateHud() {
    renderPowerChips(false);
    for (const chip of document.querySelectorAll("#powers .chip")) {
        const k = chip.dataset.k, f = k === "shield" ? 1 : P.power[k] / POWERS[k].dur;
        chip.style.setProperty("--p", (f * 360).toFixed(0) + "deg");
        chip.classList.toggle("ending", k !== "shield" && P.power[k] < 1.5);
    }
    const mult = multiplier(), L = S.level;
    const key = [Math.floor(P.score), mult, P.orbs, Math.floor(P.dist), Math.round(P.speed), P.nearMisses, P.grounded, P.airJumps].join("|");
    if (key === hudKey) return;
    hudKey = key;
    $("score").textContent = Math.floor(P.score).toLocaleString();
    $("mult").textContent = "x" + mult;
    $("mult").classList.toggle("hot", mult > 1);
    $("orbs").textContent = P.orbs;
    $("near").textContent = P.nearMisses;
    $("speedFill").style.width = clamp(8 + (P.speed - 18) / 44 * 92, 0, 100) + "%";
    $("speedVal").textContent = Math.round(P.speed * 3.6) + " km/h";
    $("airPip").classList.toggle("on", P.grounded || P.airJumps > 0);
    if (L.endless) {
        $("progressFill").style.width = ((P.dist % 1200) / 1200 * 100).toFixed(1) + "%";
        $("progressText").textContent = `${Math.floor(P.dist)} m · zone ${Math.floor(P.dist / 1200) + 1}`;
    } else {
        $("progressFill").style.width = (clamp(P.dist / L.goal, 0, 1) * 100).toFixed(1) + "%";
        $("progressText").textContent = `${Math.min(L.goal, Math.floor(P.dist))} / ${L.goal} m`;
    }
}

// ---------------------------------------------------------------- main loop
function fit() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}
addEventListener("resize", fit);

let last = performance.now();
function frame(now) {
    requestAnimationFrame(frame);
    fit();
    const realDt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    S.t += realDt;
    if (S.mode === "play") {
        update(P.dead ? realDt * 0.35 : realDt);
        updateHud();
        Sound.setHum(clamp((P.speed - 18) / 44, 0, 1), !P.dead);
    } else if (S.mode === "menu") {
        P.y += 14 * realDt; P.dist = P.y;
        if (P.y > chunks[1].y0 + 4) { chunks.shift(); chunks.push(makeChunk(chunks[chunks.length - 1].index + 1)); rebuildWorld(); }
    } else if (S.mode === "over" || S.mode === "complete") {
        update(realDt * 0.3);
    }
    updatePalette(realDt);
    updateCamera(realDt, S.t);
    shake = Math.max(0, shake - realDt * 2.5);
    const fxScale = save.settings.fx === "full" ? 1 : 0.35;
    space.fx.flash = Math.max(0, space.fx.flash - realDt * 2.2);
    space.fx.aberr = Math.max(0, space.fx.aberr - realDt * 2);
    space.fx.speed = (S.mode === "play" && !P.dead ? clamp((P.speed - 18) / 44, 0, 1.3) : 0) * fxScale;
    space.time = S.t;
    const [dp, dc] = buildDynamic(S.t);
    const aberr = space.fx.aberr;
    space.fx.aberr = aberr * fxScale;
    space.render(dp, dc);
    space.fx.aberr = aberr;
    updatePopups(realDt);
}

openMenu();
requestAnimationFrame(frame);
window.neonRush = { S, get P() { return P; }, get chunks() { return chunks; }, space, startLevel, update, laneMove, jump, LANES, LEVELS, save };
