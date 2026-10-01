/**
 * The scene at the top of the landing page. It uses the engine's parts directly (Renderer, Scene, Camera,
 * Loop) rather than Game, because a page that scrolls must keep its wheel and its vertical swipes: the
 * canvas only takes horizontal drags.
 * @module site/hero
 */
import { Renderer, Scene, Camera, Loop, Entity, Mesh, PBRMaterial, StandardMaterial, ShadowMap, PostFX, primitives } from "../engine/index.js";

const canvas = document.getElementById("hero");
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

let renderer = null;
try { renderer = new Renderer(canvas, { antialias: false }); } catch { canvas.remove(); }      // the poster image underneath stays

if (renderer) {
    const scene = new Scene(), camera = new Camera({ distance: 15.5, pitch: 0.36, yaw: -1.05, target: [0, 0, 1.25], fov: 40 });
    renderer.postfx = new PostFX(renderer, { ao: { enabled: true, radius: 0.6 }, bloom: { threshold: 1.0, intensity: 0.6 }, vignette: 0.18, grain: 0.012 });
    scene.sunDirection.set([0.5, -0.45, 0.74]);
    scene.sunColor.set([1.05, 0.95, 0.82]);
    scene.shadow = new ShadowMap({ center: [0, 0, 0], extent: [9, 9], depth: 40, size: 2048, strength: 0.75 });

    // the canvas takes the page's own background, so the scene sits in the page instead of in a box
    const theme = () => {
        const dark = !matchMedia("(prefers-color-scheme: light)").matches;
        const bg = dark ? [0.082, 0.09, 0.125] : [0.984, 0.984, 0.992];
        scene.clearColor.set([...bg, 1]);
        scene.fogColor.set(bg); scene.fogDensity = dark ? 0.02 : 0.012;
        scene.skyColor.set(dark ? [0.34, 0.4, 0.58] : [0.33, 0.37, 0.5]);
        scene.groundColor.set(dark ? [0.12, 0.11, 0.12] : [0.24, 0.22, 0.22]);
        floor.color.set(dark ? [0.2, 0.21, 0.27] : [0.7, 0.71, 0.76]);
        renderer.postfx.settings.exposure = dark ? 1 : 0.92;
    };

    const add = (geometry, material, x, y, z) => { const e = scene.add(new Entity({ mesh: new Mesh(geometry, material) })); e.setPosition(x, y, z); return e; };
    const floor = new PBRMaterial({ roughness: 0.55 });
    add(primitives.cylinder(8.5, 8.5, 0.4, 96), floor, 0, 0, -0.2);
    add(primitives.sphere(1.5, 64, 40), new PBRMaterial({ color: [1.0, 0.77, 0.34], metallic: 1, roughness: 0.2, envIntensity: 2.2 }), 0, 0, 1.5);
    const ring = add(primitives.torus(2.5, 0.16, 16, 96), new PBRMaterial({ color: [0.95, 0.64, 0.54], metallic: 1, roughness: 0.34, envIntensity: 2 }), 0, 0, 1.5);
    const blocks = [[-4.2, 1.6, 1.3, [0.9, 0.28, 0.24]], [-3.1, 3.3, 0.9, [0.24, 0.5, 0.92]], [3.9, 2.4, 1.1, [0.3, 0.74, 0.52]], [4.4, -2.0, 0.8, [0.93, 0.93, 0.95]], [-3.6, -2.9, 1.0, [0.62, 0.44, 0.9]]]
        .map(([x, y, s, color]) => add(primitives.box(s, s, s), new PBRMaterial({ color, roughness: 0.45 }), x, y, s / 2));
    add(primitives.cone(0.8, 1.9, 40), new PBRMaterial({ color: [0.95, 0.56, 0.2], roughness: 0.6 }), 1.4, -4.2, 0.95);
    add(primitives.capsule(0.45, 1.1), new PBRMaterial({ color: [0.2, 0.62, 0.7], roughness: 0.3 }), -0.6, 4.6, 1.0);

    const lamp = { position: [0, 0, 2.2], color: [2.4, 1.3, 0.6], radius: 9 };
    scene.pointLights.push(lamp);
    const bulb = scene.add(new Entity({ castShadow: false, mesh: new Mesh(primitives.sphere(0.13, 12, 8), new StandardMaterial({ lit: false, color: [3.4, 2.2, 1.0], castShadow: false })) }));
    theme();
    matchMedia("(prefers-color-scheme: light)").addEventListener("change", theme);

    // horizontal drags turn the scene; vertical ones are left to the page
    let dragging = null, spin = still ? 0 : 0.14;
    canvas.addEventListener("pointerdown", (e) => { dragging = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        camera.orbit(-(e.clientX - dragging.x) * 0.006, (e.clientY - dragging.y) * 0.004);
        camera.pitch = Math.max(0.12, Math.min(1.2, camera.pitch));
        dragging = { x: e.clientX, y: e.clientY };
        spin = 0;
    });
    const release = () => { dragging = null; };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);

    let time = still ? 1.2 : 0, frames = 0;
    const pose = () => {
        ring.setRotationEuler(0.9 + Math.sin(time * 0.5) * 0.25, time * 0.6, 0);
        const a = time * 0.7, x = Math.cos(a) * 5.2, y = Math.sin(a) * 5.2;
        lamp.position = [x, y, 2.2];
        bulb.setPosition(x, y, 2.2);
        blocks.forEach((b, i) => b.setYaw(time * 0.25 * (i % 2 ? 1 : -1) + i));
    };
    const loop = new Loop({
        update: (dt) => { scene.snapshot(); if (!still) time += dt; pose(); if (!dragging) camera.yaw += spin * dt; scene.update(dt); },
        render: (alpha, delta) => {
            camera.update(delta);
            renderer.time = loop.realTime;
            renderer.render(scene, camera, alpha);
            if (++frames === 4) window.__ready = true;
        },
    });
    pose();
    // draw only while the scene is on screen
    new IntersectionObserver(([entry]) => { if (entry.isIntersecting) loop.start(); else loop.stop(); }, { threshold: 0.05 }).observe(canvas);
    window.lab = { renderer, scene, camera, loop };
}
