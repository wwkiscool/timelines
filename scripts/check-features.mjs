import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");

function loadTs(relativePath, mocks = {}) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const loaded = { exports: {} };
  const customRequire = id => (id in mocks ? mocks[id] : require(id));
  new Function("exports", "require", "module", code)(loaded.exports, customRequire, loaded);
  return loaded.exports;
}

const timeMod = loadTs("../src/lib/time.ts");
const momentsMod = loadTs("../src/lib/moments.ts", { "./time": timeMod });
const solarMod = loadTs("../src/lib/solar-system.ts");

test("getScopeProgress computes valid UTC+8 percentages across day, week, month, year", () => {
  // 2026-11-17T12:00:00+08:00 -> exactly 50% of the day
  const noonShanghai = Date.UTC(2026, 10, 17, 4, 0, 0, 0);
  assert.ok(Math.abs(timeMod.getScopeProgress(noonShanghai, "day") - 50) < 1e-6);

  // Tuesday noon is 1.5 / 7 days into Monday-starting week
  const weekPct = timeMod.getScopeProgress(noonShanghai, "week");
  assert.ok(Math.abs(weekPct - (1.5 / 7) * 100) < 1e-6);

  const monthPct = timeMod.getScopeProgress(noonShanghai, "month");
  assert.ok(monthPct > 50 && monthPct < 60);

  const yearPct = timeMod.getScopeProgress(noonShanghai, "year");
  assert.ok(yearPct > 85 && yearPct < 90);
});

test("Shanghai date/time input helpers round-trip and reject invalid calendar dates", () => {
  const tsMs = Date.UTC(2026, 10, 17, 8, 30, 45, 123); // 16:30:45.123 +08:00
  const vals = timeMod.toShanghaiInputValues(tsMs);
  assert.deepEqual(vals, { date: "2026-11-17", time: "16:30:45", ms: "123" });
  assert.equal(timeMod.fromShanghaiInputValues(vals.date, vals.time, vals.ms), tsMs);

  // Invalid date like Feb 30 must return null
  assert.equal(timeMod.fromShanghaiInputValues("2026-02-30", "12:00:00", "0"), null);
  assert.equal(timeMod.getMonthGroupKey(tsMs), "2026年11月");
  assert.equal(timeMod.isSameShanghaiMonthDay(tsMs, Date.UTC(2024, 10, 17, 1, 0, 0)), true);
  assert.equal(timeMod.isSameShanghaiMonthDay(tsMs, Date.UTC(2024, 10, 18, 1, 0, 0)), false);
});

test("parseImportedMomentsFile supports export format, arrays, deduplication and demo filtering", () => {
  const payload = JSON.stringify({
    version: 1,
    timezone: "Asia/Shanghai",
    moments: [
      { id: "m1", title: "测试一", note: "内容", timestamp: 1700000000000, category: "personal", demo: false },
      { id: "m1", title: "重复ID", note: "", timestamp: 1700000001000, category: "personal", demo: false },
      { id: "demo-1", title: "示例", note: "", timestamp: 1700000002000, category: "system", demo: true },
      { id: "bad", title: "", note: "", timestamp: 1700000003000, category: "personal", demo: false },
      { title: "无ID自动生成", note: "", timestamp: 1700000004000, category: "milestone" },
    ],
  });
  const result = momentsMod.parseImportedMomentsFile(payload);
  assert.ok(result);
  assert.equal(result.moments.length, 2);
  assert.equal(result.skippedDemo, 1);
  assert.equal(result.skippedInvalid, 1);
  assert.equal(result.moments[0].title, "无ID自动生成");
  assert.equal(result.moments[1].id, "m1");
  assert.equal(momentsMod.parseImportedMomentsFile("not-json"), null);
});

test("solar-system ephemeris and moment marker projections remain finite", () => {
  const earth = solarMod.solarPlanets.find(p => p.id === "earth");
  assert.ok(earth);
  assert.equal(solarMod.resolvePlanetAngleOffset(earth, undefined), earth.angle);
  const ephAngle = solarMod.resolvePlanetAngleOffset(earth, Date.UTC(2026, 10, 17, 8, 0, 0));
  assert.ok(Number.isFinite(ephAngle) && ephAngle !== earth.angle);

  const now = Date.UTC(2026, 10, 17, 8, 0, 0);
  const markers = solarMod.projectSolarMomentMarkers(
    1200,
    600,
    [
      { id: "a", title: "此刻", timestamp: now - 5_000, category: "personal", demo: false },
      { id: "b", title: "昨日", timestamp: now - 86_400_000, category: "milestone", demo: false },
    ],
    now,
  );
  assert.equal(markers.length, 2);
  for (const m of markers) {
    assert.ok(Number.isFinite(m.x) && Number.isFinite(m.y));
    assert.ok(m.x > 0 && m.x < 1200 && m.y > 0 && m.y < 600);
  }
});
