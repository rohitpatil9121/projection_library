import { Geometry, indexArray } from "../Geometry.js";
import { StandardMaterial } from "../Material.js";
import { Texture } from "../Texture.js";
import { Entity } from "../Entity.js";
import { Mesh, SkinnedMesh } from "../Mesh.js";
import { Skeleton, AnimationClip, Animator, PATH, POSE_STRIDE } from "../Animation.js";
import { mat4, quat } from "../vendor.js";

/**
 * glTF 2.0 loader: reads .glb (one binary file) and .gltf (JSON + buffers), the format Blender and most
 * asset packs export.
 *
 *   const asset = await loadGLTF("assets/models/vendor.glb");
 *   const character = asset.instantiate();        // an Entity tree; call it again for another copy
 *   scene.add(character);
 *   character.animator.play("walk");              // set when the file has a skin
 *   game.onRender((dt) => character.animator.update(dt));
 *
 * Or take the parts and build things yourself: `asset.meshes`, `asset.skeleton`, `asset.clips`.
 *
 * What is read: meshes (positions, normals, UVs, vertex colours, joints, weights, indices), materials (base
 * colour, base colour texture, emissive, alpha mode, double-sided), textures, the node tree, one skin
 * (its joints become a Skeleton), animations of that skin's joints.
 * What is not: cameras, lights, morph targets, sparse accessors, more than one skin, animation of nodes
 * that aren't joints, metallic/roughness (the engine's lighting is not physically based), compression
 * extensions (Draco, meshopt).
 *
 * Coordinates: glTF is Y-up and this engine is Z-up. `instantiate()` returns a root that is already turned
 * upright, so the model stands on the XY plane. If you build from parts, use `asset.upright` (a quaternion).
 * @module engine/loaders/GLTF
 */

const COMPONENTS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
/** how a normalized integer maps to a float, per the glTF spec */
const NORMALIZE = { 5120: (v) => Math.max(v / 127, -1), 5121: (v) => v / 255, 5122: (v) => Math.max(v / 32767, -1), 5123: (v) => v / 65535 };

/** rotation that turns a Y-up model upright in a Z-up world: +90° about X */
const UPRIGHT = quat.setAxisAngle(quat.create(), [1, 0, 0], Math.PI / 2);

/**
 * @param {string} url
 * @param {{ material?: (info: { name: string, color: number[], map: Texture | null, emissive: number[],
 *           transparent: boolean, alphaTest: number, doubleSided: boolean, vertexColors: boolean }) => import("../Material.js").Material }} [options]
 *        material: build your own material for each glTF material instead of a StandardMaterial
 * @returns {Promise<GLTFAsset>}
 */
export async function loadGLTF(url, options = {}) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`loadGLTF: could not load ${url} (${res.status})`);
    return parseGLTF(await res.arrayBuffer(), { ...options, baseUrl: url });
}

