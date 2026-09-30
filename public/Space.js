/**
 * Space: the original projection_library renderer (WebGL1).
 *
 * World convention: Z is up. The camera sits on a sphere of radius `Rc` around the view point
 * (X0, Y0, Z0); `alpha` is the yaw around Z and `beta` the pitch above the XY plane.
 *
 *     Xc = X0 + cos(beta) * cos(alpha) * Rc
 *     Yc = Y0 + cos(beta) * sin(alpha) * Rc
 *     Zc = Z0 + sin(beta) * Rc
 *
 * The view basis (xAxis, yAxis, zAxis) is built by hand in getX/Y/ZaxisUnitVector, and the vertex
 * shader projects every vertex with three dot products against that basis.
 *
 * Geometry lives in two flat arrays: `posArr` (vec4 x,y,z,w per vertex) and `colArr`
 * (vec4 r,g,b,a per vertex). `totalVert` is the number of vertices drawn by reDraw().
 *
 * P0 cleanup notes (see ARCHITECTURE.md): the dead Canvas-2D code path (drawPath, drawPath2,
 * getPointParameter, getMagnifiedPosition, getMagniValue, fillFace) and its unused fields were
 * removed; keyboard handling moved out of the engine into the demos; shader failures now throw
 * with the compiler log instead of calling alert().
 *
 * @deprecated Kept as a stable compatibility layer for Prime Walk, the OBJ viewer and Neon Rush (which
 * vendors its own copy). New code should use the engine: import { Game, Camera } from "./engine/index.js".
 * engine/Camera.js implements the same camera and basis maths; tests/engine.test.js checks the two agree.
 */
export default class Space {

    /** @param {WebGLRenderingContext} context */
    constructor(context) {
        /** @type {WebGLRenderingContext} */
        this.gl = context;
        /** @deprecated alias of `gl`, kept for existing callers */
        this.context = context;

        // ---- camera: view point, orbit radius and angles
        this.X0 = 0;
        this.Y0 = 0;
        this.Z0 = 0;
        this.Rc = 70;
        this.alpha = Math.PI;
        this.beta = 0;
        this.updateCameraPosition();

        /** focal-length multiplier (bigger = zoomed in) */
        this.magnifier = 1.75;
        /** far clipping distance along the view direction */
        this.far = 2000;

        /** @type {number[]} */ this.xUnitVec = [1, 0, 0];
        /** @type {number[]} */ this.yUnitVec = [0, 1, 0];
        /** @type {number[]} */ this.zUnitVec = [0, 0, 1];
        this.updateMyVectors();

        // ---- geometry (flat vec4 arrays)
        /** @type {number[] | Float32Array} */ this.posArr = [];
        /** @type {number[] | Float32Array} */ this.colArr = [];
        this.totalVert = 0;

        const gl = this.gl;
        gl.enable(gl.DEPTH_TEST);
        gl.clearColor(0, 0, 0, 1);

        this.posBuffer = gl.createBuffer();
        this.colBuffer = gl.createBuffer();
        this.dirty = true;      // geometry must be (re)uploaded before the next draw
        this.uploadedLen = 0;   // floats already on the GPU
        this.gpuCapacity = 0;   // floats the GPU buffers can hold without reallocating

        this.vertexShaderCode = `
        attribute vec4 pos;
        attribute vec4 col;
        varying vec4 vcol;

        uniform vec3 cPoint;      // camera position
        uniform vec3 xAxis;       // camera basis (see getX/Y/ZaxisUnitVector)
        uniform vec3 yAxis;
        uniform vec3 zAxis;
        uniform vec3 veriables;   // x: aspect (width / height), y: magnifier, z: far plane

        void main(){
            vcol = col;

            // move the vertex into camera space with three dot products
            float a = (pos.x - cPoint.x);
            float b = (pos.y - cPoint.y);
            float c = (pos.z - cPoint.z);
            float xProj = a*xAxis.x + b*xAxis.y + c*xAxis.z;
            float yProj = a*yAxis.x + b*yAxis.y + c*yAxis.z;
            float zProj = a*zAxis.x + b*zAxis.y + c*zAxis.z;

            // Same scale as the original (x / (zProj * 0.1 / magnifier * 16) on a 2:1 canvas), but the
            // divide goes through w: the GPU clips geometry behind the camera instead of mirroring
            // it, and zProj = 0 no longer divides by zero.
            float focal = veriables.y * 1.25;
            float n = 0.5;
            float f = veriables.z;
            // xAxis from getXaxisUnitVector points to screen-left, so negate it to un-mirror the image
            gl_Position = vec4(-xProj * focal / veriables.x, yProj * focal,
                               zProj * (f + n) / (f - n) - 2.0 * f * n / (f - n), zProj);
        }`;

        this.fragmentShaderCode = `
        precision mediump float;
        varying vec4 vcol;
        void main(){
            gl_FragColor = vec4(vcol);
        }`;

        this.vertShader = Space.compileShader(gl, gl.VERTEX_SHADER, this.vertexShaderCode);
        this.fragShader = Space.compileShader(gl, gl.FRAGMENT_SHADER, this.fragmentShaderCode);
        this.program = gl.createProgram();
        gl.attachShader(this.program, this.vertShader);
        gl.attachShader(this.program, this.fragShader);
        gl.linkProgram(this.program);
        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            throw new Error("Space: shader program failed to link\n" + gl.getProgramInfoLog(this.program));
        }
        gl.useProgram(this.program);

