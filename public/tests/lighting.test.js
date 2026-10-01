import { test, assert, near, nearVec } from "./runner.js";
import { Renderer, Scene, Entity, Mesh, Camera, PostFX, primitives, StandardMaterial, Texture, ShadowMap, SkinnedMesh,
    Skeleton, AnimationClip, Animator, PATH, Geometry, parseGLTF } from "../engine/index.js";

/**
 * Tests for the light system, textures, skinning and the glTF loader.
 * @module tests/lighting
 */

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

test("Geometry.merge joins parts, applies matrices and tints", () => {
    const a = primitives.box(1, 1, 1), b = primitives.box(1, 1, 1);
    const move = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1]);
    const g = Geometry.merge([{ geometry: a, color: [1, 0, 0] }, { geometry: b, matrix: move, color: [0, 0, 1, 2] }]);
    assert(g.vertexCount === 48 && g.indices.length === 72, "counts add up");
    near(g.boundsMax[0], 5.5, 1e-6, "second box moved");
    nearVec(g.colors.subarray(0, 4), [1, 0, 0, 1], 1e-6, "first tint");
    nearVec(g.colors.subarray(24 * 4, 24 * 4 + 4), [0, 0, 1, 2], 1e-6, "second tint keeps alpha");
    assert(g.indices[36] === 24, "indices offset into the second part");
});

function twoJointSkeleton() {
    // joint 1 sits 2 units above joint 0
    const rest = new Float32Array([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 2, 0, 0, 0, 1, 1, 1, 1]);
    const inverseBind = new Float32Array(32);
    inverseBind.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 0);
    inverseBind.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -2, 1], 16);
    return new Skeleton({ names: ["a", "b"], parents: [-1, 0], rest, inverseBind });
}

test("Animator: rest pose skins to identity; a rotated parent carries its child", () => {
    const sk = twoJointSkeleton();
    const h = Math.SQRT1_2;     // quaternion for 90° about X: (sin 45°, 0, 0, cos 45°)
    const clip = new AnimationClip("bend", [{ joint: 0, path: PATH.rotation, times: new Float32Array([0, 1]), values: new Float32Array([0, 0, 0, 1, h, 0, 0, h]) }]);
    const an = new Animator(sk, [clip]);
    nearVec(an.matrices.subarray(16, 32), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 1e-6, "identity at rest");
    an.play("bend", { loop: false, fade: 0 });
    an.update(1);
    assert(an.finished, "non-looping clip finished");
    // 90° about X turns the child offset (0, 0, 2) into (0, -2, 0)
    nearVec(an.jointMatrix(1).subarray(12, 15), [0, -2, 0], 1e-5, "child position");
    near(an.matrices.length, 32 * 16, 0, "always maxJoints matrices");
});

test("Animator cross-fades between clips", () => {
    const sk = twoJointSkeleton();
    const mk = (name, x) => new AnimationClip(name, [{ joint: 1, path: PATH.translation, times: new Float32Array([0, 1]), values: new Float32Array([x, 0, 2, x, 0, 2]) }]);
    const an = new Animator(sk, [mk("left", -1), mk("right", 1)]);
    an.play("left", { fade: 0 }); an.update(0.1);
    near(an.pose[10], -1, 1e-6, "left pose");
    an.play("right", { fade: 1 }); an.update(0.5);
    near(an.pose[10], 0, 1e-6, "half-way through the fade");
    an.update(0.6);
    near(an.pose[10], 1, 1e-6, "fade complete");
});

