import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// Uses the actual Canvas renderer, without launching a browser or adding a
// runtime dependency. Supply @napi-rs/canvas via --canvas-module or env.
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: {
  "canvas-module": { type: "string" },
  "write-posters": { type: "boolean", default: false },
  "animation-frames": { type: "boolean", default: false },
  output: { type: "string", default: "artifacts/solar-system" },
} });
const canvasModule = values["canvas-module"] ?? process.env.SOLAR_CANVAS_MODULE ?? "@napi-rs/canvas";
const { createCanvas } = require(canvasModule);
const ts = require("typescript");
const source = await readFile(path.join(root, "src/lib/solar-system.ts"), "utf8");
const code = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
} }).outputText;
const loaded = { exports: {} };
new Function("exports", "require", "module", code)(loaded.exports, require, loaded);
const { solarPlanets, solarOrbitPosition, solarPosition, solarSunPosition, solarPathTangent,
  createSolarProjection, solarBodyRadius, solarSunRadius, drawSolarSystem,
  DEFAULT_SOLAR_CAMERA, SOLAR_CAMERA_LIMITS, SOLAR_HISTORY_SECONDS } = loaded.exports;

const near = (a, b, description) => assert.ok(Math.abs(a - b) < 1e-7, `${description}: ${a} != ${b}`);
const finite = (point, description) => {
  for (const [key, value] of Object.entries(point)) assert.ok(Number.isFinite(value), `${description}.${key} is not finite`);
};
for (const planet of solarPlanets) {
  for (const seconds of [0, 12, 28, 32, 52, 91, 116]) {
    const local = solarOrbitPosition(planet, seconds);
    near(Math.hypot(local.x, local.y, local.z), planet.orbit, `${planet.id} orbital radius`);
    const returned = solarOrbitPosition(planet, seconds + planet.period);
    for (const key of ["x", "y", "z"]) near(local[key], returned[key], `${planet.id} period return ${key}`);
    for (const age of [0, 13, 26, SOLAR_HISTORY_SECONDS]) {
      const historical = solarPosition(planet, seconds, age);
      const orbit = solarOrbitPosition(planet, seconds - age);
      const sun = solarSunPosition(seconds, age);
      const relative = { x: historical.x - sun.x, y: historical.y - sun.y, z: historical.z - sun.z };
      near(Math.hypot(relative.x, relative.y, relative.z), planet.orbit, `${planet.id} distance from curved flight centre`);
      const opposite = solarPosition(planet, seconds + planet.period / 2, age);
      const repeated = solarPosition(planet, seconds + planet.period, age);
      for (const key of ["x", "y", "z"]) {
        near((historical[key] + opposite[key]) / 2, sun[key], `${planet.id} opposite phases share curved centre ${key}`);
        near(repeated[key], historical[key], `${planet.id} historical period return ${key}`);
        if (age === 0) near(historical[key], orbit[key], `${planet.id} current orbit unchanged ${key}`);
      }
      const tangent = solarPathTangent(age);
      finite(tangent, "Curved path tangent");
      near(Math.hypot(tangent.x, tangent.y, tangent.z), 1, "Curved path tangent is unit length");
      const along = relative.x * tangent.x + relative.y * tangent.y + relative.z * tangent.z;
      assert.ok(Math.abs(along) <= planet.orbit * Math.sin(Math.abs(planet.tilt)) + 1e-7, `${planet.id} orbital plane does not follow curved tangent`);
      near(along, orbit.z, `${planet.id} transported orbit preserves inclination`);
      assert.ok(sun.z >= 0, "History must recede along a common positive axis");
    }
  }
}

const cameras = [{ name: "default", value: DEFAULT_SOLAR_CAMERA }];
for (const yaw of [SOLAR_CAMERA_LIMITS.yaw.min, SOLAR_CAMERA_LIMITS.yaw.max])
  for (const pitch of [SOLAR_CAMERA_LIMITS.pitch.min, SOLAR_CAMERA_LIMITS.pitch.max])
    for (const roll of [SOLAR_CAMERA_LIMITS.roll.min, SOLAR_CAMERA_LIMITS.roll.max])
      for (const distance of [SOLAR_CAMERA_LIMITS.distance.min, SOLAR_CAMERA_LIMITS.distance.max]) {
        cameras.push({ name: `extreme-${cameras.length}`, value: { yaw, pitch, roll, distance } });
      }
