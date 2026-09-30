import { test, assert, near, nearVec, throws } from "./runner.js";
import {
    Camera, Transform, Entity, Scene, Loop, Input, Renderer, Mesh, InstancedMesh, BasicMaterial, primitives,
    ShaderProgram, ShaderError, parseShaderLog, quat,
} from "../engine/index.js";
import Space from "../Space.js";

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const rand = (() => { let s = 12345; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();

// ------------------------------------------------------------------ Camera

test("Camera basis is orthonormal for random orbits", () => {
    const cam = new Camera();
    for (let i = 0; i < 200; i++) {
        cam.target.set([rand() * 40 - 20, rand() * 40 - 20, rand() * 10]);
        cam.yaw = rand() * 20 - 10; cam.pitch = rand() * 3 - 1.5; cam.distance = 0.5 + rand() * 300;
        cam.update(0);
        near(dot(cam.right, cam.right), 1, 1e-9, "|right|");
        near(dot(cam.up, cam.up), 1, 1e-9, "|up|");
        near(dot(cam.forward, cam.forward), 1, 1e-9, "|forward|");
        near(dot(cam.right, cam.up), 0, 1e-9, "right·up");
        near(dot(cam.up, cam.forward), 0, 1e-9, "up·forward");
        near(dot(cam.right, cam.forward), 0, 1e-9, "right·forward");
        // right-handed: right × up = -forward? (right, up, forward) with forward into the screen:
        // right = forward × up
        const c = [cam.forward[1] * cam.up[2] - cam.forward[2] * cam.up[1], cam.forward[2] * cam.up[0] - cam.forward[0] * cam.up[2], cam.forward[0] * cam.up[1] - cam.forward[1] * cam.up[0]];
        nearVec(cam.right, c, 1e-9, "right = forward × up");
        assert(cam.up[2] >= -1e-9, "screen-up never points below the horizon plane for |pitch| < 90°");
    }
});

test("Camera basis matches the original Space maths exactly", () => {
    const canvas = document.createElement("canvas");
    const space = new Space(canvas.getContext("webgl"));
    const cam = new Camera();
    for (let i = 0; i < 100; i++) {
        const t = [rand() * 20 - 10, rand() * 20 - 10, rand() * 5], a = rand() * 6.28, b = rand() * 2.8 - 1.4, r = 1 + rand() * 100;
        Object.assign(space, { X0: t[0], Y0: t[1], Z0: t[2], alpha: a, beta: b, Rc: r });
        space.updateCameraPosition(); space.updateMyVectors();
        cam.target.set(t); cam.yaw = a; cam.pitch = b; cam.distance = r; cam.update(0);
        nearVec(cam.eye, [space.Xc, space.Yc, space.Zc], 1e-9, "eye");
        nearVec(cam.left, space.xUnitVec, 1e-9, "left = Space xAxis");
        nearVec(cam.up, space.yUnitVec, 1e-9, "up = Space yAxis");
        nearVec(cam.forward, space.zUnitVec, 1e-9, "forward = Space zAxis");
    }
});

test("Camera.project puts the target at the screen centre and screenRay inverts project", () => {
    const cam = new Camera({ target: [3, -2, 1], distance: 15, yaw: 0.7, pitch: 0.4 });
    cam.update(0);
    const p = cam.project(cam.target, 800, 450);
    assert(p.visible, "target visible");
    near(p.x, 400, 1e-6, "x"); near(p.y, 225, 1e-6, "y");
    const world = [5, 1, 2];
    const s = cam.project(world, 800, 450);
    const ray = cam.screenRay(s.x, s.y, 800, 450);
    const d = [world[0] - ray.origin[0], world[1] - ray.origin[1], world[2] - ray.origin[2]];
    const len = Math.hypot(...d);
    nearVec(ray.direction, d.map((v) => v / len), 1e-9, "ray direction");
});

test("Camera.project clips points behind the eye", () => {
    const cam = new Camera({ target: [0, 0, 0], distance: 10, yaw: 0, pitch: 0 });
    cam.update(0);
    const behind = [cam.eye[0] - cam.forward[0] * 5, cam.eye[1] - cam.forward[1] * 5, cam.eye[2] - cam.forward[2] * 5];
    assert(!cam.project(behind, 100, 100).visible);
});

test("Camera follow mode eases toward the object with look-ahead", () => {
    const obj = { position: [0, 0, 0] };
    const cam = new Camera();
    cam.setFollow(obj, { damping: 10, lookAhead: 0.5, offset: [0, 0, 0] });
    for (let i = 0; i < 120; i++) { obj.position[1] += 10 / 60; cam.update(1 / 60); }
    assert(cam.target[1] > obj.position[1] - 0.5, "keeps up with the object");
    assert(cam.target[1] > obj.position[1], "leads the object (look-ahead)");
});

test("Camera fov ↔ focal ↔ Space magnifier", () => {
    const cam = new Camera();
    cam.focal = 1.25 * 1.75;
    near(cam.focal, 2.1875, 1e-9);
});

// ------------------------------------------------------------------ Transform / Scene

test("Transform hierarchy composes world matrices", () => {
    const parent = new Transform().setPosition(10, 0, 0).setYaw(Math.PI / 2);
    const child = new Transform().setPosition(1, 0, 0);
    parent.add(child);
    parent.updateWorldMatrix();
    nearVec(child.getWorldPosition(), [10, 1, 0], 1e-6, "child rotates with parent");
    parent.remove(child);
    assert(child.parent === null && parent.children.length === 0);
});

test("Transform interpolates between fixed steps", () => {
    const t = new Transform().setPosition(0, 0, 0);
    t.snapshot();
    t.setPosition(10, 0, 0);
    t.updateWorldMatrix(0.25);
    near(t.worldMatrix[12], 2.5, 1e-6);
    t.interpolate = false; t.updateWorldMatrix(0.25);
    near(t.worldMatrix[12], 10, 1e-6);
});

test("quat.fromEuler supports the zyx order used by setRotationEuler", () => {
    const t = new Transform().setRotationEuler(0, 0, Math.PI / 2);
    const q = quat.create(); quat.setAxisAngle(q, [0, 0, 1], Math.PI / 2);
    nearVec(t.rotation, q, 1e-6);
});

test("Scene updates entities and sweeps destroyed ones", () => {
    const scene = new Scene();
    const a = scene.add(new Entity({ name: "a" })), b = scene.add(new Entity({ name: "b" }));
    let ticks = 0;
    a.onUpdate(() => ticks++);
    b.onUpdate((dt, e) => e.destroy());
    scene.update(1 / 60);
    assert(ticks === 1, "updater ran");
    assert(scene.find("b") === null && scene.find("a") === a, "destroyed entity removed");
});

// ------------------------------------------------------------------ Loop

function fakeLoop(opts = {}) {
    let now = 0;
    const calls = { updates: 0, renders: 0, alphas: [] };
    const loop = new Loop({
        update: () => calls.updates++,
        render: (alpha) => { calls.renders++; calls.alphas.push(alpha); },
        now: () => now, requestFrame: () => 0, cancelFrame: () => {}, autoPauseWhenHidden: false, ...opts,
    });
    return { loop, calls, advance(ms) { now += ms; loop.tick(now); } };
}

test("Loop runs fixed 60 Hz steps regardless of frame rate", () => {
    const { loop, calls, advance } = fakeLoop();
    loop.start();
    for (let i = 0; i < 144; i++) advance(1000 / 144); // one second at 144 fps
    near(calls.updates, 60, 1, "≈60 updates in one second");
    assert(calls.renders === 144, "renders every frame");
    assert(calls.alphas.every((a) => a >= 0 && a < 1), "alpha in [0,1)");
});

test("Loop timeScale and pause", () => {
    const { loop, calls, advance } = fakeLoop();
    loop.start(); loop.timeScale = 0.5;
    for (let i = 0; i < 60; i++) advance(1000 / 60);
    near(calls.updates, 30, 1, "half speed");
    loop.pause(); const before = calls.updates;
    for (let i = 0; i < 30; i++) advance(1000 / 60);
    assert(calls.updates === before, "no updates while paused");
    assert(calls.renders === 90, "still renders while paused");
});

test("Loop clamps long stalls instead of spiralling", () => {
    const { loop, calls, advance } = fakeLoop();
    loop.start();
    advance(5000);
    assert(calls.updates <= 5, "at most maxStepsPerFrame after a 5 s stall");
});

// ------------------------------------------------------------------ Input

function key(type, code, target = window) { target.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true })); }

