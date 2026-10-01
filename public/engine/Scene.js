import { Entity } from "./Entity.js";
import { RENDER } from "./config.js";

/**
 * Scene: the root of the entity tree, plus the environment settings the Renderer reads.
 * @module engine/Scene
 */
export class Scene {
    constructor() {
        this.root = new Entity({ name: "root" });
        this.clearColor = Float32Array.from(RENDER.clearColor);
        /** one directional sun + a hemisphere ambient (sky colour from above, ground colour from below) */
        this.sunDirection = Float32Array.from(normalize(RENDER.sunDirection));
        this.sunColor = Float32Array.from(RENDER.sunColor);
        this.skyColor = Float32Array.from(RENDER.skyColor);
        this.groundColor = Float32Array.from(RENDER.groundColor);
        /** distance fog read by StandardMaterial and the lighting chunk; density 0 turns it off */
        this.fogColor = Float32Array.from(RENDER.fogColor);
        this.fogDensity = RENDER.fogDensity;
        /** @type {Array<{ position: ArrayLike<number>, color: ArrayLike<number>, radius: number, enabled?: boolean }>} */
        this.pointLights = [];
        /** @type {import("./ShadowMap.js").ShadowMap | null} shadows cast by the sun */
        this.shadow = null;
    }

    /** @param {Entity} entity @param {Entity} [parent] */
    add(entity, parent = this.root) { parent.add(entity); return entity; }

    /** @param {Entity} entity */
    remove(entity) { if (entity.parent) entity.parent.remove(entity); return entity; }

    /** Store previous poses before a fixed step (for render interpolation). */
    snapshot() { this.root.snapshot(); }

    /** Run one fixed step for every entity, then remove destroyed ones. */
    update(dt) {
        this.root.update(dt);
        this._sweep(this.root);
    }

    _sweep(node) {
        for (let i = node.children.length - 1; i >= 0; i--) {
            const c = node.children[i];
            if (c.destroyed) node.remove(c);
            else this._sweep(c);
        }
    }

    /** @param {(e: Entity) => void} fn */
    traverse(fn, node = this.root) {
        fn(node);
        for (const c of node.children) this.traverse(fn, c);
    }

    /** Find the first entity with a name. */
    find(name) {
        let hit = null;
        this.traverse((e) => { if (!hit && e.name === name) hit = e; });
        return hit;
    }
}

function normalize(v) {
    const m = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / m, v[1] / m, v[2] / m];
}
