import Point from "./Point.js";
import Path from "./Shapes/Path.js";
import Face from "./Shapes/Face.js";

export default class Space {



    constructor(context) {

        this.X0 = 0;
        this.Y0 = 0;
        this.Z0 = 0;

        this.Rc = 70;
        this.Xc = 0 * this.Rc;
        this.Yc = 1 * this.Rc;
        this.Zc = 0 * this.Rc;
        this.camera = [this.Xc * this.Rc, this.Yc * this.Rc, this.Zc * this.Rc];
        this.whMax = 10;
        this.vRange = 20;
        this.vRadCont = 0.1;

        this.alpha = Math.PI;
        this.beta = 0;
        this.Xc = this.X0 + (Math.cos(this.beta) * Math.cos(this.alpha)) * this.Rc;
        this.Yc = this.Y0 + (Math.cos(this.beta) * Math.sin(this.alpha)) * this.Rc;
        this.Zc = this.Z0 + (Math.sin(this.beta)) * this.Rc;

        this.context = context;




        this.xUnitVec = Array(3);
        this.yUnitVec = Array(3);
        this.zUnitVec = Array(3);
        this.updateMyVectors();

        this.gl = context;
        this.gl.enable(this.gl.DEPTH_TEST);

        this.posArr = [
            0, 0, -1, 1,
            1, 0, -1, 1,
            1, 1, 1, 1,
        ];
        this.colArr = [
            0, 1, 0, 1,
            0, 1, 0, 1,
            0, 1, 0, 1,
        ];
        this.totalVert = 0;


        this.posBuffer = this.gl.createBuffer(this.posArr);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.posBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(this.posArr), this.gl.STATIC_DRAW);