test("Input action mapping: a tap between steps is reported once", () => {
    const input = new Input();
    input.bind("jump", ["Space", "KeyW"]);
    key("keydown", "Space"); key("keyup", "Space");
    input.beginStep();
    assert(input.wasPressed("jump"), "pressed in first step");
    assert(!input.isDown("jump"), "already released");
    input.endStep(); input.beginStep();
    assert(!input.wasPressed("jump"), "not reported twice");
    input.dispose();
});

test("Input axis combines keys", () => {
    const input = new Input();
    input.bindAxis("steer", { negative: ["KeyA"], positive: ["KeyD"] });
    key("keydown", "KeyD");
    assert(input.axis("steer") === 1);
    key("keydown", "KeyA");
    assert(input.axis("steer") === 0, "both held cancel out");
    key("keyup", "KeyD"); key("keyup", "KeyA");
    input.dispose();
});

test("Input ignores keys typed into form fields", () => {
    const input = new Input();
    input.bind("jump", ["Space"]);
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));
    input.beginStep();
    assert(!input.wasPressed("jump"));
    field.remove(); input.dispose();
});

// ------------------------------------------------------------------ Shaders

test("parseShaderLog reads ANGLE and driver formats", () => {
    const e = parseShaderLog("ERROR: 0:12: 'foo' : undeclared identifier\n0(7) : error C1008: undefined variable");
    assert(e[0].line === 12 && e[0].message.includes("undeclared"));
    assert(e[1].line === 7);
});

