import { test, assert, near, nearVec } from "./runner.js";
import { Renderer, Scene, Entity, Mesh, InstancedMesh, SkinnedMesh, Camera, Game, PostFX, primitives, Geometry, BasicMaterial,
    StandardMaterial, PBRMaterial, Texture, ShadowMap, Skeleton, Animator, parseGLTF, Input, TouchControls, DebugOverlay,
    raycast, raySphere, rayAABB, rayPlane, rayTriangle, sphereSphere, aabbAABB, sphereAABB, slideCircle, POSE_STRIDE } from "../engine/index.js";

/**
 * Tests for the parts that let a scene grow: frustum culling, levels of detail, cascaded shadows,
 * physically based materials and normal maps, big skeletons, the glTF additions, collision and touch input.
 * @module tests/world
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

/** The pixel a world point lands on. */
function pixelAt(r, cam, point) {
    const w = r.gl.drawingBufferWidth, h = r.gl.drawingBufferHeight, p = cam.project(point, w, h), px = new Uint8Array(4);
    assert(p.visible && p.x >= 0 && p.x < w && p.y >= 0 && p.y < h, `point ${point} is on screen`);
    r.gl.readPixels(Math.round(p.x), Math.round(h - 1 - p.y), 1, 1, r.gl.RGBA, r.gl.UNSIGNED_BYTE, px);
    return px;
}

function plainScene() {
    const scene = new Scene();
    scene.clearColor.set([0, 0, 0, 1]);
    scene.sunDirection.set([0, 0, 1]); scene.sunColor.set([1, 1, 1]); scene.skyColor.set([0, 0, 0]); scene.groundColor.set([0, 0, 0]);
    return scene;
}

// ------------------------------------------------------------------ culling and levels of detail

test("Frustum culling skips meshes outside the view but keeps their shadows", () => {
    const canvas = offscreen();
    const r = new Renderer(canvas, { preserveDrawingBuffer: true, autoResize: false });
    const scene = plainScene();
    scene.skyColor.set([0.5, 0.5, 0.5]); scene.groundColor.set([0.5, 0.5, 0.5]);      // the camera looks at faces the sun misses
    const box = () => new Mesh(primitives.box(1, 1, 1), new StandardMaterial({ color: [1, 1, 1] }));
    const ahead = scene.add(new Entity({ mesh: box() }));
    const behind = scene.add(new Entity({ mesh: box() })); behind.setPosition(0, -40, 0);     // the camera looks along +Y from y = -10
    const aside = scene.add(new Entity({ mesh: box() })); aside.setPosition(60, 0, 0);
    const cam = new Camera({ distance: 10, pitch: 0, target: [0, 0, 0] }); cam.update(0);
    r.render(scene, cam);
    assert(r.stats.drawCalls === 1 && r.stats.culled === 2, `one drawn, two culled (${r.stats.drawCalls}, ${r.stats.culled})`);
    assert(centrePixel(r.gl)[0] > 30, "the box ahead is on screen");

    aside.setPosition(5.2, 0, 0);       // its centre is just off screen, its sphere is not
    r.render(scene, cam);
    assert(r.stats.culled === 1, "a sphere that straddles the edge is kept");
    aside.setPosition(60, 0, 0);

    behind.frustumCulled = false;
    r.render(scene, cam);
    assert(r.stats.drawCalls === 2, "frustumCulled = false opts an entity out");
    behind.frustumCulled = true;

    r.frustumCulling = false;
    r.render(scene, cam);
    assert(r.stats.drawCalls === 3 && r.stats.culled === 0, "culling can be switched off");
    r.frustumCulling = true;

    scene.shadow = new ShadowMap({ center: [0, 0, 0], extent: [70, 70], depth: 40, size: 256 });
    r.render(scene, cam);
    assert(r.stats.drawCalls === 1 && r.stats.shadowCalls === 3, `off-screen casters still reach the shadow map (${r.stats.shadowCalls})`);
    scene.shadow.extent.set([8, 8]);
    r.render(scene, cam);
    assert(r.stats.shadowCalls === 1, `casters outside the sun's box are skipped (${r.stats.shadowCalls})`);

    // instanced meshes have no bounds of their own: always drawn, unless the entity is given a radius
    const many = new InstancedMesh(primitives.box(1, 1, 1), new BasicMaterial(), 4);
    const crowd = scene.add(new Entity({ mesh: many })); crowd.setPosition(0, -60, 0);
    scene.shadow = null;
    r.render(scene, cam);
    assert(r.stats.drawCalls === 2, "an instanced mesh behind the camera is drawn by default");
    crowd.cullRadius = 5;
    r.render(scene, cam);
    assert(r.stats.drawCalls === 1, "and culled once it has a cullRadius");
    assert(r.gl.getError() === r.gl.NO_ERROR, "no GL error");
    r.dispose(); canvas.remove();
});

