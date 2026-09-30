import RunnerSpace from "./RunnerSpace.js";

// ===========================================================================
// NEON RUSH: an endless synthwave runner built on projection_library's Space.
// World is Z-up (Space convention). The track runs along +Y, lanes along X.
// ===========================================================================

const LANES = [-3, 0, 3];
const CHUNK = 48;             // track length generated per chunk
const AHEAD = 7;              // chunks kept in front of the player
const START_SPEED = 20, MAX_SPEED = 62, ACCEL = 0.35;
const GRAVITY = -32, JUMP_V = 10.5;

const $ = (id) => document.getElementById(id);
const canvas = $("view");
const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
if (!gl) { $("nogl").classList.remove("hidden"); throw new Error("WebGL unavailable"); }
const space = new RunnerSpace(gl);

// ---------------------------------------------------------------- geometry helpers
const FACES = [[0, -1], [0, 1], [1, -1], [1, 1], [2, -1], [2, 1]];
const LIGHT = (() => { const v = [0.35, -0.55, 0.76], m = Math.hypot(...v); return v.map((x) => x / m); })();

// Push an (optionally Z-rotated) box into pos/col arrays in Space's vec4 format.
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
function quad(P, C, x0, x1, y0, y1, z, rgb, code) {
    const v = [[x0, y0], [x1, y0], [x1, y1], [x0, y0], [x1, y1], [x0, y1]];
    for (const [x, y] of v) { P.push(x, y, z, 1); C.push(rgb[0], rgb[1], rgb[2], code); }
}
function hsl(h, s, l) {
    const a = s * Math.min(l, 1 - l);
    const f = (n) => { const k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return [f(0), f(8), f(4)];
}

// seeded RNG so a run's layout is reproducible
function mulberry32(a) {
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------------------------------------------------------------- audio (Web Audio synth)
const Sound = {
    ctx: null, master: null, muted: false, hum: null,
    init() {
        if (this.ctx) return;
        try {
            this.ctx = new AudioContext();
            this.master = this.ctx.createGain(); this.master.gain.value = 0.45; this.master.connect(this.ctx.destination);
        } catch (e) { this.ctx = null; }
    },
    tone(freq, dur, type = "square", vol = 0.08, slide = 0, delay = 0) {
        if (!this.ctx || this.muted) return;
        const t = this.ctx.currentTime + delay, o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = type; o.frequency.setValueAtTime(freq, t);
        if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
        g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.02);
    },
    noise(dur, vol, f0, f1) {
        if (!this.ctx || this.muted) return;
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
        o.type = "sawtooth"; o2.type = "sawtooth"; o2.detune.value = 12; f.type = "lowpass"; f.frequency.value = 500;
        g.gain.value = this.muted ? 0 : 0.03;
        o.connect(f); o2.connect(f); f.connect(g).connect(this.master); o.start(); o2.start();
        this.hum = { o, o2, g, f };
    },
    setHum(speed01) {
        if (!this.hum) return;
        const t = this.ctx.currentTime;
        this.hum.o.frequency.setTargetAtTime(55 + speed01 * 55, t, 0.1);
        this.hum.o2.frequency.setTargetAtTime(55 + speed01 * 55, t, 0.1);
        this.hum.f.frequency.setTargetAtTime(400 + speed01 * 1400, t, 0.1);
        this.hum.g.gain.setTargetAtTime(this.muted ? 0 : 0.03, t, 0.05);
    },
    stopHum() { if (this.hum) { this.hum.o.stop(); this.hum.o2.stop(); this.hum = null; } },
    orb(streak) { const f = 660 * Math.pow(2, Math.min(streak, 24) / 12); this.tone(f, 0.09, "triangle", 0.09); this.tone(f * 1.5, 0.12, "triangle", 0.05, 0, 0.04); },
    jump() { this.tone(220, 0.18, "square", 0.05, 260); },
    land() { this.noise(0.08, 0.12, 300, 120); },
    lane() { this.noise(0.07, 0.07, 1800, 900); },
    shield() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.14, "triangle", 0.07, 0, i * 0.05)); },
    block() { this.tone(900, 0.3, "sawtooth", 0.08, -700); this.noise(0.3, 0.2, 2000, 200); },
    crash() { this.noise(0.8, 0.5, 1200, 60); this.tone(140, 0.7, "sawtooth", 0.12, -100); },
};

