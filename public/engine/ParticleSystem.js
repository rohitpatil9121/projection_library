import { Entity } from "./Entity.js";
import { Mesh } from "./Mesh.js";
import { Geometry } from "./Geometry.js";
import { ShaderMaterial } from "./Material.js";
import * as particles from "../shaders/particles/particles.js";

/**
 * ParticleSystem: pooled point-sprite particles, simulated on the CPU in world space.
 *
 * Data is struct-of-arrays in typed arrays allocated once (`capacity`). Dead particles are removed by
 * swapping the last live one into their slot, so the live particles are always the first `alive` entries
 * and the GPU draws exactly that range. Emitting and updating allocate nothing.
 *
 *   const sparks = new ParticleSystem({ capacity: 2000, gravity: [0, 0, -4] });
 *   scene.add(sparks);
 *   sparks.emit(40, { position: [x, y, z], speed: 6, life: [0.4, 0.9], size: [0.3, 0], color: [1, .8, .3, 1], colorEnd: [1, .2, 0, 0] });
 * @module engine/ParticleSystem
 */

/**
 * @typedef {Object} EmitOptions
 * @property {ArrayLike<number>} position   emitter centre (world)
 * @property {number} [spread=0]            random position offset radius
 * @property {ArrayLike<number>} [velocity] base velocity
 * @property {number} [speed=0]             extra speed in a random direction
 * @property {boolean} [flat=false]         random direction only in the XY plane
 * @property {number[]} [life=[1,1]]        [min, max] seconds
 * @property {number[]} [size=[0.2,0]]      [start, end] world units
 * @property {number[]} [color=[1,1,1,1]]   start rgba (rgb may exceed 1 for bloom)
 * @property {number[]} [colorEnd]          end rgba (defaults to start with alpha 0)
 */

const ZERO3 = [0, 0, 0];
const DEFAULT_LIFE = [1, 1];
const DEFAULT_SIZE = [0.2, 0];
const WHITE = [1, 1, 1, 1];

export class ParticleSystem extends Entity {
    /**
     * @param {{ capacity?: number, gravity?: number[], drag?: number, blending?: "additive" | "normal", name?: string }} [options]
     */
    constructor(options = {}) {
        super({ name: options.name || "particles" });
        const n = (this.capacity = options.capacity ?? 1000);
        this.gravity = Float32Array.from(options.gravity || [0, 0, 0]);
        /** fraction of velocity lost per second */
        this.drag = options.drag ?? 0;
        this.alive = 0;
        this.interpolate = false;

        this.px = new Float32Array(n); this.py = new Float32Array(n); this.pz = new Float32Array(n);
        this.vx = new Float32Array(n); this.vy = new Float32Array(n); this.vz = new Float32Array(n);
        this.life = new Float32Array(n); this.maxLife = new Float32Array(n);
        this.size0 = new Float32Array(n); this.size1 = new Float32Array(n);
        this.c0 = new Float32Array(n * 4); this.c1 = new Float32Array(n * 4);

        this.geometry = new Geometry({
            name: "particles", mode: "points", dynamic: true,
            positions: new Float32Array(n * 3), colors: new Float32Array(n * 4), uvs: new Float32Array(n * 2),
        });
        this.geometry.drawCount = 0;
        this.mesh = new Mesh(this.geometry, new ShaderMaterial({
            name: "particles", vertex: particles.vertex, fragment: particles.fragment,
            transparent: true, blending: options.blending || "additive", depthWrite: false, cull: "none",
        }));
    }

    /** @param {number} count @param {EmitOptions} o */
    emit(count, o) {
        const vel = o.velocity || ZERO3, life = o.life || DEFAULT_LIFE, size = o.size || DEFAULT_SIZE;
        const c0 = o.color || WHITE, c1 = o.colorEnd;
        const spread = o.spread || 0, speed = o.speed || 0;
        for (let k = 0; k < count; k++) {
            if (this.alive >= this.capacity) return;
            const i = this.alive++;
            // random direction (uniform on a sphere, or a circle when flat)
            let dx, dy, dz;
            if (o.flat) { const a = Math.random() * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a); dz = 0; }
            else { const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u); dx = r * Math.cos(a); dy = r * Math.sin(a); dz = u; }
            const s = speed * (0.35 + Math.random() * 0.65), off = spread * Math.random();
            this.px[i] = o.position[0] + dx * off; this.py[i] = o.position[1] + dy * off; this.pz[i] = o.position[2] + dz * off;
            this.vx[i] = vel[0] + dx * s; this.vy[i] = vel[1] + dy * s; this.vz[i] = vel[2] + dz * s;
            this.maxLife[i] = this.life[i] = life[0] + Math.random() * (life[1] - life[0]);
            this.size0[i] = size[0]; this.size1[i] = size[1];
            for (let j = 0; j < 4; j++) {
                this.c0[i * 4 + j] = c0[j];
                this.c1[i * 4 + j] = c1 ? c1[j] : j === 3 ? 0 : c0[j];
            }
        }
    }

    /** Remove every particle. */
    clear() { this.alive = 0; this.geometry.drawCount = 0; }

    update(dt) {
        super.update(dt);
        const damp = Math.max(0, 1 - this.drag * dt), gx = this.gravity[0] * dt, gy = this.gravity[1] * dt, gz = this.gravity[2] * dt;
        const pos = this.geometry.positions, col = this.geometry.colors, uv = this.geometry.uvs;
        let i = 0;
        while (i < this.alive) {
            this.life[i] -= dt;
            if (this.life[i] <= 0) { this._kill(i); continue; } // swapped-in particle is processed next
            this.vx[i] = (this.vx[i] + gx) * damp; this.vy[i] = (this.vy[i] + gy) * damp; this.vz[i] = (this.vz[i] + gz) * damp;
            this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
            const t = 1 - this.life[i] / this.maxLife[i]; // 0 at birth -> 1 at death
            pos[i * 3] = this.px[i]; pos[i * 3 + 1] = this.py[i]; pos[i * 3 + 2] = this.pz[i];
            for (let j = 0; j < 4; j++) col[i * 4 + j] = this.c0[i * 4 + j] + (this.c1[i * 4 + j] - this.c0[i * 4 + j]) * t;
            uv[i * 2] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
            uv[i * 2 + 1] = t;
            i++;
        }
        this.geometry.drawCount = this.alive;
        this.geometry.markDirty();
    }

    _kill(i) {
        const last = --this.alive;
        if (i === last) return;
        this.px[i] = this.px[last]; this.py[i] = this.py[last]; this.pz[i] = this.pz[last];
        this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last]; this.vz[i] = this.vz[last];
        this.life[i] = this.life[last]; this.maxLife[i] = this.maxLife[last];
        this.size0[i] = this.size0[last]; this.size1[i] = this.size1[last];
        for (let j = 0; j < 4; j++) { this.c0[i * 4 + j] = this.c0[last * 4 + j]; this.c1[i * 4 + j] = this.c1[last * 4 + j]; }
    }
}