test("Geometry bounds follow markDirty()", () => {
    const g = primitives.box(2, 2, 2);
    near(g.boundingRadius, Math.sqrt(3), 1e-6, "half the diagonal");
    for (let i = 0; i < g.positions.length; i += 3) g.positions[i] += 10;
    g.markDirty();
    nearVec(g.freshBounds().boundsCenter, [10, 0, 0], 1e-6, "centre moved with the vertices");
});

test("Entity.lod picks a mesh by distance", () => {
    const canvas = offscreen();
    const r = new Renderer(canvas, { autoResize: false });
    const scene = plainScene();
    const fine = new Mesh(primitives.sphere(1, 32, 24), new BasicMaterial()), coarse = new Mesh(primitives.sphere(1, 8, 6), new BasicMaterial());
    const e = scene.add(new Entity({ lod: [{ distance: 0, mesh: fine }, { distance: 20, mesh: coarse }, { distance: 60, mesh: null }] }));
    const cam = new Camera({ distance: 5, pitch: 0.2 });
    cam.update(0); r.render(scene, cam);
    assert(e.mesh === fine && r.stats.triangles > 1000, "close: the fine mesh");
    cam.distance = 30; cam.update(0); r.render(scene, cam);
    assert(e.mesh === coarse && r.stats.triangles < 200, `further: the coarse mesh (${r.stats.triangles} triangles)`);
    cam.distance = 80; cam.update(0); r.render(scene, cam);
    assert(e.mesh === null && r.stats.drawCalls === 0, "beyond the last level: nothing");
    r.dispose(); canvas.remove();
});

// ------------------------------------------------------------------ cascaded shadows