// ---------------------------------------------------------------- game state
const best = { score: +(localStorage.getItem("neonRushBest") || 0) };
const S = {
    mode: "menu",            // menu | play | pause | over
    t: 0,
};
let P;                       // player
let chunks = [];             // active track chunks
let particles = [];
let rng = mulberry32(1);
let origin = 0;              // world rebasing offset along Y (keeps float32 coordinates small)
let nextRowY = 0;

function newRun() {
    rng = mulberry32((Math.random() * 1e9) | 0);
    P = {
        lane: 1, x: 0, y: 0, z: 0, vz: 0, grounded: true, tilt: 0,
        speed: START_SPEED, dist: 0, score: 0, orbs: 0, streak: 0, streakTimer: 0,
        shield: false, shieldHits: 0, dead: false, deadT: 0, jumps: 0,
    };
    chunks = []; particles = []; origin = 0; nextRowY = 60;
    for (let i = 0; i < AHEAD; i++) chunks.push(makeChunk(i));
    rebuildWorld();
}

// ---------------------------------------------------------------- track generation
const PATTERNS = [
    // B = tall block (dodge), L = low bar (jump), . = free
    { lanes: "B..", w: 3 }, { lanes: ".B.", w: 3 }, { lanes: "..B", w: 3 },
    { lanes: "BB.", w: 2 }, { lanes: "B.B", w: 2 }, { lanes: ".BB", w: 2 },
    { lanes: "LLL", w: 1.5, min: 300 }, { lanes: "LB.", w: 1.5, min: 200 }, { lanes: ".BL", w: 1.5, min: 200 },
    { lanes: "BLB", w: 1.2, min: 500 }, { lanes: "L.L", w: 1.2, min: 150 },
];
function pickPattern(dist) {
    const pool = PATTERNS.filter((p) => !p.min || dist > p.min);
    let r = rng() * pool.reduce((s, p) => s + p.w, 0);
    for (const p of pool) { r -= p.w; if (r <= 0) return p.lanes; }
    return pool[0].lanes;
}

function makeChunk(index) {
    const y0 = index * CHUNK, y1 = y0 + CHUNK;
    const c = { index, y0, y1, obstacles: [], pickups: [], towers: [], hue: (index * 0.07) % 1 };
    // obstacle rows: spacing widens with the speed they will be met at
    while (nextRowY < y1) {
        const y = nextRowY;
        const expectedSpeed = Math.min(MAX_SPEED, START_SPEED + y * 0.02);
        const pattern = pickPattern(y);
        const free = [];
        for (let i = 0; i < 3; i++) {
            const k = pattern[i], x = LANES[i];
            if (k === "B") c.obstacles.push({ x, y, w: 2.3, d: 1.4, h: 2.6, type: "B" });
            else if (k === "L") c.obstacles.push({ x, y, w: 2.6, d: 0.8, h: 0.95, type: "L" });
            else free.push(i);
            if (k === "L" && rng() < 0.5) // orb arc over a low bar
                for (let j = -2; j <= 2; j++) c.pickups.push({ x, y: y + j * 1.6, z: 1.3 + (2 - Math.abs(j)) * 0.55, kind: "orb" });
        }
        if (free.length && rng() < 0.75) {
            const lane = free[(rng() * free.length) | 0];
            if (rng() < 0.07) c.pickups.push({ x: LANES[lane], y: y - 6, z: 0.9, kind: "shield" });
            else for (let j = 1; j <= 4; j++) c.pickups.push({ x: LANES[lane], y: y - j * 2.4, z: 0.9, kind: "orb" });
        }
        nextRowY += 15 + expectedSpeed * 0.32 + rng() * 6;
    }
    // skyline towers on both sides
    for (let i = 0; i < 7; i++) {
        const side = rng() < 0.5 ? -1 : 1;
        c.towers.push({ x: side * (11 + rng() * 34), y: y0 + rng() * CHUNK, w: 3 + rng() * 5, d: 3 + rng() * 5, h: 5 + rng() * 26 });
    }
    return c;
}

