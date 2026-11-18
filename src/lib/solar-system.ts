type Point = { x: number; y: number; z: number };
type Projection = { x: number; y: number; scale: number; depth: number };
export type SolarCamera = { yaw: number; pitch: number; roll: number; distance: number };
type Planet = { id: string; name: string; orbit: number; radius: number; color: string; period: number; angle: number; tilt: number; node: number };
type Stroke = { kind: "stroke"; depth: number; a: Projection; b: Projection; color: string; alpha: number; width: number };
type Body = { kind: "body"; depth: number; point: Projection; radius: number; planet?: Planet };
export type SolarMomentCategory = "personal" | "milestone" | "system";
export type SolarMomentInput = { id: string; title: string; timestamp: number; category: SolarMomentCategory; demo: boolean };
export type SolarMomentMarker = SolarMomentInput & { x: number; y: number; radius: number; depth: number };
export type SolarRenderExtras = {
  ephemerisTimestamp?: number;
  moments?: SolarMomentInput[];
  referenceTimestamp?: number;
  activeMomentId?: string | null;
  hoveredMomentId?: string | null;
};
const TAU = Math.PI * 2;
const FORWARD_SPEED = 52;
const PATH_RADIUS = 5200;
export const SOLAR_HISTORY_SECONDS = 72;
export const DEFAULT_SOLAR_CAMERA: Readonly<SolarCamera> = { yaw: -.58, pitch: .2, roll: .53, distance: 6000 };
export const SOLAR_CAMERA_LIMITS = { yaw: { min: -1.48, max: -.58 }, pitch: { min: -.36, max: .2 }, roll: { min: .38, max: .74 }, distance: { min: 5200, max: 7600 } } as const;
export const SOLAR_BODY_SCALE = 2.65;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const rgba = (hex: string, alpha: number) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${clamp(alpha, 0, 1)})`;
// The flight path has its own reference orientation. Changing the initial
// viewing angle must not reshape the existing arc or planetary trajectories.
const PATH_ORIENTATION = { yaw: -1.15, pitch: -.12 };
const curveNormalLength = Math.hypot(Math.sin(PATH_ORIENTATION.pitch), Math.cos(PATH_ORIENTATION.pitch) * Math.sin(PATH_ORIENTATION.yaw));
const CURVE_NORMAL = {
  x: -Math.sin(PATH_ORIENTATION.pitch) / curveNormalLength,
  y: Math.cos(PATH_ORIENTATION.pitch) * Math.sin(PATH_ORIENTATION.yaw) / curveNormalLength,
};

export const solarPlanets: readonly Planet[] = [
  { id: "mercury", name: "水星", orbit: 200, radius: 12, color: "#b8b5aa", period: 30, angle: .78, tilt: .045, node: .2 },
  { id: "venus", name: "金星", orbit: 270, radius: 18, color: "#e7c48e", period: 34, angle: 3.05, tilt: -.025, node: 1.3 },
  { id: "earth", name: "地球", orbit: 345, radius: 19, color: "#6aa7e8", period: 38, angle: 4.97, tilt: .012, node: .8 },
  { id: "mars", name: "火星", orbit: 420, radius: 15, color: "#e47e5b", period: 42, angle: 2.09, tilt: .035, node: 2.1 },
  { id: "jupiter", name: "木星", orbit: 500, radius: 38, color: "#d6ac8a", period: 46, angle: 4.1, tilt: -.015, node: .4 },
  { id: "saturn", name: "土星", orbit: 600, radius: 31, color: "#e1ce9d", period: 50, angle: 1.13, tilt: .025, node: 1.8 },
  { id: "uranus", name: "天王星", orbit: 700, radius: 25, color: "#9cd4d7", period: 54, angle: 2.7, tilt: -.035, node: 1 },
  { id: "neptune", name: "海王星", orbit: 800, radius: 24, color: "#668ee7", period: 58, angle: 5.67, tilt: .02, node: 2.7 },
  { id: "pluto", name: "冥王星", orbit: 900, radius: 11, color: "#c8b7a8", period: 62, angle: 3.58, tilt: .075, node: .5 },
];

function historyFrame(age: number) {
  const angle = age * FORWARD_SPEED / PATH_RADIUS;
  const sin = Math.sin(angle), cos = Math.cos(angle);
  const bend = PATH_RADIUS * (1 - cos);
  return { sin, cos, center: { x: CURVE_NORMAL.x * bend, y: CURVE_NORMAL.y * bend, z: PATH_RADIUS * sin } };
}

// The camera follows the Sun and its current tangent. Older positions sweep
// around one broad circular arc while the current Sun stays near page centre.
export function solarSunPosition(_seconds: number, age = 0): Point {
  return historyFrame(age).center;
}

export function solarPathTangent(age = 0): Point {
  const { sin, cos } = historyFrame(age);
  return { x: CURVE_NORMAL.x * sin, y: CURVE_NORMAL.y * sin, z: cos };
}

function bendOrbit(point: Point, frame: ReturnType<typeof historyFrame>): Point {
  const normal = point.x * CURVE_NORMAL.x + point.y * CURVE_NORMAL.y;
  const offset = normal * (frame.cos - 1) + point.z * frame.sin;
  return {
    x: point.x + CURVE_NORMAL.x * offset,
    y: point.y + CURVE_NORMAL.y * offset,
    z: point.z * frame.cos - normal * frame.sin,
  };
}

const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const DAY_MS = 86_400_000;
const EPHEMERIS_ELEMENTS: Record<string, { lon0Deg: number; periodDays: number }> = {
  mercury: { lon0Deg: 252.25, periodDays: 87.969 },
  venus: { lon0Deg: 181.98, periodDays: 224.701 },
  earth: { lon0Deg: 100.46, periodDays: 365.256 },
  mars: { lon0Deg: 355.45, periodDays: 686.980 },
  jupiter: { lon0Deg: 34.40, periodDays: 4332.589 },
  saturn: { lon0Deg: 49.94, periodDays: 10759.22 },
  uranus: { lon0Deg: 313.23, periodDays: 30685.4 },
  neptune: { lon0Deg: 304.88, periodDays: 60189.0 },
  pluto: { lon0Deg: 238.93, periodDays: 90560.0 },
};

const MOMENT_COLORS: Record<SolarMomentCategory, string> = {
  personal: "#70d9ff",
  milestone: "#b8a5ff",
  system: "#ffcf79",
};

export function resolvePlanetAngleOffset(planet: Planet, ephemerisTimestamp?: number): number {
  if (ephemerisTimestamp === undefined || !Number.isFinite(ephemerisTimestamp)) return planet.angle;
  const elem = EPHEMERIS_ELEMENTS[planet.id];
  if (!elem) return planet.angle;
  const daysSinceJ2000 = (ephemerisTimestamp - J2000_MS) / DAY_MS;
  return ((elem.lon0Deg / 180) * Math.PI) + (daysSinceJ2000 / elem.periodDays) * TAU;
}

export function solarOrbitPosition(planet: Planet, seconds: number, angleOverride?: number): Point {
  const angle = (angleOverride ?? planet.angle) + seconds * TAU / planet.period;
  const along = Math.cos(angle - planet.node) * planet.orbit;
  const across = Math.sin(angle - planet.node) * planet.orbit;
  return {
    x: along * Math.cos(planet.node) - across * Math.cos(planet.tilt) * Math.sin(planet.node),
    y: along * Math.sin(planet.node) + across * Math.cos(planet.tilt) * Math.cos(planet.node),
    z: across * Math.sin(planet.tilt),
  };
}

export function solarPosition(planet: Planet, seconds: number, age = 0, angleOverride?: number): Point {
  const frame = historyFrame(age);
  const local = bendOrbit(solarOrbitPosition(planet, seconds - age, angleOverride), frame), sun = frame.center;
  return { x: local.x + sun.x, y: local.y + sun.y, z: local.z + sun.z };
}

function momentAgeOnArc(timestamp: number, referenceTimestamp: number, index: number, total: number): number {
  const diffSeconds = Math.max(0, (referenceTimestamp - timestamp) / 1000);
  // Map moments across the visible 72s solar arc with a logarithmic compression
  // so both recent seconds and older days remain spread cleanly along the route.
  if (diffSeconds <= 60) {
    return clamp(2 + (diffSeconds / 60) * 16, 2, SOLAR_HISTORY_SECONDS - 4);
  }
  const logRatio = clamp(Math.log10(diffSeconds / 60) / 4.5, 0, 1);
  const jitter = total > 1 ? ((index % 5) - 2) * 1.1 : 0;
  return clamp(18 + logRatio * (SOLAR_HISTORY_SECONDS - 24) + jitter, 2.5, SOLAR_HISTORY_SECONDS - 3);
}

export function projectSolarMomentMarkers(
  width: number,
  height: number,
  moments: readonly SolarMomentInput[],
  referenceTimestamp: number,
  options: Partial<SolarCamera> = {},
): SolarMomentMarker[] {
  if (!moments.length) return [];
  const project = createSolarProjection(width, height, options);
  const compact = width < 640;
  const visible = moments.slice(0, 24);
  return visible.map((item, index) => {
    const age = momentAgeOnArc(item.timestamp, referenceTimestamp, index, visible.length);
    const base = solarSunPosition(0, age);
    const offsetAngle = (index * 2.39996) % TAU;
    const radial = 32 + (index % 3) * 16;
    const world = {
      x: base.x + Math.cos(offsetAngle) * radial,
      y: base.y + Math.sin(offsetAngle) * radial * 0.65,
      z: base.z,
    };
    const projected = project(world);
    const radius = compact ? 3.5 : 4.2;
    return {
      ...item,
      x: projected.x,
      y: projected.y,
      radius,
      depth: projected.depth,
    };
  });
}

function cameraTransform(view: SolarCamera) {
  const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch), cr = Math.cos(view.roll), sr = Math.sin(view.roll);
  return (point: Point) => ({
    x: point.x * (cr * cy + sr * sp * sy) - point.y * sr * cp + point.z * (cr * sy - sr * sp * cy),
    y: point.x * (sr * cy - cr * sp * sy) + point.y * cr * cp + point.z * (sr * sy + cr * sp * cy),
    depth: view.distance - point.x * cp * sy - point.y * sp + point.z * cp * cy,
  });
}

const historyFitFrames = Array.from({ length: 33 }, (_, index) => historyFrame(index / 32 * SOLAR_HISTORY_SECONDS));
const orbitFitSamples = solarPlanets.map(planet => ({
  planet,
  samples: historyFitFrames.flatMap(frame => Array.from({ length: 96 }, (_, index) => {
    const local = bendOrbit(solarOrbitPosition(planet, index / 96 * planet.period), frame);
    return { x: local.x + frame.center.x, y: local.y + frame.center.y, z: local.z + frame.center.z };
  })),
}));

function resolveCamera(options: Partial<SolarCamera>): SolarCamera {
  const value = { ...DEFAULT_SOLAR_CAMERA, ...options };
  for (const key of ["yaw", "pitch", "roll", "distance"] as const) {
    value[key] = Number.isFinite(value[key]) ? clamp(value[key], SOLAR_CAMERA_LIMITS[key].min, SOLAR_CAMERA_LIMITS[key].max) : DEFAULT_SOLAR_CAMERA[key];
  }
  return value;
}

let cachedProjection: { width: number; height: number; key: string; project: (point: Point) => Projection } | null = null;

export function solarBodyRadius(planet: (typeof solarPlanets)[number], point: Projection, compact: boolean) {
  return Math.max(compact ? 2.6 : 3.4, planet.radius * SOLAR_BODY_SCALE * point.scale);
}

export function solarSunRadius(point: Projection, compact: boolean) {
  return Math.max(compact ? 10 : 15, point.scale * 76);
}

export function createSolarProjection(width: number, height: number, options: Partial<SolarCamera> = {}) {
  const view = resolveCamera(options);
  const key = `${view.yaw},${view.pitch},${view.roll},${view.distance}`;
  if (cachedProjection?.width === width && cachedProjection.height === height && cachedProjection.key === key) return cachedProjection.project;
  const transform = cameraTransform(view);
  let minX = 0, maxX = 0, minY = 0, maxY = 0;
  // Curved history can reach an extremum between its endpoints. Fit a cached
  // cloud covering the whole arc and every orbital phase, keeping zoom steady.
  for (const { planet, samples } of orbitFitSamples) {
    for (const sample of samples) {
      const point = transform(sample);
      const margin = planet.radius * SOLAR_BODY_SCALE * (planet.id === "saturn" ? 2.15 : 1.2) + 2;
      minX = Math.min(minX, (point.x - margin) / point.depth);
      maxX = Math.max(maxX, (point.x + margin) / point.depth);
      minY = Math.min(minY, (-point.y - margin) / point.depth);
      maxY = Math.max(maxY, (-point.y + margin) / point.depth);
    }
  }
  const compact = width < 640;
  // Use the largest uniform scale that fits the complete trajectory envelope.
  // Shift the Sun only as far as needed to fit; keep the camera angles and the
  // scale independent of animation time so playback never rotates or zooms.
  const padding = Math.min(compact ? 18 : 24, width / 4, height / 4);
  const focal = Math.min(
    (width - padding * 2) / (maxX - minX),
    (height - padding * 2) / (maxY - minY),
  );
  const centerX = clamp(width * .53, padding - minX * focal, width - padding - maxX * focal);
  const centerY = clamp(height * .38, padding - minY * focal, height - padding - maxY * focal);
  const project = (point: Point): Projection => {
    const transformed = transform(point);
    const scale = focal / Math.max(1000, transformed.depth);
    return { x: centerX + transformed.x * scale, y: centerY - transformed.y * scale, scale, depth: transformed.depth };
  };
  cachedProjection = { width, height, key, project };
  return project;
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU);
}

function saturnRing(ctx: CanvasRenderingContext2D, point: Projection, radius: number, front: boolean) {
  ctx.save(); ctx.translate(point.x, point.y); ctx.rotate(-.32); ctx.beginPath();
  ctx.ellipse(0, 0, radius * 1.95, radius * .62, 0, front ? 0 : Math.PI, front ? Math.PI : TAU);
  ctx.strokeStyle = front ? "#d4c094c9" : "#b8a68179";
  ctx.lineWidth = Math.max(1.4, radius * .23); ctx.stroke(); ctx.restore();
}

function planetSphere(ctx: CanvasRenderingContext2D, body: Body, sun: Projection, cameraDistance: number) {
  const planet = body.planet;
  if (!planet) return;
  const { point, radius } = body;
  const distance = Math.hypot(sun.x - point.x, sun.y - point.y) || 1;
  const lx = (sun.x - point.x) / distance, ly = (sun.y - point.y) / distance;
  // Opaque spheres hide the orbit behind them; fog dims distant bodies without
  // making their surfaces transparent.
  ctx.save(); ctx.globalAlpha = 1;
  if (planet.id === "saturn") saturnRing(ctx, point, radius, false);
  const lit = ctx.createRadialGradient(point.x + lx * radius * .45, point.y + ly * radius * .45, radius * .07, point.x - lx * radius * .25, point.y - ly * radius * .25, radius * 1.3);
  lit.addColorStop(0, "#fff4dc"); lit.addColorStop(.2, planet.color); lit.addColorStop(.52, planet.color); lit.addColorStop(1, "#050a15");
  circle(ctx, point.x, point.y, radius); ctx.fillStyle = lit; ctx.fill();
  if (planet.id === "jupiter" || planet.id === "earth") {
    ctx.save(); circle(ctx, point.x, point.y, radius); ctx.clip();
    if (planet.id === "jupiter") {
      ctx.fillStyle = "#ac775944";
      for (let band = -2; band <= 2; band++) ctx.fillRect(point.x - radius, point.y + band * radius * .35, radius * 2, Math.max(1, radius * .15));
    } else {
      ctx.fillStyle = "#8fc99588";
      circle(ctx, point.x - radius * .3, point.y - radius * .18, radius * .3); ctx.fill();
      circle(ctx, point.x + radius * .35, point.y + radius * .34, radius * .2); ctx.fill();
    }
    ctx.restore();
  }
  const shade = ctx.createLinearGradient(point.x + lx * radius, point.y + ly * radius, point.x - lx * radius, point.y - ly * radius);
  shade.addColorStop(0, "#05091200"); shade.addColorStop(.32, "#05091200"); shade.addColorStop(1, "#030711ed");
  circle(ctx, point.x, point.y, radius); ctx.fillStyle = shade; ctx.fill();
  const facing = Math.atan2(ly, lx);
  ctx.beginPath(); ctx.arc(point.x, point.y, radius * .96, facing - Math.PI * .4, facing + Math.PI * .4);
  ctx.strokeStyle = "#e6f7ff80"; ctx.lineWidth = Math.max(.6, radius * .05); ctx.stroke();
  const fog = clamp((point.depth - cameraDistance) / (cameraDistance * 1.2), 0, .5);
  circle(ctx, point.x, point.y, radius); ctx.fillStyle = rgba("#071122", fog); ctx.fill();
  if (planet.id === "saturn") saturnRing(ctx, point, radius, true);
  ctx.restore();
}

function drawPlanetLabels(ctx: CanvasRenderingContext2D, bodies: Body[], width: number, height: number) {
  const occupied = bodies.map(body => ({ x: body.point.x - body.radius * 1.2, y: body.point.y - body.radius * 1.2, w: body.radius * 2.4, h: body.radius * 2.4 }));
  ctx.save(); ctx.font = "9px Arial, Microsoft YaHei, sans-serif"; ctx.textAlign = "left";
  for (const { planet, point, radius } of bodies) {
    if (!planet?.name || planet.orbit < 500) continue;
    const w = ctx.measureText(planet.name).width;
    for (const [x, y] of [[point.x + radius + 6, point.y + 3], [point.x - radius - w - 6, point.y + 3], [point.x - w / 2, point.y + radius + 14]]) {
      const box = { x: x - 3, y: y - 10, w: w + 6, h: 14 };
      if (box.x < 8 || box.x + box.w > width - 8 || box.y < 8 || box.y + box.h > height - 8) continue;
      if (occupied.some(other => box.x < other.x + other.w && box.x + box.w > other.x && box.y < other.y + other.h && box.y + box.h > other.y)) continue;
      occupied.push(box); ctx.fillStyle = rgba(planet.color, .65); ctx.fillText(planet.name, x, y); break;
    }
  }
  ctx.restore();
}

function drawSun(ctx: CanvasRenderingContext2D, point: Projection, radius: number, seconds: number) {
  const glowRadius = radius * (4.4 + Math.sin(seconds * .55) * .15);
  const glow = ctx.createRadialGradient(point.x, point.y, radius * .45, point.x, point.y, glowRadius);
  glow.addColorStop(0, "#ffce556b"); glow.addColorStop(.22, "#ffb84428"); glow.addColorStop(1, "#ffb84400");
  circle(ctx, point.x, point.y, glowRadius); ctx.fillStyle = glow; ctx.fill();
  const sphere = ctx.createRadialGradient(point.x - radius * .3, point.y - radius * .4, radius * .05, point.x, point.y, radius);
  sphere.addColorStop(0, "#fff1ab"); sphere.addColorStop(.5, "#ffda65"); sphere.addColorStop(1, "#ef9e33");
  circle(ctx, point.x, point.y, radius); ctx.fillStyle = sphere; ctx.fill();
}

export function drawSolarSystem(ctx: CanvasRenderingContext2D, width: number, height: number, seconds: number, flash = -1, options: Partial<SolarCamera> = {}, extras?: SolarRenderExtras) {
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = "round";
  const compact = width < 640;
  const view = resolveCamera(options);
  const project = createSolarProjection(width, height, view);
  const sunWorld = solarSunPosition(seconds);
  const sun = project(sunWorld);
  const drawing: (Stroke | Body)[] = [];
  const addLine = (a: Point, b: Point, color: string, alpha: number, weight: number) => {
    const from = project(a), to = project(b);
    const depth = (from.depth + to.depth) * .5;
    const proximity = view.distance / depth;
    drawing.push({ kind: "stroke", depth, a: from, b: to, color, alpha: alpha * clamp(proximity * proximity, .12, 1.8), width: weight * clamp(proximity, .35, 2) });
  };
  for (let index = 0; index < solarPlanets.length; index++) {
    const planet = solarPlanets[index];
    const angleOverride = resolvePlanetAngleOffset(planet, extras?.ephemerisTimestamp);
    const historySteps = Math.ceil(clamp(SOLAR_HISTORY_SECONDS / planet.period * 40, compact ? 40 : 56, compact ? 72 : 104));
    for (let i = 0; i < historySteps; i++) {
      const age = i / historySteps * SOLAR_HISTORY_SECONDS, nextAge = (i + 1) / historySteps * SOLAR_HISTORY_SECONDS;
      const fade = Math.pow(1 - age / SOLAR_HISTORY_SECONDS, .95);
      addLine(solarPosition(planet, seconds, age, angleOverride), solarPosition(planet, seconds, nextAge, angleOverride), planet.color, fade * (planet.id === "earth" ? .62 : .49), compact ? .9 : 1.2);
    }
    const world = solarPosition(planet, seconds, 0, angleOverride), point = project(world);
    drawing.push({ kind: "body", depth: point.depth, point, radius: solarBodyRadius(planet, point, compact), planet });
    if (planet.id === "earth") {
      const angle = seconds * TAU / 3 + 1.9;
      const moon = project({ x: world.x + Math.cos(angle) * 47, y: world.y + Math.sin(angle) * 47, z: world.z + Math.sin(angle) * 6 });
      drawing.push({ kind: "body", depth: moon.depth, point: moon, radius: Math.max(1.3, moon.scale * 6), planet: { ...planet, id: "moon", name: "", color: "#d7d9dc", radius: 6, orbit: 0 } });
    }
  }
  // The Sun's fading arc gives all nine winding trails a clear shared route.
  for (let i = 0; i < 48; i++) {
    const age = i / 48 * SOLAR_HISTORY_SECONDS, nextAge = (i + 1) / 48 * SOLAR_HISTORY_SECONDS;
    addLine(solarSunPosition(seconds, age), solarSunPosition(seconds, nextAge), "#ffcf79", Math.pow(1 - i / 48, 1.5) * .28, 1.1);
  }
  drawing.push({ kind: "body", depth: sun.depth, point: sun, radius: solarSunRadius(sun, compact) });
  drawing.sort((a, b) => b.depth - a.depth);
  for (const item of drawing) {
    if (item.kind === "stroke") {
      ctx.beginPath(); ctx.moveTo(item.a.x, item.a.y); ctx.lineTo(item.b.x, item.b.y);
      ctx.strokeStyle = rgba(item.color, item.alpha); ctx.lineWidth = item.width; ctx.stroke();
    } else if (item.planet) planetSphere(ctx, item, sun, view.distance);
    else drawSun(ctx, sun, item.radius, seconds);
  }
  if (!compact) drawPlanetLabels(ctx, drawing.filter((item): item is Body => item.kind === "body"), width, height);
  if (extras?.moments?.length) {
    const refTime = extras.referenceTimestamp ?? Date.now();
    const markers = projectSolarMomentMarkers(width, height, extras.moments, refTime, view);
    for (const marker of markers) {
      const color = MOMENT_COLORS[marker.category];
      const active = marker.id === extras.activeMomentId || marker.id === extras.hoveredMomentId;
      const haloRadius = marker.radius * (active ? 4.4 : 2.9);
      const halo = ctx.createRadialGradient(marker.x, marker.y, 0, marker.x, marker.y, haloRadius);
      halo.addColorStop(0, rgba(color, active ? 0.92 : 0.55));
      halo.addColorStop(0.45, rgba(color, active ? 0.35 : 0.16));
      halo.addColorStop(1, rgba(color, 0));
      circle(ctx, marker.x, marker.y, haloRadius);
      ctx.fillStyle = halo;
      ctx.fill();

      circle(ctx, marker.x, marker.y, active ? marker.radius * 1.15 : marker.radius * 0.72);
      ctx.fillStyle = active ? "#ffffff" : rgba(color, marker.demo ? 0.65 : 0.95);
      ctx.fill();

      if (active) {
        circle(ctx, marker.x, marker.y, marker.radius * 2.1);
        ctx.strokeStyle = rgba(color, 0.8);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }
  if (flash >= 0) {
    const progress = clamp(flash / 1.6, 0, 1);
    circle(ctx, sun.x, sun.y, (40 + progress * 850) * sun.scale);
    ctx.strokeStyle = rgba("#bceaff", (1 - progress) * .65); ctx.lineWidth = 1; ctx.stroke();
  }
  ctx.restore();
}