test("ShaderProgram throws ShaderError with stage and line", () => {
    const gl = document.createElement("canvas").getContext("webgl");
    throws(() => new ShaderProgram(gl, "void main(){ gl_Position = vec4(0.0); }", "void main(){ gl_FragColor = nope; }", { name: "bad" }),
        (err) => {
            assert(err instanceof ShaderError, "ShaderError");
            assert(err.stage === "fragment", "stage");
            assert(err.entries.some((x) => x.line > 0), "has a line number");
        });
});

test("ShaderProgram caches uniforms and ignores unknown names", () => {
    const gl = document.createElement("canvas").getContext("webgl");
    const p = new ShaderProgram(gl, "attribute vec3 a_position; uniform float u_k; void main(){ gl_Position = vec4(a_position * u_k, 1.0); }",
        "uniform vec4 u_color; void main(){ gl_FragColor = u_color; }");
    p.use().set("u_k", 2).set("u_color", [1, 0, 0, 1]).set("u_notThere", 5);
    assert(p.has("u_k") && p.has("u_color") && !p.has("u_notThere"));
    assert(gl.getError() === gl.NO_ERROR);
});

// ------------------------------------------------------------------ Renderer

function offscreen(w = 128, h = 128) {
    const c = document.createElement("canvas");
    c.style.cssText = `position:fixed;left:-9999px;width:${w}px;height:${h}px`;
    document.body.appendChild(c);
    return c;
}