for (const webgl2 of [true, false]) {
    test(`Cascaded shadows reach from the camera's feet to the distance (${webgl2 ? "WebGL2" : "WebGL1"})`, () => {
        const canvas = offscreen(256, 256);
        const r = new Renderer(canvas, { preferWebGL2: webgl2, preserveDrawingBuffer: true, autoResize: false, antialias: false });
        const scene = plainScene();
        scene.add(new Entity({ mesh: new Mesh(primitives.plane(600, 600), new StandardMaterial({ color: [1, 1, 1] })) }));
        const slab = (x, y, size) => { const e = scene.add(new Entity({ mesh: new Mesh(primitives.box(size, size, 0.2), new StandardMaterial({ color: [0, 1, 0] })) })); e.setPosition(x, y, 3); return e; };
        slab(0, 0, 4);          // over the point the camera looks at
        slab(0, 60, 8);         // 70 units away
        const shadow = (scene.shadow = new ShadowMap({ cascades: 3, distance: 120, size: 512, strength: 1 }));
        const cam = new Camera({ distance: 10, pitch: 0.5, target: [0, 0, 0] }); cam.update(0);
        r.render(scene, cam);
        assert(r.gl.getError() === r.gl.NO_ERROR, "no GL error");
        assert(shadow.activeCascades === 3, "three cascades fitted");
        const d = shadow.cascadeData;
        assert(d[0] > cam.near && d[4] > d[0] && d[8] > d[4], `slices get further away: ${d[0].toFixed(1)}, ${d[4].toFixed(1)}, ${d[8].toFixed(1)}`);
        near(d[8], 120, 1e-3, "the last one ends at `distance`");
        assert(d[0] < 30, `the first slice is short, so it is sharp (${d[0].toFixed(1)})`);
        if (shadow.supported) {
            assert(pixelAt(r, cam, [0, 0, 0])[0] < 40, `shadow under the near slab, got ${pixelAt(r, cam, [0, 0, 0])}`);
            assert(pixelAt(r, cam, [0, 60, 0])[0] < 40, `shadow under the far slab, got ${pixelAt(r, cam, [0, 60, 0])}`);
            assert(pixelAt(r, cam, [5, 4, 0])[0] > 200, `open floor is lit, got ${pixelAt(r, cam, [5, 4, 0])}`);
            assert(pixelAt(r, cam, [12, 40, 0])[0] > 200, `far open floor is lit, got ${pixelAt(r, cam, [12, 40, 0])}`);
        }
        // the box is the same size whichever way the camera faces, and moves in whole texels
        const size = Math.hypot(shadow.matrices[0], shadow.matrices[4], shadow.matrices[8]);
        cam.yaw += 0.7; cam.update(0); r.render(scene, cam);
        near(Math.hypot(shadow.matrices[0], shadow.matrices[4], shadow.matrices[8]), size, 1e-6, "turning the camera doesn't resize the box");
        // back to one fixed box: the atlas is rebuilt at the new width
        shadow.cascades = 0; shadow.center.set([0, 0, 0]); shadow.extent.set([10, 10]);
        cam.yaw -= 0.7; cam.update(0); r.render(scene, cam);
        assert(shadow.activeCascades === 0 && r.gl.getError() === r.gl.NO_ERROR, "switching back to a fixed box works");
        if (shadow.supported) assert(pixelAt(r, cam, [0, 0, 0])[0] < 40, "and still shadows");
        r.dispose(); canvas.remove();
    });
}

// ------------------------------------------------------------------ materials

test("Normal map tilts the lighting; tangents are made when missing", () => {
    const canvas = offscreen();
    const r = new Renderer(canvas, { preserveDrawingBuffer: true, autoResize: false });
    const scene = plainScene();
    scene.sunDirection.set([Math.SQRT1_2, 0, Math.SQRT1_2]);      // 45° from straight above, from +X
    const geo = primitives.plane(10, 10);
    const mat = new StandardMaterial({ color: [1, 1, 1] });
    scene.add(new Entity({ mesh: new Mesh(geo, mat) }));
    const cam = new Camera({ distance: 5, pitch: 1.5 }); cam.update(0);
    r.render(scene, cam);
    const flat = centrePixel(r.gl)[0];
    // a map that says "the surface leans 37° toward +U everywhere": direction (0.6, 0, 0.8) stored as a colour
    mat.normalMap = Texture.solid([0.8, 0.5, 0.9, 1]);
    mat.invalidateProgram();
    r.render(scene, cam);
    const bumped = centrePixel(r.gl)[0];
    assert(geo.tangents && geo.tangents.length === geo.vertexCount * 4, "tangents were computed");
    nearVec(geo.tangents.subarray(0, 4), [1, 0, 0, 1], 1e-6, "tangent runs along U, right-handed");
    assert(bumped > flat + 30, `leaning toward the sun is brighter (${flat} → ${bumped})`);
    assert(r.gl.getError() === r.gl.NO_ERROR, "no GL error");
    r.dispose(); canvas.remove();
});

