/**
 * Input: keyboard, mouse, touch, pointer lock and gamepads behind named actions.
 *
 *   input.bind("jump", ["Space", "KeyW", "GamepadA"]);
 *   input.bindAxis("steer", { negative: ["KeyA", "ArrowLeft"], positive: ["KeyD", "ArrowRight"], gamepad: "LeftX" });
 *   // inside a fixed update:
 *   if (input.wasPressed("jump")) player.jump();
 *   player.x += input.axis("steer") * speed * dt;
 *
 * Edge semantics with a fixed-step loop: a press that happens between two steps is reported by
 * wasPressed() in exactly ONE step, even if the key was already released, so short taps are never lost.
 * The owner calls `beginStep()` before and `endStep()` after each fixed update (Game does this).
 *
 * The engine binds nothing by default; every key a game uses is declared by that game.
 * @module engine/Input
 */

/** Standard-mapping gamepad button names → button index. */
export const GAMEPAD_BUTTONS = Object.freeze({
    GamepadA: 0, GamepadB: 1, GamepadX: 2, GamepadY: 3, GamepadLB: 4, GamepadRB: 5, GamepadLT: 6, GamepadRT: 7,
    GamepadBack: 8, GamepadStart: 9, GamepadLS: 10, GamepadRS: 11,
    GamepadUp: 12, GamepadDown: 13, GamepadLeft: 14, GamepadRight: 15,
});
/** Standard-mapping gamepad axis names → axis index. */
export const GAMEPAD_AXES = Object.freeze({ LeftX: 0, LeftY: 1, RightX: 2, RightY: 3 });

const STICK_DEADZONE = 0.18;
const PINCH_MIN_DISTANCE = 10;

export class Input {
    /**
     * @param {{ keyTarget?: EventTarget, pointerTarget?: HTMLElement | null }} [options]
     *        keyTarget: where keyboard events are read (default window)
     *        pointerTarget: element for mouse/touch/wheel (usually the canvas)
     */
    constructor(options = {}) {
        this.keyTarget = options.keyTarget || window;
        this.pointerTarget = options.pointerTarget || null;

        /** raw "is held" state by code (keys, Mouse0..2, Gamepad*) */
        this.down = new Set();
        this._pressedSinceStep = new Set();
        this._releasedSinceStep = new Set();
        this._pressed = new Set();
        this._released = new Set();

        /** @type {Map<string, string[]>} */
        this.actions = new Map();
        /** @type {Map<string, { negative: string[], positive: string[], gamepad?: string }>} */
        this.axes = new Map();

        /** pointer state; deltas accumulate between steps (see beginStep) */
        this.pointer = { x: 0, y: 0, dx: 0, dy: 0, wheel: 0, pinch: 1, dragging: false, locked: false, type: "mouse" };
        this._acc = { dx: 0, dy: 0, wheel: 0, pinch: 1 };
        this._touches = new Map();
        this._pinchStart = 0;

        this.gamepadIndex = -1;
        this._padPrev = [];

        this._listeners = [];
        this._listen(this.keyTarget, "keydown", (e) => this._onKey(e, true));
        this._listen(this.keyTarget, "keyup", (e) => this._onKey(e, false));
        this._listen(window, "blur", () => this._releaseAll());
        this._listen(window, "gamepadconnected", (e) => { if (this.gamepadIndex < 0) this.gamepadIndex = e.gamepad.index; });
        this._listen(window, "gamepaddisconnected", (e) => { if (this.gamepadIndex === e.gamepad.index) this.gamepadIndex = -1; });
        if (this.pointerTarget) this._bindPointer(this.pointerTarget);
    }

    // ------------------------------------------------------------------ mapping

    /** @param {string} action @param {string[]} codes KeyboardEvent.code, "Mouse0"/"Mouse1"/"Mouse2", or Gamepad* names */
    bind(action, codes) { this.actions.set(action, codes.slice()); return this; }

    /** @param {string} name @param {{ negative?: string[], positive?: string[], gamepad?: string }} spec */
    bindAxis(name, spec) { this.axes.set(name, { negative: spec.negative || [], positive: spec.positive || [], gamepad: spec.gamepad }); return this; }

    isDown(action) { return this._any(action, this.down); }
    wasPressed(action) { return this._any(action, this._pressed); }
    wasReleased(action) { return this._any(action, this._released); }

    /** -1..1 from keys and/or a gamepad stick (the larger magnitude wins). */
    axis(name) {
        const a = this.axes.get(name);
        if (!a) return 0;
        let v = 0;
        for (const c of a.negative) if (this.down.has(c)) { v -= 1; break; }
        for (const c of a.positive) if (this.down.has(c)) { v += 1; break; }
        if (a.gamepad) {
            const s = this.stick(a.gamepad);
            if (Math.abs(s) > Math.abs(v)) v = s;
        }
        return v;
    }

    /** Raw gamepad axis with dead-zone applied. */
    stick(axisName) {
        const pad = this._pad();
        if (!pad) return 0;
        const v = pad.axes[GAMEPAD_AXES[axisName]] || 0;
        return Math.abs(v) < STICK_DEADZONE ? 0 : v;
    }

    _any(action, set) {
        const codes = this.actions.get(action);
        if (!codes) return false;
        for (const c of codes) if (set.has(c)) return true;
        return false;
    }

