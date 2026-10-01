# Third-party software

Allowed licenses: MIT, BSD, Apache-2.0, ISC, zlib, CC0 (plus SIL OFL 1.1 for fonts only, decision
D3 in ARCHITECTURE.md). Every entry below was checked against its repository's LICENSE on 2026-10-01.

## In use today

| Name | Version | License | URL | Purpose | Where |
|---|---|---|---|---|---|
| express | ^5.2.1 | MIT | https://github.com/expressjs/express | Local dev server (`npm start`) | `index.js` (not deployed) |
| dotenv | ^17.3.1 | BSD-2-Clause | https://github.com/motdotla/dotenv | Reads `PORT` for the dev server | `index.js` (not deployed) |
| gl-matrix | 3.4.4 | MIT | https://github.com/toji/gl-matrix | Model transforms (vec3, quat, mat3, mat4) for Transform and instancing. Camera/projection maths stay ours. | Vendored: `public/vendor/gl-matrix@3.4.4/` (ESM build + LICENSE.md), imported only via `public/engine/vendor.js` |
| ZzFX | 1.3.2 | MIT | https://github.com/KilledByAPixel/ZzFX | Procedural sound effects (sample generator only; playback uses our own mixer) | Vendored: `public/vendor/zzfx@1.3.2/` (ZzFX.js + LICENSE), lazy-imported by `public/engine/Audio.js` |
| esbuild | 0.25.10 | MIT | https://github.com/evanw/esbuild | Builds the optional single-file bundle (`npm run build`) | devDependency, used only by `tools/build.mjs` (not deployed) |

## Planned (to be vendored into `public/vendor/` when the phase that needs it lands)

| Name | Version (pinned) | License | URL | Purpose | Phase | Wrapped by |
|---|---|---|---|---|---|---|
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

| What | Source | License / status | Where |
|---|---|---|---|
| ACES filmic tone-mapping curve (formula) | Krzysztof Narkowicz, 2016, https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/ | Published formula, reimplemented | `shaders/postprocessing/post.js` |
| Easing equations | Robert Penner | Published formulas, reimplemented | `engine/Tween.js` |
| Trauma-based camera shake (idea) | Squirrel Eiserloh, GDC 2016 | Technique, reimplemented | `engine/Juice.js` |
| GGX microfacet distribution, height-correlated Smith visibility, Schlick Fresnel | Walter et al. 2007; Heitz 2014; Schlick 1994 | Published formulas, reimplemented | `shaders/chunks/lighting.js` |
| Analytic environment-BRDF fit | Brian Karis, "Physically Based Shading on Mobile", 2014, https://www.unrealengine.com/en-US/blog/physically-based-shading-on-mobile | Published formula, reimplemented | `shaders/chunks/lighting.js` |
| Ray-triangle intersection | Möller and Trumbore, 1997 | Published algorithm, reimplemented | `engine/Collision.js` |
| Cascaded shadow maps with stable (sphere-fitted, texel-snapped) cascades | Technique described by Michal Valient, "Stable Rendering of Cascaded Shadow Maps", ShaderX6, 2008 | Technique, reimplemented | `engine/ShadowMap.js` |
| mulberry32 random number generator | Tommy Ettinger (public domain) | Reimplemented | `examples/shared.js` |

Every ported algorithm or shader gets a header comment with its source URL and license, and
a row here. Shadertoy code is **not** used unless its author states a compatible license (the default
Shadertoy license is CC BY-NC-SA, which is not allowed).

## Fonts (D3: OFL allowed for fonts only)

| Font | License | Source | Use |
|---|---|---|---|
| Space Grotesk (variable, latin subset) | SIL OFL 1.1 | https://github.com/floriankarsten/space-grotesk | Site and example text, self-hosted: `public/vendor/fonts/SpaceGrotesk-latin.woff2` (licence: `OFL-SpaceGrotesk.txt`) |
| JetBrains Mono (variable, latin subset) | SIL OFL 1.1 | https://github.com/JetBrains/JetBrainsMono | Code and numbers, self-hosted: `public/vendor/fonts/JetBrainsMono-latin.woff2` (licence: `OFL-JetBrainsMono.txt`) |

## Art

There are no third-party art assets. `public/assets/models/person.glb` and `dog.glb` are generated in code
(`tools/make-models.mjs` in the Night Market repository) and copied here for the characters example.
`public/assets/shots/` holds screenshots of this project's own pages and games, captured by `tools/shots.mjs`.