function centrePixel(gl) {
    const px = new Uint8Array(4);
    gl.readPixels(gl.drawingBufferWidth >> 1, gl.drawingBufferHeight >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
}

for (const webgl2 of [true, false]) {
    test(`Renderer draws a lit mesh (${webgl2 ? "WebGL2" : "WebGL1 fallback"})`, () => {
        const canvas = offscreen();
        const r = new Renderer(canvas, { preferWebGL2: webgl2, preserveDrawingBuffer: true, autoResize: false });
        assert(r.caps.webgl2 === webgl2 || !webgl2, "context type");
        const scene = new Scene(); scene.clearColor.set([0, 0, 0, 1]);
        scene.add(new Entity({ mesh: new Mesh(primitives.sphere(1), new BasicMaterial({ color: [1, 0.2, 0.2] })) }));
        const cam = new Camera({ distance: 4, pitch: 0.3 }); cam.update(0);
        r.render(scene, cam);
        const px = centrePixel(r.gl);
        assert(px[0] > 40 && px[0] > px[2], `centre pixel is lit red, got ${px}`);
        assert(r.stats.drawCalls === 1, "one draw call");
        assert(r.gl.getError() === r.gl.NO_ERROR, "no GL error");
        r.dispose(); canvas.remove();
    });

    test(`InstancedMesh: 100k cubes in one draw call (${webgl2 ? "WebGL2" : "WebGL1 fallback"})`, () => {
        const canvas = offscreen();
        const r = new Renderer(canvas, { preferWebGL2: webgl2, preserveDrawingBuffer: true, autoResize: false });
        const scene = new Scene();
        const N = 100000, mesh = new InstancedMesh(primitives.box(1, 1, 1), new BasicMaterial({ color: [0.2, 1, 0.3] }), N);
        for (let i = 0; i < N; i++) mesh.setTransform(i, (i % 316) - 158, Math.floor(i / 316) - 158, 0);
        scene.add(new Entity({ mesh }));
        const cam = new Camera({ distance: 400, pitch: 1.2 }); cam.update(0);
        r.render(scene, cam);
        assert(r.stats.drawCalls === 1, "one draw call");
        assert(r.stats.instances === N, "all instances");
        assert(r.stats.triangles === 12 * N, "triangles counted");
        assert(r.gl.getError() === r.gl.NO_ERROR, "no GL error");
        const px = centrePixel(r.gl);
        assert(px[1] > 60, `centre shows green cubes, got ${px}`);
        r.dispose(); canvas.remove();
    });
}

test("Renderer: transparent objects draw after opaque, back to front", () => {
    const canvas = offscreen();
    const r = new Renderer(canvas, { autoResize: false });
    const scene = new Scene();
    const order = [];
    const mk = (name, z, transparent) => {
        const e = scene.add(new Entity({ name, mesh: new Mesh(primitives.box(), new BasicMaterial({ opacity: transparent ? 0.5 : 1 })) }));
        e.setPosition(0, z, 0);
        const orig = e.mesh.bindVAO.bind(e.mesh);
        e.mesh.bindVAO = (gl) => { order.push(name); orig(gl); };
        return e;
    };
    mk("near-glass", -2, true); mk("solid", 0, false); mk("far-glass", 5, true);
    const cam = new Camera({ distance: 20, yaw: -Math.PI / 2, pitch: 0 }); cam.update(0);
    r.render(scene, cam);
    assert(order.join(",") === "solid,far-glass,near-glass", `draw order ${order}`);
    r.dispose(); canvas.remove();
});

// ------------------------------------------------------------------ Space compatibility (Prime Walk, OBJ viewer, Neon Rush)

test("Space compat: addStructure / addElements / clearScene / moveStructure / reDraw", () => {
    const canvas = offscreen();
    const gl = canvas.getContext("webgl", { preserveDrawingBuffer: true });
    canvas.width = canvas.height = 64;
    const space = new Space(gl);
    const tri = [0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 1];
    const col = [1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1];
    const s = { vertArrays: tri.slice(), colArr: col.slice(), startVertId: 0, endVertId: 3, minX: 0, maxX: 1, minY: 0, maxY: 0, minZ: 0, maxZ: 1 };
    space.addStructure(s);
    space.addElements(tri, col);
    assert(space.totalVert === 6, "vertex count");
    assert(s.startVertId === 0 && s.endVertId === 3, "structure range");
    space.moveStructure(s, 1, 2, 3);
    near(space.posArr[0], 1); near(space.posArr[1], 2); near(space.posArr[2], 3);
    assert(space.dirty, "moveStructure marks dirty");
    space.reDraw();
    assert(gl.getError() === gl.NO_ERROR, "no GL error after reDraw");
    space.addElements(tri, col); space.reDraw();
    assert(space.uploadedLen === space.posArr.length, "tail upload");
    space.clearScene(); space.reDraw();
    assert(space.totalVert === 0 && gl.getError() === gl.NO_ERROR, "cleared");
    canvas.remove();
});

test("Space compat: subclass swaps in its own program (Neon Rush pattern)", () => {
    const canvas = offscreen();
    const gl = canvas.getContext("webgl", { preserveDrawingBuffer: true });
    canvas.width = canvas.height = 64;
    class Custom extends Space {
        constructor(g) {
            super(g);
            const vs = Space.compileShader(g, g.VERTEX_SHADER, "attribute vec4 pos; attribute vec4 col; varying vec4 v; uniform vec3 cPoint; uniform vec3 xAxis; uniform vec3 yAxis; uniform vec3 zAxis; uniform vec3 veriables; void main(){ v = col; vec3 d = pos.xyz - cPoint; gl_Position = vec4(-dot(d,xAxis)*veriables.y, dot(d,yAxis)*veriables.y, 0.0, dot(d,zAxis)); }");
            const fs = Space.compileShader(g, g.FRAGMENT_SHADER, "precision mediump float; varying vec4 v; void main(){ gl_FragColor = v; }");
            const p = g.createProgram(); g.attachShader(p, vs); g.attachShader(p, fs); g.linkProgram(p);
            this.program = p;
            this.posId = g.getAttribLocation(p, "pos"); this.colId = g.getAttribLocation(p, "col");
            g.enableVertexAttribArray(this.posId); g.enableVertexAttribArray(this.colId);
            for (const [f, n] of [["cPointLoc", "cPoint"], ["xAxisLoc", "xAxis"], ["yAxisLoc", "yAxis"], ["zAxisLoc", "zAxis"], ["varsLocation", "veriables"]]) this[f] = g.getUniformLocation(p, n);
            this.vPointLoc = null;
        }
    }
    const space = new Custom(gl);
    space.X0 = 0; space.Y0 = 0; space.Z0 = 0; space.alpha = -Math.PI / 2; space.beta = 0.2; space.Rc = 5; space.updateCameraPosition();
    const big = [-3, -3, 0, 1, 3, -3, 0, 1, 0, 3, 0, 1];
    space.addElements(big, [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
    space.reDraw();
    assert(gl.getError() === gl.NO_ERROR, "no GL error");
    const px = centrePixel(gl);
    assert(px[1] > 200, `custom program drew green, got ${px}`);
    canvas.remove();
});