    // ------------------------------------------------------------------ step boundaries

    /** Freeze this step's edges and pointer deltas. Call before each fixed update. */
    beginStep() {
        this._pollGamepad();
        this._pressed.clear(); for (const c of this._pressedSinceStep) this._pressed.add(c);
        this._released.clear(); for (const c of this._releasedSinceStep) this._released.add(c);
        this._pressedSinceStep.clear();
        this._releasedSinceStep.clear();
        const p = this.pointer, a = this._acc;
        p.dx = a.dx; p.dy = a.dy; p.wheel = a.wheel; p.pinch = a.pinch;
        a.dx = 0; a.dy = 0; a.wheel = 0; a.pinch = 1;
    }

    /** Clear edges after the step so they are reported only once. */
    endStep() {
        this._pressed.clear();
        this._released.clear();
        const p = this.pointer;
        p.dx = 0; p.dy = 0; p.wheel = 0; p.pinch = 1;
    }

    // ------------------------------------------------------------------ raw events

    _press(code) {
        if (!this.down.has(code)) { this.down.add(code); this._pressedSinceStep.add(code); }
    }
    _release(code) {
        if (this.down.has(code)) { this.down.delete(code); this._releasedSinceStep.add(code); }
    }
    _releaseAll() { for (const c of [...this.down]) this._release(c); }

    _onKey(e, isDown) {
        if (e.repeat) return;
        // don't steal typing from form fields
        const t = e.target;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        // a focused button or link owns its activation keys (Space / Enter), so keyboard users can press it
        if (t && /^(BUTTON|A|SUMMARY)$/.test(t.tagName) && (e.code === "Space" || e.code === "Enter" || e.code === "NumpadEnter")) return;
        if (isDown) this._press(e.code); else this._release(e.code);
        if (this._isBound(e.code)) e.preventDefault(); // e.g. Space / arrows would scroll the page
    }

    _isBound(code) {
        for (const codes of this.actions.values()) if (codes.includes(code)) return true;
        for (const a of this.axes.values()) if (a.negative.includes(code) || a.positive.includes(code)) return true;
        return false;
    }

    _bindPointer(el) {
        el.style.touchAction = "none"; // we handle pan/pinch ourselves
        this._listen(el, "pointerdown", (e) => {
            el.setPointerCapture?.(e.pointerId);
            this.pointer.type = e.pointerType;
            this._touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
            this._setPointerPos(e);
            if (this._touches.size === 1) { this._press("Mouse" + e.button); this.pointer.dragging = true; }
            if (this._touches.size === 2) this._pinchStart = this._touchDistance();
        });
        this._listen(el, "pointermove", (e) => {
            const t = this._touches.get(e.pointerId);
            if (this.pointer.locked) { this._acc.dx += e.movementX; this._acc.dy += e.movementY; return; }
            if (t) {
                if (this._touches.size === 1) { this._acc.dx += e.clientX - t.x; this._acc.dy += e.clientY - t.y; }
                t.x = e.clientX; t.y = e.clientY;
                if (this._touches.size === 2) {
                    const d = this._touchDistance();
                    if (this._pinchStart > PINCH_MIN_DISTANCE && d > PINCH_MIN_DISTANCE) this._acc.pinch *= d / this._pinchStart;
                    this._pinchStart = d;
                }
            }
            this._setPointerPos(e);
        });
        const up = (e) => {
            this._touches.delete(e.pointerId);
            this._release("Mouse" + e.button);
            if (this._touches.size === 0) { this.pointer.dragging = false; for (const b of ["Mouse0", "Mouse1", "Mouse2"]) this._release(b); }
        };
        this._listen(el, "pointerup", up);
        this._listen(el, "pointercancel", up);
        this._listen(el, "wheel", (e) => { e.preventDefault(); this._acc.wheel += e.deltaY; }, { passive: false });
        this._listen(el, "contextmenu", (e) => e.preventDefault());
        this._listen(document, "pointerlockchange", () => { this.pointer.locked = document.pointerLockElement === el; });
    }

    _setPointerPos(e) {
        const r = this.pointerTarget.getBoundingClientRect();
        this.pointer.x = e.clientX - r.left;
        this.pointer.y = e.clientY - r.top;
    }

    _touchDistance() {
        const [a, b] = [...this._touches.values()];
        return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    }

    /** Request pointer lock (first-person look). Must be called from a user gesture. */
    lockPointer() { this.pointerTarget?.requestPointerLock?.(); }
    unlockPointer() { if (document.pointerLockElement) document.exitPointerLock(); }

    _pad() {
        if (this.gamepadIndex < 0 || !navigator.getGamepads) return null;
        return navigator.getGamepads()[this.gamepadIndex] || null;
    }

    _pollGamepad() {
        const pad = this._pad();
        if (!pad) return;
        for (const name in GAMEPAD_BUTTONS) {
            const b = pad.buttons[GAMEPAD_BUTTONS[name]];
            const pressed = !!b && (b.pressed || b.value > 0.5);
            if (pressed) this._press(name); else this._release(name);
        }
    }

    _listen(target, type, fn, opts) {
        target.addEventListener(type, fn, opts);
        this._listeners.push([target, type, fn, opts]);
    }

    dispose() {
        for (const [t, type, fn, opts] of this._listeners) t.removeEventListener(type, fn, opts);
        this._listeners.length = 0;
    }
}
