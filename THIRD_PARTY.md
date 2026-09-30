# Third-party software

Allowed licenses: MIT, BSD, Apache-2.0, ISC, zlib, CC0 (plus SIL OFL 1.1 for fonts only, decision
D3 in ARCHITECTURE.md). Every entry below was checked against its repository's LICENSE on 2026-10-01.

## In use today

| Name | Version | License | URL | Purpose | Where |
|---|---|---|---|---|---|
| express | ^5.2.1 | MIT | https://github.com/expressjs/express | Local dev server (`npm start`) | `index.js` (not deployed) |
| dotenv | ^17.3.1 | BSD-2-Clause | https://github.com/motdotla/dotenv | Reads `PORT` for the dev server | `index.js` (not deployed) |
| gl-matrix | 3.4.4 | MIT | https://github.com/toji/gl-matrix | Model transforms (vec3, quat, mat3, mat4) for Transform and instancing. Camera/projection maths stay ours. | Vendored: `public/vendor/gl-matrix@3.4.4/` (ESM build + LICENSE.md), imported only via `public/engine/vendor.js` |

## Planned (to be vendored into `public/vendor/` when the phase that needs it lands)

| Name | Version (pinned) | License | URL | Purpose | Phase | Wrapped by |
|---|---|---|---|---|---|---|
| ZzFX | 1.3.2 | MIT | https://github.com/KilledByAPixel/ZzFX | Procedural sound effects, no audio files | P4 | `engine/Audio.js` |
| ZzFXM | 2.0.3 | MIT | https://github.com/keithclark/ZzFXM | Tiny procedural music | P4 | `engine/Audio.js` |
| Tweakpane | 4.0.5 | MIT | https://github.com/cocopon/tweakpane | Inspector / debug sliders and presets | P3 | `engine/Debug.js` |
| simplex-noise | 4.0.3 | MIT | https://github.com/jwagner/simplex-noise.js | CPU noise: terrain, camera shake, turbulence | P4 | `engine/Noise.js` |
| webgl-noise (Stefan Gustavson, Ashima Arts) | master @ 2025-04-27 | MIT | https://github.com/stegu/webgl-noise | GLSL simplex/cellular noise chunks | P2 | `shaders/chunks/noise.glsl` (header credits source) |
| cannon-es | 0.20.0 | MIT | https://github.com/pmndrs/cannon-es | *Optional*, heavy rigid-body physics for games that need it; teaching demos use our own physics | P7 (optional) | `engine/Physics.js` adapter |

## Considered and not used

| Name | License | Reason |
|---|---|---|
| twgl.js 7.0.0 | MIT | Would hide the WebGL plumbing this repo exists to teach; our wrappers are small. |
| GSAP 3.15.0 | GSAP "Standard no-charge" license (not on the allowed list) | Replaced by our own `Tween` + CSS / Web Animations API. (Neon Rush, a separate repo, uses it today.) |
| lil-gui 0.21.0 | MIT | Tweakpane covers the same need with better presets and plugins. |
| stats-gl 4.2.3 | MIT | Our own `Performance` HUD reports exactly the numbers we need (draw calls, vertices, particles). |

## Ported algorithms and shaders

None yet. Every ported algorithm or shader gets a header comment with its source URL and license, and
a row here. Shadertoy code is **not** used unless its author states a compatible license (the default
Shadertoy license is CC BY-NC-SA, which is not allowed).

## Fonts (D3: OFL allowed for fonts only)

| Font | License | Source | Use |
|---|---|---|---|
| (display font, TBD in P3) | SIL OFL 1.1 | Google Fonts | UI headings, self-hosted in `public/vendor/fonts/` |
| (mono font, TBD in P3) | SIL OFL 1.1 | Google Fonts | Code / HUD, self-hosted |
