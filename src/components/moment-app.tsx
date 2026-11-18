"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  PROGRESS_SCOPE_META,
  createDemoMoments,
  formatMomentDate,
  formatMomentTime,
  fromShanghaiInputValues,
  getMonthGroupKey,
  getScopeProgress,
  getTimeParts,
  isSameShanghaiMonthDay,
  toShanghaiInputValues,
  type MomentCategory,
  type MomentEntry,
  type ProgressScope,
} from "@/lib/time";
import Icon, { type IconName } from "./icon";
import Modal from "./modal";
import SolarSystemScene from "./solar-system-scene";
import TimelineScene from "./timeline-scene";
import Starfield from "./starfield";
import TimelineLogin from "./timeline-login";
import useTimelineCloud from "@/lib/use-timeline-cloud";
import { parseImportedMomentsFile, parseSavedMoments, type ParsedImportResult } from "@/lib/moments";
import { AmbientSpaceAudio } from "@/lib/ambient-audio";
import { downloadMomentCard } from "@/lib/moment-card-export";
import type { MomentExport, MomentInput, Preferences } from "@/lib/timeline-api";

const categoryMeta: Record<MomentCategory, { label: string; icon: IconName }> = {
  personal: { label: "生活片刻", icon: "bookmark" },
  milestone: { label: "小小里程碑", icon: "spark" },
  system: { label: "时间印记", icon: "sun" },
};

