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
