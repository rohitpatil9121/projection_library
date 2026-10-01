import { Transform } from "./Transform.js";

/**
 * Entity: a Transform that can carry a Mesh and behaviour.
 *
 *   const cube = new Entity({ name: "cube", mesh: new Mesh(box(), new BasicMaterial()) });
 *   cube.onUpdate((dt, e) => e.setYaw(e.age));
 * @module engine/Entity
 */
export class Entity extends Transform {
    /** @param {{ name?: string, mesh?: import("./Mesh.js").Mesh | null, visible?: boolean, staticShadow?: boolean, castShadow?: boolean,
     *           frustumCulled?: boolean, cullRadius?: number, lod?: Array<{ distance: number, mesh: import("./Mesh.js").Mesh | null }>, tags?: string[] }} [options] */
    constructor(options = {}) {
        super();
        this.name = options.name || "entity";
        /** @type {import("./Mesh.js").Mesh | null} */
        this.mesh = options.mesh || null;
        this.visible = options.visible ?? true;
        /** never moves: a ShadowMap draws its shadow once and keeps it (see engine/ShadowMap) */
        this.staticShadow = options.staticShadow ?? false;
        /** set false to keep this entity out of the sun's shadow map */
        this.castShadow = options.castShadow ?? true;
        /** set false to draw this entity even when its bounding sphere is off screen */
        this.frustumCulled = options.frustumCulled ?? true;
        /**
         * World-space radius to cull by, around the entity's position, instead of the mesh's own bounds.
         * Give one to instanced, skinned or shader-displaced meshes so they can be skipped when off screen.
         */
        this.cullRadius = options.cullRadius ?? 0;
        /**
         * Levels of detail: `[{ distance: 0, mesh: fine }, { distance: 40, mesh: coarse }, { distance: 150, mesh: null }]`.
         * Each frame the Renderer sets `mesh` to the last level whose distance the camera has passed
         * (null = not drawn), so far objects cost fewer triangles. Distances must increase.
         * @type {Array<{ distance: number, mesh: import("./Mesh.js").Mesh | null }> | null}
         */
        this.lod = options.lod || null;
        this.tags = new Set(options.tags || []);
        /** seconds of simulated time since the entity was added */
        this.age = 0;
        /** @type {Array<(dt: number, entity: Entity) => void>} */
        this._updaters = [];
        /** set by Scene.remove / Entity.destroy; removed at the end of the step */
        this.destroyed = false;
    }

    /** Add a per-step behaviour. Returns a function that removes it. */
    onUpdate(fn) {
        this._updaters.push(fn);
        return () => { const i = this._updaters.indexOf(fn); if (i >= 0) this._updaters.splice(i, 1); };
    }

    /** Called once per fixed step by the Scene. */
    update(dt) {
        this.age += dt;
        for (let i = 0; i < this._updaters.length; i++) this._updaters[i](dt, this);
        for (let i = 0; i < this.children.length; i++) {
            const c = this.children[i];
            if (c instanceof Entity) c.update(dt);
        }
    }

    /** Remove from the scene at the end of the current step. */
    destroy() { this.destroyed = true; }
}