export default function MomentApp() {
  const [view, setView] = useState<"timeline" | "collection">("timeline");
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [showMilliseconds, setShowMilliseconds] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [pulseKey, setPulseKey] = useState(0);
  const [warpKey, setWarpKey] = useState(0);
  const [immersive, setImmersive] = useState(true);
  const [sceneMode, setSceneMode] = useState<"solar" | "portal">("solar");
  const [portalFlat, setPortalFlat] = useState(false);
  const [ephemeris, setEphemeris] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [progressScope, setProgressScope] = useState<ProgressScope>("day");
  const [fullscreen, setFullscreen] = useState(false);
  const [demos, setDemos] = useState<MomentEntry[]>([]);
  const [filter, setFilter] = useState<"all" | "saved" | "demo">("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | MomentCategory>("all");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const [collectionLayout, setCollectionLayout] = useState<"grid" | "timeline">("grid");
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim();
  const cloud = useTimelineCloud(view === "collection" ? normalizedSearch : "", sortOrder);
  const moments = useMemo(() => {
    const combined = [...cloud.entries, ...demos];
    return combined.sort((a, b) => sortOrder === "asc" ? a.timestamp - b.timestamp : b.timestamp - a.timestamp);
  }, [cloud.entries, demos, sortOrder]);
  const [modal, setModal] = useState<"capture" | "edit" | "detail" | "about" | "login" | "import" | "import-file" | "focus" | null>(null);
  const [busy, setBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [legacyCount, setLegacyCount] = useState(0);
  const [pendingImport, setPendingImport] = useState<ParsedImportResult | null>(null);
  const [preferencesDirty, setPreferencesDirty] = useState(false);
  const preferencesQueue = useRef<Promise<unknown>>(Promise.resolve());
  const activeUser = useRef<number | null>(null);
  const [selected, setSelected] = useState<MomentEntry | null>(null);
  const [warpedMoment, setWarpedMoment] = useState<MomentEntry | null>(null);
  const [capturedAt, setCapturedAt] = useState(0);
  const [customTimeOpen, setCustomTimeOpen] = useState(false);
  const [dateInput, setDateInput] = useState("");
  const [timeInput, setTimeInput] = useState("");
  const [msInput, setMsInput] = useState("000");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState<MomentCategory>("personal");
  const [focusMinutes, setFocusMinutes] = useState(25);
  const [focusRemaining, setFocusRemaining] = useState(0);
  const [focusRunning, setFocusRunning] = useState(false);
  const [focusTotalSeconds, setFocusTotalSeconds] = useState(25 * 60);
  const [revisitIndex, setRevisitIndex] = useState(0);
  const [toast, setToast] = useState("");

  const audioRef = useRef<AmbientSpaceAudio | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef(0);
  const startRef = useRef(0);
  const hoursRef = useRef<HTMLSpanElement>(null);
  const minutesRef = useRef<HTMLSpanElement>(null);
  const secondsRef = useRef<HTMLSpanElement>(null);
  const millisRef = useRef<HTMLSpanElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const dateRef = useRef<HTMLSpanElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const progressLabelRef = useRef<HTMLSpanElement>(null);
  const elapsedRef = useRef<HTMLSpanElement>(null);
  const savedCount = cloud.total;

  useEffect(() => {
    timeRef.current = Date.now();
    startRef.current = Date.now();
    setDemos(createDemoMoments(Date.now()));
    try { setLegacyCount(parseSavedMoments(localStorage.getItem("moment.entries.v1")).length); } catch { setLegacyCount(0); }
    const audio = new AmbientSpaceAudio();
    audioRef.current = audio;
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreen);
      audio.dispose();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    audioRef.current?.setPaused(!running || Boolean(warpedMoment));
  }, [running, warpedMoment]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    let raf = 0, lastSecond = -1;
    const tick = () => {
      if (warpedMoment) {
        timeRef.current = warpedMoment.timestamp;
      } else if (running || !timeRef.current) {
        timeRef.current = Date.now();
      }
      const now = timeRef.current;
      const parts = getTimeParts(now);
      if (showMilliseconds && millisRef.current) millisRef.current.textContent = parts.milliseconds;
      const currentSecond = Math.floor(now / 1000);
      if (currentSecond !== lastSecond) {
        lastSecond = currentSecond;
        if (hoursRef.current) hoursRef.current.textContent = parts.hours;
        if (minutesRef.current) minutesRef.current.textContent = parts.minutes;
        if (secondsRef.current) secondsRef.current.textContent = parts.seconds;
        if (dateRef.current) dateRef.current.textContent = `${parts.date}  ·  ${parts.weekday}`;
        if (clockRef.current) {
          const stateLabel = warpedMoment ? "，正在回望此刻" : running ? "，实时运行" : "，已暂停";
          clockRef.current.setAttribute("aria-label", `北京时间 ${parts.hours}时${parts.minutes}分${parts.seconds}秒${stateLabel}`);
        }
        const progress = getScopeProgress(Date.now(), progressScope);
        if (progressRef.current) progressRef.current.style.width = `${progress}%`;
        if (progressLabelRef.current) progressLabelRef.current.textContent = `${progress.toFixed(2)}%`;
        if (running && !warpedMoment) {
          audioRef.current?.triggerTick(currentSecond % 60 === 0);
        }
      }
      const elapsed = Math.max(0, Math.floor((Date.now() - startRef.current) / 1000));
      if (elapsedRef.current) elapsedRef.current.textContent = `${String(Math.floor(elapsed / 3600)).padStart(2, "0")}:${String(Math.floor(elapsed / 60) % 60).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
      raf = requestAnimationFrame(tick);
    };
    const onVisibility = () => { cancelAnimationFrame(raf); if (!document.hidden) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    document.addEventListener("visibilitychange", onVisibility);
    return () => { cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", onVisibility); };
  }, [running, view, showMilliseconds, progressScope, warpedMoment]);

  useEffect(() => {
    if (!focusRunning || focusRemaining <= 0) return;
    const timer = setInterval(() => {
      setFocusRemaining(prev => {
        if (prev <= 1) {
          setFocusRunning(false);
          const mins = Math.max(1, Math.round(focusTotalSeconds / 60));
          setCapturedAt(Date.now());
          const vals = toShanghaiInputValues(Date.now());
          setDateInput(vals.date);
          setTimeInput(vals.time);
          setMsInput(vals.ms);
          setCustomTimeOpen(false);
          setTitle(`完成 ${mins} 分钟专注`);
          setNote("把一段安静的时间留给了自己。");
          setCategory("milestone");
          if (cloud.user) setModal("capture");
          setToast(`专注完成（${mins} 分钟），可将其存入时刻集。`);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [focusRunning, focusRemaining, focusTotalSeconds, cloud.user]);

  useEffect(() => {
    activeUser.current = cloud.user?.id ?? null;
    setSelected(null); setConfirmDelete(false); setPreferencesDirty(false); setWarpedMoment(null);
    setModal(current => current === "about" || current === "login" ? current : null);
  }, [cloud.user?.id]);

  useEffect(() => {
    if (!cloud.preferences) return;
    setSpeed(cloud.preferences.speed);
    setImmersive(cloud.preferences.immersive);
    setShowMilliseconds(cloud.preferences.showMilliseconds);
    setPreferencesDirty(false);
  }, [cloud.preferences]);

  useEffect(() => {
    if (!preferencesDirty || !cloud.user || !cloud.preferences) return;
    const owner = cloud.user.id;
    const data: Preferences = { speed, immersive, showMilliseconds };
    const timer = setTimeout(() => {
      preferencesQueue.current = preferencesQueue.current.catch(() => undefined).then(async () => {
        if (activeUser.current !== owner) return;
        await cloud.request("/preferences", { method: "PUT", body: JSON.stringify(data) });
      }).catch(cause => {
        if (activeUser.current === owner && !(cause instanceof Error && cause.name === "AbortError")) setToast(cause instanceof Error ? cause.message : "偏好保存失败，请重试。");
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [preferencesDirty, speed, immersive, showMilliseconds, cloud.user, cloud.preferences, cloud.request]);

  const reportError = (cause: unknown) => {
    if (cause instanceof Error && cause.name === "AbortError") return;
    setToast(cause instanceof Error ? cause.message : "操作失败，请重试。");
  };

  const syncCaptureTimestamp = (timestamp: number) => {
    setCapturedAt(timestamp);
    const vals = toShanghaiInputValues(timestamp);
    setDateInput(vals.date);
    setTimeInput(vals.time);
    setMsInput(vals.ms);
  };

  const capture = useCallback(() => {
    if (cloud.restoring) { setToast("正在确认登录状态，请稍候。"); return; }
    if (!cloud.user) { setModal("login"); return; }
    const targetTs = warpedMoment ? warpedMoment.timestamp : (running ? Date.now() : timeRef.current);
    syncCaptureTimestamp(targetTs);
    setCustomTimeOpen(false);
    setTitle(""); setNote(""); setCategory("personal"); setModal("capture");
  }, [running, cloud.user, cloud.restoring, warpedMoment]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (modal || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select, button, a, [contenteditable='true']")) return;
      if (event.code === "Space" && view === "timeline") { event.preventDefault(); setWarpedMoment(null); setRunning(value => !value); }
      if (event.key.toLowerCase() === "n") { event.preventDefault(); capture(); }
      if (event.key === "/" && view === "collection") { event.preventDefault(); searchInputRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [capture, modal, view]);

  const returnToNow = () => {
    setWarpedMoment(null);
    timeRef.current = Date.now();
    setRunning(true);
    setResetKey(value => value + 1);
    setPulseKey(0);
    setSpeed(1);
    setPreferencesDirty(true);
  };

  const toggleAudio = async () => {
    if (!audioRef.current) return;
    const next = !audioEnabled;
    const ok = await audioRef.current.setEnabled(next);
    setAudioEnabled(ok);
    if (next && !ok) setToast("当前浏览器未能启动音频播放，请检查静音或权限设置。");
    else setToast(ok ? "已开启深空环境音。" : "已关闭深空环境音。");
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else setToast("当前浏览器暂不支持全屏，可使用横屏浏览。");
    } catch { setToast("暂时无法进入全屏，请使用浏览器的全屏选项。"); }
  };

  const saveMoment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    let finalTimestamp = capturedAt;
    if (customTimeOpen) {
      const parsedTs = fromShanghaiInputValues(dateInput, timeInput, msInput);
      if (parsedTs === null || Math.abs(parsedTs) >= 8e15) {
        setToast("请输入有效的北京时间日期与时间。");
        return;
      }
      finalTimestamp = parsedTs;
    }
    setBusy(true);
    const editing = modal === "edit" && selected;
    const input: MomentInput = { title: title.trim() || "一个值得记住的瞬间", note: note.trim(), timestamp: finalTimestamp, category };
    try {
      await cloud.request(editing ? `/moments/${encodeURIComponent(editing.id)}` : "/moments", { method: editing ? "PUT" : "POST", body: JSON.stringify(input) });
      if (!editing) cloud.setTotal(value => value + 1);
      cloud.refresh(); setPulseKey(value => value + 1); setModal(null);
      setToast(editing ? "时刻已更新。" : "已留住这一刻，保存到你的账号。");
    } catch (cause) { reportError(cause); }
    finally { setBusy(false); }
  };

  const exportMoments = async () => {
    if (!cloud.user) { setModal("login"); return; }
    if (busy) return;
    setBusy(true);
    try {
      const data = await cloud.request<MomentExport>("/moments/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `moment-${new Date().toISOString().slice(0, 10)}.json`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); setToast("时刻集已导出。");
    } catch (cause) { reportError(cause); }
    finally { setBusy(false); }
  };

  const openDetail = useCallback(async (moment: MomentEntry) => {
    if (busy) return;
    setConfirmDelete(false);
    if (moment.demo) { setSelected(moment); setModal("detail"); return; }
    setBusy(true);
    try { setSelected(await cloud.request<MomentEntry>(`/moments/${encodeURIComponent(moment.id)}`)); setModal("detail"); }
    catch (cause) { reportError(cause); }
    finally { setBusy(false); }
  }, [busy, cloud]);

  const openMomentById = useCallback((id: string) => {
    const found = moments.find(item => item.id === id);
    if (found) void openDetail(found);
  }, [moments, openDetail]);

  const locateInUniverse = (moment: MomentEntry) => {
    setWarpedMoment(moment);
    setRunning(false);
    setSceneMode("solar");
    setView("timeline");
    setModal(null);
    setWarpKey(value => value + 1);
    setToast(`已定位到「${moment.title}」对应的宇宙坐标。`);
  };

  const editMoment = () => {
    if (!selected || selected.demo) return;
    syncCaptureTimestamp(selected.timestamp);
    setCustomTimeOpen(false);
    setTitle(selected.title); setNote(selected.note); setCategory(selected.category); setModal("edit");
  };

  const deleteMoment = async () => {
    if (!selected || selected.demo || busy) return;
    setBusy(true);
    try {
      await cloud.request(`/moments/${encodeURIComponent(selected.id)}`, { method: "DELETE" });
      cloud.setTotal(value => Math.max(0, value - 1));
      if (warpedMoment?.id === selected.id) setWarpedMoment(null);
      cloud.refresh(); setSelected(null); setModal(null); setToast("这条时刻已删除。");
    } catch (cause) { reportError(cause); }
    finally { setBusy(false); }
  };

  const importLegacy = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const legacy = parseSavedMoments(localStorage.getItem("moment.entries.v1"));
      const result = await cloud.request<{ imported: number; skipped: number }>("/moments/import", { method: "POST", body: JSON.stringify({ moments: legacy }) });
      cloud.setTotal(value => value + result.imported); cloud.refresh(); setModal(null);
      setToast(`已导入 ${result.imported} 条，跳过 ${result.skipped} 条重复记录。本机备份仍保留。`);
    } catch (cause) { reportError(cause); }
    finally { setBusy(false); }
  };

  const handleImportFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setToast("备份文件过大，请选择 2MB 以内的 JSON 文件。");
      return;
    }
    try {
      const text = await file.text();
      const parsed = parseImportedMomentsFile(text);
      if (!parsed) {
        setToast("文件格式不支持，请选择本应用导出的 JSON 备份文件。");
        return;
      }
      if (parsed.moments.length === 0) {
        setToast("文件中没有可导入的个人时刻记录。");
        return;
      }
      setPendingImport(parsed);
      setModal("import-file");
    } catch {
      setToast("读取备份文件失败，请重试。");
    }
  };

  const confirmImportFile = async () => {
    if (!pendingImport || busy) return;
    setBusy(true);
    try {
      const result = await cloud.request<{ imported: number; skipped: number }>("/moments/import", {
        method: "POST",
        body: JSON.stringify({ moments: pendingImport.moments }),
      });
      cloud.setTotal(value => value + result.imported);
      cloud.refresh();
      setPendingImport(null);
      setModal(null);
      setToast(`成功导入 ${result.imported} 条记录，跳过 ${result.skipped} 条重复记录。`);
    } catch (cause) {
      reportError(cause);
    } finally {
      setBusy(false);
    }
  };

  const startFocusSession = (minutes: number) => {
    const clamped = Math.max(1, Math.min(180, Math.round(minutes)));
    setFocusMinutes(clamped);
    setFocusTotalSeconds(clamped * 60);
    setFocusRemaining(clamped * 60);
    setFocusRunning(true);
    setWarpedMoment(null);
    setRunning(true);
    setView("timeline");
    setModal(null);
    setToast(`已开始 ${clamped} 分钟专注片刻。`);
  };

  const filtered = moments.filter(moment =>
    (filter === "all" || (filter === "demo" ? moment.demo : !moment.demo)) &&
    (categoryFilter === "all" || moment.category === categoryFilter) &&
    `${moment.title} ${moment.note}`.toLowerCase().includes(normalizedSearch.toLowerCase()),
  );

  const groupedByMonth = useMemo(() => {
    const groups: { month: string; items: MomentEntry[] }[] = [];
    const map = new Map<string, MomentEntry[]>();
    for (const item of filtered) {
      const key = getMonthGroupKey(item.timestamp);
      let list = map.get(key);
      if (!list) {
        list = [];
        map.set(key, list);
        groups.push({ month: key, items: list });
      }
      list.push(item);
    }
    return groups;
  }, [filtered]);

  const summaryStats = useMemo(() => {
    if (cloud.user && cloud.insights) {
      return cloud.insights;
    }
    const source = cloud.user ? cloud.entries : demos;
    const now = Date.now();
    const counts = { personal: 0, milestone: 0, system: 0 };
    const daySet = new Set<string>();
    const onThisDay: MomentEntry[] = [];
    for (const item of source) {
      counts[item.category] += 1;
      daySet.add(getTimeParts(item.timestamp).date);
      if (isSameShanghaiMonthDay(item.timestamp, now)) onThisDay.push(item);
    }
    return {
      total: source.length,
      categoryCounts: counts,
      activeDays: daySet.size,
      earliestTimestamp: source.length ? source[source.length - 1].timestamp : null,
      latestTimestamp: source.length ? source[0].timestamp : null,
      onThisDay,
      highlight: onThisDay[0] ?? source[0] ?? null,
    };
  }, [cloud.user, cloud.insights, cloud.entries, demos]);

  const revisitPool = useMemo(() => {
    if (summaryStats.onThisDay.length > 0) return summaryStats.onThisDay;
    const pool = cloud.user && cloud.entries.length > 0 ? cloud.entries : demos;
    return pool;
  }, [summaryStats.onThisDay, cloud.user, cloud.entries, demos]);

  const revisitMoment = revisitPool.length > 0 ? revisitPool[revisitIndex % revisitPool.length] : null;
  const solarMarkerInputs = useMemo(
    () => moments.map(m => ({ id: m.id, title: m.title, timestamp: m.timestamp, category: m.category, demo: m.demo })),
    [moments],
  );
  const referenceTimestamp = warpedMoment ? warpedMoment.timestamp : undefined;

  const momentCard = (moment: MomentEntry, index: number) => <button key={moment.id} className={`moment-card category-${moment.category}`} onClick={() => openDetail(moment)} style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}>
    <div className="card-top"><span className="card-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><span className="card-icon"><Icon name={categoryMeta[moment.category].icon} size={17} /></span><span className="card-category">{categoryMeta[moment.category].label}</span>{moment.demo && <span className="demo-tag">示例</span>}<Icon name="arrow" size={16} className="card-arrow" /></div>
    <h3>{moment.title}</h3><p>{moment.note || "无需太多言语，记住此刻就好。"}</p>
    <div className="card-bottom"><time dateTime={new Date(moment.timestamp).toISOString()}>{formatMomentTime(moment.timestamp)}</time><span>{formatMomentDate(moment.timestamp)}</span></div>
  </button>;

  const focusMm = String(Math.floor(focusRemaining / 60)).padStart(2, "0");
  const focusSs = String(focusRemaining % 60).padStart(2, "0");

  return <div className="app-shell">
    <header className="site-header">
      <button className="brand" onClick={() => setView("timeline")} aria-label="MOMENT 一瞬，返回时间线"><svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m3 23 7-15 7 15 5-11 7 11" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><circle cx="10" cy="8" r="2.3" fill="currentColor"/><path d="M3 28h26" stroke="currentColor" strokeOpacity=".25"/></svg><span>MOMENT<span className="brand-cn">一瞬</span></span></button>
      <nav className="main-nav" aria-label="主导航"><button className={view === "timeline" ? "active" : ""} aria-current={view === "timeline" ? "page" : undefined} onClick={() => setView("timeline")}>时间线</button><button className={view === "collection" ? "active" : ""} aria-current={view === "collection" ? "page" : undefined} onClick={() => setView("collection")}>时刻集<span className="nav-count">{savedCount.toString().padStart(2, "0")}</span></button><button onClick={() => setModal("about")}>关于</button></nav>
      <div className="header-right">
        <div className="account-controls">{cloud.user ? <><span className="account-name" title={cloud.user.phone || undefined}>{cloud.user.nickname} · {cloud.user.role === "ADMIN" ? "管理员" : "普通用户"}</span><button className="text-button" disabled={busy} onClick={() => { cloud.logout(); setModal(null); setToast("已退出登录。"); }}>退出</button></> : <button className="text-button" onClick={() => setModal("login")} disabled={cloud.restoring}>{cloud.restoring ? "验证登录…" : "登录 / 注册"}</button>}</div>
        <span className="system-status"><span className="status-dot"/>世界仍在向前</span>
        <span className="header-divider"/>
        <button className={`icon-button audio-button ${audioEnabled ? "active" : ""}`} onClick={toggleAudio} aria-pressed={audioEnabled} aria-label={audioEnabled ? "关闭深空环境音" : "开启深空环境音"} title={audioEnabled ? "关闭深空环境音" : "开启深空环境音"}><Icon name={audioEnabled ? "volume" : "mute"} size={17}/></button>
        <button className="icon-button fullscreen-button" onClick={toggleFullscreen} aria-label={fullscreen ? "退出全屏" : "进入全屏"} title={fullscreen ? "退出全屏" : "全屏沉浸"}><Icon name={fullscreen ? "shrink" : "expand"} size={17}/></button>
      </div>
    </header>

    <main>
      {cloud.error && <div className="cloud-banner" role="alert"><span>{cloud.error}</span><button className="text-button" onClick={cloud.retry}>重试</button>{!cloud.user && <button className="text-button" onClick={() => setModal("login")}>重新登录</button>}</div>}
      {cloud.loading && <div className="cloud-loading" role="status">正在加载你的时刻…</div>}
      {view === "timeline" ? <>
        <section className={`timeline-experience solar-experience ${!running ? "is-paused" : ""} ${immersive ? "is-immersive" : ""}`} aria-label="太阳系与实时时间线">
          <div className="solar-starfield" aria-hidden="true"><Starfield key={resetKey} running={running} speed={speed}/></div>
          <div className="hero-heading">
            <div className="eyebrow"><span className="eyebrow-index">01 /</span> A CONTINUOUS MOMENT</div>
            <h1>此刻，<br/><span>一去不返。</span></h1>
          </div>
          <div className="hero-aside">
            <span className="aside-label">THE ART OF PASSING TIME</span>
            <p>时间从不停留。<br/>让值得记住的，有迹可循。</p>
            <span className="aside-scale"><span/> 1 SECOND = 1,000 MOMENTS</span>
          </div>
          <div className="clock-area">
            <div className="clock-meta">
              <span className={`live-badge ${warpedMoment ? "warped" : running ? "" : "paused"}`}>
                <span/>{warpedMoment ? `WARP / 回望 ${formatMomentDate(warpedMoment.timestamp)}` : running ? "LIVE / 正在发生" : "PAUSED / 凝结此刻"}
              </span>
              <span ref={dateRef}>正在与此刻相遇</span>
            </div>
            <button className="clock-display" onClick={() => { setShowMilliseconds(value => !value); setPreferencesDirty(true); }} aria-expanded={showMilliseconds} aria-controls="clock-fraction" aria-label={showMilliseconds ? "隐藏毫秒" : "显示毫秒"}>
              <span className="digital-clock" ref={clockRef} role="timer" aria-label="北京时间，正在同步" aria-live="off">
                <span className="clock-main" aria-hidden="true"><span ref={hoursRef}>00</span><span className="clock-colon">:</span><span ref={minutesRef}>00</span><span id="clock-seconds" className="clock-seconds"><span className="clock-colon">:</span><span ref={secondsRef}>00</span></span></span>
                <span id="clock-fraction" className="clock-fraction" hidden={!showMilliseconds} aria-hidden="true"><span className="fraction-dot">.</span><span ref={millisRef}>000</span><span className="fraction-unit">MS</span></span>
              </span>
            </button>
            <div className="clock-caption"><span>北京时间 <span className="mono">UTC +08:00</span></span><span className="clock-caption-right">{warpedMoment ? `坐标：${warpedMoment.title}` : "慢一点，感受此刻"} <Icon name="arrow" size={13}/></span></div>
            {focusRemaining > 0 && (
              <div className="focus-pill" role="status">
                <Icon name="timer" size={14}/>
                <span className="mono">{focusMm}:{focusSs}</span>
                <span>{focusRunning ? "专注片刻中" : "专注已暂停"}</span>
                <button type="button" onClick={() => setFocusRunning(v => !v)}>{focusRunning ? "暂停" : "继续"}</button>
                <button type="button" onClick={() => { setFocusRunning(false); setFocusRemaining(0); }}>结束</button>
              </div>
            )}
          </div>
          <div className="scene-wrap">
            {sceneMode === "solar" ? (
              <SolarSystemScene
                key={resetKey}
                running={running}
                speed={speed}
                pulseKey={pulseKey}
                ephemeris={ephemeris}
                referenceTimestamp={referenceTimestamp}
                moments={solarMarkerInputs}
                activeMomentId={warpedMoment?.id ?? selected?.id ?? null}
                warpKey={warpKey}
                onSelectMoment={openMomentById}
              />
            ) : (
              <TimelineScene
                running={running}
                speed={speed}
                flat={portalFlat}
                resetKey={resetKey}
                pulseKey={pulseKey}
              />
            )}
          </div>
          <div className="scene-caption" aria-hidden="true"><span>ORBITING, EVER FORWARD</span><p>一边周而复始，<br/>一边奔向远方。</p></div>
          <div className="scene-top-controls">
            <span className="scene-label"><span className="tiny-cross">+</span> {sceneMode === "solar" ? (ephemeris ? "太阳系 · 今日真实星历" : "太阳系 · 螺旋前行") : (portalFlat ? "二维时间光轨" : "三维时间光门")}</span>
            <div className="scene-switches">
              <button className="view-button" type="button" onClick={() => setSceneMode(m => m === "solar" ? "portal" : "solar")} title="切换宇宙场景形态">
                <Icon name={sceneMode === "solar" ? "orbit" : "layers"} size={14}/>
                <span>{sceneMode === "solar" ? "光门" : "太阳系"}</span>
              </button>
              {sceneMode === "solar" ? (
                <button className="immersive-button" type="button" aria-pressed={ephemeris} onClick={() => setEphemeris(v => !v)} title="按当前日期切换行星真实天文黄经方位">
                  <Icon name="compass" size={14}/>
                  <span>{ephemeris ? "真实星历" : "示意公转"}</span>
                </button>
              ) : (
                <button className="immersive-button" type="button" aria-pressed={portalFlat} onClick={() => setPortalFlat(v => !v)} title="切换二维/三维光门">
                  <Icon name="layers" size={14}/>
                  <span>{portalFlat ? "三维" : "二维"}</span>
                </button>
              )}
              <button className="immersive-button" aria-pressed={immersive} onClick={() => { setImmersive(value => !value); setPreferencesDirty(true); }} title={immersive ? "退出沉浸模式" : "进入沉浸模式"}><Icon name={immersive ? "shrink" : "expand"} size={14}/><span>{immersive ? "退出沉浸" : "沉浸"}</span></button>
            </div>
          </div>
          <div className="experience-bottom">
            <div className="transport">
              <button className="pause-button" onClick={() => { setWarpedMoment(null); setRunning(value => !value); }} aria-label={running ? "暂停星空、公转与时间线" : "继续星空、公转与时间线"}><Icon name={running ? "pause" : "play"} size={14}/><span>{running ? "暂停" : "继续"}</span><kbd>空格</kbd></button>
              <span className="control-divider"/>
              <button className="speed-button" onClick={() => { setSpeed(value => value === 1 ? 2 : value === 2 ? .5 : 1); setPreferencesDirty(true); }} aria-label={`运动速度 ${speed} 倍，点击切换`} title="调整星空和太阳系的运动速度，时钟始终同步真实时间">{speed}<span>×</span></button>
              <span className="control-divider"/>
              <button className="focus-timer-button" type="button" onClick={() => setModal("focus")} title="开启一段安静的专注倒计时">
                <Icon name="timer" size={15}/>
                <span>{focusRemaining > 0 ? `${focusMm}:${focusSs}` : "专注"}</span>
              </button>
              <span className="control-divider"/>
              <button className="now-button" onClick={returnToNow}><Icon name="focus" size={16}/><span>回到此刻</span></button>
            </div>
            <button className="capture-button" onClick={capture}><Icon name="plus" size={17}/>记录此刻<kbd>N</kbd></button>
          </div>
          <p className="scene-hint"><span>{sceneMode === "solar" ? "轨迹星标可点击 · 拖动旋转 · Alt+滚轮缩放" : "拖动调整视角 · Home 恢复"}</span></p>
          <a className="solar-source" href="https://codepen.io/sarazond/pen/LYGbwj" target="_blank" rel="noopener noreferrer">星空灵感：CodePen <span aria-hidden="true">↗</span></a>
          <span className="experience-index" aria-hidden="true">SCROLL TO DISCOVER <span>↓</span></span>
        </section>

        <section className="moments-section" aria-labelledby="recent-title">
          <div className="section-heading">
            <div>
              <div className="section-kicker">02 / TRACES OF YOU</div>
              <h2 id="recent-title">时间流过，你曾在场。</h2>
              <p>给无限的时间，留下几个属于你的坐标。</p>
            </div>
            <button className="text-button" onClick={() => setView("collection")}>探索时刻集<Icon name="arrow" size={16}/></button>
          </div>
          <div className="insights-bar">
            <div className="insights-pills">
              <span className="insight-pill">共 <strong>{summaryStats.total}</strong> 个时刻</span>
              <span className="insight-pill">跨越 <strong>{summaryStats.activeDays}</strong> 天</span>
              <span className="insight-pill">生活 {summaryStats.categoryCounts.personal} · 里程碑 {summaryStats.categoryCounts.milestone} · 印记 {summaryStats.categoryCounts.system}</span>
            </div>
            {revisitMoment && (
              <div className="revisit-card">
                <div className="revisit-meta">
                  <Icon name="spark" size={14}/>
                  <span>{summaryStats.onThisDay.length > 0 ? "那年今日 / 今日印记" : "拾光重温"}</span>
                  <time>{formatMomentDate(revisitMoment.timestamp)} · {formatMomentTime(revisitMoment.timestamp).slice(0, 8)}</time>
                </div>
                <div className="revisit-body">
                  <strong>{revisitMoment.title}</strong>
                  <p>{revisitMoment.note || "无需太多言语，记住此刻就好。"}</p>
                </div>
                <div className="revisit-actions">
                  <button type="button" className="text-button" onClick={() => openDetail(revisitMoment)}>查看详情</button>
                  <button type="button" className="text-button" onClick={() => locateInUniverse(revisitMoment)}>在宇宙中定位</button>
                  {revisitPool.length > 1 && (
                    <button type="button" className="text-button" onClick={() => setRevisitIndex(i => i + 1)}>换一条</button>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="moments-grid">{moments.slice(0, 3).map(momentCard)}</div>
        </section>
      </> : <section className="collection-page">
        <div className="collection-heading">
          <div>
            <div className="eyebrow">YOUR PERSONAL TIME CAPSULE</div>
            <h1>留住的，<span>都是时光。</span></h1>
            <p>每一个被记录的瞬间，都是时间给你的回信。</p>
          </div>
          <button className="capture-button" onClick={capture}><Icon name="plus" size={17}/>记录此刻</button>
        </div>
        <div className="collection-tools">
          <div className="filter-tabs" aria-label="筛选时刻来源">
            {([["all", "全部时刻"], ["saved", "我的记录"], ["demo", "演示时刻"]] as const).map(([value, label]) => (
              <button key={value} onClick={() => setFilter(value)} className={filter === value ? "active" : ""} aria-pressed={filter === value}>{label}{value === "saved" && <span>{savedCount}</span>}</button>
            ))}
          </div>
          <div className="collection-actions">
            <input ref={searchInputRef} className="search-input" aria-label="搜索时刻（按 / 聚焦）" maxLength={240} placeholder="寻找某个瞬间… ( / )" value={search} onChange={e => setSearch(e.target.value)}/>
            <button type="button" className="icon-button" onClick={() => setSortOrder(s => s === "desc" ? "asc" : "desc")} title={sortOrder === "desc" ? "当前：最新优先，点击切换最早优先" : "当前：最早优先，点击切换最新优先"} aria-label="切换排序方向">
              <span className="sort-badge">{sortOrder === "desc" ? "↓" : "↑"}</span>
            </button>
            <button type="button" className="icon-button" onClick={() => setCollectionLayout(l => l === "grid" ? "timeline" : "grid")} title={collectionLayout === "grid" ? "切换时间轴视图" : "切换卡片网格视图"} aria-label={collectionLayout === "grid" ? "切换时间轴视图" : "切换卡片网格视图"}>
              <Icon name={collectionLayout === "grid" ? "list" : "grid"}/>
            </button>
            <button type="button" className="icon-button" onClick={() => { if (!cloud.user) { setModal("login"); return; } fileInputRef.current?.click(); }} title="导入 JSON 备份" aria-label="导入 JSON 备份">
              <Icon name="upload"/>
            </button>
            <button className="icon-button export-button" onClick={exportMoments} title="导出我的记录" aria-label="导出我的记录"><Icon name="download"/></button>
            <input ref={fileInputRef} type="file" accept=".json,application/json" hidden onChange={handleImportFileChange}/>
          </div>
        </div>
        <div className="category-filter-row" aria-label="按分类筛选">
          <button type="button" className={categoryFilter === "all" ? "active" : ""} onClick={() => setCategoryFilter("all")}>全部分类</button>
          {(Object.keys(categoryMeta) as MomentCategory[]).map(cat => (
            <button key={cat} type="button" className={categoryFilter === cat ? "active" : ""} onClick={() => setCategoryFilter(cat)}>
              <Icon name={categoryMeta[cat].icon} size={13}/>{categoryMeta[cat].label}
            </button>
          ))}
        </div>
        {collectionLayout === "grid" ? (
          <div className="moments-grid collection-grid">{filtered.map(momentCard)}</div>
        ) : (
          <div className="timeline-axis-list">
            {groupedByMonth.map(group => (
              <div key={group.month} className="timeline-month-group">
                <h2 className="timeline-month-heading">{group.month} <span>({group.items.length})</span></h2>
                <div className="timeline-month-items">
                  {group.items.map(moment => (
                    <button key={moment.id} type="button" className={`timeline-axis-item category-${moment.category}`} onClick={() => openDetail(moment)}>
                      <span className="axis-dot" aria-hidden="true"/>
                      <div className="axis-time">
                        <time>{formatMomentDate(moment.timestamp)}</time>
                        <span className="mono">{formatMomentTime(moment.timestamp)}</span>
                      </div>
                      <div className="axis-content">
                        <div className="axis-title-row">
                          <span className="axis-cat"><Icon name={categoryMeta[moment.category].icon} size={13}/>{categoryMeta[moment.category].label}</span>
                          {moment.demo && <span className="demo-tag">示例</span>}
                        </div>
                        <h3>{moment.title}</h3>
                        <p>{moment.note || "无需太多言语，记住此刻就好。"}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {filtered.length === 0 && <div className="empty-state"><Icon name={search ? "focus" : "bookmark"} size={32}/><h2>{search ? "还没有找到这个瞬间" : "你的故事，从此刻开始"}</h2><p>{search ? "换一个词，或看看其他时刻。" : "为平凡的一天，留下一点不平凡的记忆。"}</p><button className="text-button" onClick={search || categoryFilter !== "all" ? () => { setSearch(""); setFilter("all"); setCategoryFilter("all"); } : capture}>{search || categoryFilter !== "all" ? "查看全部时刻" : "记录第一个瞬间"}<Icon name="arrow" size={16}/></button></div>}
        <p className="storage-note"><Icon name="bookmark" size={13}/>{cloud.user ? "记录已关联当前账号，最多保存 200 条。可随时导出或导入 JSON 备份。" : "登录后可保存和同步你的记录。当前展示的是演示时刻。"}</p>
        {cloud.user && legacyCount > 0 && <button className="text-button legacy-import" onClick={() => setModal("import")} disabled={busy}>导入本机旧记录（{legacyCount} 条）</button>}
      </section>}
    </main>

    <footer className="site-footer">
      <div className="day-progress">
        <button type="button" className="day-progress-label progress-toggle" onClick={() => setProgressScope(s => PROGRESS_SCOPE_META[s].next)} title="点击切换进度维度（今日 / 本周 / 本月 / 今年）">
          <span>{PROGRESS_SCOPE_META[progressScope].label}</span>
          <span ref={progressLabelRef} className="mono">0.00%</span>
        </button>
        <div className="progress-track"><div ref={progressRef}/></div>
      </div>
      <div className="footer-bottom"><span className="footer-quote">“ 时间是我们所在的地方。 ”</span><span className="session-time"><span className="status-dot"/>已与你共度 <span ref={elapsedRef} className="mono">00:00:00</span></span><span className="footer-signature">MADE FOR THE MOMENT<span>© 2026</span></span></div>
    </footer>

    <Modal open={modal !== null} title={modal === "capture" ? "留住这一刻" : modal === "edit" ? "编辑时刻" : modal === "detail" ? "时间里的一个坐标" : modal === "login" ? "登录一瞬" : modal === "import" ? "导入本机旧记录" : modal === "import-file" ? "导入 JSON 备份" : modal === "focus" ? "专注片刻" : "关于一瞬"} onClose={() => { if (!busy && !authBusy) setModal(null); }}>
      {(modal === "capture" || modal === "edit") && <form onSubmit={saveMoment}><fieldset className="moment-form-fields" disabled={busy}>
        <div className="captured-time">
          <span className="eyebrow">A MOMENT TO REMEMBER</span>
          <strong>{formatMomentTime(customTimeOpen ? (fromShanghaiInputValues(dateInput, timeInput, msInput) ?? capturedAt) : capturedAt)}</strong>
          <span>{getTimeParts(customTimeOpen ? (fromShanghaiInputValues(dateInput, timeInput, msInput) ?? capturedAt) : capturedAt).date} · 北京时间</span>
          <button type="button" className="time-adjust-toggle" onClick={() => setCustomTimeOpen(v => !v)}>
            <Icon name="calendar" size={13}/>{customTimeOpen ? "收起时间调整" : "补记 / 修改时间"}
          </button>
        </div>
        {customTimeOpen && (
          <div className="custom-time-grid">
            <label><span>日期</span><input type="date" className="form-input" value={dateInput} onChange={e => setDateInput(e.target.value)} required/></label>
            <label><span>时分秒</span><input type="time" step="1" className="form-input" value={timeInput} onChange={e => setTimeInput(e.target.value)} required/></label>
            <label><span>毫秒</span><input type="number" min={0} max={999} className="form-input" value={msInput} onChange={e => setMsInput(e.target.value)}/></label>
            <button type="button" className="text-button" onClick={() => syncCaptureTimestamp(Date.now())}>设为当前时刻</button>
          </div>
        )}
        <label className="field-label" htmlFor="moment-title">为此刻起个名字<span>{title.length}/40</span></label><input id="moment-title" className="form-input" maxLength={40} placeholder="例如：终于完成了那个小目标" value={title} onChange={e => setTitle(e.target.value)} autoFocus/><label className="field-label" htmlFor="moment-note">想对未来的自己说<span>选填</span></label><textarea id="moment-note" className="form-input" rows={3} maxLength={240} placeholder="记下心情、一个念头，或只是天气……" value={note} onChange={e => setNote(e.target.value)}/><span className="field-label">时刻分类</span><div className="category-options">{(Object.keys(categoryMeta) as MomentCategory[]).map(value => <button key={value} type="button" className={category === value ? "selected" : ""} onClick={() => setCategory(value)} aria-pressed={category === value}><Icon name={categoryMeta[value].icon} size={14}/>{categoryMeta[value].label}</button>)}</div><button className="capture-button modal-submit" disabled={busy} type="submit"><Icon name="bookmark" size={16}/>{busy ? "保存中…" : modal === "edit" ? "保存修改" : "存入时刻集"}</button><p className="form-footnote">这一刻已定格，慢慢写也没关系。</p></fieldset></form>}

      {modal === "detail" && selected && (selected.demo || cloud.user) && <div className="moment-detail"><div className="detail-category"><Icon name={categoryMeta[selected.category].icon}/>{categoryMeta[selected.category].label}{selected.demo && <span className="demo-tag">演示数据</span>}</div><h3>{selected.title}</h3><p>{selected.note || "无需太多言语，记住此刻就好。"}</p><div className="detail-time"><span>{getTimeParts(selected.timestamp).date} · 北京时间</span><strong>{formatMomentTime(selected.timestamp)}</strong><span className="mono">UNIX {selected.timestamp} ms</span></div>
        <div className="detail-extra-actions">
          <button type="button" className="text-button" onClick={() => locateInUniverse(selected)}><Icon name="orbit" size={15}/>在宇宙中定位此刻</button>
          <button type="button" className="text-button" onClick={() => { if (downloadMomentCard(selected)) setToast("时刻纪念卡已生成并下载。"); }}><Icon name="image" size={15}/>生成纪念卡</button>
        </div>
        {selected.demo && <p className="detail-demo-note">这是一条演示记录。点击「记录此刻」，开始写下你自己的时间故事。</p>}
        {!selected.demo && cloud.user && <div className="detail-actions"><button className="text-button" onClick={editMoment} disabled={busy}>编辑时刻</button>{confirmDelete ? <><span>确定删除这条记录？</span><button className="text-button danger-button" onClick={deleteMoment} disabled={busy}>{busy ? "删除中…" : "确认删除"}</button><button className="text-button" onClick={() => setConfirmDelete(false)} disabled={busy}>取消</button></> : <button className="text-button danger-button" onClick={() => setConfirmDelete(true)}>删除时刻</button>}</div>}
        <button className="text-button" disabled={busy} onClick={capture}>记录属于我的此刻<Icon name="arrow" size={16}/></button></div>}

      {modal === "login" && <TimelineLogin onBusyChange={setAuthBusy} onLogin={async (phone, code) => { await cloud.login(phone, code); setModal(null); setToast("登录成功，可以记录你的时刻了。"); }}/>}

      {modal === "import" && cloud.user && <div className="import-content"><p>将本机的 {legacyCount} 条旧记录导入到 <strong>{cloud.user.nickname}（{cloud.user.phone}）</strong>。</p><p>请确认这些记录属于当前账号。重复记录会自动跳过，本机原始备份会继续保留。</p><button className="capture-button modal-submit" onClick={importLegacy} disabled={busy}>{busy ? "正在导入…" : "确认导入到此账号"}</button></div>}

      {modal === "import-file" && cloud.user && pendingImport && <div className="import-content">
        <p>已解析备份文件，共发现 <strong>{pendingImport.moments.length}</strong> 条可导入记录将写入账号 <strong>{cloud.user.nickname}</strong>。</p>
        {(pendingImport.skippedDemo > 0 || pendingImport.skippedInvalid > 0) && (
          <p>已自动忽略 {pendingImport.skippedDemo} 条示例记录与 {pendingImport.skippedInvalid} 条无效记录。重复 ID 将由服务端自动去重跳过。</p>
        )}
        <button className="capture-button modal-submit" onClick={confirmImportFile} disabled={busy}>{busy ? "正在导入…" : "确认导入备份"}</button>
      </div>}

      {modal === "focus" && <div className="focus-modal">
        <p className="login-intro">给自己一段安静的专注时间。结束时，可将这枚片刻直接存为里程碑。</p>
        <div className="focus-presets">
          {[15, 25, 45].map(mins => (
            <button key={mins} type="button" className={focusMinutes === mins ? "selected" : ""} onClick={() => setFocusMinutes(mins)}>{mins} 分钟</button>
          ))}
        </div>
        <label className="field-label" htmlFor="focus-custom-minutes">自定义分钟数<span>1 ~ 180 分钟</span></label>
        <input id="focus-custom-minutes" className="form-input" type="number" min={1} max={180} value={focusMinutes} onChange={e => setFocusMinutes(Math.max(1, Math.min(180, Number(e.target.value) || 1)))}/>
        <button type="button" className="capture-button modal-submit" onClick={() => startFocusSession(focusMinutes)}><Icon name="timer" size={16}/>开始 {focusMinutes} 分钟专注</button>
      </div>}

      {modal === "about" && <div className="about-content"><div className="about-mark">m<span>.</span></div><h3>让时间，有迹可循。</h3><p>一瞬是一处安静的时间观察站。在流动中感受此刻，也给值得记住的事情留一个位置。</p><div className="about-facts"><div><Icon name="clock"/><span><strong>让时间安静一点</strong>默认显示时、分、秒，点击时钟展开或收起毫秒。使用设备时间，以北京时间展示；页脚进度支持切换日/周/月/年。</span></div><div><Icon name="sun"/><span><strong>公转，也不断前行</strong>太阳与星球朝同一方向前行，你的时刻以星标落在螺旋轨迹上。支持切换今日真实星历、时间光门场景与深空环境音。</span></div><div><Icon name="bookmark"/><span><strong>故事只属于你</strong>登录后，记录保存在你的账号中，可跨设备查看。支持 JSON 导出/导入与生成时刻纪念卡。</span></div></div><div className="about-shortcuts"><span><kbd>空格</kbd>暂停 / 继续</span><span><kbd>N</kbd>记录此刻</span><span><kbd>/</kbd>搜索时刻</span><span><kbd>Esc</kbd>关闭弹窗</span></div><p className="about-signoff">THE PRESENT IS A PRESENT.</p></div>}
    </Modal>
    <div className={`toast ${toast ? "visible" : ""}`} role="status" aria-live="polite">{toast && <><Icon name="check" size={16}/>{toast}</>}</div>
  </div>;
}
