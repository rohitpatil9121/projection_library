/**
 * The only place the engine imports third-party code.
 *
 * Libraries are vendored under public/vendor/<name>@<exact version>/ so the site works offline and never
 * changes underneath us. The version is part of the path, so upgrading is a deliberate one-line change here
 * (and a row in THIRD_PARTY.md). A relative path is used instead of a bare specifier + import map because
 * pages live at different folder depths (/, /examples/, /experiments/x/), and an import map would need a
 * different base on every page.
 *
 * gl-matrix 3.4.4 (MIT): https://github.com/toji/gl-matrix
 * Used for model transforms only (Transform, instancing). Camera and projection maths stay ours (Camera.js).
 * @module engine/vendor
 */
export { vec3, vec4, quat, mat3, mat4 } from "../vendor/gl-matrix@3.4.4/esm/index.js";
