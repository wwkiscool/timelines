"use client";

import { useEffect, useRef } from "react";
import { DEFAULT_SOLAR_CAMERA, SOLAR_CAMERA_LIMITS, drawSolarSystem, type SolarCamera } from "@/lib/solar-system";
import styles from "./solar-system-scene.module.css";

type SolarSystemSceneProps = { running: boolean; speed: number; pulseKey: number };

export default function SolarSystemScene({ running, speed, pulseKey }: SolarSystemSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const posterRef = useRef<HTMLPictureElement>(null);
  const options = useRef({ running, speed });
  const redraw = useRef<() => void>(() => {});
  const pulse = useRef(false);
  const previousPulse = useRef(pulseKey);
  const cameraRef = useRef<SolarCamera>({ ...DEFAULT_SOLAR_CAMERA });
  useEffect(() => { options.current = { running, speed }; redraw.current(); }, [running, speed]);
  useEffect(() => {
    if (pulseKey > 0 && previousPulse.current !== pulseKey) { pulse.current = true; redraw.current(); }
    previousPulse.current = pulseKey;
  }, [pulseKey]);
  useEffect(() => {
    const canvas = canvasRef.current;
    let ctx: CanvasRenderingContext2D | null = null;
    try { ctx = canvas?.getContext("2d", { alpha: true }) ?? null; }
    catch (error) { console.error("太阳系画布不可用，保留首屏画面。", error); }
    if (!canvas || !ctx) return;
    const reducedMotion = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    let width = 1, height = 1, phase = 0, flash = -1, raf = 0, previousTime = 0, sized = false;
    let pointerId: number | null = null, lastX = 0, lastY = 0, touchDragging = false;
    const limitCamera = (yaw: number, pitch: number) => {
      cameraRef.current.yaw = Math.max(SOLAR_CAMERA_LIMITS.yaw.min, Math.min(SOLAR_CAMERA_LIMITS.yaw.max, yaw));
      cameraRef.current.pitch = Math.max(SOLAR_CAMERA_LIMITS.pitch.min, Math.min(SOLAR_CAMERA_LIMITS.pitch.max, pitch));
    };
    const paint = () => {
      if (!sized) return false;
      try {
        drawSolarSystem(ctx, width, height, phase, flash, cameraRef.current);
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
      if (moving) phase += dt * options.current.speed;
      if (pulse.current) { flash = reducedMotion?.matches ? -1 : 0; pulse.current = false; }
      if (reducedMotion?.matches) flash = -1;
      if (moving && flash >= 0) { flash += dt; if (flash > 1.6) flash = -1; }
      if (!paint()) { previousTime = 0; return; }
      if (moving && !document.hidden) raf = requestAnimationFrame(draw);
      else previousTime = 0;
    };
    const queue = () => { if (sized && !raf && !document.hidden) raf = requestAnimationFrame(draw); };
    const finishPointer = (event?: PointerEvent) => {
      if (event && event.pointerId !== pointerId) return;
      const active = pointerId; pointerId = null; touchDragging = false;
      if (active !== null && canvas.hasPointerCapture?.(active)) canvas.releasePointerCapture?.(active);
      if (canvas.dataset) canvas.dataset.dragging = "false";
    };
    const pointerDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return;
      pointerId = event.pointerId; lastX = event.clientX; lastY = event.clientY;
      touchDragging = false;
      canvas.setPointerCapture?.(event.pointerId);
      canvas.focus?.({ preventScroll: true });
      if (canvas.dataset) canvas.dataset.dragging = "true";
    };
    const pointerMove = (event: PointerEvent) => {
      if (event.pointerId === pointerId) {
        const dx = event.clientX - lastX, dy = event.clientY - lastY;
        // Horizontal touch drags rotate the scene; normal vertical swipes can scroll.
        if (event.pointerType === "touch" && !touchDragging) {
          if (Math.abs(dx) < 4 || Math.abs(dx) < Math.abs(dy)) return;
          touchDragging = true;
        }
        limitCamera(cameraRef.current.yaw + dx * .004, cameraRef.current.pitch - dy * .003);
        lastX = event.clientX; lastY = event.clientY; queue();
      }
    };
    const keyDown = (event: KeyboardEvent) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "Home") cameraRef.current = { ...DEFAULT_SOLAR_CAMERA };
      else {
        const step = event.shiftKey ? .12 : .055;
        limitCamera(cameraRef.current.yaw + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0), cameraRef.current.pitch + (event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0));
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
    canvas.addEventListener?.("pointerup", finishPointer);
    canvas.addEventListener?.("pointercancel", finishPointer);
    canvas.addEventListener?.("lostpointercapture", finishPointer);
    canvas.addEventListener?.("keydown", keyDown);
    return () => {
      redraw.current = () => {};
      cancelAnimationFrame(raf); observer?.disconnect();
      if (!observer) window.removeEventListener("resize", resize);
      if (reducedMotion?.removeEventListener) reducedMotion.removeEventListener("change", queue);
      else reducedMotion?.removeListener?.(queue);
      document.removeEventListener("visibilitychange", visibility);
      finishPointer();
      canvas.removeEventListener?.("pointerdown", pointerDown);
      canvas.removeEventListener?.("pointermove", pointerMove);
      canvas.removeEventListener?.("pointerup", finishPointer);
      canvas.removeEventListener?.("pointercancel", finishPointer);
      canvas.removeEventListener?.("lostpointercapture", finishPointer);
      canvas.removeEventListener?.("keydown", keyDown);
    };
  }, []);
  return <div className={styles.scene} style={{ position: "relative", width: "100%", height: "100%", minHeight: 320 }}>
    <picture ref={posterRef} className={styles.poster} style={{ position: "absolute", inset: 0 }}>
      <source media="(max-width: 640px)" srcSet="/solar-system-mobile.png"/>
      <img src="/solar-system-desktop.png" alt="" aria-hidden="true" draggable={false} style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }}/>
    </picture>
    <canvas ref={canvasRef} className={styles.canvas} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} tabIndex={0} role="img" aria-label="立体太阳系：太阳与九颗星球沿共同弧形路径平缓地向右上方前行，星球围绕太阳公转，公转平面随路径转向，螺旋历史轨迹沿弧线向后逐渐淡出。拖动或使用方向键旋转观察视角，Home 恢复视角。" />
  </div>;
}