/** A minimal .glb: one triangle with vertex colours, skinned to two joints, with one animation. */
function tinyGLB() {
    const f32 = (a) => new Uint8Array(new Float32Array(a).buffer), u16 = (a) => new Uint8Array(new Uint16Array(a).buffer), u8 = (a) => new Uint8Array(a);
    const chunks = [
        f32([0, 0, 0, 1, 0, 0, 0, 1, 0]),                                   // 0 positions
        f32([1, 0, 0, 0, 1, 0, 0, 0, 1]),                                   // 1 colours (RGB)
        u8([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),                           // 2 joints
        f32([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),                          // 3 weights
        u16([0, 1, 2, 0]),                                                  // 4 indices (padded)
        f32([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),   // 5 inverse binds, in skin order: tip, root
        f32([0, 1]),                                                        // 6 times
        f32([0, 1, 0, 0, 3, 0]),                                            // 7 translations
    ];
    let offset = 0;
    const views = chunks.map((c) => { const v = { buffer: 0, byteOffset: offset, byteLength: c.length }; offset += c.length; return v; });
    const bin = new Uint8Array(offset);
    chunks.forEach((c, i) => bin.set(c, views[i].byteOffset));
    const json = {
        asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0, 3] }],
        // the skin lists the child joint first, to exercise the parent-first reordering
        nodes: [{ name: "armature", children: [1] }, { name: "root", children: [2] }, { name: "tip", translation: [0, 1, 0] }, { name: "body", mesh: 0, skin: 0 }],
        meshes: [{ name: "tri", primitives: [{ attributes: { POSITION: 0, COLOR_0: 1, JOINTS_0: 2, WEIGHTS_0: 3 }, indices: 4, material: 0 }] }],
        materials: [{ name: "paint", pbrMetallicRoughness: { baseColorFactor: [0.5, 1, 1, 1] }, doubleSided: true }],
        skins: [{ joints: [2, 1], inverseBindMatrices: 5 }],
        animations: [{ name: "lift", channels: [{ sampler: 0, target: { node: 2, path: "translation" } }], samplers: [{ input: 6, output: 7 }] }],
        buffers: [{ byteLength: bin.length }], bufferViews: views,
        accessors: [
            { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }, { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" },
            { bufferView: 2, componentType: 5121, count: 3, type: "VEC4" }, { bufferView: 3, componentType: 5126, count: 3, type: "VEC4" },
            { bufferView: 4, componentType: 5123, count: 3, type: "SCALAR" }, { bufferView: 5, componentType: 5126, count: 2, type: "MAT4" },
            { bufferView: 6, componentType: 5126, count: 2, type: "SCALAR" }, { bufferView: 7, componentType: 5126, count: 2, type: "VEC3" },
        ],
    };
    let text = JSON.stringify(json);
    while (text.length % 4) text += " ";
    const jsonBytes = new TextEncoder().encode(text);
    const out = new ArrayBuffer(12 + 8 + jsonBytes.length + 8 + bin.length), dv = new DataView(out), bytes = new Uint8Array(out);
    dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.byteLength, true);
    dv.setUint32(12, jsonBytes.length, true); dv.setUint32(16, 0x4e4f534a, true); bytes.set(jsonBytes, 20);
    const b = 20 + jsonBytes.length;
    dv.setUint32(b, bin.length, true); dv.setUint32(b + 4, 0x004e4942, true); bytes.set(bin, b + 8);
    return out;
}

test("parseGLTF reads a .glb: mesh, colours, material, skin, animation", async () => {
    const asset = await parseGLTF(tinyGLB());
    const prim = asset.mesh("tri");
    assert(prim && prim.geometry.vertexCount === 3 && prim.geometry.indices.length === 3, "one triangle");
    nearVec(prim.geometry.colors.subarray(0, 4), [1, 0, 0, 1], 1e-6, "RGB colours padded to RGBA");
    assert(prim.material instanceof StandardMaterial && prim.material.vertexColors && prim.material.cull === "none", "material options");
    nearVec(prim.material.color, [0.5, 1, 1], 1e-6, "base colour");
    const sk = asset.skeleton;
    assert(sk.count === 2 && sk.names[0] === "root" && sk.names[1] === "tip" && sk.parents[1] === 0, `joints reordered parent-first: ${sk.names}`);
    // vertex 1 was bound to skin slot 1 (the root), which is joint 0 after reordering
    assert(prim.geometry.joints[4] === 0 && prim.geometry.joints[0] === 1, "vertex joints re-mapped");
    near(sk.inverseBind[16 + 13], -1, 1e-6, "inverse bind followed its joint");
    assert(asset.clips.length === 1 && asset.clip("lift").duration === 1, "clip");
    const root = asset.instantiate();
    assert(root.animator && root.children.some((c) => c.mesh instanceof SkinnedMesh), "instance has a skinned mesh and an animator");
    root.animator.play("lift", { fade: 0, loop: false }); root.animator.update(1);
    near(root.animator.jointMatrix(1)[13], 3, 1e-5, "animated joint moved");
});

