/**
 * TouchControls: an on-screen joystick and buttons for phones and tablets, feeding the same Input actions
 * and axes the keyboard and gamepad do. The game code doesn't change.
 *
 *   input.bindAxis("moveX", { negative: ["KeyA"], positive: ["KeyD"], gamepad: "LeftX" });
 *   input.bindAxis("moveY", { negative: ["KeyS"], positive: ["KeyW"] });
 *   input.bind("jump", ["Space", "TouchA"]);
 *
 *   const touch = new TouchControls(game.input);
 *   touch.joystick({ x: "moveX", y: "moveY" });           // bottom left; up on the stick is +1 on y
 *   touch.button({ code: "TouchA", label: "Jump" });       // bottom right
 *
 * By default the controls appear only on devices whose main pointer is a finger (`visible: "auto"`).
 * They are plain DOM elements over the page, so they stay sharp at any resolution and cost the renderer
 * nothing. The joystick floats: it re-centres under the thumb wherever the thumb lands in its half of
 * the screen, so nobody has to look down to find it.
 * @module engine/TouchControls
 */

/** Route the rest of a touch to the element it started on (a no-op for pointers the browser doesn't know). */
function capture(el, id) { try { el.setPointerCapture(id); } catch { /* synthetic or already-released pointer */ } }

const BASE = "position:absolute;touch-action:none;user-select:none;-webkit-user-select:none;box-sizing:border-box;";

export class TouchControls {
    /**
     * @param {import("./Input.js").Input} input
     * @param {{ parent?: HTMLElement, visible?: boolean | "auto", color?: string }} [options]
     */
    constructor(input, options = {}) {
        this.input = input;
        this.color = options.color || "255,255,255";
        const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
        this.visible = options.visible === "auto" || options.visible === undefined ? coarse : !!options.visible;
        this.root = document.createElement("div");
        this.root.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:20;display:${this.visible ? "block" : "none"}`;
        this.root.setAttribute("aria-hidden", "true");      // keyboard and gamepad users have the real bindings
        (options.parent || document.body).appendChild(this.root);
        this._cleanup = [];
    }

    setVisible(on) { this.visible = on; this.root.style.display = on ? "block" : "none"; }

    /**
     * @param {{ x?: string, y?: string, side?: "left" | "right", size?: number, deadzone?: number }} [options]
     *        x, y: names of Input axes to drive (-1..1); size: diameter in CSS pixels
     */
    joystick(options = {}) {
        const size = options.size ?? 120, side = options.side || "left", dead = options.deadzone ?? 0.12, input = this.input;
        const zone = document.createElement("div");
        zone.style.cssText = `${BASE}${side}:0;bottom:0;width:50%;height:60%;pointer-events:auto;`;
        const base = document.createElement("div");
        base.style.cssText = `${BASE}width:${size}px;height:${size}px;border-radius:50%;border:2px solid rgba(${this.color},0.35);background:rgba(${this.color},0.08);${side}:24px;bottom:24px;pointer-events:none;`;
        const knob = document.createElement("div");
        knob.style.cssText = `${BASE}width:${size * 0.44}px;height:${size * 0.44}px;border-radius:50%;background:rgba(${this.color},0.45);left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none;`;
        base.appendChild(knob);
        zone.appendChild(base);
        this.root.appendChild(zone);

        const stick = { x: 0, y: 0, active: false, element: zone };
        let id = null, cx = 0, cy = 0;
        const set = (x, y) => {
            stick.x = x; stick.y = y;
            if (options.x) input.virtualAxes.set(options.x, x);
            if (options.y) input.virtualAxes.set(options.y, y);
            knob.style.transform = `translate(calc(-50% + ${x * size * 0.5}px), calc(-50% + ${-y * size * 0.5}px))`;
        };
        const move = (e) => {
            let dx = (e.clientX - cx) / (size / 2), dy = (cy - e.clientY) / (size / 2);     // screen y runs downward
            const m = Math.hypot(dx, dy);
            if (m > 1) { dx /= m; dy /= m; }
            if (m < dead) { dx = 0; dy = 0; }
            set(dx, dy);
        };
        const down = (e) => {
            if (id !== null) return;
            id = e.pointerId;
            capture(zone, id);
            // re-centre the stick under the thumb
            const r = zone.getBoundingClientRect();
            cx = e.clientX; cy = e.clientY;
            base.style[side] = "auto"; base.style.bottom = "auto";
            base.style.left = `${cx - r.left - size / 2}px`; base.style.top = `${cy - r.top - size / 2}px`;
            stick.active = true;
            move(e);
        };
        const up = (e) => {
            if (e.pointerId !== id) return;
            id = null; stick.active = false;
            set(0, 0);
        };
        const onMove = (e) => { if (e.pointerId === id) move(e); };
        zone.addEventListener("pointerdown", down);
        zone.addEventListener("pointermove", onMove);
        zone.addEventListener("pointerup", up);
        zone.addEventListener("pointercancel", up);
        this._cleanup.push(() => { if (options.x) input.virtualAxes.delete(options.x); if (options.y) input.virtualAxes.delete(options.y); });
        return stick;
    }

    /**
     * @param {{ code: string, label?: string, side?: "left" | "right", size?: number, offset?: number[] }} options
     *        code: what Input sees while it is held; list it in `input.bind(action, [..., code])`
     *        offset: [from the side, from the bottom] in CSS pixels, to lay out several buttons
     */
    button(options) {
        const size = options.size ?? 72, side = options.side || "right", [ox, oy] = options.offset || [28, 36], input = this.input;
        const el = document.createElement("div");
        el.textContent = options.label ?? "";
        el.style.cssText = `${BASE}${side}:${ox}px;bottom:${oy}px;width:${size}px;height:${size}px;border-radius:50%;pointer-events:auto;display:grid;place-items:center;`
            + `font:600 14px system-ui,sans-serif;color:rgba(${this.color},0.9);border:2px solid rgba(${this.color},0.35);background:rgba(${this.color},0.1);`;
        const held = new Set();
        const down = (e) => { capture(el, e.pointerId); held.add(e.pointerId); input.press(options.code); el.style.background = `rgba(${this.color},0.3)`; e.preventDefault(); };
        const up = (e) => { held.delete(e.pointerId); if (!held.size) { input.release(options.code); el.style.background = `rgba(${this.color},0.1)`; } };
        el.addEventListener("pointerdown", down);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
        this.root.appendChild(el);
        this._cleanup.push(() => input.release(options.code));
        return el;
    }

    dispose() {
        for (const fn of this._cleanup) fn();
        this._cleanup.length = 0;
        this.root.remove();
    }
}