for (const webgl2 of [true, false]) {
    test(`PBRMaterial: metal and plastic, lit by sun, lamp and sky (${webgl2 ? "WebGL2" : "WebGL1"})`, () => {
        const canvas = offscreen();
        const r = new Renderer(canvas, { preferWebGL2: webgl2, preserveDrawingBuffer: true, autoResize: false });
        const scene = plainScene();
        scene.skyColor.set([0.2, 0.3, 0.5]); scene.groundColor.set([0.1, 0.08, 0.06]);
        scene.sunDirection.set([0.3, -0.6, 0.74]);
        scene.pointLights.push({ position: [2, -2, 2], color: [1, 0.4, 0.2], radius: 8 });
        scene.shadow = new ShadowMap({ size: 256 });
        const mat = new PBRMaterial({ color: [1, 0.2, 0.2], metallic: 0, roughness: 0.5, metallicRoughnessMap: Texture.solid([1, 1, 1, 1]), normalMap: Texture.solid([0.5, 0.5, 1, 1]) });
        scene.add(new Entity({ mesh: new Mesh(primitives.sphere(1, 24, 16), mat) }));
        const cam = new Camera({ distance: 4, pitch: 0.4 }); cam.update(0);
        r.render(scene, cam);
        assert(r.gl.getError() === r.gl.NO_ERROR, "no GL error");
        const plastic = centrePixel(r.gl);
        assert(plastic[0] > 60 && plastic[0] > plastic[2], `red plastic is lit red, got ${plastic}`);
        mat.metallic = 1; mat.roughness = 0.3;
        r.render(scene, cam);
        const metal = centrePixel(r.gl);
        assert(Math.abs(metal[0] - plastic[0]) + Math.abs(metal[1] - plastic[1]) + Math.abs(metal[2] - plastic[2]) > 12, `metal looks different from plastic (${plastic} vs ${metal})`);
        const d = mat.defines();
        assert(d.PBR && d.MR_MAP && d.NORMAL_MAP && d.UV && !d.MAP, "defines");
        r.dispose(); canvas.remove();
    });
}

test("Instanced meshes shade correctly under non-uniform scale", () => {
    const canvas = offscreen();
    const r = new Renderer(canvas, { preserveDrawingBuffer: true, autoResize: false });
    const scene = plainScene();
    scene.sunDirection.set([Math.SQRT1_2, 0, Math.SQRT1_2]);
    // a sphere squashed flat along Z is nearly a disc: seen from above, its middle faces straight up
    const mesh = new InstancedMesh(primitives.sphere(1, 32, 24), new StandardMaterial({ color: [1, 1, 1] }), 1);
    mesh.setTransform(0, 0.35, 0, 0, 1, 1, 0.05);
    scene.add(new Entity({ mesh }));
    const cam = new Camera({ distance: 6, pitch: 1.5 }); cam.update(0);
    r.render(scene, cam);
    // at x = 0.35 the true normal of the disc still points almost straight up: N·L ≈ 0.71 → about 180.
    // Shading with the plain model matrix would lean it toward +X and give about 240.
    const px = centrePixel(r.gl)[0];
    assert(px > 150 && px < 210, `flat top shades as flat, got ${px}`);
    r.dispose(); canvas.remove();
});

test("PostFX: Reinhard tone map and saturation", () => {
    const canvas = offscreen();
    const r = new Renderer(canvas, { preserveDrawingBuffer: true, autoResize: false });
    r.postfx = new PostFX(r, { bloom: { enabled: false }, vignette: 0, grain: 0, antialias: false, tonemap: "reinhard", saturation: 0 });
    const scene = plainScene();
    scene.add(new Entity({ mesh: new Mesh(primitives.sphere(1), new BasicMaterial({ color: [1, 0, 0], lit: false })) }));
    const cam = new Camera({ distance: 3 }); cam.update(0);
    r.render(scene, cam);
    const grey = centrePixel(r.gl);
    assert(Math.abs(grey[0] - grey[1]) < 3 && Math.abs(grey[1] - grey[2]) < 3 && grey[0] > 10, `saturation 0 is grey, got ${grey}`);
    r.postfx.settings.saturation = 1;
    r.render(scene, cam);
    const red = centrePixel(r.gl);
    assert(red[0] > 110 && red[0] < 140 && red[1] < 5, `Reinhard maps 1.0 to 0.5, got ${red}`);
    assert(r.gl.getError() === r.gl.NO_ERROR, "no GL error");
    r.dispose(); canvas.remove();
});

// ------------------------------------------------------------------ big skeletons