// Build static geometry for all active chunks into Space (relative to `origin`).
function rebuildWorld() {
    origin = Math.floor(P.y / 100) * 100;
    space.clearScene();
    for (const c of chunks) appendChunk(c);
}
function appendChunk(c) {
    const Pa = [], Ca = [], o = origin;
    const y0 = c.y0 - o, y1 = c.y1 - o;
    quad(Pa, Ca, -60, 60, y0, y1, 0, [0, 0, 0], -1);                       // neon floor
    const rail = hsl(0.52, 1, 0.55), post = hsl(0.9, 1, 0.6);
    for (const s of [-1, 1]) {
        box(Pa, Ca, s * 5.3, (y0 + y1) / 2, 0.15, 0.25, CHUNK, 0.3, rail, 1);  // side rails
        for (let y = y0; y < y1; y += 8) box(Pa, Ca, s * 5.3, y, 0.55, 0.35, 0.35, 1.1, post, 0.9);
    }
    // arch gateway every chunk, colour cycling along the run
    const archCol = hsl(c.hue, 1, 0.6), ay = y0 + CHUNK / 2;
    for (const s of [-1, 1]) box(Pa, Ca, s * 6.4, ay, 3.2, 0.5, 0.5, 6.4, archCol, 1);
    box(Pa, Ca, 0, ay, 6.5, 13.3, 0.5, 0.5, archCol, 1);
    // skyline
    for (const t of c.towers) {
        const ty = t.y - o;
        box(Pa, Ca, t.x, ty, t.h / 2, t.w, t.d, t.h, [0.06, 0.05, 0.12]);
        box(Pa, Ca, t.x, ty, t.h + 0.08, t.w + 0.1, t.d + 0.1, 0.16, hsl((c.hue + 0.5) % 1, 1, 0.6), 1);
        if (t.h > 12) box(Pa, Ca, t.x, ty, t.h * 0.55, t.w + 0.05, t.d + 0.05, 0.25, hsl(c.hue, 0.9, 0.55), 0.8);
    }
    // obstacles
    for (const ob of c.obstacles) {
        const oy = ob.y - o;
        if (ob.type === "B") {
            box(Pa, Ca, ob.x, oy, ob.h / 2, ob.w, ob.d, ob.h, [0.12, 0.04, 0.16]);
            edges(Pa, Ca, ob.x, oy, ob.h / 2, ob.w, ob.d, ob.h, 0.12, [1, 0.2, 0.6], 1);
            box(Pa, Ca, ob.x, oy - ob.d / 2 - 0.01, ob.h * 0.55, ob.w * 0.7, 0.02, 0.25, [1, 0.2, 0.6], 1);
        } else {
            box(Pa, Ca, ob.x, oy, ob.h / 2, ob.w, ob.d, ob.h, [1, 0.55, 0.1], 0.85);
            for (let k = -1; k <= 1; k += 2) box(Pa, Ca, ob.x + k * (ob.w / 2 - 0.15), oy, ob.h / 2, 0.3, ob.d + 0.1, ob.h + 0.05, [0.15, 0.08, 0.05]);
        }
    }
    space.addElements(Pa, Ca); // Space appends in place; reDraw uploads only the new tail
}

// ---------------------------------------------------------------- particles
function burst(x, y, z, rgb, n, speed = 8) {
    for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2 - 0.2, s = speed * (0.3 + Math.random() * 0.7);
        particles.push({ x, y, z, vx: Math.cos(a) * Math.cos(e) * s, vy: Math.sin(a) * Math.cos(e) * s + P.speed * 0.5, vz: Math.sin(e) * s + 2,
            life: 0.5 + Math.random() * 0.6, rgb, size: 0.12 + Math.random() * 0.18 });
    }
}

