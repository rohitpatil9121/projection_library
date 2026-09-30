import { CAMERA } from "./config.js";

/**
 * Camera: the projection_library camera, generalised.
 *
 * WORLD: Z is up.
 *
 * ORBIT (the original Space model). The camera sits on a sphere of radius `distance` (Rc) around a
 * `target` (X0, Y0, Z0), steered by `yaw` (alpha, around Z) and `pitch` (beta, above the XY plane):
 *
 *     eye.x = target.x + cos(pitch) · cos(yaw) · distance
 *     eye.y = target.y + cos(pitch) · sin(yaw) · distance
 *     eye.z = target.z + sin(pitch) · distance
 *
 * VIEW BASIS (the original "lamdanot" construction, see Camera.basis):
 *   forward = normalize(target − eye)
 *   up      = world-up projected onto the plane perpendicular to `forward`
 *   left    = up × forward            (the original getXaxisUnitVector)
 *   right   = −left                   (what the shaders use)
 *
 * PROJECTION (done in the vertex shader, shaders/chunks/projection.js): a vertex p is moved into camera
 * space with three dot products and divided by its depth through gl_Position.w:
 *
 *     v = p − eye
 *     clip.x = dot(v, right)   · focal / aspect
 *     clip.y = dot(v, up)      · focal
 *     clip.w = dot(v, forward)            (perspective divide → x/w, y/w)
 *     focal  = 1 / tan(fov / 2)
 *
 * MODES
 *   "orbit"       yaw/pitch/distance around `target`
 *   "follow"      orbit whose target eases toward a followed object, with look-ahead along its velocity
 *   "firstPerson" eye at `position`, looking along yaw/pitch
 * Any mode can be shaken: `shakeOffset` moves eye and target together (driven by Juice in P4).
 * @module engine/Camera
 */

const EPS = 1e-9;

export class Camera {
    /**
     * @param {{ mode?: "orbit" | "follow" | "firstPerson", fov?: number, near?: number, far?: number,
     *           target?: number[], distance?: number, yaw?: number, pitch?: number }} [options]
     *        `fov` is the vertical field of view in degrees.
     */
    constructor(options = {}) {
        /** @type {"orbit" | "follow" | "firstPerson"} */
        this.mode = options.mode || "orbit";
        this.fov = options.fov ?? CAMERA.fovDeg;
        this.near = options.near ?? CAMERA.near;
        this.far = options.far ?? CAMERA.far;
        this.aspect = 1;

        /** orbit / follow centre (Space: X0, Y0, Z0) */
        this.target = Float64Array.from(options.target || [0, 0, 0]);
        /** orbit radius (Space: Rc) */
        this.distance = options.distance ?? 20;
        /** rotation around world Z in radians (Space: alpha) */
        this.yaw = options.yaw ?? -Math.PI / 2;
        /** elevation above the XY plane in radians (Space: beta) */
        this.pitch = options.pitch ?? 0.5;

        /** first-person eye position */
        this.position = new Float64Array([0, 0, 2]);

        /** follow mode settings */
        this.follow = { object: null, damping: 6, lookAhead: 0.25, offset: [0, 0, 1], last: null, velocity: [0, 0, 0] };

        /** world-space shake added to eye and target (set by Juice) */
        this.shakeOffset = new Float64Array(3);

        // outputs, recomputed by update()
        this.eye = new Float64Array(3);
        this.right = new Float64Array([1, 0, 0]);
        this.up = new Float64Array([0, 0, 1]);
        this.forward = new Float64Array([0, 1, 0]);
        this.left = new Float64Array([-1, 0, 0]);
        this._lookAt = new Float64Array(3);

        /** Float32 copies for uniforms (allocated once) */
        this.uniforms = {
            u_camPos: new Float32Array(3),
            u_camRight: new Float32Array(3),
            u_camUp: new Float32Array(3),
            u_camForward: new Float32Array(3),
            u_proj: new Float32Array(4),
        };
        this.update(0);
    }

    // ------------------------------------------------------------------ Space-compatible names
    get alpha() { return this.yaw; } set alpha(v) { this.yaw = v; }
    get beta() { return this.pitch; } set beta(v) { this.pitch = v; }
    get Rc() { return this.distance; } set Rc(v) { this.distance = v; }

