export default class Structure {
    constructor(vertArrays, colArr) {
        this.vertArrays = vertArrays;
        this.colArr = colArr;

        this.startVertId = 0;
        this.endVertId = vertArrays.length / 4;

        this.minX = Infinity;
        this.maxX = -Infinity;
        this.minY = Infinity;
        this.maxY = -Infinity;
        this.minZ = Infinity;
        this.maxZ = -Infinity;

        this.totalVert = vertArrays.length / 4;
        for (let i = 0; i < this.totalVert; i++) {

            if (this.vertArrays[0 + 4 * i] < this.minX) {
                this.minX = this.vertArrays[0 + 4 * i];
            }
            if (this.vertArrays[0 + 4 * i] > this.maxX) {
                this.maxX = this.vertArrays[0 + 4 * i];
            }

            if(this.vertArrays[1 + 4 * i] < this.minY){
                this.minY = this.vertArrays[1 + 4 * i];
            }
            if(this.vertArrays[1 + 4 * i] > this.maxY){
                this.maxY = this.vertArrays[1 + 4 * i];
            }

            if(this.vertArrays[2 + 4 * i] < this.minZ){
                this.minZ = this.vertArrays[2 + 4 * i];
            }
            if(this.vertArrays[2 + 4 * i] > this.maxZ){
                this.maxZ = this.vertArrays[2 + 4 * i];
            }

        }
    }
    move(dx,dy,dz){
        this.minX+=dx;
        this.maxX+=dx;

        this.minY+=dy;
        this.maxY+=dy;

        this.minZ+=dz;
        this.maxZ+=dz;

        for(let i=0;i<this.totalVert;i++){
            this.vertArrays[0 + 4 * i]+=dx;
            this.vertArrays[1 + 4 * i]+=dy;
            this.vertArrays[2 + 4 * i]+=dz;
        }

    }
}