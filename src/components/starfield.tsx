"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import styles from "./starfield.module.css";

type StarfieldProps = { running: boolean; speed: number };

const TILE_SIZE = 1600;

// Fixed seeds keep the server and browser rendering identical.
function createStarTile(count: number, size: number, seed: number) {
  let state = seed;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const stars = Array.from({ length: count }, () => {
    const x = (random() * TILE_SIZE).toFixed(1);
    const y = (random() * TILE_SIZE).toFixed(1);
    const opacity = (.45 + random() * .55).toFixed(2);
    const color = random() < .22 ? "#99bcff" : "#e0ebff";
    return `<circle cx="${x}" cy="${y}" r="${size / 2}" fill="${color}" opacity="${opacity}"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_SIZE}" height="${TILE_SIZE}" viewBox="0 0 ${TILE_SIZE} ${TILE_SIZE}">${stars}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const layers = [
  { name: "far", count: 700, duration: 110, opacity: .62, image: createStarTile(700, 1, 173) },
  { name: "middle", count: 200, duration: 70, opacity: .72, image: createStarTile(200, 2, 821) },
  { name: "near", count: 80, duration: 42, opacity: .88, image: createStarTile(80, 3, 1571) },
] as const;

export default function Starfield({ running, speed }: StarfieldProps) {
  const fieldRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const applySpeed = () => {
      const animations = fieldRef.current?.getAnimations?.({ subtree: true }) ?? [];
      for (const animation of animations) {
        if ("animationName" in animation && typeof animation.animationName === "string" && animation.animationName.includes("rise")) {
          if (typeof animation.updatePlaybackRate === "function") animation.updatePlaybackRate(speed);
          else animation.playbackRate = speed;
        }
      }
    };
    const onVisibility = () => {
      if (fieldRef.current) fieldRef.current.dataset.hidden = String(document.hidden);
    };
    applySpeed();
    onVisibility();
    const reducedMotion = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    if (reducedMotion?.addEventListener) reducedMotion.addEventListener("change", applySpeed);
    else reducedMotion?.addListener?.(applySpeed);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (reducedMotion?.removeEventListener) reducedMotion.removeEventListener("change", applySpeed);
      else reducedMotion?.removeListener?.(applySpeed);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [speed]);

  return (
    <div ref={fieldRef} className={styles.field} data-running={running} aria-hidden="true">
      {layers.map(layer => (
        <div
          key={layer.name}
          className={styles.layer}
          data-layer={layer.name}
          data-star-count={layer.count}
          style={{
            "--star-image": layer.image,
            "--rise-period": `${layer.duration}s`,
            "--layer-opacity": layer.opacity,
          } as CSSProperties}
        />
      ))}
    </div>
  );
}
