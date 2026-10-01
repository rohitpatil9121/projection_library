import { Entity } from "./Entity.js";
import { Mesh } from "./Mesh.js";
import { Geometry } from "./Geometry.js";
import { BasicMaterial } from "./Material.js";

/**
 * Trail: a fading line through the last N positions of something that moves (comets, projectiles, cursors).
 * Additive and unlit, so with bloom it reads as a streak of light.
 *
 *   const trail = scene.add(new Trail({ length: 120, color: [0.5, 0.9, 1.5] }));
 *   trail.push(x, y, z);   // every step
 * @module engine/Trail
 */
export class Trail extends Entity {
    /** @param {{ length?: number, color?: number[], name?: string }} [options] color rgb may exceed 1 (HDR) */
    constructor(options = {}) {
        super({ name: options.name || "trail" });
        this.length = options.length ?? 100;
        this.color = Float32Array.from(options.color || [1, 1, 1]);
        this.interpolate = false;
        this._ring = new Float32Array(this.length * 3);
        this._head = 0;
        this.count = 0;
        this.geometry = new Geometry({
            name: "trail", mode: "lineStrip", dynamic: true,
            positions: new Float32Array(this.length * 3), colors: new Float32Array(this.length * 4),
        });
        this.geometry.drawCount = 0;
        this.mesh = new Mesh(this.geometry, new BasicMaterial({
            lit: false, vertexColors: true, transparent: true, blending: "additive", cull: "none", depthWrite: false,
        }));
    }

    /** Append a point (oldest points fall off the end). */
    push(x, y, z) {
        const i = this._head * 3;
        this._ring[i] = x; this._ring[i + 1] = y; this._ring[i + 2] = z;
        this._head = (this._head + 1) % this.length;
        if (this.count < this.length) this.count++;
        this._rebuild();
    }

    clear() { this.count = 0; this._head = 0; this.geometry.drawCount = 0; }

    _rebuild() {
        const pos = this.geometry.positions, col = this.geometry.colors, n = this.count;
        const start = (this._head - n + this.length) % this.length;
        for (let k = 0; k < n; k++) {
            const src = ((start + k) % this.length) * 3;
            pos[k * 3] = this._ring[src]; pos[k * 3 + 1] = this._ring[src + 1]; pos[k * 3 + 2] = this._ring[src + 2];
            const a = (k + 1) / n;          // oldest -> newest fades in
            const f = a * a;
            col[k * 4] = this.color[0] * f; col[k * 4 + 1] = this.color[1] * f; col[k * 4 + 2] = this.color[2] * f; col[k * 4 + 3] = f;
        }
        this.geometry.drawCount = n;
        this.geometry.markDirty();
    }
}
