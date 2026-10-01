import { SKIN } from "./config.js";

/**
 * Skeletal animation: Skeleton (the bones), AnimationClip (keyframes), Animator (one character's playback).
 *
 * A skeleton is a small tree of joints. Each joint has a pose relative to its parent: translation,
 * rotation (a quaternion) and scale. A clip stores, per joint, how those change over time. Every frame the
 * Animator:
 *   1. samples the clip at the current time into a local pose (blending two clips while cross-fading);
 *   2. walks the tree from the root, multiplying each joint's local matrix onto its parent's, to get where
 *      each joint is in model space;
 *   3. multiplies by the joint's inverse bind matrix (where the joint was when the mesh was modelled),
 *      giving the matrix that moves a vertex from its modelled position to its animated one.
 * Those are the `u_joints` matrices the skinning shader blends per vertex.
 *
 * Skeletons and clips are shared; each character has its own Animator, so a crowd costs one small pose
 * buffer each, not a copy of the animation data. Joints are plain typed arrays rather than scene Entities
 * for the same reason.
 *
 *   const animator = new Animator(asset.skeleton, asset.clips);
 *   animator.play("walk");
 *   entity.mesh = new SkinnedMesh(geometry, material, animator);
 *   // each rendered frame: animator.update(frameDelta)
 * @module engine/Animation
 */

/** floats per joint in a pose: tx ty tz, qx qy qz qw, sx sy sz */
export const POSE_STRIDE = 10;

export class Skeleton {
    /**
     * @param {{ names: string[], parents: ArrayLike<number>, rest: Float32Array, inverseBind: Float32Array,
     *           rootMatrix?: Float32Array | null }} data
     *        parents: index of each joint's parent, -1 for roots; a parent always comes before its children
     *        rest: the pose a joint keeps when no clip animates it (POSE_STRIDE floats per joint)
     *        rootMatrix: transform of whatever sits above the root joints in the source file, if any
     */
    constructor(data) {
        this.names = data.names;
        this.count = data.names.length;
        if (this.count > SKIN.maxJoints) throw new Error(`Skeleton has ${this.count} joints; the engine supports ${SKIN.maxJoints}`);
        this.parents = Int16Array.from(data.parents);
        this.rest = data.rest;
        this.inverseBind = data.inverseBind;
        this.rootMatrix = data.rootMatrix || null;
        this._index = new Map(this.names.map((n, i) => [n, i]));
    }

    /** Joint index by name, or -1. */
    index(name) { return this._index.has(name) ? this._index.get(name) : -1; }
}

export const PATH = Object.freeze({ translation: 0, rotation: 1, scale: 2 });

export class AnimationClip {
    /**
     * @param {string} name
     * @param {Array<{ joint: number, path: 0 | 1 | 2, times: Float32Array, values: Float32Array, step?: boolean }>} tracks
     *        values hold 3 floats per key (translation, scale) or 4 (rotation quaternion)
     * @param {number} [duration] seconds; defaults to the last keyframe
     */
    constructor(name, tracks, duration) {
        this.name = name;
        this.tracks = tracks;
        let end = 0;
        for (const t of tracks) if (t.times.length) end = Math.max(end, t.times[t.times.length - 1]);
        this.duration = duration ?? end;
    }
}

/** Write the clip's pose at `time` into `pose` (only the joints the clip animates). */
function sample(clip, time, pose) {
    for (const tr of clip.tracks) {
        const times = tr.times, n = times.length, size = tr.path === PATH.rotation ? 4 : 3;
        const o = tr.joint * POSE_STRIDE + (tr.path === PATH.translation ? 0 : tr.path === PATH.rotation ? 3 : 7);
        const v = tr.values;
        if (n === 1 || time <= times[0]) { for (let k = 0; k < size; k++) pose[o + k] = v[k]; continue; }
        if (time >= times[n - 1]) { const b = (n - 1) * size; for (let k = 0; k < size; k++) pose[o + k] = v[b + k]; continue; }
        // few keys per track, so a linear scan from a remembered position beats a binary search
        let i = tr._i || 0;
        if (i >= n - 1 || times[i] > time) i = 0;
        while (times[i + 1] < time) i++;
        tr._i = i;
        const a = i * size, b = a + size;
        if (tr.step) { for (let k = 0; k < size; k++) pose[o + k] = v[a + k]; continue; }
        const u = (time - times[i]) / (times[i + 1] - times[i]);
        if (size === 3) { for (let k = 0; k < 3; k++) pose[o + k] = v[a + k] + (v[b + k] - v[a + k]) * u; continue; }
        // rotations: normalised lerp along the shorter arc (close keys make it indistinguishable from slerp)
        let dot = v[a] * v[b] + v[a + 1] * v[b + 1] + v[a + 2] * v[b + 2] + v[a + 3] * v[b + 3];
        const s = dot < 0 ? -1 : 1;
        let x = v[a] + (v[b] * s - v[a]) * u, y = v[a + 1] + (v[b + 1] * s - v[a + 1]) * u, z = v[a + 2] + (v[b + 2] * s - v[a + 2]) * u, w = v[a + 3] + (v[b + 3] * s - v[a + 3]) * u;
        const l = Math.hypot(x, y, z, w) || 1;
        pose[o] = x / l; pose[o + 1] = y / l; pose[o + 2] = z / l; pose[o + 3] = w / l;
    }
}

