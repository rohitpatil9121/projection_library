<div align="center">
  <h1>projection_library</h1>
  <p><strong>A from-scratch WebGL 3D engine: orbit camera, hand-built view basis, dot-product projection.</strong></p>

  <img src="Screenshot 2026-04-01 042922.png" alt="3D prime walk screenshot" width="800">

  <p>
    <kbd>JavaScript</kbd> | <kbd>WebGL</kbd> | <kbd>3D Math</kbd> | <kbd>Number Theory</kbd>
  </p>
</div>

<hr>

<h2>🚀 Overview</h2>
<p><b>🎮 Play <a href="https://rohitpatil9121.github.io/projection_library/runner.html">Neon Rush</a></b>: an endless synthwave runner built on this engine.</p>
<p>No three.js, no matrix library. <code>Space.js</code> places a camera on a sphere around a view point, builds the camera's
x/y/z axes itself, and projects every vertex in the vertex shader with dot products. Two demos ship with it:</p>
<ul>
  <li><b>Prime Walk 3D</b> (<code>index.html</code>): a walk through 3D space that turns every time it reaches a prime number, drawing one cube per step.</li>
  <li><b>Neon Rush</b> (<code>runner.html</code>): an endless runner game. <code>runner/RunnerSpace.js</code> extends <code>Space</code> with custom GLSL:
    a procedural neon floor grid, a synthwave sun, distance fog and a post-processing pass (bloom, chromatic aberration, vignette,
    scanlines, speed streaks). The track streams in chunks through <code>addElements</code>, and coordinates are rebased as you run so
    float precision holds over long distances.</li>
  <li><b>OBJ Preview</b> (<code>preview.html</code>): load an <code>.obj</code> (plus <code>.mtl</code> and textures) and inspect it with orbit, pan and zoom.</li>
</ul>

<h2>🧠 How the rendering works</h2>
<ol>
  <li><b>Camera.</b> The camera <code>(Xc, Yc, Zc)</code> orbits the view point <code>(X0, Y0, Z0)</code> at distance <code>Rc</code>,
    steered by <code>alpha</code> (yaw) and <code>beta</code> (pitch). The world is Z-up.</li>
  <li><b>View basis.</b> <code>getZaxisUnitVector</code> is the view direction. <code>getYaxisUnitVector</code> projects world-up onto the view
    plane, and <code>getXaxisUnitVector</code> is their cross product.</li>
  <li><b>Projection.</b> The vertex shader moves each vertex into camera space with three dot products, then divides by depth
    through <code>gl_Position.w</code>. The GPU clips anything behind the camera.</li>
  <li><b>Geometry.</b> <code>Structure</code> holds a slice of triangles (<code>vec4</code> positions and colors). <code>addStructure</code> appends it to
    <code>posArr</code>/<code>colArr</code> in place, and <code>reDraw()</code> sends only the newly added vertices to the GPU
    (into a buffer with spare capacity). Camera moves only update uniforms.</li>
</ol>

<h2>🎮 Controls (Prime Walk)</h2>
<table>
  <tr><td>Drag</td><td>Orbit (flick to spin)</td></tr>
  <tr><td>Right-drag / <kbd>Shift</kbd>-drag</td><td>Pan</td></tr>
  <tr><td>Wheel / pinch</td><td>Zoom</td></tr>
  <tr><td><kbd>Space</kbd> / <kbd>Enter</kbd></td><td>Add one step (hold <kbd>Shift</kbd> to add 50)</td></tr>
  <tr><td><kbd>G</kbd></td><td>Auto-grow on / off</td></tr>
  <tr><td><kbd>F</kbd></td><td>Frame the whole walk (auto-framing is on until you pan or zoom)</td></tr>
  <tr><td><kbd>R</kbd></td><td>Reset the walk</td></tr>
  <tr><td><kbd>A</kbd> <kbd>D</kbd> <kbd>W</kbd> <kbd>S</kbd></td><td>Rotate the camera</td></tr>
  <tr><td><kbd>J</kbd> <kbd>L</kbd> <kbd>O</kbd> <kbd>M</kbd> <kbd>I</kbd> <kbd>K</kbd></td><td>Move left / right / up / down / forward / back</td></tr>
  <tr><td><kbd>V</kbd> <kbd>C</kbd></td><td>Camera distance</td></tr>
  <tr><td><kbd>=</kbd> / <kbd>-</kbd></td><td>Magnify in / out</td></tr>
</table>
<p>Gold cubes are primes (the turning points); the rest of the path fades through a rainbow as <i>n</i> grows.</p>

<h2>📁 Project structure</h2>
<ul>
  <li><code>index.js</code>: Express static server for <code>public/</code></li>
  <li><code>public/Space.js</code>: the engine (camera, basis, shaders, buffers)</li>
  <li><code>public/Main.js</code>: Prime Walk demo</li>
  <li><code>public/preview.html</code>: OBJ viewer</li>
  <li><code>public/runner.html</code>, <code>public/runner/</code>: Neon Rush game (<code>RunnerSpace.js</code> shaders, <code>game.js</code> gameplay)</li>
  <li><code>public/Shapes/</code>: <code>Structure</code>, <code>Path</code>, <code>Face</code></li>
</ul>

<h2>⚙️ Getting started</h2>
<pre>git clone https://github.com/rohitpatil9121/projection_library.git
cd projection_library
npm install
npm start</pre>
<p><b>Live demo:</b> <a href="https://rohitpatil9121.github.io/projection_library/">Prime Walk 3D</a> · <a href="https://rohitpatil9121.github.io/projection_library/runner.html">Neon Rush</a> · <a href="https://rohitpatil9121.github.io/projection_library/preview.html">OBJ Preview</a></p>
<p>Open <code>http://localhost:9600</code> (or set <code>PORT</code>). The OBJ viewer is at <code>/preview.html</code>.</p>

<hr>

<div align="center">
  <p>Originally developed with ❤️ by <a href="https://github.com/rohit-s-init">Rohit Sawant</a> (<a href="https://github.com/rohit-s-init/projection_library">original repo</a>)</p>
</div>