// ---------------------------------------------------------------- input
const input = { left: false, right: false, jump: false, drop: false };
function laneMove(dir) {
    if (S.mode !== "play" || P.dead) return;
    const nl = Math.max(0, Math.min(2, P.lane + dir));
    if (nl !== P.lane) { P.lane = nl; Sound.lane(); }
}
function jump() {
    if (S.mode !== "play" || P.dead) return;
    if (P.grounded) { P.vz = JUMP_V; P.grounded = false; P.jumps++; Sound.jump(); }
}
function drop() { if (S.mode === "play" && !P.grounded) P.vz = Math.min(P.vz, -18); }

addEventListener("keydown", (e) => {
    Sound.init();
    if (e.repeat) return;
    switch (e.code) {
        case "ArrowLeft": case "KeyA": laneMove(-1); break;
        case "ArrowRight": case "KeyD": laneMove(1); break;
        case "ArrowUp": case "KeyW": case "Space": e.preventDefault(); if (S.mode === "play") jump(); else if (S.mode === "menu" || S.mode === "over") start(); break;
        case "ArrowDown": case "KeyS": drop(); break;
        case "Enter": if (S.mode === "menu" || S.mode === "over") start(); else if (S.mode === "pause") resume(); break;
        case "KeyP": case "Escape": if (S.mode === "play") pause(); else if (S.mode === "pause") resume(); break;
        case "KeyM": toggleMute(); break;
    }
});
// touch: swipe left/right to change lane, swipe up or tap to jump, swipe down to drop
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

// ---------------------------------------------------------------- UI flow
function show(id, on) { $(id).classList.toggle("hidden", !on); }
function start() {
    Sound.init(); Sound.startHum();
    newRun();
    S.mode = "play";
    show("menu", false); show("over", false); show("pause", false); show("hud", true);
    flash([0.3, 0.9, 1], 0.6);
}
function pause() { S.mode = "pause"; show("pause", true); Sound.setHum(0); }
function resume() { S.mode = "play"; show("pause", false); }
function toggleMute() {
    Sound.muted = !Sound.muted;
    $("muteBtn").textContent = Sound.muted ? "🔇" : "🔊";
    if (Sound.hum) Sound.setHum(0);
}
function gameOver() {
    S.mode = "over";
    Sound.stopHum();
    const score = Math.floor(P.score), isBest = score > best.score;
    if (isBest) { best.score = score; try { localStorage.setItem("neonRushBest", String(score)); } catch (e) { /* storage blocked */ } }
    $("finalScore").textContent = score.toLocaleString();
    $("newBest").classList.toggle("hidden", !isBest);
    $("statDist").textContent = Math.floor(P.dist) + " m";
    $("statOrbs").textContent = P.orbs;
    $("statSpeed").textContent = Math.round(P.speed * 3.6) + " km/h";
    $("statBest").textContent = best.score.toLocaleString();
    show("hud", false); show("over", true);
}
$("playBtn").addEventListener("click", start);
$("retryBtn").addEventListener("click", start);
$("menuBtn").addEventListener("click", () => { S.mode = "menu"; show("over", false); show("menu", true); updateMenuBest(); });
$("resumeBtn").addEventListener("click", resume);
$("pauseBtn").addEventListener("click", () => (S.mode === "play" ? pause() : S.mode === "pause" && resume()));
$("muteBtn").addEventListener("click", toggleMute);
function updateMenuBest() { $("menuBest").textContent = best.score.toLocaleString(); }
updateMenuBest();

function flash(rgb, amount) { space.fx.flashColor = rgb; space.fx.flash = Math.max(space.fx.flash, amount); }