export class Animator {
    /**
     * @param {Skeleton} skeleton
     * @param {AnimationClip[] | Map<string, AnimationClip>} clips
     */
    constructor(skeleton, clips = []) {
        this.skeleton = skeleton;
        /** @type {Map<string, AnimationClip>} */
        this.clips = clips instanceof Map ? clips : new Map(clips.map((c) => [c.name, c]));
        const n = skeleton.count;
        /** local pose, POSE_STRIDE floats per joint. Edit between sample() and solve() to add your own motion. */
        this.pose = new Float32Array(skeleton.rest);
        this._from = new Float32Array(n * POSE_STRIDE);
        /** joint matrices in model space (where each joint is), 16 floats each */
        this.model = new Float32Array(n * 16);
        /** skinning matrices for the shader: always SKIN.maxJoints long, unused ones stay identity */
        this.matrices = new Float32Array(SKIN.maxJoints * 16);
        for (let i = 0; i < SKIN.maxJoints; i++) this.matrices[i * 16] = this.matrices[i * 16 + 5] = this.matrices[i * 16 + 10] = this.matrices[i * 16 + 15] = 1;
        this.clip = null;
        this.time = 0;
        this.speed = 1;
        this.loop = true;
        /** true once a non-looping clip has reached its end */
        this.finished = false;
        this._prev = null; this._prevTime = 0; this._prevLoop = true;
        this._fade = 0; this._fadeTime = 0;
        this.solve();
    }

    /** Name of the clip being played, or "". */
    get current() { return this.clip ? this.clip.name : ""; }

    /**
     * Switch to a clip, cross-fading from whatever is playing. Asking for the clip that is already
     * playing does nothing (so it is safe to call every frame) unless `restart` is set.
     * @param {string} name
     * @param {{ fade?: number, loop?: boolean, speed?: number, restart?: boolean, offset?: number }} [options]
     *        fade: seconds of cross-fade; offset: start this far into the clip (0..1 of its length)
     */
    play(name, options = {}) {
        const clip = this.clips.get(name);
        if (!clip) return this;
        this.speed = options.speed ?? 1;
        if (clip === this.clip && !options.restart) { this.loop = options.loop ?? this.loop; return this; }
        const fade = options.fade ?? 0.2;
        if (this.clip && fade > 0) { this._prev = this.clip; this._prevTime = this.time; this._prevLoop = this.loop; this._fade = fade; this._fadeTime = 0; }
        else this._prev = null;
        this.clip = clip;
        this.loop = options.loop ?? true;
        this.time = (options.offset ?? 0) * clip.duration;
        this.finished = false;
        return this;
    }

    /** Advance time and recompute the matrices. Call once per rendered frame. */
    update(dt) {
        this.sample(dt);
        this.solve();
    }