/** Parse glTF from memory (an ArrayBuffer holding a .glb, or the bytes of a .gltf JSON file). */
export async function parseGLTF(arrayBuffer, options = {}) {
    const view = new DataView(arrayBuffer);
    let json, binary = null;
    if (arrayBuffer.byteLength >= 12 && view.getUint32(0, true) === 0x46546c67) {
        // .glb: a 12-byte header, then chunks of [length, type, data]; the first is JSON, the second binary
        let offset = 12;
        while (offset < arrayBuffer.byteLength) {
            const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
            const data = arrayBuffer.slice(offset + 8, offset + 8 + length);
            if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(data));
            else if (type === 0x004e4942) binary = data;
            offset += 8 + length;
        }
        if (!json) throw new Error("parseGLTF: the .glb has no JSON chunk");
    } else {
        json = JSON.parse(new TextDecoder().decode(arrayBuffer));
    }
    const resolve = (uri) => (/^(data:|https?:|blob:)/.test(uri) || !options.baseUrl ? uri : new URL(uri, new URL(options.baseUrl, typeof location !== "undefined" ? location.href : "file:///")).href);

    const buffers = await Promise.all((json.buffers || []).map(async (b, i) => {
        if (b.uri === undefined) { if (!binary) throw new Error(`parseGLTF: buffer ${i} has no data`); return binary; }
        return (await fetch(resolve(b.uri))).arrayBuffer();
    }));

    /** Read an accessor into a flat typed array (floats unless `raw`), honouring stride and normalisation. */
    const accessorCache = new Map();
    function accessor(index, raw = false) {
        const key = index * 2 + (raw ? 1 : 0);
        if (accessorCache.has(key)) return accessorCache.get(key);
        const a = json.accessors[index];
        if (a.sparse) throw new Error("parseGLTF: sparse accessors are not supported");
        const size = SIZES[a.type], Type = COMPONENTS[a.componentType], count = a.count;
        const out = raw ? new Type(count * size) : new Float32Array(count * size);
        if (a.bufferView !== undefined) {
            const bv = json.bufferViews[a.bufferView];
            const start = (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || size * Type.BYTES_PER_ELEMENT;
            const dv = new DataView(buffers[bv.buffer]);
            const read = { 5120: "getInt8", 5121: "getUint8", 5122: "getInt16", 5123: "getUint16", 5125: "getUint32", 5126: "getFloat32" }[a.componentType];
            const norm = !raw && a.normalized ? NORMALIZE[a.componentType] : null;
            for (let i = 0; i < count; i++) for (let k = 0; k < size; k++) {
                const v = dv[read](start + i * stride + k * Type.BYTES_PER_ELEMENT, true);
                out[i * size + k] = norm ? norm(v) : v;
            }
        }
        accessorCache.set(key, out);
        return out;
    }

    // ---- textures
    const images = await Promise.all((json.images || []).map(async (img) => {
        let blob;
        if (img.bufferView !== undefined) {
            const bv = json.bufferViews[img.bufferView];
            blob = new Blob([new Uint8Array(buffers[bv.buffer], bv.byteOffset || 0, bv.byteLength)], { type: img.mimeType || "image/png" });
        } else blob = await (await fetch(resolve(img.uri))).blob();
        return blob;
    }));
    const textures = await Promise.all((json.textures || []).map(async (t) => {
        const sampler = json.samplers ? json.samplers[t.sampler] || {} : {};
        const wrap = sampler.wrapS === 33071 ? "clamp" : sampler.wrapS === 33648 ? "mirror" : "repeat";
        const filter = sampler.magFilter === 9728 ? "nearest" : "linear";
        return Texture.fromBlob(images[t.source], { wrap, filter, name: (json.images[t.source].name || "image") });
    }));

    // ---- materials
    const materialInfo = (json.materials || []).map((m) => {
        const pbr = m.pbrMetallicRoughness || {}, c = pbr.baseColorFactor || [1, 1, 1, 1];
        return {
            name: m.name || "material", color: [c[0], c[1], c[2]], opacity: c[3],
            map: pbr.baseColorTexture ? textures[pbr.baseColorTexture.index] : null,
            emissive: m.emissiveFactor || [0, 0, 0],
            transparent: m.alphaMode === "BLEND", alphaTest: m.alphaMode === "MASK" ? m.alphaCutoff ?? 0.5 : 0,
            doubleSided: !!m.doubleSided, vertexColors: false,
        };
    });
    const defaultInfo = { name: "default", color: [1, 1, 1], opacity: 1, map: null, emissive: [0, 0, 0], transparent: false, alphaTest: 0, doubleSided: false, vertexColors: false };
    const materialCache = new Map();
    function material(index, vertexColors) {
        const key = (index ?? -1) * 2 + (vertexColors ? 1 : 0);
        if (materialCache.has(key)) return materialCache.get(key);
        const info = { ...(index === undefined ? defaultInfo : materialInfo[index]), vertexColors };
        const m = options.material ? options.material(info) : new StandardMaterial({
            color: info.color, opacity: info.opacity, emissive: info.emissive, map: info.map, vertexColors,
            transparent: info.transparent, alphaTest: info.alphaTest, cull: info.doubleSided ? "none" : "back",
        });
        m.name = info.name;
        materialCache.set(key, m);
        return m;
    }

    // ---- meshes: each glTF primitive becomes one Geometry + Material
    const meshes = (json.meshes || []).map((mesh, mi) => ({
        name: mesh.name || "mesh" + mi,
        primitives: mesh.primitives.filter((p) => (p.mode ?? 4) === 4).map((p) => {
            const at = p.attributes, positions = accessor(at.POSITION);
            const vertexCount = positions.length / 3;
            let colors = null;
            if (at.COLOR_0 !== undefined) {
                // glTF allows RGB or RGBA; the engine always uses four components
                const src = accessor(at.COLOR_0), n = json.accessors[at.COLOR_0].type === "VEC3" ? 3 : 4;
                colors = new Float32Array(vertexCount * 4);
                for (let i = 0; i < vertexCount; i++) { for (let k = 0; k < 3; k++) colors[i * 4 + k] = src[i * n + k]; colors[i * 4 + 3] = n === 4 ? src[i * 4 + 3] : 1; }
            }
            const indices = p.indices !== undefined ? indexArray(accessor(p.indices, true), vertexCount) : null;
            const geometry = new Geometry({
                name: mesh.name || "mesh" + mi, positions,
                normals: at.NORMAL !== undefined ? accessor(at.NORMAL) : flatNormals(positions, indices),
                uvs: at.TEXCOORD_0 !== undefined ? accessor(at.TEXCOORD_0) : null, colors,
                joints: at.JOINTS_0 !== undefined ? accessor(at.JOINTS_0) : null,
                weights: at.WEIGHTS_0 !== undefined ? accessor(at.WEIGHTS_0) : null, indices,
            });
            return { geometry, material: material(p.material, !!colors) };
        }),
    }));

    // ---- nodes: local matrices, parents
    const nodes = (json.nodes || []).map((n, i) => {
        const t = n.translation || [0, 0, 0], r = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1];
        if (n.matrix) { mat4.getTranslation(t, n.matrix); mat4.getScaling(s, n.matrix); mat4.getRotation(r, mat4.scale(mat4.create(), n.matrix, [1 / s[0], 1 / s[1], 1 / s[2]])); }
        return { index: i, name: n.name || "node" + i, t, r, s, children: n.children || [], mesh: n.mesh, skin: n.skin, parent: -1 };
    });
    for (const n of nodes) for (const c of n.children) nodes[c].parent = n.index;
    const worldOf = (index) => {
        const chain = [];
        for (let i = index; i >= 0; i = nodes[i].parent) chain.unshift(nodes[i]);
        const m = mat4.create(), l = mat4.create();
        for (const n of chain) mat4.multiply(m, m, mat4.fromRotationTranslationScale(l, n.r, n.t, n.s));
        return m;
    };

    // ---- skin → Skeleton (joints reordered so every parent comes before its children)
    let skeleton = null;
    const jointOfNode = new Map();
    if (json.skins && json.skins.length) {
        const skin = json.skins[0], set = new Set(skin.joints);
        const depth = (i) => { let d = 0; for (let p = nodes[i].parent; p >= 0; p = nodes[p].parent) d++; return d; };
        const order = skin.joints.map((node, slot) => ({ node, slot })).sort((a, b) => depth(a.node) - depth(b.node));
        const ibmSrc = skin.inverseBindMatrices !== undefined ? accessor(skin.inverseBindMatrices) : null;
        // vertices name joints by their slot in the skin; `remap` turns a slot into the new, parent-first index
        const remap = new Int16Array(skin.joints.length);
        order.forEach((o, i) => { remap[o.slot] = i; jointOfNode.set(o.node, i); });
        const n = order.length, rest = new Float32Array(n * POSE_STRIDE), inverseBind = new Float32Array(n * 16), parents = new Int16Array(n), names = [];
        let rootMatrix = null;
        order.forEach((o, i) => {
            const node = nodes[o.node];
            names.push(node.name);
            rest.set(node.t, i * POSE_STRIDE); rest.set(node.r, i * POSE_STRIDE + 3); rest.set(node.s, i * POSE_STRIDE + 7);
            parents[i] = set.has(node.parent) ? jointOfNode.get(node.parent) : -1;
            if (parents[i] < 0 && node.parent >= 0 && !rootMatrix) rootMatrix = new Float32Array(worldOf(node.parent));
            if (ibmSrc) inverseBind.set(ibmSrc.subarray(o.slot * 16, o.slot * 16 + 16), i * 16);
            else { inverseBind[i * 16] = inverseBind[i * 16 + 5] = inverseBind[i * 16 + 10] = inverseBind[i * 16 + 15] = 1; }
        });
        skeleton = new Skeleton({ names, parents, rest, inverseBind, rootMatrix });
        const identity = remap.every((v, i) => v === i);
        if (!identity) for (const m of meshes) for (const p of m.primitives) {
            const j = p.geometry.joints;
            if (j) for (let i = 0; i < j.length; i++) j[i] = remap[j[i]];
        }
    }

    // ---- animations → clips (only channels that move skeleton joints)
    const clips = [];
    for (const anim of json.animations || []) {
        const tracks = [];
        for (const ch of anim.channels) {
            const joint = jointOfNode.get(ch.target.node), path = PATH[ch.target.path];
            if (joint === undefined || path === undefined) continue;
            const s = anim.samplers[ch.sampler];
            let values = accessor(s.output);
            const times = accessor(s.input);
            if (s.interpolation === "CUBICSPLINE") {
                // keys are stored as [in-tangent, value, out-tangent]; keep the values and interpolate linearly
                const size = path === PATH.rotation ? 4 : 3, v = new Float32Array(times.length * size);
                for (let i = 0; i < times.length; i++) for (let k = 0; k < size; k++) v[i * size + k] = values[i * size * 3 + size + k];
                values = v;
            }
            tracks.push({ joint, path, times, values, step: s.interpolation === "STEP" });
        }
        if (tracks.length) clips.push(new AnimationClip(anim.name || "clip" + clips.length, tracks));
    }

    return new GLTFAsset({ json, meshes, nodes, skeleton, clips, textures });
}

