import { drawSolarSystem } from "./solar-system";
import { formatMomentTime, getTimeParts, type MomentCategory, type MomentEntry } from "./time";

const CATEGORY_LABELS: Record<MomentCategory, { label: string; color: string }> = {
  personal: { label: "生活片刻", color: "#70d9ff" },
  milestone: { label: "小小里程碑", color: "#b8a5ff" },
  system: { label: "时间印记", color: "#ffcf79" },
};

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const ch of Array.from(paragraph)) {
      const next = current + ch;
      if (ctx.measureText(next).width > maxWidth && current) {
        lines.push(current);
        current = ch;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

export function downloadMomentCard(moment: MomentEntry): boolean {
  if (typeof document === "undefined") return false;
  const width = 900;
  const height = 1280;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;

  // Deep-space gradient background
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#050b18");
  bg.addColorStop(0.55, "#091529");
  bg.addColorStop(1, "#050a16");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Subtle radial glow
  const glow = ctx.createRadialGradient(width * 0.5, 410, 20, width * 0.5, 410, 380);
  glow.addColorStop(0, "rgba(112, 217, 255, 0.14)");
  glow.addColorStop(1, "rgba(5, 11, 24, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // Border frame
  ctx.strokeStyle = "rgba(134, 182, 237, 0.22)";
  ctx.lineWidth = 2;
  ctx.strokeRect(36, 36, width - 72, height - 72);

  // Header
  ctx.fillStyle = "#8596bb";
  ctx.font = '18px "SFMono-Regular", Consolas, monospace';
  ctx.fillText("MOMENT 一瞬 · TIME COORDINATE", 78, 102);

  const meta = CATEGORY_LABELS[moment.category];
  ctx.fillStyle = meta.color;
  ctx.textAlign = "right";
  ctx.fillText(meta.label, width - 78, 102);
  ctx.textAlign = "left";

  // Miniature solar system snapshot anchored at the moment's phase
  const solarCanvas = document.createElement("canvas");
  solarCanvas.width = 744;
  solarCanvas.height = 420;
  const solarCtx = solarCanvas.getContext("2d");
  if (solarCtx) {
    const phaseSeconds = ((moment.timestamp / 1000) % 86400 + 86400) % 86400;
    drawSolarSystem(solarCtx, 744, 420, phaseSeconds * 0.08, 0.35);
    ctx.drawImage(solarCanvas, 78, 150);
  }

  // Divider
  ctx.strokeStyle = "rgba(134, 182, 237, 0.18)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(78, 608);
  ctx.lineTo(width - 78, 608);
  ctx.stroke();

  // Exact timestamp
  const parts = getTimeParts(moment.timestamp);
  ctx.fillStyle = "#70d9ff";
  ctx.font = '56px "SFMono-Regular", Consolas, monospace';
  ctx.fillText(formatMomentTime(moment.timestamp), 78, 690);

  ctx.fillStyle = "#8899bf";
  ctx.font = '20px Arial, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(`${parts.date} · ${parts.weekday} · 北京时间 UTC+08:00`, 78, 736);

  // Title
  ctx.fillStyle = "#e3efff";
  ctx.font = 'bold 38px Arial, "PingFang SC", "Microsoft YaHei", sans-serif';
  const titleLines = wrapLines(ctx, moment.title, width - 156).slice(0, 2);
  let y = 830;
  for (const line of titleLines) {
    ctx.fillText(line, 78, y);
    y += 52;
  }

  // Note
  ctx.fillStyle = "#98acd7";
  ctx.font = '24px Arial, "PingFang SC", "Microsoft YaHei", sans-serif';
  const noteText = moment.note.trim() || "无需太多言语，记住此刻就好。";
  const noteLines = wrapLines(ctx, noteText, width - 156).slice(0, 6);
  y += 26;
  for (const line of noteLines) {
    ctx.fillText(line, 78, y);
    y += 40;
  }

  // Footer
  ctx.fillStyle = "#5a6c86";
  ctx.font = '16px "SFMono-Regular", Consolas, monospace';
  ctx.fillText(`UNIX ${moment.timestamp} MS`, 78, height - 82);
  ctx.textAlign = "right";
  ctx.fillText("THE PRESENT IS A PRESENT.", width - 78, height - 82);

  const url = canvas.toDataURL("image/png");
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `moment-${parts.date.replace(/[年月日]/g, "-")}-${moment.id.slice(0, 8)}.png`;
  anchor.click();
  return true;
}