const previewSizes = [["desktop", 1440, 511], ["mobile", 390, 422]];
const sizes = [[320, 320], [390, 362], [390, 422], [768, 456], [1440, 526], [1440, 511], [1920, 846]];
const phases = [...new Set([...Array.from({ length: 59 }, (_, i) => i * 2), 12, 28, 32, 52])];
const historyAges = Array.from({ length: 65 }, (_, index) => index / 64 * SOLAR_HISTORY_SECONDS);
let bodyChecks = 0, trailChecks = 0;
function within(point, radius, width, height, description) {
  finite(point, description);
  assert.ok(point.scale > 0 && point.depth > 0, `${description}: geometry behind camera`);
  assert.ok(point.x - radius >= 0 && point.x + radius <= width && point.y - radius >= 0 && point.y + radius <= height,
    `${description}: clipped at (${point.x.toFixed(1)}, ${point.y.toFixed(1)}), r=${radius.toFixed(1)} in ${width}x${height}`);
}
let flightAngle = 0;
const curveChecks = [];
for (const [width, height] of sizes) {
  const project = createSolarProjection(width, height);
  const sun = project(solarSunPosition(0));
  near(sun.x, width * .53, "Default Sun horizontal anchor");
  near(sun.y, height * .38, "Default Sun vertical anchor");
  const history = project(solarSunPosition(0, SOLAR_HISTORY_SECONDS));
  const nearHead = project(solarSunPosition(0, .1));
  const angle = Math.atan2(nearHead.y - sun.y, sun.x - nearHead.x) * 180 / Math.PI;
  assert.ok(angle >= 25 && angle <= 45, `Default flight must visibly rise at 25–45 degrees; got ${angle}`);
  flightAngle = angle;
  let previous = sun, maxBow = 0, maxTangentDeviation = 0;
  const chordX = history.x - sun.x, chordY = history.y - sun.y, chordLength = Math.hypot(chordX, chordY);
  const tangentX = nearHead.x - sun.x, tangentY = nearHead.y - sun.y, tangentLength = Math.hypot(tangentX, tangentY);
  for (const age of historyAges.slice(1)) {
    const point = project(solarSunPosition(0, age));
    finite(point, "Projected common curved path");
    assert.ok(point.x < previous.x && point.y > previous.y, "Curved history must continue down-left without hooks");
    const x = point.x - sun.x, y = point.y - sun.y;
    maxBow = Math.max(maxBow, Math.abs(chordX * y - chordY * x) / chordLength);
    maxTangentDeviation = Math.max(maxTangentDeviation, Math.abs(tangentX * y - tangentY * x) / tangentLength);
    previous = point;
  }
  assert.ok(maxBow / chordLength >= .06, "Common flight path has lost its visible arc");
  curveChecks.push({ width, height, nearHeadAngle: angle,
    chordAngle: Math.atan2(chordY, -chordX) * 180 / Math.PI, maxBow, maxTangentDeviation });
}

// Include the CSS scene offsets in the position check, so canvas centring alone
// cannot hide a scene that has slipped below the first viewport.
const css = await readFile(path.join(root, "src/app/globals.css"), "utf8");
const sceneOffsets = [...css.matchAll(/\.solar-experience\.is-immersive\s+\.scene-wrap\s*\{\s*top:\s*(\d+)px;\s*bottom:\s*(\d+)px;\s*\}/g)]
  .map(match => ({ top: Number(match[1]), bottom: Number(match[2]) }));
const heroConstraints = [...css.matchAll(/\.solar-experience\s*\{\s*height:\s*clamp\((\d+)px,\s*calc\(100svh\s*-\s*(\d+)px\),\s*(\d+)px\);\s*\}/g)]
  .map(match => ({ min: Number(match[1]), viewportOffset: Number(match[2]), max: Number(match[3]) }));
