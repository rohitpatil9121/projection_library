import { vec3, quat, mat4, mat3 } from "./vendor.js";

/**
 * Transform: position, rotation (quaternion), scale, and a parent/children hierarchy.
 *
 * Fixed-timestep interpolation: the simulation moves objects at 60 Hz, but the screen may refresh at 144 Hz.
 * Before each simulation step, `snapshot()` stores the previous pose. When rendering, the world matrix is
 * built from the pose blended between previous and current by `alpha` (0..1, from the Loop), so motion
 * stays smooth at any refresh rate.
 * @module engine/Transform
 */
export class Transform {
    constructor() {
        this.position = vec3.create();
        this.rotation = quat.create();
        this.scale = vec3.fromValues(1, 1, 1);

        this.prevPosition = vec3.create();
        this.prevRotation = quat.create();
        this.prevScale = vec3.fromValues(1, 1, 1);
        /** interpolate between fixed steps when rendering (turn off for teleports / UI objects) */
        this.interpolate = true;

        /** @type {Transform | null} */
        this.parent = null;
        /** @type {Transform[]} */
        this.children = [];

        this.localMatrix = mat4.create();
        this.worldMatrix = mat4.create();
        this.normalMatrix = mat3.create();

        this._p = vec3.create();
        this._q = quat.create();
        this._s = vec3.create();
    }

    setPosition(x, y, z) { vec3.set(this.position, x, y, z); return this; }
    setScale(x, y = x, z = x) { vec3.set(this.scale, x, y, z); return this; }

    /** Rotation from Euler angles in radians, applied in Z (yaw), then Y, then X order. */
    setRotationEuler(x, y, z) {
        quat.fromEuler(this.rotation, (x * 180) / Math.PI, (y * 180) / Math.PI, (z * 180) / Math.PI, "zyx");
        return this;
    }

    /** Rotate around world Z (yaw), convenient in a Z-up world. */
    setYaw(angle) { quat.setAxisAngle(this.rotation, [0, 0, 1], angle); return this; }

    /** Place the object at its current pose with no interpolation from the old one (use after teleporting). */
    teleport() { this.snapshot(); return this; }

    /** @param {Transform} child */
    add(child) {
        if (child.parent) child.parent.remove(child);
        child.parent = this;
        this.children.push(child);
        return child;
    }

    /** @param {Transform} child */
    remove(child) {
        const i = this.children.indexOf(child);
        if (i >= 0) { this.children.splice(i, 1); child.parent = null; }
        return child;
    }

    /** Store the current pose as the "previous" pose (called before each fixed update). */
    snapshot() {
        vec3.copy(this.prevPosition, this.position);
        quat.copy(this.prevRotation, this.rotation);
        vec3.copy(this.prevScale, this.scale);
        for (const c of this.children) c.snapshot();
    }

    /**
     * Recompute world matrices for this subtree.
     * @param {number} [alpha=1] interpolation factor between previous and current pose
     * @param {Float32Array | null} [parentWorld]
     */
    updateWorldMatrix(alpha = 1, parentWorld = null) {
        let p = this.position, q = this.rotation, s = this.scale;
        if (this.interpolate && alpha < 1) {
            vec3.lerp(this._p, this.prevPosition, this.position, alpha); p = this._p;
            quat.slerp(this._q, this.prevRotation, this.rotation, alpha); q = this._q;
            vec3.lerp(this._s, this.prevScale, this.scale, alpha); s = this._s;
        }
        mat4.fromRotationTranslationScale(this.localMatrix, q, p, s);
        if (parentWorld) mat4.multiply(this.worldMatrix, parentWorld, this.localMatrix);
        else mat4.copy(this.worldMatrix, this.localMatrix);
        mat3.normalFromMat4(this.normalMatrix, this.worldMatrix);
        for (const c of this.children) c.updateWorldMatrix(alpha, this.worldMatrix);
    }

    /** World-space position from the last updateWorldMatrix(). */
    getWorldPosition(out = vec3.create()) {
        return vec3.set(out, this.worldMatrix[12], this.worldMatrix[13], this.worldMatrix[14]);
    }
}