// ---------------------------------------------------------------- simulation
let shake = 0;
function update(dt) {
    // speed, distance, lane easing
    if (!P.dead) {
        P.speed = Math.min(MAX_SPEED, P.speed + ACCEL * dt);
        P.y += P.speed * dt;
        P.dist += P.speed * dt;
        const mult = 1 + Math.min(4, Math.floor(P.streak / 8));
        P.score += P.speed * dt * 0.5 * mult;
        P.streakTimer -= dt;
        if (P.streakTimer <= 0) P.streak = 0;
    }
    const tx = LANES[P.lane];
    const prevX = P.x;
    P.x += (tx - P.x) * (1 - Math.exp(-dt * 14));
    P.tilt = (P.x - prevX) / Math.max(dt, 1e-3) * 0.035;

    // vertical
    if (!P.grounded) {
        P.vz += GRAVITY * dt; P.z += P.vz * dt;
        if (P.z <= 0) { P.z = 0; P.vz = 0; P.grounded = true; Sound.land(); burst(P.x, P.y - 0.8, 0.1, [0.3, 0.9, 1], 8, 3); }
    }

    // stream chunks: drop the one behind, add one ahead, rebase coordinates
    if (P.y > chunks[1].y0 + 4) {
        chunks.shift();
        chunks.push(makeChunk(chunks[chunks.length - 1].index + 1));
        rebuildWorld();
    }

    if (!P.dead) collide();

    // particles
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        p.vz += GRAVITY * 0.5 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z = Math.max(0.05, p.z + p.vz * dt);
    }
    // engine trail
    if (!P.dead && Math.random() < 0.8) particles.push({ x: P.x + (Math.random() - 0.5) * 0.5, y: P.y - 1.1, z: P.z + 0.35, vx: 0, vy: -2, vz: 0.3, life: 0.35, rgb: [1, 0.45, 0.15], size: 0.14 });

    if (P.dead) { P.deadT += dt; if (P.deadT > 1.3 && S.mode === "play") gameOver(); }
}

function collide() {
    const px0 = P.x - 0.6, px1 = P.x + 0.6, py0 = P.y - 0.85, py1 = P.y + 0.85, pz0 = P.z, pz1 = P.z + 0.8;
    for (const c of chunks) {
        if (c.y1 < P.y - 5 || c.y0 > P.y + 5) continue;
        for (let i = c.obstacles.length - 1; i >= 0; i--) {
            const o = c.obstacles[i];
            if (px1 > o.x - o.w / 2 && px0 < o.x + o.w / 2 && py1 > o.y - o.d / 2 && py0 < o.y + o.d / 2 && pz0 < o.h && pz1 > 0) {
                if (P.shield) {
                    P.shield = false;
                    c.obstacles.splice(i, 1);
                    rebuildWorld();
                    burst(o.x, o.y, o.h / 2, o.type === "B" ? [1, 0.2, 0.6] : [1, 0.6, 0.1], 60, 12);
                    flash([0.3, 0.8, 1], 0.8); shake = 0.6; space.fx.aberr = 1;
                    Sound.block();
                } else {
                    P.dead = true;
                    burst(P.x, P.y, P.z + 0.4, [1, 0.5, 0.2], 90, 14);
                    burst(P.x, P.y, P.z + 0.4, [0.3, 0.9, 1], 50, 10);
                    flash([1, 0.2, 0.35], 1); shake = 1.2; space.fx.aberr = 1.6;
                    Sound.stopHum(); Sound.crash();
                }
                return;
            }
        }
        for (const k of c.pickups) {
            if (k.taken) continue;
            if (Math.abs(k.x - P.x) < 1.1 && Math.abs(k.y - P.y) < 1.2 && Math.abs(k.z - (P.z + 0.5)) < 1.1) {
                k.taken = true;
                if (k.kind === "shield") {
                    P.shield = true; Sound.shield(); flash([0.3, 0.8, 1], 0.5);
                    burst(k.x, k.y, k.z, [0.3, 0.8, 1], 30, 6);
                } else {
                    P.orbs++; P.streak++; P.streakTimer = 3;
                    const mult = 1 + Math.min(4, Math.floor(P.streak / 8));
                    P.score += 25 * mult;
                    Sound.orb(P.streak);
                    burst(k.x, k.y, k.z, [1, 0.85, 0.3], 10, 4);
                }
            }
        }
    }
}

