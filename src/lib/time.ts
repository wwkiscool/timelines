export type MomentCategory = "personal" | "milestone" | "system";

export type MomentEntry = {
  id: string;
  title: string;
  note: string;
  timestamp: number;
  category: MomentCategory;
  demo: boolean;
};

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const DAY = 24 * 60 * MINUTE;
// Asia/Shanghai observes UTC+08:00 year-round for the contemporary timeline.
const SHANGHAI_OFFSET = 8 * 60 * MINUTE;
const WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

function inShanghai(timestamp: number): Date {
  // UTC getters make the result independent of the browser's local timezone.
  return new Date(timestamp + SHANGHAI_OFFSET);
}

export function getTimeParts(timestamp: number): {
  hours: string;
  minutes: string;
  seconds: string;
  milliseconds: string;
  date: string;
  weekday: string;
} {
  const date = inShanghai(timestamp);

  return {
    hours: pad(date.getUTCHours()),
    minutes: pad(date.getUTCMinutes()),
    seconds: pad(date.getUTCSeconds()),
    milliseconds: pad(date.getUTCMilliseconds(), 3),
    date: `${date.getUTCFullYear()}年${pad(date.getUTCMonth() + 1)}月${pad(date.getUTCDate())}日`,
    weekday: WEEKDAYS[date.getUTCDay()],
  };
}

export function formatMomentTime(timestamp: number): string {
  const { hours, minutes, seconds, milliseconds } = getTimeParts(timestamp);
  return `${hours}:${minutes}:${seconds}.${milliseconds}`;
}

export function formatMomentDate(timestamp: number): string {
  const date = inShanghai(timestamp);
  return `${pad(date.getUTCMonth() + 1)}月${pad(date.getUTCDate())}日`;
}

export function createDemoMoments(now: number): MomentEntry[] {
  const startOfToday = Math.floor((now + SHANGHAI_OFFSET) / DAY) * DAY - SHANGHAI_OFFSET;

  return [
    {
      id: "demo-encounter",
      title: "与此刻相遇",
      note: "时间经过，而你恰好在这里。",
      timestamp: now - 72 * SECOND,
      category: "personal" as const,
      demo: true,
    },
    {
      id: "demo-focus",
      title: "专注的片刻",
      note: "让世界安静一点，把这一刻留给自己。",
      timestamp: now - 26 * MINUTE,
      category: "milestone" as const,
      demo: true,
    },
    {
      id: "demo-daybreak",
      title: "今日的开始",
      note: "新的一天，展开一条尚未写下的时间线。",
      timestamp: Math.min(startOfToday, now - 1),
      category: "system" as const,
      demo: true,
    },
  ].sort((a, b) => b.timestamp - a.timestamp);
}

export function getDayProgress(timestamp: number): number {
  const elapsed = ((timestamp + SHANGHAI_OFFSET) % DAY + DAY) % DAY;
  return (elapsed / DAY) * 100;
}

export type ProgressScope = "day" | "week" | "month" | "year";

export const PROGRESS_SCOPE_META: Record<ProgressScope, { label: string; next: ProgressScope }> = {
  day: { label: "今天，已经走过", next: "week" },
  week: { label: "本周，已经走过", next: "month" },
  month: { label: "本月，已经走过", next: "year" },
  year: { label: "今年，已经走过", next: "day" },
};

export function getScopeProgress(timestamp: number, scope: ProgressScope): number {
  if (scope === "day") return getDayProgress(timestamp);
  const shanghai = inShanghai(timestamp);
  const year = shanghai.getUTCFullYear();
  const month = shanghai.getUTCMonth();
  const date = shanghai.getUTCDate();
  const localMs = shanghai.getTime();
  if (scope === "week") {
    // Monday as start of week.
    const dayOffset = (shanghai.getUTCDay() + 6) % 7;
    const start = Date.UTC(year, month, date - dayOffset);
    return ((localMs - start) / (7 * DAY)) * 100;
  }
  if (scope === "month") {
    const start = Date.UTC(year, month, 1);
    const end = Date.UTC(year, month + 1, 1);
    return ((localMs - start) / (end - start)) * 100;
  }
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  return ((localMs - start) / (end - start)) * 100;
}

export function toShanghaiInputValues(timestamp: number): { date: string; time: string; ms: string } {
  const d = inShanghai(timestamp);
  return {
    date: `${String(d.getUTCFullYear()).padStart(4, "0")}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`,
    ms: pad(d.getUTCMilliseconds(), 3),
  };
}

export function fromShanghaiInputValues(dateStr: string, timeStr: string, msStr: string): number | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  const tm = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(timeStr.trim());
  if (!dm || !tm) return null;
  const year = Number(dm[1]), month = Number(dm[2]), day = Number(dm[3]);
  const hour = Number(tm[1]), minute = Number(tm[2]), second = Number(tm[3] ?? "0");
  const ms = Math.max(0, Math.min(999, Number.parseInt(msStr || "0", 10) || 0));
  const utc = Date.UTC(year, month - 1, day, hour, minute, second, ms) - SHANGHAI_OFFSET;
  const check = inShanghai(utc);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return Number.isFinite(utc) ? utc : null;
}

export function getMonthGroupKey(timestamp: number): string {
  const d = inShanghai(timestamp);
  return `${d.getUTCFullYear()}年${pad(d.getUTCMonth() + 1)}月`;
}

export function isSameShanghaiMonthDay(a: number, b: number): boolean {
  const da = inShanghai(a);
  const db = inShanghai(b);
  return da.getUTCMonth() === db.getUTCMonth() && da.getUTCDate() === db.getUTCDate();
}