/** Face normals for a mesh that came without any (each vertex gets the normal of the last face using it). */
function flatNormals(positions, indices) {
    const normals = new Float32Array(positions.length), n = indices ? indices.length : positions.length / 3;
    for (let i = 0; i < n; i += 3) {
        const a = indices ? indices[i] : i, b = indices ? indices[i + 1] : i + 1, c = indices ? indices[i + 2] : i + 2;
        const ux = positions[b * 3] - positions[a * 3], uy = positions[b * 3 + 1] - positions[a * 3 + 1], uz = positions[b * 3 + 2] - positions[a * 3 + 2];
        const vx = positions[c * 3] - positions[a * 3], vy = positions[c * 3 + 1] - positions[a * 3 + 1], vz = positions[c * 3 + 2] - positions[a * 3 + 2];
        let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
        const l = Math.hypot(x, y, z) || 1;
        x /= l; y /= l; z /= l;
        for (const v of [a, b, c]) { normals[v * 3] = x; normals[v * 3 + 1] = y; normals[v * 3 + 2] = z; }
    }
    return normals;
}

export class GLTFAsset {
    constructor(data) {
        /** the parsed glTF JSON, for anything this loader doesn't surface */
        this.json = data.json;
        /** @type {Array<{ name: string, primitives: Array<{ geometry: Geometry, material: import("../Material.js").Material }> }>} */
        this.meshes = data.meshes;
        this.nodes = data.nodes;
        /** @type {Skeleton | null} */
        this.skeleton = data.skeleton;
        /** @type {AnimationClip[]} */
        this.clips = data.clips;
        this.textures = data.textures;
        /** quaternion that stands a Y-up model upright in this Z-up engine */
        this.upright = UPRIGHT;
    }