test("A 40-joint skeleton skins through the joint texture, shadows included", () => {
    const canvas = offscreen();
    const r = new Renderer(canvas, { preserveDrawingBuffer: true, autoResize: false });
    if (!r.caps.webgl2 && !r.gl.getExtension("OES_texture_float")) { r.dispose(); canvas.remove(); return; }
    const N = 40, rest = new Float32Array(N * POSE_STRIDE), inverseBind = new Float32Array(N * 16), parents = [], names = [];
    for (let j = 0; j < N; j++) {
        rest.set([0, 0, 0, 0, 0, 0, 1, 1, 1, 1], j * POSE_STRIDE);
        inverseBind.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], j * 16);
        parents.push(j - 1); names.push("j" + j);
    }
    const an = new Animator(new Skeleton({ names, parents, rest, inverseBind }));
    assert(an.matrices.length === N * 16, "one matrix per joint");
    const geo = primitives.box(1, 1, 1);
    geo.joints = new Float32Array(geo.vertexCount * 4).fill(0); geo.weights = new Float32Array(geo.vertexCount * 4);
    for (let i = 0; i < geo.vertexCount; i++) { geo.joints[i * 4] = N - 1; geo.weights[i * 4] = 1; }      // everything follows the last joint
    const mesh = new SkinnedMesh(geo, new StandardMaterial({ color: [1, 1, 1] }), an);
    assert(mesh.usesJointTexture, "too many joints for a uniform array");
    const scene = plainScene();
    scene.skyColor.set([0.5, 0.5, 0.5]); scene.groundColor.set([0.5, 0.5, 0.5]);
    scene.shadow = new ShadowMap({ size: 256 });
    scene.add(new Entity({ mesh }));
    const cam = new Camera({ distance: 4, pitch: 0.6 }); cam.update(0);
    r.render(scene, cam);
    assert(r.gl.getError() === r.gl.NO_ERROR, "no GL error");
    assert(centrePixel(r.gl)[0] > 60, `box at rest is in the middle, got ${centrePixel(r.gl)}`);
    an.pose[(N - 1) * POSE_STRIDE] = 50;        // slide the last joint far along X
    an.solve();
    r.render(scene, cam);
    assert(centrePixel(r.gl)[0] < 10, `the box followed its joint out of view, got ${centrePixel(r.gl)}`);
    assert(r.gl.getError() === r.gl.NO_ERROR, "no GL error after the pose changed");
    r.dispose(); canvas.remove();
});

// ------------------------------------------------------------------ glTF additions

function glb(json, chunks) {
    let offset = 0;
    json.bufferViews = chunks.map((c) => { const v = { buffer: 0, byteOffset: offset, byteLength: c.length }; offset += c.length + ((4 - (c.length % 4)) % 4); return v; });
    const bin = new Uint8Array(offset);
    chunks.forEach((c, i) => bin.set(c, json.bufferViews[i].byteOffset));
    json.buffers = [{ byteLength: bin.length }];
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

test("parseGLTF: sparse accessors, morph targets, tangents and PBR materials", async () => {
    const f32 = (a) => new Uint8Array(new Float32Array(a).buffer), u8 = (a) => new Uint8Array(a);
    const file = glb({
        asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: "n", mesh: 0 }],
        meshes: [{ name: "tri", weights: [0.5], primitives: [{ attributes: { POSITION: 0, TANGENT: 3 }, targets: [{ POSITION: 1 }], material: 0 }] }],
        materials: [{ name: "steel", pbrMetallicRoughness: { baseColorFactor: [0.6, 0.6, 0.7, 1], metallicFactor: 0.9, roughnessFactor: 0.35 }, emissiveFactor: [1, 0.5, 0],
            extensions: { KHR_materials_emissive_strength: { emissiveStrength: 2 } } }],
        accessors: [
            { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
            // the morph target has no base data: all zeros, except vertex 2, which a sparse entry lifts by 4
            { componentType: 5126, count: 3, type: "VEC3", sparse: { count: 1, indices: { bufferView: 1, componentType: 5121 }, values: { bufferView: 2 } } },
            { bufferView: 2, componentType: 5126, count: 1, type: "VEC3" },
            { bufferView: 3, componentType: 5126, count: 3, type: "VEC4" },
        ],
    }, [f32([0, 0, 0, 1, 0, 0, 0, 1, 0]), u8([2]), f32([0, 0, 4]), f32([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1])]);

    const asset = await parseGLTF(file, { pbr: true });
    const { geometry, material } = asset.mesh("tri");
    assert(material instanceof PBRMaterial, "pbr: true makes PBRMaterials");
    near(material.metallic, 0.9, 1e-6, "metallic"); near(material.roughness, 0.35, 1e-6, "roughness");
    nearVec(material.emissive, [2, 1, 0], 1e-6, "emissive × strength");
    assert(geometry.tangents && geometry.tangents[3] === 1, "tangents read");
    assert(geometry.morphTargets.length === 1, "one shape key");
    nearVec(geometry.morphTargets[0].positions, [0, 0, 0, 0, 0, 0, 0, 0, 4], 1e-6, "sparse accessor filled in");
    near(geometry.positions[8], 2, 1e-6, "the file's default weight (0.5) is applied");
    geometry.applyMorph([1]);
    near(geometry.positions[8], 4, 1e-6, "full weight");
    geometry.applyMorph([0]);
    near(geometry.positions[8], 0, 1e-6, "back to the base shape");
    near(geometry.freshBounds().boundsMax[2], 0, 1e-6, "bounds follow the morph");

    const plain = await parseGLTF(file);
    assert(plain.mesh("tri").material instanceof StandardMaterial && !(plain.mesh("tri").material instanceof PBRMaterial), "StandardMaterial by default");
});