test("StandardMaterial: texture, sun shadow and point light", () => {
    const canvas = offscreen();
    const r = new Renderer(canvas, { preserveDrawingBuffer: true, autoResize: false });
    const scene = new Scene(); scene.clearColor.set([0, 0, 0, 1]);
    scene.sunDirection.set([0, 0, 1]); scene.sunColor.set([1, 1, 1]); scene.skyColor.set([0, 0, 0]); scene.groundColor.set([0, 0, 0]);
    const floor = scene.add(new Entity({ mesh: new Mesh(primitives.plane(20, 20), new StandardMaterial({ map: Texture.solid([1, 0, 0, 1]) })) }));
    // the camera sits low, under where the slab will be, looking down at the floor
    const cam = new Camera({ distance: 2, pitch: 1.5, target: [0, 0, 0] }); cam.update(0);
    r.render(scene, cam);
    const lit = centrePixel(r.gl);
    assert(lit[0] > 200 && lit[1] < 30, `floor is lit and red from its texture, got ${lit}`);

    const slab = scene.add(new Entity({ mesh: new Mesh(primitives.box(4, 4, 0.2), new StandardMaterial({ color: [0, 1, 0] })) }));
    slab.setPosition(0, 0, 3);
    scene.shadow = new ShadowMap({ center: [0, 0, 0], extent: [10, 10], depth: 40, size: 512, strength: 1 });
    r.render(scene, cam);
    assert(r.stats.shadowCalls === 2, `shadow pass drew both casters (${r.stats.shadowCalls})`);
    if (scene.shadow.supported) {
        const shadowed = centrePixel(r.gl);
        assert(shadowed[0] < 40, `floor under the slab is in shadow, got ${shadowed}`);
    }
    // a caster that never moves is drawn into the shadow map once and kept
    slab.staticShadow = true;
    scene.shadow.cache = true;
    r.render(scene, cam);
    if (r.caps.webgl2) {
        assert(scene.shadow.staticRedraws === 1, "static caster drawn into the kept copy");
        r.render(scene, cam);
        assert(r.stats.shadowCalls === 1 && scene.shadow.staticRedraws === 1, `second frame draws only the mover (${r.stats.shadowCalls})`);
        if (scene.shadow.supported) assert(centrePixel(r.gl)[0] < 40, "the kept shadow is still there");
        slab.setPosition(40, 0, 3);
        r.render(scene, cam);
        assert(scene.shadow.staticRedraws === 2, "moving a static caster redraws the kept copy");
        if (scene.shadow.supported) assert(centrePixel(r.gl)[0] > 200, "and its shadow moved away with it");
        slab.setPosition(0, 0, 3);
        r.render(scene, cam);
    }
    slab.staticShadow = false; scene.shadow.cache = false;
    scene.shadow.enabled = false;
    r.render(scene, cam);
    assert(centrePixel(r.gl)[0] > 200, "lit again with shadows off");

    scene.sunColor.set([0, 0, 0]);
    scene.pointLights.push({ position: [0, 0, 1], color: [0, 0, 4], radius: 6 });
    floor.mesh.material.map = null; floor.mesh.material.invalidateProgram();
    r.render(scene, cam);
    const blue = centrePixel(r.gl);
    assert(blue[2] > 150 && blue[0] < 30, `the point light alone lights the floor blue, got ${blue}`);
    assert(r.gl.getError() === r.gl.NO_ERROR, "no GL error");
    r.dispose(); canvas.remove();
});

for (const webgl2 of [true, false]) {
    test(`Skinned mesh + shadows + ambient occlusion render without GL errors (${webgl2 ? "WebGL2" : "WebGL1"})`, () => {
        const canvas = offscreen(160, 90);
        const r = new Renderer(canvas, { preferWebGL2: webgl2, preserveDrawingBuffer: true, autoResize: false });
        r.postfx = new PostFX(r, { ao: { enabled: true } });
        const scene = new Scene();
        scene.shadow = new ShadowMap({ size: 256 });
        const geo = primitives.box(1, 1, 2);
        geo.joints = new Float32Array(geo.vertexCount * 4);
        geo.weights = new Float32Array(geo.vertexCount * 4);
        for (let i = 0; i < geo.vertexCount; i++) { geo.joints[i * 4] = geo.positions[i * 3 + 2] > 0 ? 1 : 0; geo.weights[i * 4] = 1; }
        const an = new Animator(twoJointSkeleton());
        scene.add(new Entity({ mesh: new SkinnedMesh(geo, new StandardMaterial({ color: [1, 0.5, 0.2] }), an) }));
        scene.add(new Entity({ mesh: new Mesh(primitives.plane(10, 10), new StandardMaterial()) }));
        const cam = new Camera({ distance: 8, pitch: 0.6 }); cam.update(0);
        r.render(scene, cam);
        assert(r.gl.getError() === r.gl.NO_ERROR, "no GL error");
        assert(r.stats.drawCalls === 2, "two draw calls");
        const px = centrePixel(r.gl);
        assert(px[0] > 60, `skinned box visible at the centre, got ${px}`);
        if (r.postfx.aoSupported) assert(r.stats.postPasses >= 10, `occlusion passes ran (${r.stats.postPasses})`);
        r.dispose(); canvas.remove();
    });
}