const headerHeights = [...css.matchAll(/\.site-header\s*\{[^}]*height:\s*(\d+)px;[^}]*\}/g)].map(match => Number(match[1]));
assert.ok(sceneOffsets.length >= 2 && heroConstraints.length >= 2 && headerHeights.length >= 2, "Could not read desktop/mobile viewport geometry from CSS");
const viewportComposition = [];
for (const [name, width, canvasHeight] of previewSizes) {
  const viewportHeight = name === "desktop" ? 900 : 844;
  const mobile = name === "mobile";
  const headerHeight = mobile ? headerHeights.at(-1) : headerHeights[0];
  const hero = mobile ? heroConstraints.at(-1) : heroConstraints[0];
  const heroHeight = Math.max(hero.min, Math.min(hero.max, viewportHeight - hero.viewportOffset));
  const scene = mobile ? sceneOffsets.at(-1) : sceneOffsets[0];
  near(canvasHeight, heroHeight - scene.top - scene.bottom, `${name} actual immersive canvas height`);
  const sun = createSolarProjection(width, canvasHeight)(solarSunPosition(0));
  const pageSun = { x: sun.x, y: headerHeight + scene.top + sun.y };
  const offset = { x: pageSun.x - width / 2, y: pageSun.y - viewportHeight / 2 };
  assert.ok(Math.hypot(offset.x, offset.y) <= 50, `${name} Sun is more than 50px from the first viewport centre`);
  viewportComposition.push({ name, viewport: { width, height: viewportHeight }, canvas: { width, height: canvasHeight },
    sun: pageSun, centreOffset: offset, distanceFromCentre: Math.hypot(offset.x, offset.y) });
}
for (const [width, height] of sizes) for (const camera of cameras) {
  const project = createSolarProjection(width, height, camera.value);
  const anchor = project(solarSunPosition(0));
  for (const seconds of phases) {
    assert.deepEqual(project(solarSunPosition(seconds)), anchor, "Camera-following Sun drifted");
    within(anchor, solarSunRadius(anchor, width < 640), width, height, `${camera.name} Sun`);
    for (const planet of solarPlanets) {
      const point = project(solarPosition(planet, seconds));
      const radius = solarBodyRadius(planet, point, width < 640);
      within(point, planet.id === "saturn" ? radius * 2.1 : radius, width, height, `${width}x${height} ${camera.name} t=${seconds} ${planet.id}`);
      bodyChecks++;
      for (const age of historyAges) {
        within(project(solarPosition(planet, seconds, age)), .5, width, height, `${camera.name} ${planet.id} age=${age}`);
        trailChecks++;
      }
    }
  }
  const invalid = createSolarProjection(width, height, { yaw: NaN, pitch: Infinity, roll: NaN, distance: NaN });
  assert.deepEqual(invalid(solarSunPosition(0)), createSolarProjection(width, height)(solarSunPosition(0)), "Invalid camera values do not fall back to defaults");
}