// ------------------------------------------------------------------ collision

test("Collision: rays against spheres, boxes, planes and triangles", () => {
    near(raySphere([0, -5, 0], [0, 1, 0], [0, 0, 0], 1), 4, 1e-9, "sphere hit");
    assert(raySphere([0, -5, 0], [0, -1, 0], [0, 0, 0], 1) === -1, "sphere behind the ray");
    assert(raySphere([0, 0, 0], [1, 0, 0], [0, 0, 0], 1) === 0, "starting inside");
    near(rayAABB([-5, 0.2, 0.2], [1, 0, 0], [-1, -1, -1], [1, 1, 1]), 4, 1e-9, "box hit");
    assert(rayAABB([-5, 2, 0], [1, 0, 0], [-1, -1, -1], [1, 1, 1]) === -1, "box miss");
    near(rayPlane([0, 0, 10], [0, 0, -1], [0, 0, 0], [0, 0, 1]), 10, 1e-9, "ground hit");
    assert(rayPlane([0, 0, 10], [1, 0, 0], [0, 0, 0], [0, 0, 1]) === -1, "parallel to the ground");
    near(rayTriangle([0.2, 0.2, 5], [0, 0, -1], [0, 0, 0], [1, 0, 0], [0, 1, 0]), 5, 1e-9, "triangle hit");
    assert(rayTriangle([0.8, 0.8, 5], [0, 0, -1], [0, 0, 0], [1, 0, 0], [0, 1, 0]) === -1, "outside the triangle");
});

test("Collision: overlaps and sliding", () => {
    assert(sphereSphere([0, 0, 0], 1, [1.5, 0, 0], 1) && !sphereSphere([0, 0, 0], 1, [2.5, 0, 0], 1), "spheres");
    assert(aabbAABB([0, 0, 0], [1, 1, 1], [0.5, 0.5, 0.5], [2, 2, 2]) && !aabbAABB([0, 0, 0], [1, 1, 1], [2, 0, 0], [3, 1, 1]), "boxes");
    const push = sphereAABB([1.3, 0, 0], 0.5, [-1, -1, -1], [1, 1, 1]);
    assert(push && push.x === 1, "pushed out along +X"); near(push.depth, 0.2, 1e-9, "by the overlap");
    assert(sphereAABB([3, 0, 0], 0.5, [-1, -1, -1], [1, 1, 1]) === null, "no touch");
    // a player walks diagonally into a wall: it stops going in, keeps going along
    const wall = [{ min: [1, -5, 0], max: [2, 5, 3] }], p = [0.9, 0.3, 0];
    assert(slideCircle(p, 0.4, wall), "touched");
    nearVec(p, [0.6, 0.3], 1e-9, "x pushed back to the wall's face, y untouched");
});