        this.colBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.colBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(this.colArr), this.gl.STATIC_DRAW);



        this.vertexShaderCode = `

        attribute vec4 pos;
        attribute vec4 col;
        uniform vec3 coord;
        varying vec4 vcol;
        
        uniform vec3 vPoint;
        uniform vec3 cPoint;
        uniform vec3 xAxis;
        uniform vec3 yAxis;
        uniform vec3 zAxis;

        uniform vec3 veriables;
        
        
        void main(){
            vcol = col;
            
            float a = (pos.x - cPoint.x);
            float b = (pos.y - cPoint.y);
            float c = (pos.z - cPoint.z);
        
            float xProj = a*xAxis.x + b*xAxis.y + c*xAxis.z;
            float yProj = a*yAxis.x + b*yAxis.y + c*yAxis.z;
            float zProj = a*zAxis.x + b*zAxis.y + c*zAxis.z;
        
            // Same scale as the original (x / (zProj * 0.1 / magnifier * 16) on a 2:1 canvas), but the
            // divide now goes through w: the GPU clips geometry behind the camera instead of mirroring
            // it, and zProj = 0 no longer divides by zero.
            //   veriables.x = canvas aspect (width / height), .y = magnifier, .z = far plane
            float focal = veriables.y * 1.25;
            float n = 0.5;
            float f = veriables.z;
            // xAxis from getXaxisUnitVector points to screen-left, so negate it to un-mirror the image
            gl_Position = vec4(-xProj * focal / veriables.x, yProj * focal,
                               zProj * (f + n) / (f - n) - 2.0 * f * n / (f - n), zProj);
        }
        
        `

        this.fragmentShaderCode = `
        precision mediump float;
        
        varying vec4 vcol;
        
        
        void main(){
            gl_FragColor = vec4(vcol);
        }
        
        `

        this.vertShader = this.gl.createShader(this.gl.VERTEX_SHADER);
        this.gl.shaderSource(this.vertShader, this.vertexShaderCode);
        this.gl.compileShader(this.vertShader);

        this.fragShader = this.gl.createShader(this.gl.FRAGMENT_SHADER);
        this.gl.shaderSource(this.fragShader, this.fragmentShaderCode);
        this.gl.compileShader(this.fragShader);

        this.program = this.gl.createProgram();
        this.gl.attachShader(this.program, this.vertShader);
        this.gl.attachShader(this.program, this.fragShader);
        this.gl.linkProgram(this.program);

        if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
            alert("program not linked")
        }



        this.posId = this.gl.getAttribLocation(this.program, "pos");
        this.gl.enableVertexAttribArray(this.posId);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.posBuffer);
        this.gl.vertexAttribPointer(this.posId, 4, this.gl.FLOAT, false, 0, 0);

        this.colId = this.gl.getAttribLocation(this.program, "col");
        this.gl.enableVertexAttribArray(this.colId);
        console.log("col id is : " + this.colId)
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.colBuffer);
        this.gl.vertexAttribPointer(this.colId, 4, this.gl.FLOAT, false, 0, 0);


        // gl.uniform3fv(coordLoc, )


        this.gl.useProgram(this.program);

        this.coordLoc = this.gl.getUniformLocation(this.program, "coord");
        this.gl.uniform3fv(this.coordLoc, new Float32Array([0, 0, 0]));

        // -------------------points ---------------------------
        this.cPointLoc = this.gl.getUniformLocation(this.program, "cPoint");
        this.gl.uniform3fv(this.cPointLoc, new Float32Array([this.Xc, this.Yc, this.Zc]));

        this.vPointLoc = this.gl.getUniformLocation(this.program, "vPoint");
        this.gl.uniform3fv(this.vPointLoc, new Float32Array([this.X0, this.Y0, this.Z0]));

        // -------------------unit vectors------------------------
        this.xAxisLoc = this.gl.getUniformLocation(this.program, "xAxis");
        this.gl.uniform3fv(this.xAxisLoc, new Float32Array(this.xUnitVec));

        this.yAxisLoc = this.gl.getUniformLocation(this.program, "yAxis");
        this.gl.uniform3fv(this.yAxisLoc, new Float32Array(this.yUnitVec));

        this.zAxisLoc = this.gl.getUniformLocation(this.program, "zAxis");
        this.gl.uniform3fv(this.zAxisLoc, new Float32Array(this.zUnitVec));
        // -------------------------------------------------------
        this.magnifier = 1.75;
        this.far = 2000;
        this.varsLocation = this.gl.getUniformLocation(this.program, "veriables");
        this.dirty = true; // geometry must be (re)uploaded before the next draw
        this.uploadedLen = 0;
        this.gpuCapacity = 0;
        this.gl.clearColor(0, 0, 0, 1);
















        this.face = new Face();

        // this.drawPath(this.face.path);

        // test
        this.t = 0;










        this.updateMyVectors();


        // = / - : magnify in / out (focal length). O is used by Main.js to move the view point.
        document.addEventListener("keydown", (event) => {
            if (event.code == "Equal" || event.code == "NumpadAdd") this.magnifier += 0.1;
            else if (event.code == "Minus" || event.code == "NumpadSubtract") this.magnifier = Math.max(0.2, this.magnifier - 0.1);
            else return;
            this.reDraw();
        })

    }


    updateMyVectors() {
        this.xUnitVec = this.getXaxisUnitVector();
        this.yUnitVec = this.getYaxisUnitVector();
        this.zUnitVec = this.getZaxisUnitVector();
    }


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

        gl.uniform3fv(this.cPointLoc, new Float32Array([this.Xc, this.Yc, this.Zc]));
        gl.uniform3fv(this.vPointLoc, new Float32Array([this.X0, this.Y0, this.Z0]));
        gl.uniform3fv(this.xAxisLoc, new Float32Array(this.xUnitVec));
        gl.uniform3fv(this.yAxisLoc, new Float32Array(this.yUnitVec));
        gl.uniform3fv(this.zAxisLoc, new Float32Array(this.zUnitVec));
        const aspect = gl.drawingBufferWidth / Math.max(1, gl.drawingBufferHeight);
        gl.uniform3fv(this.varsLocation, new Float32Array([aspect, this.magnifier, this.far]));

        gl.drawArrays(gl.TRIANGLES, 0, this.totalVert);
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

    // Appends happen in place (no concat copy of the whole scene per structure).
    appendArrays(pos, col) {
        if (!Array.isArray(this.posArr)) this.posArr = Array.from(this.posArr);
        if (!Array.isArray(this.colArr)) this.colArr = Array.from(this.colArr);
        for (let i = 0; i < pos.length; i++) this.posArr.push(pos[i]);
        for (let i = 0; i < col.length; i++) this.colArr.push(col[i]);
    }

    addElements(sudoPosArr, sudoColArr) {
        this.appendArrays(sudoPosArr, sudoColArr);
        this.totalVert += sudoPosArr.length / 4;
    }

    addStructure(structure/**@type {Structure} */) {
        this.appendArrays(structure.vertArrays, structure.colArr);
        structure.startVertId += this.totalVert;
        structure.endVertId += this.totalVert;
        // one vertex = 4 floats (x, y, z, w); this used to add 3x the real count
        this.totalVert += structure.vertArrays.length / 4;
    }

    // remove all geometry
    clearScene() {
        this.posArr = [];
        this.colArr = [];
        this.totalVert = 0;
        this.dirty = true;
    }

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




    drawPath(path) {
        this.context.beginPath();
        let pp = this.getPointParameter(path.point)
        this.context.moveTo(pp[0], pp[1]);


        let sudoPath = path.nextPath;
        while (sudoPath != undefined) {

            // console.log(this.getPointParameter(sudoPath.point)[0] + "," + this.getPointParameter(sudoPath.point)[1]);
            let pp = this.getPointParameter(sudoPath.point)
            this.context.lineTo(pp[0], pp[1]);
            sudoPath = sudoPath.nextPath;
        }

        this.context.fill();

    }






    drawPath2() {


        for (let i = 0; i < 780; i += 4) {
            for (let j = 0; j < i; j += 4) {
                this.context.fillRect(i + this.t, j, 4, 4);
            }
        }
        // this.context.fillRect(this.t,0,5,5);


        this.t++;
        this.context.fill();

    }


















    EqnCentralLinePoint(lamda) {
        return [(this.Xc + lamda * (this.X0 - this.Xc)), (this.Yc + lamda * (this.Y0 - this.Yc)), (this.Zc + lamda * (this.Z0 - this.Zc))];
    }

    getPerpendicularPointLamda(point) {
        return ((this.X0 - this.Xc) * (point.Xp - this.Xc) + (this.Y0 - this.Yc) * (point.Yp - this.Yc) + (this.Z0 - this.Zc) * (point.Zp - this.Zc)) / ((this.X0 - this.Xc) * (this.X0 - this.Xc) + (this.Y0 - this.Yc) * (this.Y0 - this.Yc) + (this.Z0 - this.Zc) * (this.Z0 - this.Zc));
    }

    getPointPerpendicularOfP(point) {
        return this.EqnCentralLinePoint(this.getPerpendicularPointLamda(point));
    }






    getYaxisLamdanot() {
        return 1 - ((this.Zc - this.Z0)) / ((this.X0 - this.Xc) * (this.X0 - this.Xc) + (this.Y0 - this.Yc) * (this.Y0 - this.Yc) + (this.Z0 - this.Zc) * (this.Z0 - this.Zc));
    }




    getPerpVectorP(point) {
        let Xp = point.Xp;
        let Yp = point.Yp;
        let Zp = point.Zp;

        let perpOfP = this.getPointPerpendicularOfP(point);

        return [(Xp - perpOfP[0]), (Yp - perpOfP[1]), (Zp - perpOfP[2])];
    }
    getYaxisUnitVector() {
        // let lamdanotpoint = this.yAxisPoint(this.getYaxisLamdanot());
        // let mag = Math.sqrt(lamdanotpoint[0] * lamdanotpoint[0] + lamdanotpoint[1] * lamdanotpoint[1] + lamdanotpoint[2] * lamdanotpoint[2]);
        // lamdanotpoint[0] = lamdanotpoint[0] / mag;
        // lamdanotpoint[1] = lamdanotpoint[1] / mag;
        // lamdanotpoint[2] = lamdanotpoint[2] / mag;
        // return lamdanotpoint;
        let lamdanot = this.getYaxisLamdanot();
        let m = this.X0 + lamdanot * (this.Xc - this.X0) - this.Xc;
        let n = this.Y0 + lamdanot * (this.Yc - this.Y0) - this.Yc;
        let o = (1 + this.Z0) + lamdanot * (this.Zc - this.Z0) - this.Zc;

        let mag = Math.sqrt(m * m + n * n + o * o);

        return [m / mag, n / mag, o / mag];

    }
    getXaxisUnitVector() {
        // let lamdanotpoint = this.xAxisPoint(this.getYaxisLamdanot());
        // let mag = Math.sqrt(lamdanotpoint[0] * lamdanotpoint[0] + lamdanotpoint[1] * lamdanotpoint[1] + lamdanotpoint[2] * lamdanotpoint[2]);
        // lamdanotpoint[0] = lamdanotpoint[0] / mag;
        // lamdanotpoint[1] = lamdanotpoint[1] / mag;
        // lamdanotpoint[2] = lamdanotpoint[2] / mag;
        // return lamdanotpoint;
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
    getZaxisUnitVector() {
        let a = this.X0 - this.Xc;
        let b = this.Y0 - this.Yc;
        let c = this.Z0 - this.Zc;
        let mag = Math.sqrt(a * a + b * b + c * c);
        return [a / mag, b / mag, c / mag];
    }














    getYProj(point) {
        let x_p_ppp = point.Xp - this.Xc;
        let y_p_ppp = point.Yp - this.Yc;
        let z_p_ppp = point.Zp - this.Zc;

        return x_p_ppp * this.yUnitVec[0] + y_p_ppp * this.yUnitVec[1] + z_p_ppp * this.yUnitVec[2];

    }
    getXProj(point) {
        let x_p_ppp = point.Xp - this.Xc;
        let y_p_ppp = point.Yp - this.Yc;
        let z_p_ppp = point.Zp - this.Zc;

        return x_p_ppp * this.xUnitVec[0] + y_p_ppp * this.xUnitVec[1] + z_p_ppp * this.xUnitVec[2];
    }
    getZProj(point) {
        let x_ppp = point.Xp - this.Xc;
        let y_ppp = point.Yp - this.Yc;
        let z_ppp = point.Zp - this.Zc;

        return x_ppp * this.zUnitVec[0] + y_ppp * this.zUnitVec[1] + z_ppp * this.zUnitVec[2];
    }
    getRadialDist(point) {
        let sudoArr = this.getPointPerpendicularOfP(point);
        let x_ppp = sudoArr[0];
        let y_ppp = sudoArr[1];
        let z_ppp = sudoArr[2];

        return Math.sqrt((x_ppp - point.Xp) * (x_ppp - point.Xp) + (y_ppp - point.Yp) * (y_ppp - point.Yp) + (z_ppp - point.Zp) * (z_ppp - point.Zp));

    }


    // everything up is working fine uodate downward




















    getMagniValue(point) {
        // let sudoArr = (point);
        let x_ppp = point.Xp;
        let y_ppp = point.Yp;
        let z_ppp = point.Zp;

        let p_dist_of_point = Math.sqrt((x_ppp - this.Xc) * (x_ppp - this.Xc) + (y_ppp - this.Yc) * (y_ppp - this.Yc) + (z_ppp - this.Zc) * (z_ppp - this.Zc));

        // return p_dist_of_point;
        if (p_dist_of_point > this.vRange) {
            return 0;
        }
        // console.log(-(this.whMax * p_dist_of_point) / this.vRange + this.whMax);
        return -(this.whMax * p_dist_of_point) / this.vRange + this.whMax;

    }
    getMagnifiedPosition(point) {
        // let sudoArr = this.getPointPerpendicularOfP(point);
        // let x_ppp = sudoArr[0];
        // let y_ppp = sudoArr[1];
        // let z_ppp = sudoArr[2];

        // let p_dist_of_point2 = Math.sqrt((x_ppp - this.Xc) * (x_ppp - this.Xc) + (y_ppp - this.Yc) * (y_ppp - this.Yc) + (z_ppp - this.Zc) * (z_ppp - this.Zc));
        // let sudoArr = (point);
        let x_ppp = point.Xp - this.Xc;
        let y_ppp = point.Yp - this.Yc;
        let z_ppp = point.Zp - this.Zc;

        // let p_dist_of_point = Math.sqrt((x_ppp - this.Xc) * (x_ppp - this.Xc) + (y_ppp - this.Yc) * (y_ppp - this.Yc) + (z_ppp - this.Zc) * (z_ppp - this.Zc));
        let p_dist_of_point = this.zUnitVec[0] * x_ppp + this.zUnitVec[1] * y_ppp + this.zUnitVec[2] * z_ppp
        let maxWidthAtK = this.vRadCont * p_dist_of_point;

        let x = this.getXProj(point);
        let y = this.getYProj(point);
        console.log(x + "," + y + "," + maxWidthAtK);

        // if(x>maxWidthAtK){
        //     x = 0;
        // }
        // if(y>maxWidthAtK){
        //     y = 0;
        // }

        return [x / maxWidthAtK, y / maxWidthAtK];

    }



    incAlpha() {
        this.alpha += 0.01;
        this.Xc = this.X0 + (Math.cos(this.beta) * Math.cos(this.alpha)) * this.Rc;
        this.Yc = this.Y0 + (Math.cos(this.beta) * Math.sin(this.alpha)) * this.Rc;
        this.Zc = this.Z0 + (Math.sin(this.beta)) * this.Rc;
    }
    decAlpha() {
        this.alpha -= 0.01;
        this.Xc = this.X0 + (Math.cos(this.beta) * Math.cos(this.alpha)) * this.Rc;
        this.Yc = this.Y0 + (Math.cos(this.beta) * Math.sin(this.alpha)) * this.Rc;
        this.Zc = this.Z0 + (Math.sin(this.beta)) * this.Rc;
    }
    incBeta() {
        this.beta += 0.01;
        this.Xc = this.X0 + (Math.cos(this.beta) * Math.cos(this.alpha)) * this.Rc;
        this.Yc = this.Y0 + (Math.cos(this.beta) * Math.sin(this.alpha)) * this.Rc;
        this.Zc = this.Z0 + (Math.sin(this.beta)) * this.Rc;
    }
    decBeta() {
        this.beta -= 0.01;
        this.Xc = this.X0 + (Math.cos(this.beta) * Math.cos(this.alpha)) * this.Rc;
        this.Yc = this.Y0 + (Math.cos(this.beta) * Math.sin(this.alpha)) * this.Rc;
        this.Zc = this.Z0 + (Math.sin(this.beta)) * this.Rc;
    }



    incY0() {
        let unitVec = this.getYaxisUnitVector();
        // this.Y0 += 0.01;
        this.X0 += (unitVec[0] / 10)
        this.Y0 += (unitVec[1] / 10)
        this.Z0 += (unitVec[2] / 10)
        // this.Rc-=0.1;
        this.Xc = this.X0 + (Math.cos(this.beta) * Math.cos(this.alpha)) * this.Rc;
        this.Yc = this.Y0 + (Math.cos(this.beta) * Math.sin(this.alpha)) * this.Rc;
        this.Zc = this.Z0 + (Math.sin(this.beta)) * this.Rc;
    }
    decY0() {
        let unitVec = this.getYaxisUnitVector();
        // this.Y0 -= 0.01;
        this.X0 -= (unitVec[0] / 10)
        this.Y0 -= (unitVec[1] / 10)
        this.Z0 -= (unitVec[2] / 10)
        // this.Rc-=0.1;
        this.Xc = this.X0 + (Math.cos(this.beta) * Math.cos(this.alpha)) * this.Rc;
        this.Yc = this.Y0 + (Math.cos(this.beta) * Math.sin(this.alpha)) * this.Rc;
        this.Zc = this.Z0 + (Math.sin(this.beta)) * this.Rc;
    }


    incX0() {
        let unitVec = this.getXaxisUnitVector();
        // this.X0 += 0.01;
        this.X0 += (unitVec[0] / 10)
        this.Y0 += (unitVec[1] / 10)
        this.Z0 += (unitVec[2] / 10)
        // this.Rc-=0.1;
        this.Xc = this.X0 + (Math.cos(this.beta) * Math.cos(this.alpha)) * this.Rc;
        this.Yc = this.Y0 + (Math.cos(this.beta) * Math.sin(this.alpha)) * this.Rc;
        this.Zc = this.Z0 + (Math.sin(this.beta)) * this.Rc;
    }
    decX0() {
        let unitVec = this.getXaxisUnitVector();
        // this.X0 -= 0.01;
        this.X0 -= (unitVec[0] / 10)
        this.Y0 -= (unitVec[1] / 10)
        this.Z0 -= (unitVec[2] / 10)
        // this.Rc-=0.1;
        this.Xc = this.X0 + (Math.cos(this.beta) * Math.cos(this.alpha)) * this.Rc;
        this.Yc = this.Y0 + (Math.cos(this.beta) * Math.sin(this.alpha)) * this.Rc;
        this.Zc = this.Z0 + (Math.sin(this.beta)) * this.Rc;
    }



    incZ0() {
        let unitVec = this.getZaxisUnitVector();
        // this.Z0 += 0.01;
        this.X0 -= (unitVec[0] / 5)
        this.Y0 -= (unitVec[1] / 5)
        // this.Z0 -= (unitVec[2] / 10)
        // this.Rc-=0.1;
        this.Xc = this.X0 + (Math.cos(this.beta) * Math.cos(this.alpha)) * this.Rc;
        this.Yc = this.Y0 + (Math.cos(this.beta) * Math.sin(this.alpha)) * this.Rc;
        this.Zc = this.Z0 + (Math.sin(this.beta)) * this.Rc;
    }
    decZ0() {
        let unitVec = this.getZaxisUnitVector();
        // this.Z0 -= 0.01;
        this.X0 += (unitVec[0] / 5)
        this.Y0 += (unitVec[1] / 5)
        // this.Z0 += (unitVec[2] / 6)
        // this.Rc-=0.1;
        this.Xc = this.X0 + (Math.cos(this.beta) * Math.cos(this.alpha)) * this.Rc;
        this.Yc = this.Y0 + (Math.cos(this.beta) * Math.sin(this.alpha)) * this.Rc;
        this.Zc = this.Z0 + (Math.sin(this.beta)) * this.Rc;
    }


    incRc() {
        this.Rc += 0.1;
        this.Xc = this.X0 + (Math.cos(this.beta) * Math.cos(this.alpha)) * this.Rc;
        this.Yc = this.Y0 + (Math.cos(this.beta) * Math.sin(this.alpha)) * this.Rc;
        this.Zc = this.Z0 + (Math.sin(this.beta)) * this.Rc;
    }
    decRc() {
        this.Rc -= 0.1;
        this.Xc = this.X0 + (Math.cos(this.beta) * Math.cos(this.alpha)) * this.Rc;
        this.Yc = this.Y0 + (Math.cos(this.beta) * Math.sin(this.alpha)) * this.Rc;
        this.Zc = this.Z0 + (Math.sin(this.beta)) * this.Rc;
    }

    getPointParameter(point) {
        let x2 = this.getMagnifiedPosition(point)[0];
        let y2 = this.getMagnifiedPosition(point)[1];
        let z2 = this.getZProj(point);
        let r2 = this.getRadialDist(point);
        let m2 = this.getMagniValue(point);

        // console.log(x2*100+","+y2*100+","+m2*1.3);

        // if(c==2){
        //     context.fillStyle = "green";
        // }
        // if(c==-2){
        //     context.fillStyle = "blue";
        // }
        // else{
        // }
        // context.fillStyle = col;
        return [Number(400 + x2 * 100), Number(400 + y2 * 100), Number(z2), Number(m2 * 1.3)];

    }



    fillFace(point, wid, hei, bre, col) {

        // context.fillStyle = "green";
        // context.beginPath();
        // context.moveTo(this.getPointParameter(point)[0], this.getPointParameter(a4)[1]);
        // context.lineTo(getRectPerameter(b4)[0], getRectPerameter(b4)[1]);
        // context.lineTo(getRectPerameter(c4)[0], getRectPerameter(c4)[1]);
        // context.lineTo(getRectPerameter(d4)[0], getRectPerameter(d4)[1]);
        // context.fill();


    }




}