    /** focal length: 1 / tan(fov / 2). Space's `magnifier` m corresponds to focal = 1.25 · m. */
    get focal() { return 1 / Math.tan((this.fov * Math.PI) / 360); }
    set focal(f) { this.fov = (2 * Math.atan(1 / f) * 180) / Math.PI; }

    // ------------------------------------------------------------------ the original basis maths

    /**
     * View basis from an eye position and a look-at point, using the original projection_library
     * construction (Space.getYaxisUnitVector / getXaxisUnitVector / getZaxisUnitVector):
     *
     * 1. d = target − eye is the view direction.
     * 2. Take the point U = target + (0, 0, 1), one unit "above" the target. The point on the view line
     *    eye + λ·d closest to U gives the foot of the perpendicular; the vector from that foot to U is
     *    world-up with its component along d removed. The closed form for λ is
     *        λ = 1 − (eye.z − target.z) / |d|²          ("lamdanot")
     *    and  up = normalize( target + λ·(eye − target) + (0,0,1) − eye ).
     * 3. left = w × d (w = the unnormalised up vector), forward = d / |d|. So right = −left = forward × up,
 *    a right-handed camera frame.
     *
     * Undefined when d is exactly vertical (looking straight up or down); callers clamp pitch.
     * @param {ArrayLike<number>} eye
     * @param {ArrayLike<number>} target
     * @param {{ left: Float64Array, up: Float64Array, forward: Float64Array }} out
     */
    static basis(eye, target, out) {
        const dx = target[0] - eye[0], dy = target[1] - eye[1], dz = target[2] - eye[2];
        const d2 = dx * dx + dy * dy + dz * dz || EPS;
        const lamdanot = 1 - (eye[2] - target[2]) / d2;
        // m, n, o: vector from the eye to the point "one unit above the target, projected"
        const m = target[0] + lamdanot * (eye[0] - target[0]) - eye[0];
        const n = target[1] + lamdanot * (eye[1] - target[1]) - eye[1];
        const o = (1 + target[2]) + lamdanot * (eye[2] - target[2]) - eye[2];
        const um = Math.hypot(m, n, o) || EPS;
        out.up[0] = m / um; out.up[1] = n / um; out.up[2] = o / um;
        // left = w × d, where w = (m, n, o)
        const r = dz * n - dy * o;
        const s = -(dz * m - dx * o);
        const t = dy * m - dx * n;
        const lm = Math.hypot(r, s, t) || EPS;
        out.left[0] = r / lm; out.left[1] = s / lm; out.left[2] = t / lm;
        const fm = Math.sqrt(d2);
        out.forward[0] = dx / fm; out.forward[1] = dy / fm; out.forward[2] = dz / fm;
        return out;
    }

    // ------------------------------------------------------------------ modes

    /**
     * Follow an object each frame. The object needs a `position` (array-like, world space).
     * @param {{ position: ArrayLike<number> } | null} object
     * @param {{ damping?: number, lookAhead?: number, offset?: number[] }} [opts]
     */
    setFollow(object, opts = {}) {
        this.mode = object ? "follow" : "orbit";
        Object.assign(this.follow, opts, { object, last: null });
        if (object) for (let i = 0; i < 3; i++) this.target[i] = object.position[i] + this.follow.offset[i];
    }

    /** Orbit controls helper: rotate by pixel-ish deltas. */
    orbit(dYaw, dPitch) {
        this.yaw += dYaw;
        this.pitch = Math.max(-CAMERA.maxPitch, Math.min(CAMERA.maxPitch, this.pitch + dPitch));
    }

    /** Multiply the orbit distance (wheel / pinch). */
    zoom(factor) { this.distance = Math.max(CAMERA.minDistance, this.distance * factor); }

    /** Move the orbit target in the view plane (pan). */
    pan(dRight, dUp) {
        for (let i = 0; i < 3; i++) this.target[i] += this.right[i] * dRight + this.up[i] * dUp;
    }