    /** The first primitive of the mesh with this name: { geometry, material }, or null. */
    mesh(name) {
        const m = this.meshes.find((x) => x.name === name);
        return m && m.primitives.length ? m.primitives[0] : null;
    }

    /** Geometry of the mesh with this name (its first primitive), or null. */
    geometry(name) { const m = this.mesh(name); return m ? m.geometry : null; }

    /** A clip by name, or null. */
    clip(name) { return this.clips.find((c) => c.name === name) || null; }

    /**
     * Build an Entity tree from the file's default scene. Geometry, materials, the skeleton and the clips
     * are shared between instances; each instance gets its own Animator (as `root.animator`).
     * @returns {Entity & { animator?: Animator }}
     */
    instantiate() {
        const root = new Entity({ name: "gltf" });
        quat.copy(root.rotation, UPRIGHT);
        const animator = this.skeleton ? new Animator(this.skeleton, this.clips) : null;
        if (animator) root.animator = animator;
        const scene = this.json.scenes ? this.json.scenes[this.json.scene || 0] : null;
        const roots = scene ? scene.nodes : this.nodes.filter((n) => n.parent < 0).map((n) => n.index);
        const build = (index, parent) => {
            const n = this.nodes[index];
            const e = new Entity({ name: n.name });
            e.setPosition(n.t[0], n.t[1], n.t[2]);
            quat.copy(e.rotation, n.r);
            e.setScale(n.s[0], n.s[1], n.s[2]);
            const mesh = n.mesh !== undefined ? this.meshes[n.mesh] : null;
            const skinned = mesh && n.skin !== undefined && animator;
            if (mesh) mesh.primitives.forEach((p, i) => {
                // a skinned mesh is placed by its joints, not by its node, so it hangs straight off the root
                const holder = i === 0 && !skinned ? e : new Entity({ name: n.name + "." + i });
                holder.mesh = skinned ? new SkinnedMesh(p.geometry, p.material, animator) : new Mesh(p.geometry, p.material);
                if (skinned) root.add(holder); else if (holder !== e) e.add(holder);
            });
            parent.add(e);
            for (const c of n.children) build(c, e);
        };
        for (const r of roots) build(r, root);
        return root;
    }
}
