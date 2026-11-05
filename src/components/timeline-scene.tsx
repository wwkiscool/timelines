"use client";

import { useEffect, useRef } from "react";

type Props = { running: boolean; speed: number; flat: boolean; resetKey: number; pulseKey: number };
type Point = { x: number; y: number; z: number };
type Projection = { x: number; y: number; scale: number; depth: number };
const CAMERA = { yaw: 0.57, pitch: 0.23 };
const TAU = Math.PI * 2;
const NEAR = 360;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const noise = (seed: number) => { const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return value - Math.floor(value); };
const color = (rgb: string, alpha: number) => "rgba(" + rgb + "," + clamp(alpha, 0, 1) + ")";

export default function TimelineScene({ running, speed, flat, resetKey, pulseKey }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const options = useRef({ running, speed, flat });
  const target = useRef({ ...CAMERA });
  const requestDraw = useRef<() => void>(() => {});
  const pulse = useRef(false);
  const previousPulse = useRef(pulseKey);

  useEffect(() => {
    options.current = { running, speed, flat };
    requestDraw.current();
  }, [running, speed, flat]);

  useEffect(() => {
    target.current = { ...CAMERA };
    requestDraw.current();
  }, [resetKey]);

  useEffect(() => {
    if (pulseKey !== previousPulse.current) {
      previousPulse.current = pulseKey;
      pulse.current = true; requestDraw.current();
    }
  }, [pulseKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !ctx) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 1, height = 1, raf = 0, lastFrame = 0, phase = 0;
    let blend = options.current.flat ? 1 : 0, flash = -1;
    let pointerId: number | null = null, lastX = 0, lastY = 0;
    let wasMoving = false, ambientYaw = 0, ambientPitch = 0;
    const camera = { ...CAMERA };
    const hover = { x: 0, y: 0 };
    const dust = Array.from({ length: 112 }, (_, i) => ({
      x: (noise(i + 1) - 0.5) * 2800,
      y: (noise(i + 153) - 0.5) * 1250,
      z: noise(i + 317) * 4600,
      size: 0.55 + noise(i + 489) * 1.45,
    }));

    // Reuse one glow texture instead of blurring each particle on every frame.
    const light = document.createElement("canvas");
    light.width = light.height = 128;
    const lightCtx = light.getContext("2d");
    if (lightCtx) {
      const gradient = lightCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
      gradient.addColorStop(0, "rgba(242,255,213,1)");
      gradient.addColorStop(0.05, "rgba(226,255,161,.85)");
      gradient.addColorStop(0.18, "rgba(197,251,111,.24)");
      gradient.addColorStop(0.5, "rgba(172,234,100,.05)");
      gradient.addColorStop(1, "rgba(172,234,100,0)");
      lightCtx.fillStyle = gradient; lightCtx.fillRect(0, 0, 128, 128);
    }

    const transform = ({ x, y, z }: Point) => {
      const rx = x * Math.cos(camera.yaw) + z * Math.sin(camera.yaw);
      const rz = -x * Math.sin(camera.yaw) + z * Math.cos(camera.yaw);
      return { x: rx, y: y * Math.cos(camera.pitch) + rz * Math.sin(camera.pitch), depth: 1800 - y * Math.sin(camera.pitch) + rz * Math.cos(camera.pitch) };
    };
    const project = (point: Point): Projection => {
      const rotated = transform(point);
      // Fit vertical geometry to the stage as well as its width, including short screens.
      const focal = width < 640 ? Math.min(width * 2.5, 1050, height * 1.65) : Math.min(width * 1.1, 1480, height * 1.65);
      const scale = focal / Math.max(NEAR, rotated.depth);
      return {
        x: (width * 0.5 + rotated.x * scale) * (1 - blend) + (width * 0.5 + point.z * width / 3400) * blend,
        y: (height * 0.5 - rotated.y * scale) * (1 - blend) + (height * 0.5 - point.y * (width < 640 ? 0.3 : 0.58)) * blend,
        scale: scale * (1 - blend) + (width < 640 ? 0.5 : 1) * blend,
        depth: rotated.depth,
      };
    };
    const glow = (point: Projection, radius: number, alpha: number, stretch = 1) => {
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.drawImage(light, point.x - radius, point.y - radius * stretch, radius * 2, radius * 2 * stretch);
      ctx.restore();
    };
    const line = (a: Point, b: Point, stroke: string, weight = 1) => {
      // Clip in world space before projecting near-camera geometry.
      if (blend < 0.999) {
        const da = transform(a).depth, db = transform(b).depth;
        if (da < NEAR && db < NEAR) return;
        if (da < NEAR || db < NEAR) {
          const t = (NEAR - da) / (db - da);
          const clipped = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
          if (da < NEAR) a = clipped; else b = clipped;
        }
      }
      const from = project(a), to = project(b);
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y);
      ctx.strokeStyle = stroke; ctx.lineWidth = weight; ctx.stroke();
    };
    const stream = (z: number, lane = 0): Point => ({
      x: Math.sin(z * 0.00055) * 180 + lane * (32 + Math.abs(z) * 0.024),
      y: Math.sin(z * 0.00074) * 38 + lane * 5,
      z,
    });
    const ringPoint = (angle: number, radius: number, z: number, thickness = 0): Point => {
      const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
      return { x: x * 0.986 - y * 0.166, y: x * 0.166 + y * 0.986, z: z + x * 0.3 + thickness };
    };
    const ring = (radius: number, z: number, opacity: number, detailed: boolean, breath = 1) => {
      const steps = detailed ? (width < 640 ? 112 : 168) : 88;
      const alpha = opacity * (1 - blend);
      if (alpha < 0.005) return;
      const illumination = detailed ? 0.55 + breath * 0.45 : 1;
      const halo = 0.35 + breath;
      const orbit = phase * (detailed ? 0.24 : 0.075) + 3.8 + z * 0.0013;
      for (let i = 0; i < steps; i++) {
        const angle = i / steps * TAU, next = (i + 1) / steps * TAU;
        const a = ringPoint(angle, radius, z), b = ringPoint(next, radius, z);
        const fixedLight = 0.22 + Math.pow((Math.cos(angle - 3.85) + 1) * 0.5, 3) * 0.78;
        const travellingLight = detailed ? Math.pow((Math.cos(angle - orbit) + 1) * 0.5, 24) * 0.28 : 0;
        const brightness = Math.min(1, fixedLight + travellingLight);
        const strength = brightness * alpha * illumination;
        const pa = project(a), pb = project(b);
        if (pa.depth < NEAR || pb.depth < NEAR) continue;
        if (detailed) {
          // The light breathes while the physical bevel stays steady.
          line(a, b, color("176,250,90", brightness * alpha * 0.075 * halo), 19 * (0.9 + breath * 0.2) * pa.scale);
          line(a, b, color("196,255,110", brightness * alpha * 0.15 * halo), 8 * (0.95 + breath * 0.12) * pa.scale);
          // A bevel and a lit face make the main ring feel like a physical object.
          const innerA = project(ringPoint(angle, radius - 5, z, 9));
          const innerB = project(ringPoint(next, radius - 5, z, 9));
          ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y);
          ctx.lineTo(innerB.x, innerB.y); ctx.lineTo(innerA.x, innerA.y); ctx.closePath();
          ctx.fillStyle = color(fixedLight > 0.66 ? "196,234,138" : "73,119,78", alpha * 0.62); ctx.fill();
          line(ringPoint(angle, radius - 5, z, 9), ringPoint(next, radius - 5, z, 9), color("93,148,112", alpha * 0.36), 0.8);
        }
        line(a, b, color("217,255,154", strength), detailed ? Math.max(1, 1.8 * pa.scale) : 0.85);
        if (detailed && brightness > 0.84) line(a, b, color("249,255,231", strength * 0.84), 0.7);
      }
      if (detailed) {
        // Rotate the scale slowly around the breathing luminous rim.
        const scaleRotation = phase * 0.065;
        for (let i = 0; i < 64; i++) {
          const angle = i / 64 * TAU + scaleRotation;
          line(ringPoint(angle, radius + 13, z), ringPoint(angle, radius + (i % 8 === 0 ? 28 : 18), z), color("181,214,147", alpha * (i % 8 === 0 ? 0.55 : 0.22)), 0.7);
        }
      }
      // A soft travelling highlight follows the rim; distant rings move more slowly.
      const sweepSteps = detailed ? 30 : 18;
      const sweepLength = detailed ? 0.68 : 0.4;
      for (let i = 0; i < sweepSteps; i++) {
        const t = i / sweepSteps;
        const a = orbit - t * sweepLength;
        const next = a - sweepLength / sweepSteps;
        const strength = Math.sin(Math.PI * t) * alpha * (detailed ? 0.58 * illumination : 0.4);
        line(ringPoint(a, radius, z), ringPoint(next, radius, z), color("222,251,178", strength * 0.2), detailed ? 6 : 3);
        line(ringPoint(a, radius, z), ringPoint(next, radius, z), color("231,255,199", strength), detailed ? 1.6 : 1);
      }
      if (detailed) {
        for (let i = 0; i < 20; i++) {
          const t = i / 20, a = 1.2 - phase * 0.07 + t * 0.34;
          line(ringPoint(a, radius + 16, z), ringPoint(a + 0.017, radius + 16, z), color("187,221,147", Math.sin(Math.PI * t) * alpha * 0.27), 0.8);
        }
      }
    };

    const queueDraw = () => { if (!raf && !document.hidden) raf = requestAnimationFrame(draw); };
    const draw = (stamp: number) => {
      raf = 0;
      const dt = lastFrame ? Math.min(stamp - lastFrame, 40) : 16;
      lastFrame = stamp;
      const moving = options.current.running && !reducedMotion.matches;
      if (moving) phase += dt * 0.001 * options.current.speed;
      if (pulse.current) { flash = reducedMotion.matches ? -1 : 0; pulse.current = false; }
      if (reducedMotion.matches) flash = -1;
      if (moving && flash >= 0) { flash += dt * 0.001; if (flash > 1.8) flash = -1; }
      const damping = reducedMotion.matches ? 1 : 1 - Math.exp(-dt * 0.009);
      const desiredBlend = options.current.flat ? 1 : 0;
      blend += (desiredBlend - blend) * damping;
      if (Math.abs(desiredBlend - blend) < 0.001) blend = desiredBlend;
      const drift = moving && pointerId === null ? Math.sin(phase * 0.18) * 0.022 : 0;
      if (moving) { ambientYaw = hover.x * 0.025 + drift; ambientPitch = hover.y * 0.012; }
      else if (wasMoving) {
        ambientYaw = camera.yaw - target.current.yaw;
        ambientPitch = camera.pitch - target.current.pitch;
      }
      wasMoving = moving;
      const yaw = target.current.yaw + ambientYaw;
      const pitch = target.current.pitch + ambientPitch;
      camera.yaw += (yaw - camera.yaw) * damping;
      camera.pitch += (pitch - camera.pitch) * damping;
      ctx.clearRect(0, 0, width, height);
      const compact = width < 640;
      const center = project({ x: 0, y: 0, z: 0 });
      const radius = compact ? 278 : 334;
      // Shared phase preserves pause, speed, and reduced-motion behavior.
      const breathing = (Math.sin(phase * TAU / 5.6) + 1) * 0.5;

      ctx.globalCompositeOperation = "screen";
      glow(center, (compact ? 330 : 660) * (0.97 + breathing * 0.06), 0.14 + breathing * 0.12, 0.46);
      glow(project({ x: 40, y: 0, z: 1100 }), compact ? 160 : 330, 0.2, 0.58);
      ctx.globalCompositeOperation = "source-over";
      if (blend < 0.999) {
        for (let x = -1400; x <= 1400; x += 280) {
          line({ x, y: -360, z: -1100 }, { x, y: -360, z: 6200 }, color("104,152,137", 0.07 * (1 - blend)), 0.65);
        }
        for (let z = -1000; z < 5000; z += 400) {
          line({ x: -1400, y: -360, z }, { x: 1400, y: -360, z }, color("104,152,137", 0.055 * (1 - blend) * (1 - Math.abs(z) / 6000)), 0.65);
        }
        if (!compact) ring(310, 2900, 0.12, false);
        ring(310, 1740, 0.2, false);
        ring(310, 820, 0.33, false);
      }

      // Curved light streams meet at NOW; all rails share the same 3D projection.
      const lanes = compact ? [-1, 0, 1] : [-2, -1, 0, 1, 2];
      for (const lane of lanes) {
        const steps = compact ? 75 : 108;
        const layers = lane === 0 ? [[22, 0.035], [9, 0.11], [2.3, 0.6], [0.8, 0.85]] : [[1, 0.14]];
        for (const [weight, alpha] of layers) {
          ctx.beginPath();
          let active = false;
          for (let i = 0; i <= steps; i++) {
            const z = -1450 + i / steps * 8050;
            const point = project(stream(z, lane));
            if (point.depth < NEAR && blend < 0.999) { active = false; continue; }
            if (!active) { ctx.moveTo(point.x, point.y); active = true; } else ctx.lineTo(point.x, point.y);
          }
          const beam = ctx.createLinearGradient(0, height * 0.95, width, height * 0.15);
          beam.addColorStop(0, color("108,196,141", alpha * 0.08));
          beam.addColorStop(0.36, color("213,255,144", alpha));
          beam.addColorStop(0.63, color("229,255,184", alpha * 0.82));
          beam.addColorStop(1, color("107,181,148", alpha * 0.02));
          ctx.strokeStyle = beam; ctx.lineWidth = weight; ctx.stroke();
        }
      }
      const offset = phase * 145 % 115;
      for (let i = -12; i < 43; i++) {
        const point = stream(i * 115 - offset), projected = project(point);
        if ((projected.depth < NEAR && blend < 0.999) || projected.x < -20 || projected.x > width + 20) continue;
        const major = i % 5 === 0, alpha = Math.max(0, 1 - Math.abs(point.z) / 4300);
        line(point, { ...point, y: point.y + (major ? 17 : 7) }, color("205,231,174", alpha * (major ? 0.54 : 0.19)), 0.7);
      }
      for (let i = 0; i < (compact ? 12 : 24); i++) {
        const z = ((i * 349 - phase * (185 + i % 4 * 17)) % 6400 + 6400) % 6400 - 1380;
        const lane = i % 5 - 2;
        line(stream(z, lane), stream(z + 55 + i % 6 * 12, lane), color(i % 5 === 0 ? "136,212,190" : "225,255,182", 0.25 + i % 3 * 0.11), i % 7 === 0 ? 1.5 : 0.8);
      }

      ring(radius, 0, 0.95, true, breathing);
      // The floor ellipse anchors the suspended portal.
      if (blend < 0.999) {
        const floorPoint = (angle: number) => ({ x: Math.cos(angle) * radius * 1.12, y: -360, z: Math.sin(angle) * radius * 1.12 });
        for (let i = 0; i < 96; i++) {
          const a = i / 96 * TAU, b = (i + 1) / 96 * TAU;
          line(floorPoint(a), floorPoint(b), color("160,220,110", (0.055 + Math.max(0, Math.sin(a)) * 0.08) * (1 - blend)), 0.8);
        }
        for (let i = 0; i < 20; i++) {
          const t = i / 20, a = phase * 0.08 + 0.7 + t * 0.42;
          line(floorPoint(a), floorPoint(a + 0.021), color("186,228,139", Math.sin(Math.PI * t) * 0.16 * (1 - blend)), 1);
        }
      }
      const particles = dust.slice(0, compact ? 54 : dust.length).map((particle, i) => {
        const z = ((particle.z - phase * (9 + i % 5 * 4)) % 4600 + 4600) % 4600 - 950;
        return { point: project({ ...particle, z }), size: particle.size, i };
      }).filter(({ point }) => point.depth > NEAR && point.x > 0 && point.x < width && point.y > 0 && point.y < height).sort((a, b) => b.point.depth - a.point.depth);
      for (const { point, size, i } of particles) {
        const fade = clamp((point.depth - NEAR) / 700, 0, 1) * (0.16 + 0.26 * Math.min(1, point.scale)) * (1 - blend * 0.7);
        const r = clamp(size * point.scale, 0.45, 2.6);
        if (i % 11 === 0) glow(point, r * 12, fade * 0.65);
        ctx.beginPath(); ctx.arc(point.x, point.y, r, 0, TAU);
        ctx.fillStyle = color(i % 4 === 0 ? "150,214,205" : "217,235,186", fade); ctx.fill();
      }

      if (flash >= 0) {
        const progress = Math.min(1, flash / 1.8), opacity = (1 - progress) * 0.6;
        for (let i = 0; i < 88; i++) {
          const a = i / 88 * TAU, b = (i + 1) / 88 * TAU, r = 50 + progress * 650;
          line({ x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r }, { x: Math.cos(b) * r, y: 0, z: Math.sin(b) * r }, color("226,255,169", opacity), 1.1);
        }
      }
      const breath = 0.96 + breathing * 0.08;
      ctx.globalCompositeOperation = "screen";
      glow(center, (compact ? 130 : 185) * breath, 0.6 + breathing * 0.18);
      glow(center, (compact ? 105 : 205) * breath, 0.72 + breathing * 0.18, 0.055);
      glow(center, 26, 0.85 + breathing * 0.1);
      ctx.globalCompositeOperation = "source-over";
      ctx.beginPath(); ctx.arc(center.x, center.y, 2.6, 0, TAU); ctx.fillStyle = "#f6ffe5"; ctx.fill();
      ctx.beginPath(); ctx.moveTo(center.x, center.y - 12); ctx.lineTo(center.x, center.y - 38);
      ctx.strokeStyle = "rgba(223,255,165,.38)"; ctx.lineWidth = 0.8; ctx.stroke();
      ctx.textAlign = "center"; ctx.font = (compact ? "9" : "10") + "px Consolas, monospace";
      ctx.fillStyle = options.current.running ? "#d5ff9a" : "#e2b980";
      ctx.fillText(options.current.running ? "N O W / 此 刻" : "P A U S E D / 暂 停", center.x, center.y - 47);

      const settling = Math.abs(yaw - camera.yaw) > 0.0001 || Math.abs(pitch - camera.pitch) > 0.0001 || blend !== desiredBlend;
      if (moving || settling) queueDraw(); else lastFrame = 0;
    };

    const releasePointer = () => {
      const active = pointerId; pointerId = null;
      if (active !== null && canvas.hasPointerCapture(active)) canvas.releasePointerCapture(active);
      canvas.style.cursor = options.current.flat ? "default" : "grab";
    };
    const down = (event: PointerEvent) => {
      if (options.current.flat || !event.isPrimary || event.button !== 0) return;
      pointerId = event.pointerId; lastX = event.clientX; lastY = event.clientY; hover.x = hover.y = 0;
      canvas.setPointerCapture(event.pointerId); canvas.style.cursor = "grabbing";
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) {
        if (event.pointerType === "mouse") {
          const box = canvas.getBoundingClientRect();
          hover.x = (event.clientX - box.left) / width - 0.5;
          hover.y = (event.clientY - box.top) / height - 0.5;
        }
        return;
      }
      if (options.current.flat) { releasePointer(); return; }
      target.current.yaw = clamp(target.current.yaw + (event.clientX - lastX) * 0.002, 0.28, 0.86);
      target.current.pitch = clamp(target.current.pitch + (event.clientY - lastY) * 0.0013, 0.08, 0.39);
      lastX = event.clientX; lastY = event.clientY; queueDraw();
    };
    const up = (event: PointerEvent) => { if (event.pointerId === pointerId) releasePointer(); };
    const leave = () => { hover.x = hover.y = 0; };
    const keydown = (event: KeyboardEvent) => {
      if (options.current.flat || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "Home") { target.current = { ...CAMERA }; ambientYaw = ambientPitch = 0; }
      else {
        target.current.yaw = clamp(target.current.yaw + (event.key === "ArrowLeft" ? -0.06 : event.key === "ArrowRight" ? 0.06 : 0), 0.28, 0.86);
        target.current.pitch = clamp(target.current.pitch + (event.key === "ArrowUp" ? -0.04 : event.key === "ArrowDown" ? 0.04 : 0), 0.08, 0.39);
      }
      queueDraw();
    };
    const refresh = () => {
      lastFrame = 0;
      if (options.current.flat) releasePointer();
      canvas.style.cursor = pointerId !== null ? "grabbing" : options.current.flat ? "default" : "grab";
      queueDraw();
    };
    const resize = () => {
      const box = canvas.getBoundingClientRect();
      width = Math.max(1, box.width); height = Math.max(1, box.height);
      const dpr = Math.min(window.devicePixelRatio || 1, width < 640 ? 1.5 : 1.75);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); queueDraw();
    };
    const visibility = () => {
      cancelAnimationFrame(raf); raf = 0; lastFrame = 0;
      if (document.hidden) releasePointer(); else queueDraw();
    };
    requestDraw.current = refresh;
    const observer = new ResizeObserver(resize); observer.observe(canvas);
    canvas.addEventListener("pointerdown", down); canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("lostpointercapture", up); canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("keydown", keydown);
    reducedMotion.addEventListener("change", refresh); document.addEventListener("visibilitychange", visibility);
    resize();

    return () => {
      requestDraw.current = () => {}; cancelAnimationFrame(raf); observer.disconnect(); releasePointer();
      canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up); canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("lostpointercapture", up); canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("keydown", keydown);
      reducedMotion.removeEventListener("change", refresh); document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  return <canvas ref={canvasRef} className="timeline-canvas" tabIndex={flat ? -1 : 0} role="img" aria-label={flat ? "二维时间光轨" : "三维时间光门。拖动或使用方向键调整视角，Home 恢复视角。"} />;
}