// ---------------------------------------------------------------- per-frame dynamic geometry
function buildDynamic(t) {
    const Pa = [], Ca = [], o = origin;
    if (P && !P.dead) {
        const x = P.x, y = P.y - o, z = P.z + 0.35 + Math.sin(t * 6) * 0.05, yaw = -P.tilt * 0.6;
        const cs = Math.cos(yaw), sn = Math.sin(yaw);
        const at = (lx, ly) => [x + lx * cs - ly * sn, y + lx * sn + ly * cs];
        const part = (lx, ly, lz, sx, sy, sz, rgb, glow) => { const [ax, ay] = at(lx, ly); box(Pa, Ca, ax, ay, z + lz, sx, sy, sz, rgb, glow, yaw); };
        part(0, 0, 0, 1.1, 1.8, 0.35, [0.14, 0.16, 0.3], 0);          // hull
        part(0, 0.35, 0.25, 0.55, 0.7, 0.25, [0.3, 0.95, 1], 0.9);     // cockpit
        part(0, 0.95, -0.02, 0.5, 0.3, 0.2, [0.14, 0.16, 0.3], 0);     // nose
        for (const s of [-1, 1]) {
            part(s * 0.85, -0.25, -0.05, 0.7, 0.9, 0.1, [0.9, 0.25, 0.7], 0.6);  // wings
            part(s * 1.2, -0.3, 0.1, 0.08, 0.8, 0.3, [0.3, 0.95, 1], 1);         // wing tips
        }
        part(0, -0.95, 0, 0.8, 0.12, 0.25, [1, 0.5, 0.15], 1);          // engine glow
        // ground shadow + hover glow
        box(Pa, Ca, x, y, 0.02, 1.2 - P.z * 0.1, 1.8 - P.z * 0.1, 0.02, [0.02, 0.0, 0.05], 0);
        if (P.shield) {
            const pulse = 1.4 + Math.sin(t * 8) * 0.06;
            edges(Pa, Ca, x, y, z + 0.1, 2.4 * pulse, 2.6 * pulse, 1.4 * pulse, 0.05, [0.3, 0.8, 1], 1);
        }
    }
    // pickups near the player
    for (const c of chunks) {
        if (c.y0 > P.y + 220) break;
        for (const k of c.pickups) {
            if (k.taken || k.y < P.y - 5) continue;
            const ky = k.y - o, bob = Math.sin(t * 4 + k.y) * 0.12;
            if (k.kind === "shield") {
                box(Pa, Ca, k.x, ky, k.z + bob, 0.7, 0.7, 0.7, [0.3, 0.8, 1], 1, t * 2);
                edges(Pa, Ca, k.x, ky, k.z + bob, 1.2, 1.2, 1.2, 0.05, [0.6, 0.9, 1], 1);
            } else {
                box(Pa, Ca, k.x, ky, k.z + bob, 0.45, 0.45, 0.45, [1, 0.8, 0.25], 1, t * 3 + k.y);
            }
        }
    }
    for (const p of particles) box(Pa, Ca, p.x, p.y - o, p.z, p.size, p.size, p.size, p.rgb, Math.min(1, p.life * 2));
    // synthwave sun far ahead (procedural in the fragment shader, code -2)
    const sunY = P.y - o + 360;
    quadVertical(Pa, Ca, -140, 140, sunY, -20, 200);
    return [Pa, Ca];
}
function quadVertical(P2, C2, x0, x1, y, z0, z1) {
    const v = [[x0, z0], [x1, z0], [x1, z1], [x0, z0], [x1, z1], [x0, z1]];
    for (const [x, z] of v) { P2.push(x, y, z, 1); C2.push(0, 0, 0, -2); }
}