test("Scene.raycast finds the nearest mesh, triangle-accurate", () => {
    const scene = new Scene();
    const near1 = scene.add(new Entity({ name: "near", mesh: new Mesh(primitives.box(2, 2, 2), new BasicMaterial()) })); near1.setPosition(0, 5, 0);
    const far1 = scene.add(new Entity({ name: "far", mesh: new Mesh(primitives.box(2, 2, 2), new BasicMaterial()) })); far1.setPosition(0, 12, 0); far1.setScale(2);
    scene.root.updateWorldMatrix();
    const hits = scene.raycast({ origin: [0, 0, 0], direction: [0, 1, 0] });
    assert(hits.length === 2 && hits[0].entity === near1 && hits[1].entity === far1, "both, nearest first");
    near(hits[0].distance, 4, 1e-5, "front face of the near box"); near(hits[1].distance, 10, 1e-5, "front face of the scaled far box");
    nearVec(hits[0].point, [0, 4, 0], 1e-5, "hit point");
    // this ray passes through the near box's bounding sphere but beside the box itself
    const beside = { origin: [1.3, 0, 0], direction: [0, 1, 0] };
    assert(scene.raycast(beside).every((h) => h.entity !== near1), "triangle test rejects a near miss");
    assert(scene.raycast(beside, { precise: false }).some((h) => h.entity === near1), "sphere-only test accepts it");
    assert(scene.raycast({ origin: [0, 0, 0], direction: [0, 1, 0] }, { maxDistance: 6 }).length === 1, "maxDistance");
});

// ------------------------------------------------------------------ touch input and the debug panel

test("TouchControls drive Input axes and actions", () => {
    const input = new Input();
    input.bind("jump", ["Space", "TouchA"]);
    input.bindAxis("moveX", { negative: ["KeyA"], positive: ["KeyD"] });
    const touch = new TouchControls(input, { visible: true });
    const stick = touch.joystick({ x: "moveX", y: "moveY", size: 100 });
    const button = touch.button({ code: "TouchA", label: "A" });
    const fire = (el, type, x, y) => el.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: x, clientY: y, bubbles: true }));
    fire(stick.element, "pointerdown", 100, 400);
    fire(stick.element, "pointermove", 150, 375);          // 50 px right (the full radius), 25 px up
    near(input.axis("moveX"), 1 / Math.hypot(1, 0.5), 1e-6, "x from the stick, clamped to the unit circle");
    near(input.axis("moveY"), 0.5 / Math.hypot(1, 0.5), 1e-6, "up on screen is positive, even for an axis no key is bound to");
    fire(stick.element, "pointerup", 150, 375);
    assert(input.axis("moveX") === 0 && !stick.active, "released: back to centre");

    fire(button, "pointerdown", 0, 0);
    input.beginStep();
    assert(input.wasPressed("jump") && input.isDown("jump"), "button press reaches the action");
    input.endStep();
    fire(button, "pointerup", 0, 0);
    input.beginStep();
    assert(input.wasReleased("jump") && !input.isDown("jump"), "and the release");
    input.endStep();
    touch.dispose(); input.dispose();
    assert(!document.body.contains(touch.root), "controls removed from the page");
});

test("DebugOverlay reports the renderer's numbers", () => {
    const canvas = offscreen();
    const game = new Game({ canvas, autoResize: false });
    game.add(new Entity({ mesh: new Mesh(primitives.box(1, 1, 1), new BasicMaterial()) }));
    const debug = new DebugOverlay(game, { visible: true, key: null });
    game.renderer.render(game.scene, game.camera);
    debug.update(1);
    assert(/fps/.test(debug.text.textContent) && /draws 1 /.test(debug.text.textContent), `panel text: ${debug.text.textContent}`);
    debug.buttons.find((b) => b.textContent === "low").click();
    assert(game.renderer.quality === "low", "quality buttons switch the preset");
    debug.dispose(); game.dispose(); canvas.remove();
});
