import { QUALITY } from "./config.js";

/**
 * DebugOverlay: a small performance panel for a Game. Frame rate, frame time, draw calls, what was culled,
 * triangles, resolution, and buttons to switch the quality preset while the game runs.
 *
 *   const debug = new DebugOverlay(game);          // hidden; press ` (the key under Esc) to show it
 *   new DebugOverlay(game, { visible: true, corner: "top-right" });
 *
 * The numbers come from `renderer.stats` and the Loop. The text is rewritten four times a second, not
 * every frame, so the panel itself doesn't show up in the timings it reports.
 * @module engine/DebugOverlay
 */
export class DebugOverlay {
    /**
     * @param {import("./Game.js").Game} game
     * @param {{ visible?: boolean, key?: string | null, corner?: "top-left" | "top-right" | "bottom-left" | "bottom-right",
     *           parent?: HTMLElement }} [options] key: KeyboardEvent.code that toggles the panel (null for none)
     */
    constructor(game, options = {}) {
        this.game = game;
        this.visible = options.visible ?? false;
        const [v, h] = (options.corner || "top-right").split("-");
        const el = (this.element = document.createElement("div"));
        el.style.cssText = `position:fixed;${v}:10px;${h}:10px;z-index:30;padding:8px 10px;border-radius:8px;white-space:pre;`
            + "font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#d8def0;background:rgba(8,10,20,0.82);"
            + "border:1px solid rgba(160,185,255,0.22);font-variant-numeric:tabular-nums;";
        this.text = document.createElement("div");
        this.text.setAttribute("role", "status");
        this.text.setAttribute("aria-live", "off");
        const row = document.createElement("div");
        row.style.cssText = "display:flex;gap:4px;margin-top:6px";
        this.buttons = Object.keys(QUALITY).map((level) => {
            const b = document.createElement("button");
            b.type = "button";
            b.textContent = level;
            b.style.cssText = "font:inherit;color:inherit;background:transparent;border:1px solid rgba(160,185,255,0.3);border-radius:5px;padding:1px 6px;cursor:pointer";
            b.addEventListener("click", () => { game.renderer.setQuality(level); this._paint(); });
            row.appendChild(b);
            return b;
        });
        el.append(this.text, row);
        (options.parent || document.body).appendChild(el);
        this._since = 1;
        this._key = options.key === undefined ? "Backquote" : options.key;
        this._onKey = (e) => { if (e.code === this._key && !e.repeat) this.toggle(); };
        if (this._key) window.addEventListener("keydown", this._onKey);
        game.onRender((frameDelta) => this.update(frameDelta));
        this.setVisible(this.visible);
    }

    setVisible(on) { this.visible = on; this.element.style.display = on ? "block" : "none"; if (on) this._paint(); }
    toggle() { this.setVisible(!this.visible); }

    /** Called every rendered frame by the Game. */
    update(frameDelta) {
        if (!this.visible) return;
        this._since += frameDelta;
        if (this._since < 0.25) return;
        this._since = 0;
        this._paint();
    }

    _paint() {
        const { renderer, loop } = this.game;
        if (!renderer) return;
        const s = renderer.stats, n = (v) => (v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v >= 1e4 ? (v / 1e3).toFixed(1) + "k" : String(Math.round(v)));
        this.text.textContent =
            `${String(Math.round(loop.fps)).padStart(3)} fps   ${loop.frameMs.toFixed(1)} ms\n` +
            `draws ${s.drawCalls} + ${s.shadowCalls} shadow${s.postPasses ? ` + ${s.postPasses} post` : ""}\n` +
            `culled ${s.culled}   tris ${n(s.triangles)}${s.instances ? `   inst ${n(s.instances)}` : ""}\n` +
            `${s.width}×${s.height}   ${renderer.caps.webgl2 ? "WebGL2" : "WebGL1"}   ${s.programs} programs`;
        for (const b of this.buttons) b.style.background = b.textContent === renderer.quality ? "rgba(160,185,255,0.28)" : "transparent";
    }

    dispose() {
        this.visible = false;
        if (this._key) window.removeEventListener("keydown", this._onKey);
        this.element.remove();
    }
}