    /** Step 1 only: advance time and write the local pose. Follow with solve(). */
    sample(dt) {
        const rest = this.skeleton.rest, pose = this.pose;
        pose.set(rest);
        const clip = this.clip;
        if (!clip) return;
        this.time += dt * this.speed;
        if (clip.duration > 0) {
            if (this.loop) this.time %= clip.duration;
            else if (this.time >= clip.duration) { this.time = clip.duration; this.finished = true; }
        }
        sample(clip, this.time, pose);
        if (this._prev) {
            this._fadeTime += dt;
            const u = this._fadeTime / this._fade;
            if (u >= 1) { this._prev = null; return; }
            // pose = previous clip's pose blended toward the new one
            const from = this._from, p = this._prev;
            from.set(rest);
            this._prevTime += dt * this.speed;
            sample(p, this._prevLoop && p.duration > 0 ? this._prevTime % p.duration : Math.min(this._prevTime, p.duration), from);
            const k = u * u * (3 - 2 * u), n = this.skeleton.count;
            for (let j = 0; j < n; j++) {
                const o = j * POSE_STRIDE;
                for (let c = 0; c < 3; c++) pose[o + c] = from[o + c] + (pose[o + c] - from[o + c]) * k;
                for (let c = 7; c < 10; c++) pose[o + c] = from[o + c] + (pose[o + c] - from[o + c]) * k;
                const dot = from[o + 3] * pose[o + 3] + from[o + 4] * pose[o + 4] + from[o + 5] * pose[o + 5] + from[o + 6] * pose[o + 6];
                const s = dot < 0 ? -1 : 1;
                const x = from[o + 3] + (pose[o + 3] * s - from[o + 3]) * k, y = from[o + 4] + (pose[o + 4] * s - from[o + 4]) * k;
                const z = from[o + 5] + (pose[o + 5] * s - from[o + 5]) * k, w = from[o + 6] + (pose[o + 6] * s - from[o + 6]) * k;
                const l = Math.hypot(x, y, z, w) || 1;
                pose[o + 3] = x / l; pose[o + 4] = y / l; pose[o + 5] = z / l; pose[o + 6] = w / l;
            }
        }
    }

    /** Steps 2 and 3: local pose → model-space joint matrices → skinning matrices. */
    solve() {
        const sk = this.skeleton, n = sk.count, pose = this.pose, M = this.model, out = this.matrices, ib = sk.inverseBind, root = sk.rootMatrix;
        for (let j = 0; j < n; j++) {
            const o = j * POSE_STRIDE, m = j * 16;
            // local matrix from translation, rotation, scale (the same formula as mat4.fromRotationTranslationScale)
            const x = pose[o + 3], y = pose[o + 4], z = pose[o + 5], w = pose[o + 6];
            const x2 = x + x, y2 = y + y, z2 = z + z;
            const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
            const sx = pose[o + 7], sy = pose[o + 8], sz = pose[o + 9];
            L[0] = (1 - (yy + zz)) * sx; L[1] = (xy + wz) * sx; L[2] = (xz - wy) * sx; L[3] = 0;
            L[4] = (xy - wz) * sy; L[5] = (1 - (xx + zz)) * sy; L[6] = (yz + wx) * sy; L[7] = 0;
            L[8] = (xz + wy) * sz; L[9] = (yz - wx) * sz; L[10] = (1 - (xx + yy)) * sz; L[11] = 0;
            L[12] = pose[o]; L[13] = pose[o + 1]; L[14] = pose[o + 2]; L[15] = 1;
            const parent = sk.parents[j];
            if (parent >= 0) multiply(M, m, M, parent * 16, L, 0);
            else if (root) multiply(M, m, root, 0, L, 0);
            else for (let k = 0; k < 16; k++) M[m + k] = L[k];
            multiply(out, m, M, m, ib, m);
        }
    }

    /**
     * Where a joint is, in the model's own space (multiply by the entity's world matrix for world space).
     * Use it to attach things to a hand or a head.
     * @returns {Float32Array} a 16-float view into this.model (do not keep it across frames)
     */
    jointMatrix(index) { return this.model.subarray(index * 16, index * 16 + 16); }
}

const L = new Float32Array(16);

/** out[oo..] = a[ao..] · b[bo..] for column-major 4×4 matrices stored in flat arrays (affine: last row is 0 0 0 1). */
function multiply(out, oo, a, ao, b, bo) {
    const a00 = a[ao], a01 = a[ao + 1], a02 = a[ao + 2], a10 = a[ao + 4], a11 = a[ao + 5], a12 = a[ao + 6];
    const a20 = a[ao + 8], a21 = a[ao + 9], a22 = a[ao + 10], a30 = a[ao + 12], a31 = a[ao + 13], a32 = a[ao + 14];
    for (let c = 0; c < 4; c++) {
        const b0 = b[bo + c * 4], b1 = b[bo + c * 4 + 1], b2 = b[bo + c * 4 + 2], b3 = b[bo + c * 4 + 3];
        out[oo + c * 4] = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3;
        out[oo + c * 4 + 1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3;
        out[oo + c * 4 + 2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3;
        out[oo + c * 4 + 3] = b3;
    }
}