const output = path.resolve(root, values.output);
await mkdir(output, { recursive: true });
const rendered = [];
function render(width, height, seconds, camera = DEFAULT_SOLAR_CAMERA) {
  const canvas = createCanvas(width, height);
  drawSolarSystem(canvas.getContext("2d"), width, height, seconds, -1, camera);
  return canvas;
}
function background(canvas) {
  const preview = createCanvas(canvas.width, canvas.height);
  const ctx = preview.getContext("2d");
  ctx.fillStyle = "#050b18"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(canvas, 0, 0);
  return preview;
}
function motionCrop(width, height) {
  const project = createSolarProjection(width, height), compact = width < 640;
  const sun = project(solarSunPosition(0));
  const glow = solarSunRadius(sun, compact) * 4.55;
  let minX = sun.x - glow, maxX = sun.x + glow, minY = sun.y - glow, maxY = sun.y + glow;
  for (const planet of solarPlanets) for (const seconds of phases) for (const age of historyAges) {
    const point = project(solarPosition(planet, seconds, age));
    const radius = solarBodyRadius(planet, point, compact) * (planet.id === "saturn" ? 2.1 : 1.2) + 35;
    minX = Math.min(minX, point.x - radius); maxX = Math.max(maxX, point.x + radius);
    minY = Math.min(minY, point.y - radius); maxY = Math.max(maxY, point.y + radius);
  }
  return { x: Math.max(0, Math.floor(minX)), y: Math.max(0, Math.floor(minY)),
    width: Math.min(width, Math.ceil(maxX)) - Math.max(0, Math.floor(minX)),
    height: Math.min(height, Math.ceil(maxY)) - Math.max(0, Math.floor(minY)) };
}
for (const [name, width, height] of previewSizes) {
  const poster = render(width, height, 0);
  await writeFile(path.join(output, `${name}-poster.png`), poster.toBuffer("image/png"));
  if (values["write-posters"]) await writeFile(path.join(root, "public", `solar-system-${name}.png`), poster.toBuffer("image/png"));
  for (const seconds of [0, 12, 28, 52]) {
    const filename = `${name}-${seconds}s.png`;
    const preview = background(render(width, height, seconds));
    await writeFile(path.join(output, filename), preview.toBuffer("image/png"));
    rendered.push({ name, seconds, canvas: preview });
  }
}
const contact = createCanvas(1600, 760);
const contactCtx = contact.getContext("2d");
contactCtx.fillStyle = "#050b18"; contactCtx.fillRect(0, 0, contact.width, contact.height);
contactCtx.font = "14px Arial";
for (let index = 0; index < rendered.length; index++) {
  const item = rendered[index], column = index % 4, row = Math.floor(index / 4);
  const boxX = column * 400, boxY = row * 380;
  const crop = item.name === "desktop" ? motionCrop(item.canvas.width, item.canvas.height) : { x: 0, y: 0, width: item.canvas.width, height: item.canvas.height };
  const fit = Math.min(390 / crop.width, 330 / crop.height);
  const w = crop.width * fit, h = crop.height * fit;
  contactCtx.drawImage(item.canvas, crop.x, crop.y, crop.width, crop.height, boxX + (400 - w) / 2, boxY + 35 + (330 - h) / 2, w, h);
  contactCtx.fillStyle = "#a8bded"; contactCtx.fillText(`${item.name} · ${item.seconds}s`, boxX + 10, boxY + 23);
}
await writeFile(path.join(output, "contact-sheet.png"), contact.toBuffer("image/png"));
let animation = null;
if (values["animation-frames"]) {
  const [, width, height] = previewSizes[0], crop = motionCrop(width, height);
  const folder = path.join(output, "animation");
  await mkdir(folder, { recursive: true });
  const frames = 180, fps = 15;
  for (let index = 0; index < frames; index++) {
    const canvas = background(render(width, height, index / fps));
    const cropped = createCanvas(crop.width, crop.height);
    cropped.getContext("2d").drawImage(canvas, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    await writeFile(path.join(folder, `frame-${String(index).padStart(3, "0")}.png`), cropped.toBuffer("image/png"));
  }
  animation = { folder, frames, fps, seconds: frames / fps, crop };
}
const bodyVisibility = [];
for (const [name, width, height] of previewSizes) {
  const project = createSolarProjection(width, height);
  const sun = project(solarSunPosition(0));
  const sunRadius = solarSunRadius(sun, width < 640);
  const planets = solarPlanets.map(planet => {
    let minDistance = Infinity, maxDistance = 0, minRadius = Infinity, maxRadius = 0, separate = 0, fullyObscured = 0;
    for (let index = 0; index < 360; index++) {
      const point = project(solarPosition(planet, index / 360 * planet.period));
      const radius = solarBodyRadius(planet, point, width < 640);
      const distance = Math.hypot(point.x - sun.x, point.y - sun.y);
      minDistance = Math.min(minDistance, distance); maxDistance = Math.max(maxDistance, distance);
      minRadius = Math.min(minRadius, radius); maxRadius = Math.max(maxRadius, radius);
      if (distance > sunRadius + radius) separate++;
      if (point.depth > sun.depth && distance + radius < sunRadius) fullyObscured++;
    }
    return { id: planet.id, minDistance: +minDistance.toFixed(1), maxDistance: +maxDistance.toFixed(1),
      minRadius: +minRadius.toFixed(1), maxRadius: +maxRadius.toFixed(1),
      separatePercent: +(separate / 3.6).toFixed(1), fullyObscuredPercent: +(fullyObscured / 3.6).toFixed(1) };
  });
  bodyVisibility.push({ name, sunRadius: +sunRadius.toFixed(1), planets });
}
const result = { planets: solarPlanets.length, sizes: sizes.length, cameras: cameras.length, phases: phases.length,
  bodyChecks, trailChecks, historySeconds: SOLAR_HISTORY_SECONDS, defaultCamera: DEFAULT_SOLAR_CAMERA,
  flightAngle, curveChecks, viewportComposition, output, postersUpdated: values["write-posters"], bodyVisibility, animation };
await writeFile(path.join(output, "validation.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ bodyChecks, trailChecks, sizes: sizes.length, cameras: cameras.length, phases: phases.length,
  flightAngle: +flightAngle.toFixed(1), curveChecks: curveChecks.filter(check => previewSizes.some(([, width, height]) => width === check.width && height === check.height)),
  viewportComposition, output, postersUpdated: values["write-posters"], animation }, null, 2));