        this.posId = gl.getAttribLocation(this.program, "pos");
        this.colId = gl.getAttribLocation(this.program, "col");
        gl.enableVertexAttribArray(this.posId);
        gl.enableVertexAttribArray(this.colId);

        this.cPointLoc = gl.getUniformLocation(this.program, "cPoint");
        this.xAxisLoc = gl.getUniformLocation(this.program, "xAxis");
        this.yAxisLoc = gl.getUniformLocation(this.program, "yAxis");
        this.zAxisLoc = gl.getUniformLocation(this.program, "zAxis");
        this.varsLocation = gl.getUniformLocation(this.program, "veriables");
        /** @deprecated the vPoint uniform was never read by the shader; kept null for subclasses */
        this.vPointLoc = null;
    }

    /**
     * Compile one shader stage, throwing a readable error (stage + compiler log) on failure.
     * @param {WebGLRenderingContext} gl
     * @param {number} type gl.VERTEX_SHADER or gl.FRAGMENT_SHADER
     * @param {string} source
     */
    static compileShader(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const stage = type === gl.VERTEX_SHADER ? "vertex" : "fragment";
            throw new Error(`Space: ${stage} shader failed to compile\n${gl.getShaderInfoLog(shader)}`);
        }
        return shader;
    }

    // ------------------------------------------------------------------ camera

    /** Recompute the camera position (Xc, Yc, Zc) from X0/Y0/Z0, Rc, alpha and beta. */
    updateCameraPosition() {
        this.Xc = this.X0 + Math.cos(this.beta) * Math.cos(this.alpha) * this.Rc;
        this.Yc = this.Y0 + Math.cos(this.beta) * Math.sin(this.alpha) * this.Rc;
        this.Zc = this.Z0 + Math.sin(this.beta) * this.Rc;
    }

    /** Rebuild the camera basis from the current camera position and view point. */
    updateMyVectors() {
        this.xUnitVec = this.getXaxisUnitVector();
        this.yUnitVec = this.getYaxisUnitVector();
        this.zUnitVec = this.getZaxisUnitVector();
    }

    /**
     * Lambda of the point on the view axis whose offset to (X0, Y0, Z0 + 1) is perpendicular to the
     * view direction. Used to project world-up onto the view plane, which gives the screen-up axis.
     */
    getYaxisLamdanot() {
        return 1 - ((this.Zc - this.Z0)) / ((this.X0 - this.Xc) * (this.X0 - this.Xc) + (this.Y0 - this.Yc) * (this.Y0 - this.Yc) + (this.Z0 - this.Zc) * (this.Z0 - this.Zc));
    }

    /** Screen-up axis: world-up projected onto the plane perpendicular to the view direction. */
    getYaxisUnitVector() {
        let lamdanot = this.getYaxisLamdanot();
        let m = this.X0 + lamdanot * (this.Xc - this.X0) - this.Xc;
        let n = this.Y0 + lamdanot * (this.Yc - this.Y0) - this.Yc;
        let o = (1 + this.Z0) + lamdanot * (this.Zc - this.Z0) - this.Zc;
        let mag = Math.sqrt(m * m + n * n + o * o);
        return [m / mag, n / mag, o / mag];
    }

    /** Screen-left axis: view direction x screen-up (the shader negates it to get screen-right). */
    getXaxisUnitVector() {
        let lamdanot = this.getYaxisLamdanot();
        let m = this.X0 + lamdanot * (this.Xc - this.X0) - this.Xc;
        let n = this.Y0 + lamdanot * (this.Yc - this.Y0) - this.Yc;
        let o = (1 + this.Z0) + lamdanot * (this.Zc - this.Z0) - this.Zc;

        let r = (this.Z0 - this.Zc) * n - (this.Y0 - this.Yc) * o;
        let s = -((this.Z0 - this.Zc) * m - (this.X0 - this.Xc) * o);
        let t = (this.Y0 - this.Yc) * m - (this.X0 - this.Xc) * n;
        let mag = Math.sqrt(r * r + s * s + t * t);
        return [r / mag, s / mag, t / mag];
    }

    /** View direction: from the camera towards the view point. */
    getZaxisUnitVector() {
        let a = this.X0 - this.Xc;
        let b = this.Y0 - this.Yc;
        let c = this.Z0 - this.Zc;
        let mag = Math.sqrt(a * a + b * b + c * c);
        return [a / mag, b / mag, c / mag];
    }

    // Small fixed-step camera nudges from the original API (kept for compatibility).
    incAlpha() { this.alpha += 0.01; this.updateCameraPosition(); }
    decAlpha() { this.alpha -= 0.01; this.updateCameraPosition(); }
    incBeta() { this.beta += 0.01; this.updateCameraPosition(); }
    decBeta() { this.beta -= 0.01; this.updateCameraPosition(); }
    incRc() { this.Rc += 0.1; this.updateCameraPosition(); }
    decRc() { this.Rc -= 0.1; this.updateCameraPosition(); }
    /** move the view point along the screen-up axis */
    incY0() { this.moveViewPoint(this.getYaxisUnitVector(), 0.1); }
    decY0() { this.moveViewPoint(this.getYaxisUnitVector(), -0.1); }
    /** move the view point along the screen-left axis */
    incX0() { this.moveViewPoint(this.getXaxisUnitVector(), 0.1); }
    decX0() { this.moveViewPoint(this.getXaxisUnitVector(), -0.1); }
    /** move the view point backwards / forwards in the ground plane */
    incZ0() { const v = this.getZaxisUnitVector(); this.moveViewPoint([v[0], v[1], 0], -0.2); }
    decZ0() { const v = this.getZaxisUnitVector(); this.moveViewPoint([v[0], v[1], 0], 0.2); }
    moveViewPoint(dir, amount) {
        this.X0 += dir[0] * amount;
        this.Y0 += dir[1] * amount;
        this.Z0 += dir[2] * amount;
        this.updateCameraPosition();
    }

    // ------------------------------------------------------------------ CPU projection (reference)
    // The same projection the vertex shader performs, on the CPU, for a point {Xp, Yp, Zp}.
    // Useful for picking, labels and learning; the renderer itself does not call these.

    getXProj(point) { return (point.Xp - this.Xc) * this.xUnitVec[0] + (point.Yp - this.Yc) * this.xUnitVec[1] + (point.Zp - this.Zc) * this.xUnitVec[2]; }
    getYProj(point) { return (point.Xp - this.Xc) * this.yUnitVec[0] + (point.Yp - this.Yc) * this.yUnitVec[1] + (point.Zp - this.Zc) * this.yUnitVec[2]; }
    getZProj(point) { return (point.Xp - this.Xc) * this.zUnitVec[0] + (point.Yp - this.Yc) * this.zUnitVec[1] + (point.Zp - this.Zc) * this.zUnitVec[2]; }

    /** Point on the camera -> view-point line at parameter lamda (0 = camera, 1 = view point). */
    EqnCentralLinePoint(lamda) {
        return [(this.Xc + lamda * (this.X0 - this.Xc)), (this.Yc + lamda * (this.Y0 - this.Yc)), (this.Zc + lamda * (this.Z0 - this.Zc))];
    }
    /** Lamda of the foot of the perpendicular from `point` onto the view line. */
    getPerpendicularPointLamda(point) {
        return ((this.X0 - this.Xc) * (point.Xp - this.Xc) + (this.Y0 - this.Yc) * (point.Yp - this.Yc) + (this.Z0 - this.Zc) * (point.Zp - this.Zc)) / ((this.X0 - this.Xc) * (this.X0 - this.Xc) + (this.Y0 - this.Yc) * (this.Y0 - this.Yc) + (this.Z0 - this.Zc) * (this.Z0 - this.Zc));
    }
    getPointPerpendicularOfP(point) {
        return this.EqnCentralLinePoint(this.getPerpendicularPointLamda(point));
    }
    /** Vector from the view line to `point`, perpendicular to the view direction. */
    getPerpVectorP(point) {
        const p = this.getPointPerpendicularOfP(point);
        return [point.Xp - p[0], point.Yp - p[1], point.Zp - p[2]];
    }
    /** Distance from `point` to the view line. */
    getRadialDist(point) {
        return Math.hypot(...this.getPerpVectorP(point));
    }

    // ------------------------------------------------------------------ drawing

    /** Clear, upload changed geometry, set camera uniforms and draw all vertices. */
    reDraw() {
        const gl = this.gl;
        this.updateMyVectors();
        gl.useProgram(this.program);
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        // Upload vertex data only when it changed. Camera moves only touch uniforms.
        //  - a new array was assigned, or this.dirty is set (e.g. moveStructure): full upload
        //  - the arrays only grew (addStructure / addElements): upload just the new tail
        if (this.dirty || this.posArr !== this.uploadedPos || this.colArr !== this.uploadedCol) {
            this.uploadFull();
        } else if (this.posArr.length > this.uploadedLen) {
            this.uploadTail();
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
        gl.vertexAttribPointer(this.posId, 4, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuffer);
        gl.vertexAttribPointer(this.colId, 4, gl.FLOAT, false, 0, 0);

        gl.uniform3f(this.cPointLoc, this.Xc, this.Yc, this.Zc);
        gl.uniform3fv(this.xAxisLoc, this.xUnitVec);
        gl.uniform3fv(this.yAxisLoc, this.yUnitVec);
        gl.uniform3fv(this.zAxisLoc, this.zUnitVec);
        const aspect = gl.drawingBufferWidth / Math.max(1, gl.drawingBufferHeight);
        gl.uniform3f(this.varsLocation, aspect, this.magnifier, this.far);

        if (this.totalVert > 0) gl.drawArrays(gl.TRIANGLES, 0, this.totalVert);
    }

    // GPU buffers keep spare capacity so appended geometry can be sent with bufferSubData.
    uploadFull() {
        const gl = this.gl, n = this.posArr.length;
        this.gpuCapacity = Math.max(1024, n * 2);
        for (const [buf, arr] of [[this.posBuffer, this.posArr], [this.colBuffer, this.colArr]]) {
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(gl.ARRAY_BUFFER, this.gpuCapacity * 4, gl.DYNAMIC_DRAW);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, arr instanceof Float32Array ? arr : new Float32Array(arr));
        }
        this.uploadedPos = this.posArr;
        this.uploadedCol = this.colArr;
        this.uploadedLen = n;
        this.dirty = false;
    }
    uploadTail() {
        if (this.posArr.length > this.gpuCapacity) return this.uploadFull();
        const gl = this.gl, from = this.uploadedLen;
        for (const [buf, arr] of [[this.posBuffer, this.posArr], [this.colBuffer, this.colArr]]) {
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferSubData(gl.ARRAY_BUFFER, from * 4, new Float32Array(arr.slice(from)));
        }
        this.uploadedLen = this.posArr.length;
    }

    // ------------------------------------------------------------------ geometry

    /** Appends happen in place (no concat copy of the whole scene per structure). */
    appendArrays(pos, col) {
        if (!Array.isArray(this.posArr)) this.posArr = Array.from(this.posArr);
        if (!Array.isArray(this.colArr)) this.colArr = Array.from(this.colArr);
        for (let i = 0; i < pos.length; i++) this.posArr.push(pos[i]);
        for (let i = 0; i < col.length; i++) this.colArr.push(col[i]);
    }

    /** Append raw vec4 position/colour arrays. */
    addElements(sudoPosArr, sudoColArr) {
        this.appendArrays(sudoPosArr, sudoColArr);
        this.totalVert += sudoPosArr.length / 4;
    }

    /** Append a Structure and record which vertex range it occupies. */
    addStructure(structure/**@type {Structure} */) {
        this.appendArrays(structure.vertArrays, structure.colArr);
        structure.startVertId += this.totalVert;
        structure.endVertId += this.totalVert;
        this.totalVert += structure.vertArrays.length / 4; // one vertex = 4 floats
    }

    /** Remove all geometry. */
    clearScene() {
        this.posArr = [];
        this.colArr = [];
        this.totalVert = 0;
        this.dirty = true;
    }

    /** Translate a previously added Structure (rewrites its vertices; full re-upload next draw). */
    moveStructure(structure, dx, dy, dz) {
        for (let i = structure.startVertId; i < structure.endVertId; i++) {
            this.posArr[0 + 4 * i] += dx;
            this.posArr[1 + 4 * i] += dy;
            this.posArr[2 + 4 * i] += dz;
        }
        this.dirty = true;
        structure.minX += dx;
        structure.maxX += dx;
        structure.minY += dy;
        structure.maxY += dy;
        structure.minZ += dz;
        structure.maxZ += dz;
    }
}