// ---------------------------------------------------------------- camera (Space's orbit camera)
function updateCamera(dt, t) {
    const o = origin;
    const menu = S.mode === "menu";
    const tx = menu ? Math.sin(t * 0.2) * 2 : P.x * 0.55;
    const ty = (P ? P.y : 0) - o + (menu ? 12 : 4.5);
    const tz = menu ? 2.5 : 1.3 + P.z * 0.35;
    const k = 1 - Math.exp(-dt * 8);
    space.X0 += (tx - space.X0) * k;
    space.Y0 = ty; // follows exactly along the track (no lag at high speed)
    space.Z0 += (tz - space.Z0) * k;
    const speed01 = P ? (P.speed - START_SPEED) / (MAX_SPEED - START_SPEED) : 0;
    space.Rc = menu ? 16 : 12.5 - speed01 * 1.5;
    space.alpha = -Math.PI / 2 + (menu ? Math.sin(t * 0.15) * 0.35 : -P.x * 0.018);
    space.beta = menu ? 0.28 : 0.4 - speed01 * 0.05;
    space.magnifier = 1.1 - speed01 * 0.18; // widen the view as speed rises
    if (shake > 0) { space.X0 += (Math.random() - 0.5) * shake; space.Z0 += (Math.random() - 0.5) * shake * 0.6; }
    space.Xc = space.X0 + Math.cos(space.beta) * Math.cos(space.alpha) * space.Rc;
    space.Yc = space.Y0 + Math.cos(space.beta) * Math.sin(space.alpha) * space.Rc;
    space.Zc = space.Z0 + Math.sin(space.beta) * space.Rc;
    space.scroll = o;
    space.sun = [0, 34, 95, 0];
}

// ---------------------------------------------------------------- HUD
let lastHud = "";
function updateHud() {
    const mult = 1 + Math.min(4, Math.floor(P.streak / 8));
    const speed01 = (P.speed - START_SPEED) / (MAX_SPEED - START_SPEED);
    const key = [Math.floor(P.score), mult, P.orbs, Math.round(speed01 * 100), P.shield, Math.floor(P.dist)].join("|");
    if (key === lastHud) return;
    lastHud = key;
    $("score").textContent = Math.floor(P.score).toLocaleString();
    $("mult").textContent = "x" + mult;
    $("mult").classList.toggle("hot", mult > 1);
    $("orbs").textContent = P.orbs;
    $("dist").textContent = Math.floor(P.dist) + " m";
    $("speedFill").style.width = (8 + speed01 * 92) + "%";
    $("speedVal").textContent = Math.round(P.speed * 3.6) + " km/h";
    $("shieldIcon").classList.toggle("on", P.shield);
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
    let dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    S.t += dt;
    if (S.mode === "play") {
        if (P.dead) dt *= 0.35; // slow-motion crash
        update(dt);
        updateHud();
        Sound.setHum((P.speed - START_SPEED) / (MAX_SPEED - START_SPEED));
    } else if (S.mode === "menu") {
        P.y += 14 * dt; // idle cruise behind the title screen
        if (P.y > chunks[1].y0 + 4) { chunks.shift(); chunks.push(makeChunk(chunks[chunks.length - 1].index + 1)); rebuildWorld(); }
    } else if (S.mode === "over") {
        update(dt * 0.3);
    }
    updateCamera(dt, S.t);
    shake = Math.max(0, shake - dt * 2.5);
    space.fx.flash = Math.max(0, space.fx.flash - dt * 2.2);
    space.fx.aberr = Math.max(0, space.fx.aberr - dt * 2);
    space.fx.speed = S.mode === "play" && !P.dead ? (P.speed - START_SPEED) / (MAX_SPEED - START_SPEED) : 0;
    space.time = S.t;
    const [dp, dc] = buildDynamic(S.t);
    space.render(dp, dc);
}

newRun();
S.mode = "menu";
requestAnimationFrame(frame);
window.neonRush = { S, get P() { return P; }, get chunks() { return chunks; }, space, start, update, laneMove, jump, LANES }; // console / testing hook
