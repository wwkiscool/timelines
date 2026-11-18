"use client";

import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_SOLAR_CAMERA,
  SOLAR_CAMERA_LIMITS,
  drawSolarSystem,
  projectSolarMomentMarkers,
  type SolarCamera,
  type SolarMomentInput,
  type SolarMomentMarker,
} from "@/lib/solar-system";
import { formatMomentDate, formatMomentTime } from "@/lib/time";
import styles from "./solar-system-scene.module.css";

type SolarSystemSceneProps = {
  running: boolean;
  speed: number;
  pulseKey: number;
  ephemeris?: boolean;
  referenceTimestamp?: number;
  moments?: SolarMomentInput[];
  activeMomentId?: string | null;
  warpKey?: number;
  onSelectMoment?: (id: string) => void;
};

const EMPTY_MOMENTS: SolarMomentInput[] = [];

export default function SolarSystemScene({
  running,
  speed,
  pulseKey,
  ephemeris = false,
  referenceTimestamp,
  moments = EMPTY_MOMENTS,
  activeMomentId = null,
  warpKey = 0,
  onSelectMoment,
}: SolarSystemSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const posterRef = useRef<HTMLPictureElement>(null);
  const options = useRef({ running, speed, ephemeris, referenceTimestamp, moments, activeMomentId });
  const onSelectRef = useRef(onSelectMoment);
  onSelectRef.current = onSelectMoment;
  const redraw = useRef<() => void>(() => {});
  const setDistanceRef = useRef<(delta: number | "reset") => void>(() => {});
  const pulse = useRef(false);
  const previousPulse = useRef(pulseKey);
  const previousWarp = useRef(warpKey);
  const cameraRef = useRef<SolarCamera>({ ...DEFAULT_SOLAR_CAMERA });
  const phaseRef = useRef(0);
  const hoveredIdRef = useRef<string | null>(null);
  const [hovered, setHovered] = useState<SolarMomentMarker | null>(null);

  useEffect(() => {
    options.current = { running, speed, ephemeris, referenceTimestamp, moments, activeMomentId };
    redraw.current();
  }, [running, speed, ephemeris, referenceTimestamp, moments, activeMomentId]);

  useEffect(() => {
    if (pulseKey > 0 && previousPulse.current !== pulseKey) {
      pulse.current = true;
      redraw.current();
    }
    previousPulse.current = pulseKey;
  }, [pulseKey]);

  useEffect(() => {
    if (warpKey > 0 && previousWarp.current !== warpKey && referenceTimestamp !== undefined) {
      phaseRef.current = (((referenceTimestamp / 1000) % 3600) + 3600) % 3600 * 0.08;
      pulse.current = true;
      redraw.current();
    }
    previousWarp.current = warpKey;
  }, [warpKey, referenceTimestamp]);

  useEffect(() => {
    const canvas = canvasRef.current;
    let ctx: CanvasRenderingContext2D | null = null;
    try { ctx = canvas?.getContext("2d", { alpha: true }) ?? null; }
    catch (error) { console.error("太阳系画布不可用，保留首屏画面。", error); }
    if (!canvas || !ctx) return;
    const reducedMotion = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    let width = 1, height = 1, flash = -1, raf = 0, previousTime = 0, sized = false;
    let pointerId: number | null = null, startX = 0, startY = 0, lastX = 0, lastY = 0, touchDragging = false, moved = false;

    const limitCamera = (yaw: number, pitch: number, distance = cameraRef.current.distance) => {
      cameraRef.current.yaw = Math.max(SOLAR_CAMERA_LIMITS.yaw.min, Math.min(SOLAR_CAMERA_LIMITS.yaw.max, yaw));
      cameraRef.current.pitch = Math.max(SOLAR_CAMERA_LIMITS.pitch.min, Math.min(SOLAR_CAMERA_LIMITS.pitch.max, pitch));
      cameraRef.current.distance = Math.max(SOLAR_CAMERA_LIMITS.distance.min, Math.min(SOLAR_CAMERA_LIMITS.distance.max, distance));
    };

    const hitTestMarker = (clientX: number, clientY: number): SolarMomentMarker | null => {
      const list = options.current.moments;
      if (!sized || !list.length) return null;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const refTime = options.current.referenceTimestamp ?? Date.now();
      const markers = projectSolarMomentMarkers(width, height, list, refTime, cameraRef.current);
      let best: SolarMomentMarker | null = null;
      let bestDist = 14;
      for (const marker of markers) {
        const dist = Math.hypot(marker.x - x, marker.y - y);
        if (dist <= bestDist) {
          bestDist = dist;
          best = marker;
        }
      }
      return best;
    };

    const paint = () => {
      if (!sized) return false;
      try {
        const refTime = options.current.referenceTimestamp ?? Date.now();
        drawSolarSystem(ctx, width, height, phaseRef.current, flash, cameraRef.current, {
          ephemerisTimestamp: options.current.ephemeris ? refTime : undefined,
          moments: options.current.moments,
          referenceTimestamp: refTime,
          activeMomentId: options.current.activeMomentId,
          hoveredMomentId: hoveredIdRef.current,
        });
        if (posterRef.current) posterRef.current.hidden = true;
        return true;
      } catch (error) {
        if (posterRef.current) posterRef.current.hidden = false;
        console.error("太阳系画布绘制失败，保留首屏画面。", error);
        return false;
      }
    };

    const draw = (stamp: number) => {
      raf = 0;
      const dt = previousTime ? Math.min((stamp - previousTime) / 1000, .04) : 0;
      previousTime = stamp;
      const moving = options.current.running && !reducedMotion?.matches;
      if (moving) phaseRef.current += dt * options.current.speed;
      if (pulse.current) { flash = reducedMotion?.matches ? -1 : 0; pulse.current = false; }
      if (reducedMotion?.matches) flash = -1;
      if (moving && flash >= 0) { flash += dt; if (flash > 1.6) flash = -1; }
      if (!paint()) { previousTime = 0; return; }
      if (moving && !document.hidden) raf = requestAnimationFrame(draw);
      else previousTime = 0;
    };

    const queue = () => { if (sized && !raf && !document.hidden) raf = requestAnimationFrame(draw); };

    setDistanceRef.current = (delta) => {
      if (delta === "reset") cameraRef.current = { ...DEFAULT_SOLAR_CAMERA };
      else limitCamera(cameraRef.current.yaw, cameraRef.current.pitch, cameraRef.current.distance + delta);
      queue();
    };

    const finishPointer = (event?: PointerEvent) => {
      if (event && event.pointerId !== pointerId) return;
      const wasClick = event?.type === "pointerup" && !moved;
      const active = pointerId; pointerId = null; touchDragging = false;
      if (active !== null && canvas.hasPointerCapture?.(active)) canvas.releasePointerCapture?.(active);
      if (canvas.dataset) canvas.dataset.dragging = "false";
      if (wasClick && event) {
        const hit = hitTestMarker(event.clientX, event.clientY);
        if (hit) onSelectRef.current?.(hit.id);
      }
    };

    const pointerDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return;
      pointerId = event.pointerId;
      startX = lastX = event.clientX;
      startY = lastY = event.clientY;
      touchDragging = false;
      moved = false;
      canvas.setPointerCapture?.(event.pointerId);
      canvas.focus?.({ preventScroll: true });
      if (canvas.dataset) canvas.dataset.dragging = "true";
    };

    const pointerMove = (event: PointerEvent) => {
      if (event.pointerId === pointerId) {
        const dx = event.clientX - lastX, dy = event.clientY - lastY;
        if (Math.hypot(event.clientX - startX, event.clientY - startY) > 4) moved = true;
        // Horizontal touch drags rotate the scene; normal vertical swipes can scroll.
        if (event.pointerType === "touch" && !touchDragging) {
          if (Math.abs(dx) < 4 || Math.abs(dx) < Math.abs(dy)) return;
          touchDragging = true;
        }
        limitCamera(cameraRef.current.yaw + dx * .004, cameraRef.current.pitch - dy * .003);
        lastX = event.clientX; lastY = event.clientY; queue();
      } else if (event.pointerType === "mouse") {
        const hit = hitTestMarker(event.clientX, event.clientY);
        const nextId = hit?.id ?? null;
        if (canvas.dataset) canvas.dataset.hover = hit ? "true" : "false";
        if (nextId !== hoveredIdRef.current) {
          hoveredIdRef.current = nextId;
          setHovered(hit);
          queue();
        } else if (hit) {
          setHovered(hit);
        }
      }
    };

    const pointerLeave = () => {
      if (canvas.dataset) canvas.dataset.hover = "false";
      if (hoveredIdRef.current !== null) {
        hoveredIdRef.current = null;
        setHovered(null);
        queue();
      }
    };

    const wheel = (event: WheelEvent) => {
      if (!event.altKey && !event.ctrlKey) return;
      event.preventDefault();
      limitCamera(cameraRef.current.yaw, cameraRef.current.pitch, cameraRef.current.distance + event.deltaY * 1.4);
      queue();
    };

    const keyDown = (event: KeyboardEvent) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "+", "=", "-", "_"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "Home") cameraRef.current = { ...DEFAULT_SOLAR_CAMERA };
      else if (event.key === "+" || event.key === "=") {
        limitCamera(cameraRef.current.yaw, cameraRef.current.pitch, cameraRef.current.distance - 240);
      } else if (event.key === "-" || event.key === "_") {
        limitCamera(cameraRef.current.yaw, cameraRef.current.pitch, cameraRef.current.distance + 240);
      } else {
        const step = event.shiftKey ? .12 : .055;
        limitCamera(
          cameraRef.current.yaw + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0),
          cameraRef.current.pitch + (event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0),
        );
      }
      queue();
    };

    const resize = () => {
      const box = canvas.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) {
        sized = false; cancelAnimationFrame(raf); raf = 0; previousTime = 0;
        if (posterRef.current) posterRef.current.hidden = false;
        return;
      }
      sized = true; width = box.width; height = box.height;
      const dpr = Math.min(window.devicePixelRatio || 1, width < 640 ? 1.5 : 1.75);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (paint()) queue();
    };

    const visibility = () => {
      cancelAnimationFrame(raf); raf = 0; previousTime = 0;
      if (document.hidden) finishPointer();
      if (!document.hidden) queue();
    };

    redraw.current = queue;
    // Paint before subscribing: a missing observer must not leave a blank canvas.
    resize();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
    if (observer) observer.observe(canvas);
    else window.addEventListener("resize", resize);
    if (reducedMotion?.addEventListener) reducedMotion.addEventListener("change", queue);
    else reducedMotion?.addListener?.(queue);
    document.addEventListener("visibilitychange", visibility);
    canvas.addEventListener?.("pointerdown", pointerDown);
    canvas.addEventListener?.("pointermove", pointerMove);
    canvas.addEventListener?.("pointerleave", pointerLeave);
    canvas.addEventListener?.("pointerup", finishPointer);
    canvas.addEventListener?.("pointercancel", finishPointer);
    canvas.addEventListener?.("lostpointercapture", finishPointer);
    canvas.addEventListener?.("wheel", wheel, { passive: false });
    canvas.addEventListener?.("keydown", keyDown);
    return () => {
      redraw.current = () => {};
      setDistanceRef.current = () => {};
      cancelAnimationFrame(raf); observer?.disconnect();
      if (!observer) window.removeEventListener("resize", resize);
      if (reducedMotion?.removeEventListener) reducedMotion.removeEventListener("change", queue);
      else reducedMotion?.removeListener?.(queue);
      document.removeEventListener("visibilitychange", visibility);
      finishPointer();
      canvas.removeEventListener?.("pointerdown", pointerDown);
      canvas.removeEventListener?.("pointermove", pointerMove);
      canvas.removeEventListener?.("pointerleave", pointerLeave);
      canvas.removeEventListener?.("pointerup", finishPointer);
      canvas.removeEventListener?.("pointercancel", finishPointer);
      canvas.removeEventListener?.("lostpointercapture", finishPointer);
      canvas.removeEventListener?.("wheel", wheel);
      canvas.removeEventListener?.("keydown", keyDown);
    };
  }, []);

  return <div className={styles.scene} style={{ position: "relative", width: "100%", height: "100%", minHeight: 320 }}>
    <picture ref={posterRef} className={styles.poster} style={{ position: "absolute", inset: 0 }}>
      <source media="(max-width: 640px)" srcSet="/solar-system-mobile.png"/>
      <img src="/solar-system-desktop.png" alt="" aria-hidden="true" draggable={false} style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }}/>
    </picture>
    <canvas
      ref={canvasRef}
      className={styles.canvas}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      tabIndex={0}
      role="img"
      aria-label="立体太阳系：太阳与九颗星球沿共同弧形路径平缓地向右上方前行，星球围绕太阳公转，轨迹上的微光星标代表时刻记录。拖动或使用方向键旋转观察视角，Alt+滚轮或加减号缩放，Home 恢复视角。"
    />
    {hovered && (
      <div className={styles.markerTooltip} style={{ left: hovered.x, top: hovered.y }} role="status">
        <span className={styles.markerTooltipTitle}>{hovered.title}</span>
        <span className={styles.markerTooltipMeta}>{formatMomentDate(hovered.timestamp)} · {formatMomentTime(hovered.timestamp).slice(0, 8)}</span>
      </div>
    )}
    <div className={styles.zoomHud} aria-label="太阳系视角缩放控制">
      <button type="button" onClick={() => setDistanceRef.current(-320)} title="拉近视角 (+)" aria-label="拉近视角">+</button>
      <button type="button" onClick={() => setDistanceRef.current(320)} title="拉远视角 (-)" aria-label="拉远视角">−</button>
      <button type="button" onClick={() => setDistanceRef.current("reset")} title="重置视角 (Home)" aria-label="重置视角">1:1</button>
    </div>
  </div>;
}