    /**
     * Recompute eye and basis. Call once per rendered frame.
     * @param {number} dt seconds since last frame (used by follow damping)
     */
    update(dt) {
        this.pitch = Math.max(-CAMERA.maxPitch, Math.min(CAMERA.maxPitch, this.pitch));
        const eye = this.eye, look = this._lookAt;

        if (this.mode === "follow" && this.follow.object) {
            const f = this.follow, p = f.object.position;
            if (f.last && dt > 0) for (let i = 0; i < 3; i++) f.velocity[i] = (p[i] - f.last[i]) / dt;
            f.last = f.last || [0, 0, 0];
            for (let i = 0; i < 3; i++) f.last[i] = p[i];
            const k = dt > 0 ? 1 - Math.exp(-dt * f.damping) : 1;
            for (let i = 0; i < 3; i++) {
                const goal = p[i] + f.offset[i] + f.velocity[i] * f.lookAhead;
                this.target[i] += (goal - this.target[i]) * k;
            }
        }

        if (this.mode === "firstPerson") {
            const cp = Math.cos(this.pitch);
            for (let i = 0; i < 3; i++) eye[i] = this.position[i] + this.shakeOffset[i];
            look[0] = eye[0] + cp * Math.cos(this.yaw);
            look[1] = eye[1] + cp * Math.sin(this.yaw);
            look[2] = eye[2] + Math.sin(this.pitch);
        } else {
            const cp = Math.cos(this.pitch);
            for (let i = 0; i < 3; i++) look[i] = this.target[i] + this.shakeOffset[i];
            eye[0] = look[0] + cp * Math.cos(this.yaw) * this.distance;
            eye[1] = look[1] + cp * Math.sin(this.yaw) * this.distance;
            eye[2] = look[2] + Math.sin(this.pitch) * this.distance;
        }

        Camera.basis(eye, look, this);
        for (let i = 0; i < 3; i++) this.right[i] = -this.left[i];
        return this;
    }

    /**
     * Fill the Float32 uniform block for the shaders.
     * @param {number} aspect width / height of the render target
     */
    writeUniforms(aspect) {
        this.aspect = aspect;
        const u = this.uniforms, f = this.focal;
        for (let i = 0; i < 3; i++) {
            u.u_camPos[i] = this.eye[i];
            u.u_camRight[i] = this.right[i];
            u.u_camUp[i] = this.up[i];
            u.u_camForward[i] = this.forward[i];
        }
        u.u_proj[0] = f / aspect;
        u.u_proj[1] = f;
        u.u_proj[2] = this.near;
        u.u_proj[3] = this.far;
        return u;
    }

    // ------------------------------------------------------------------ CPU projection (picking, labels)

    /**
     * World point → CSS pixel coordinates, using the same maths as the vertex shader.
     * @param {ArrayLike<number>} p
     * @param {number} width
     * @param {number} height
     * @param {{ x: number, y: number, depth: number, visible: boolean }} [out]
     */
    project(p, width, height, out = { x: 0, y: 0, depth: 0, visible: false }) {
        const vx = p[0] - this.eye[0], vy = p[1] - this.eye[1], vz = p[2] - this.eye[2];
        const depth = vx * this.forward[0] + vy * this.forward[1] + vz * this.forward[2];
        out.depth = depth;
        out.visible = depth > this.near;
        if (!out.visible) return out;
        const f = this.focal, aspect = width / Math.max(1, height);
        const nx = (vx * this.right[0] + vy * this.right[1] + vz * this.right[2]) * f / aspect / depth;
        const ny = (vx * this.up[0] + vy * this.up[1] + vz * this.up[2]) * f / depth;
        out.x = (nx + 1) * 0.5 * width;
        out.y = (1 - ny) * 0.5 * height;
        return out;
    }

    /**
     * CSS pixel → world ray from the eye (the inverse of project()).
     * @returns {{ origin: number[], direction: number[] }}
     */
    screenRay(px, py, width, height) {
        const aspect = width / Math.max(1, height), f = this.focal;
        const nx = (px / width) * 2 - 1, ny = 1 - (py / height) * 2;
        const kx = (nx * aspect) / f, ky = ny / f;
        const d = [0, 1, 2].map((i) => this.forward[i] + this.right[i] * kx + this.up[i] * ky);
        const m = Math.hypot(d[0], d[1], d[2]);
        return { origin: [this.eye[0], this.eye[1], this.eye[2]], direction: d.map((v) => v / m) };
    }
}
