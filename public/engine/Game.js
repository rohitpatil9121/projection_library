import { Renderer, RendererError } from "./Renderer.js";
import { showWebGLFailure } from "./gl/GLContext.js";
import { Scene } from "./Scene.js";
import { Camera } from "./Camera.js";
import { Input } from "./Input.js";
import { Loop } from "./Loop.js";
import { Tweens } from "./Tween.js";
import { Juice } from "./Juice.js";

/**
 * Game: the high-level facade that wires Renderer, Scene, Camera, Input and Loop together.
 *
 *   const game = new Game({ canvas, quality: "high" });
 *   game.add(new Entity({ mesh: new Mesh(box(), new BasicMaterial()) }));
 *   game.onUpdate((dt) => { ... });   // fixed 60 Hz steps
 *   game.start();
 *
 * If WebGL is unavailable, `game.failed` is true, a readable message replaces the canvas, and start()
 * does nothing, so a page never shows a blank screen.
 * @module engine/Game
 */
export class Game {
    /**
     * @param {{ canvas: HTMLCanvasElement, quality?: "low" | "medium" | "high" | "ultra", camera?: Camera,
     *           preferWebGL2?: boolean, antialias?: boolean, container?: HTMLElement }} options
     */
    constructor(options) {
        this.canvas = options.canvas;
        this.failed = false;
        try {
            this.renderer = new Renderer(this.canvas, options);
        } catch (err) {
            if (!(err instanceof RendererError)) throw err;
            this.failed = true;
            this.error = err;
            showWebGLFailure(options.container || this.canvas.parentElement || document.body, err.message);
            return;
        }
        this.scene = new Scene();
        this.camera = options.camera || new Camera();
        this.input = new Input({ pointerTarget: this.canvas });
        /** tweens advance in real time every rendered frame (UI and camera moves keep working while paused) */
        this.tweens = new Tweens();
        /** camera shake / hit-stop; reads prefers-reduced-motion */
        this.juice = new Juice({ camera: this.camera });
        /** @type {Array<(dt: number, game: Game) => void>} */
        this._updaters = [];
        /** @type {Array<(frameDelta: number, alpha: number, game: Game) => void>} */
        this._renderers = [];
        this.loop = new Loop({
            update: (dt) => this._update(dt),
            render: (alpha, frameDelta) => this._render(alpha, frameDelta),
        });
    }

    /** Add an entity to the scene (optionally under a parent entity). */
    add(entity, parent) { return this.scene.add(entity, parent); }
    remove(entity) { return this.scene.remove(entity); }

    /** Run `fn(dt, game)` every fixed simulation step (dt = 1/60 s × timeScale semantics via the Loop). */
    onUpdate(fn) { this._updaters.push(fn); return this; }

    /** Run `fn(frameDelta, alpha, game)` every rendered frame, before drawing (camera controls, UI). */
    onRender(fn) { this._renderers.push(fn); return this; }

    start() { if (!this.failed) this.loop.start(); return this; }
    pause() { this.loop?.pause(); return this; }
    resume() { this.loop?.resume(); return this; }
    get paused() { return !!this.loop?.paused; }

    /** Seconds of simulated time. */
    get time() { return this.loop ? this.loop.time : 0; }

    _update(dt) {
        if (this.juice.frozen) return; // hit-stop: hold the simulation for a few frames
        this.scene.snapshot();
        this.input.beginStep();
        for (let i = 0; i < this._updaters.length; i++) this._updaters[i](dt, this);
        this.scene.update(dt);
        this.input.endStep();
    }

    _render(alpha, frameDelta) {
        this.tweens.update(frameDelta);
        this.juice.update(frameDelta);
        this.renderer.time = this.loop.realTime;
        for (let i = 0; i < this._renderers.length; i++) this._renderers[i](frameDelta, alpha, this);
        this.camera.update(frameDelta);
        this.renderer.render(this.scene, this.camera, alpha);
    }

    dispose() {
        this.loop?.dispose();
        this.input?.dispose();
        this.renderer?.dispose();
    }
}
