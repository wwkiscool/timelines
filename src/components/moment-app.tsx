"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createDemoMoments, formatMomentDate, formatMomentTime, getDayProgress, getTimeParts, type MomentCategory, type MomentEntry } from "@/lib/time";
import Icon, { type IconName } from "./icon";
import Modal from "./modal";
import SolarSystemScene from "./solar-system-scene";
import Starfield from "./starfield";
import TimelineLogin from "./timeline-login";
import useTimelineCloud from "@/lib/use-timeline-cloud";
import { parseSavedMoments } from "@/lib/moments";
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
  const [immersive, setImmersive] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [demos, setDemos] = useState<MomentEntry[]>([]);
  const [filter, setFilter] = useState<"all" | "saved" | "demo">("all");
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim();
  const cloud = useTimelineCloud(view === "collection" ? normalizedSearch : "");
  const moments = [...cloud.entries, ...demos].sort((a, b) => b.timestamp - a.timestamp);
  const [modal, setModal] = useState<"capture" | "edit" | "detail" | "about" | "login" | "import" | null>(null);
  const [busy, setBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [legacyCount, setLegacyCount] = useState(0);
  const [preferencesDirty, setPreferencesDirty] = useState(false);
  const preferencesQueue = useRef<Promise<unknown>>(Promise.resolve());
  const activeUser = useRef<number | null>(null);
  const [selected, setSelected] = useState<MomentEntry | null>(null);
  const [capturedAt, setCapturedAt] = useState(0);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState<MomentCategory>("personal");
  const [toast, setToast] = useState("");
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
    timeRef.current = Date.now(); startRef.current = Date.now();
    setDemos(createDemoMoments(Date.now()));
    try { setLegacyCount(parseSavedMoments(localStorage.getItem("moment.entries.v1")).length); } catch { setLegacyCount(0); }
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    let raf = 0, lastSecond = -1;
    const tick = () => {
      if (running || !timeRef.current) timeRef.current = Date.now();
      const now = timeRef.current;
      const parts = getTimeParts(now);
      if (showMilliseconds && millisRef.current) millisRef.current.textContent = parts.milliseconds;
      if (Math.floor(now / 1000) !== lastSecond) {
        lastSecond = Math.floor(now / 1000);
        if (hoursRef.current) hoursRef.current.textContent = parts.hours;
        if (minutesRef.current) minutesRef.current.textContent = parts.minutes;
        if (secondsRef.current) secondsRef.current.textContent = parts.seconds;
        if (dateRef.current) dateRef.current.textContent = `${parts.date}  ·  ${parts.weekday}`;
        if (clockRef.current) clockRef.current.setAttribute("aria-label", `北京时间 ${parts.hours}时${parts.minutes}分${parts.seconds}秒${running ? "，实时运行" : "，已暂停"}`);
        const progress = getDayProgress(now);
        if (progressRef.current) progressRef.current.style.width = `${progress}%`;
        if (progressLabelRef.current) progressLabelRef.current.textContent = `${progress.toFixed(2)}%`;
      }
      const elapsed = Math.max(0, Math.floor((Date.now() - startRef.current) / 1000));
      if (elapsedRef.current) elapsedRef.current.textContent = `${String(Math.floor(elapsed / 3600)).padStart(2, "0")}:${String(Math.floor(elapsed / 60) % 60).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
      raf = requestAnimationFrame(tick);
    };
    const onVisibility = () => { cancelAnimationFrame(raf); if (!document.hidden) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    document.addEventListener("visibilitychange", onVisibility);
    return () => { cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", onVisibility); };
  }, [running, view, showMilliseconds]);

  useEffect(() => {
    activeUser.current = cloud.user?.id ?? null;
    setSelected(null); setConfirmDelete(false); setPreferencesDirty(false);
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

  const capture = useCallback(() => {
    if (cloud.restoring) { setToast("正在确认登录状态，请稍候。"); return; }
    if (!cloud.user) { setModal("login"); return; }
    setCapturedAt(running ? Date.now() : timeRef.current);
    setTitle(""); setNote(""); setCategory("personal"); setModal("capture");
  }, [running, cloud.user, cloud.restoring]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (modal || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select, button, a, [contenteditable='true']")) return;
      if (event.code === "Space" && view === "timeline") { event.preventDefault(); setRunning(value => !value); }
      if (event.key.toLowerCase() === "n") { event.preventDefault(); capture(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [capture, modal, view]);

  const returnToNow = () => { timeRef.current = Date.now(); setRunning(true); setResetKey(value => value + 1); setPulseKey(0); setSpeed(1); setPreferencesDirty(true); };
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
    setBusy(true);
    const editing = modal === "edit" && selected;
    const input: MomentInput = { title: title.trim() || "一个值得记住的瞬间", note: note.trim(), timestamp: capturedAt, category };
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
  const openDetail = async (moment: MomentEntry) => {
    if (busy) return;
    setConfirmDelete(false);
    if (moment.demo) { setSelected(moment); setModal("detail"); return; }
    setBusy(true);
    try { setSelected(await cloud.request<MomentEntry>(`/moments/${encodeURIComponent(moment.id)}`)); setModal("detail"); }
    catch (cause) { reportError(cause); }
    finally { setBusy(false); }
  };
  const editMoment = () => {
    if (!selected || selected.demo) return;
    setCapturedAt(selected.timestamp); setTitle(selected.title); setNote(selected.note); setCategory(selected.category); setModal("edit");
  };
  const deleteMoment = async () => {
    if (!selected || selected.demo || busy) return;
    setBusy(true);
    try {
      await cloud.request(`/moments/${encodeURIComponent(selected.id)}`, { method: "DELETE" });
      cloud.setTotal(value => Math.max(0, value - 1)); cloud.refresh(); setSelected(null); setModal(null); setToast("这条时刻已删除。");
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
  const filtered = moments.filter(moment => (filter === "all" || (filter === "demo" ? moment.demo : !moment.demo)) && `${moment.title} ${moment.note}`.toLowerCase().includes(normalizedSearch.toLowerCase()));

  const momentCard = (moment: MomentEntry, index: number) => <button key={moment.id} className={`moment-card category-${moment.category}`} onClick={() => openDetail(moment)} style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}>
    <div className="card-top"><span className="card-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><span className="card-icon"><Icon name={categoryMeta[moment.category].icon} size={17} /></span><span className="card-category">{categoryMeta[moment.category].label}</span>{moment.demo && <span className="demo-tag">示例</span>}<Icon name="arrow" size={16} className="card-arrow" /></div>
    <h3>{moment.title}</h3><p>{moment.note || "无需太多言语，记住此刻就好。"}</p>
    <div className="card-bottom"><time dateTime={new Date(moment.timestamp).toISOString()}>{formatMomentTime(moment.timestamp)}</time><span>{formatMomentDate(moment.timestamp)}</span></div>
  </button>;

  return <div className="app-shell">
    <header className="site-header">
      <button className="brand" onClick={() => setView("timeline")} aria-label="MOMENT 一瞬，返回时间线"><svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m3 23 7-15 7 15 5-11 7 11" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><circle cx="10" cy="8" r="2.3" fill="currentColor"/><path d="M3 28h26" stroke="currentColor" strokeOpacity=".25"/></svg><span>MOMENT<span className="brand-cn">一瞬</span></span></button>
      <nav className="main-nav" aria-label="主导航"><button className={view === "timeline" ? "active" : ""} aria-current={view === "timeline" ? "page" : undefined} onClick={() => setView("timeline")}>时间线</button><button className={view === "collection" ? "active" : ""} aria-current={view === "collection" ? "page" : undefined} onClick={() => setView("collection")}>时刻集<span className="nav-count">{savedCount.toString().padStart(2, "0")}</span></button><button onClick={() => setModal("about")}>关于</button></nav>
      <div className="header-right"><div className="account-controls">{cloud.user ? <><span className="account-name" title={cloud.user.phone || undefined}>{cloud.user.nickname} · {cloud.user.role === "ADMIN" ? "管理员" : "普通用户"}</span><button className="text-button" disabled={busy} onClick={() => { cloud.logout(); setModal(null); setToast("已退出登录。"); }}>退出</button></> : <button className="text-button" onClick={() => setModal("login")} disabled={cloud.restoring}>{cloud.restoring ? "验证登录…" : "登录 / 注册"}</button>}</div><span className="system-status"><span className="status-dot"/>世界仍在向前</span><span className="header-divider"/><button className="icon-button fullscreen-button" onClick={toggleFullscreen} aria-label={fullscreen ? "退出全屏" : "进入全屏"} title={fullscreen ? "退出全屏" : "全屏沉浸"}><Icon name={fullscreen ? "shrink" : "expand"} size={17}/></button></div>
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
            <div className="clock-meta"><span className={`live-badge ${running ? "" : "paused"}`}><span/>{running ? "LIVE / 正在发生" : "PAUSED / 凝结此刻"}</span><span ref={dateRef}>正在与此刻相遇</span></div>
            <button className="clock-display" onClick={() => { setShowMilliseconds(value => !value); setPreferencesDirty(true); }} aria-expanded={showMilliseconds} aria-controls="clock-fraction" aria-label={showMilliseconds ? "隐藏毫秒" : "显示毫秒"}>
              <span className="digital-clock" ref={clockRef} role="timer" aria-label="北京时间，正在同步" aria-live="off">
                <span className="clock-main" aria-hidden="true"><span ref={hoursRef}>00</span><span className="clock-colon">:</span><span ref={minutesRef}>00</span><span id="clock-seconds" className="clock-seconds"><span className="clock-colon">:</span><span ref={secondsRef}>00</span></span></span>
                <span id="clock-fraction" className="clock-fraction" hidden={!showMilliseconds} aria-hidden="true"><span className="fraction-dot">.</span><span ref={millisRef}>000</span><span className="fraction-unit">MS</span></span>
              </span>
            </button>
            <div className="clock-caption"><span>北京时间 <span className="mono">UTC +08:00</span></span><span className="clock-caption-right">慢一点，感受此刻 <Icon name="arrow" size={13}/></span></div>
          </div>
          <div className="scene-wrap">
            <SolarSystemScene key={resetKey} running={running} speed={speed} pulseKey={pulseKey}/>
          </div>
          <div className="scene-caption" aria-hidden="true"><span>ORBITING, EVER FORWARD</span><p>一边周而复始，<br/>一边奔向远方。</p></div>
          <div className="scene-top-controls"><span className="scene-label"><span className="tiny-cross">+</span> 太阳系 · 螺旋前行</span><div className="scene-switches"><button className="immersive-button" aria-pressed={immersive} onClick={() => { setImmersive(value => !value); setPreferencesDirty(true); }} title={immersive ? "退出沉浸模式" : "进入沉浸模式"}><Icon name={immersive ? "shrink" : "expand"} size={14}/><span>{immersive ? "退出沉浸" : "沉浸"}</span></button></div></div>
          <div className="experience-bottom"><div className="transport"><button className="pause-button" onClick={() => setRunning(value => !value)} aria-label={running ? "暂停星空、公转与时间线" : "继续星空、公转与时间线"}><Icon name={running ? "pause" : "play"} size={14}/><span>{running ? "暂停" : "继续"}</span><kbd>空格</kbd></button><span className="control-divider"/><button className="speed-button" onClick={() => { setSpeed(value => value === 1 ? 2 : value === 2 ? .5 : 1); setPreferencesDirty(true); }} aria-label={`运动速度 ${speed} 倍，点击切换`} title="调整星空和太阳系的运动速度，时钟始终同步真实时间">{speed}<span>×</span></button><span className="control-divider"/><button className="now-button" onClick={returnToNow}><Icon name="focus" size={16}/><span>回到此刻</span></button></div><button className="capture-button" onClick={capture}><Icon name="plus" size={17}/>记录此刻<kbd>N</kbd></button></div>
          <p className="scene-hint"><span>九颗星球 · 同向前行</span><span className="hint-divider">/</span><span>拖动旋转视角</span></p>
          <a className="solar-source" href="https://codepen.io/sarazond/pen/LYGbwj" target="_blank" rel="noopener noreferrer">星空灵感：CodePen <span aria-hidden="true">↗</span></a>
          <span className="experience-index" aria-hidden="true">SCROLL TO DISCOVER <span>↓</span></span>
        </section>

        <section className="moments-section" aria-labelledby="recent-title"><div className="section-heading"><div><div className="section-kicker">02 / TRACES OF YOU</div><h2 id="recent-title">时间流过，你曾在场。</h2><p>给无限的时间，留下几个属于你的坐标。</p></div><button className="text-button" onClick={() => setView("collection")}>探索时刻集<Icon name="arrow" size={16}/></button></div><div className="moments-grid">{moments.slice(0, 3).map(momentCard)}</div></section>
      </> : <section className="collection-page"><div className="collection-heading"><div><div className="eyebrow">YOUR PERSONAL TIME CAPSULE</div><h1>留住的，<span>都是时光。</span></h1><p>每一个被记录的瞬间，都是时间给你的回信。</p></div><button className="capture-button" onClick={capture}><Icon name="plus" size={17}/>记录此刻</button></div><div className="collection-tools"><div className="filter-tabs" aria-label="筛选时刻">{([['all', '全部时刻'], ['saved', '我的记录'], ['demo', '演示时刻']] as const).map(([value, label]) => <button key={value} onClick={() => setFilter(value)} className={filter === value ? "active" : ""} aria-pressed={filter === value}>{label}{value === "saved" && <span>{savedCount}</span>}</button>)}</div><div className="collection-actions"><input className="search-input" aria-label="搜索时刻" maxLength={240} placeholder="寻找某个瞬间…" value={search} onChange={e => setSearch(e.target.value)}/><button className="icon-button export-button" onClick={exportMoments} title="导出我的记录" aria-label="导出我的记录"><Icon name="download"/></button></div></div><div className="moments-grid collection-grid">{filtered.map(momentCard)}</div>{filtered.length === 0 && <div className="empty-state"><Icon name={search ? "focus" : "bookmark"} size={32}/><h2>{search ? "还没有找到这个瞬间" : "你的故事，从此刻开始"}</h2><p>{search ? "换一个词，或看看其他时刻。" : "为平凡的一天，留下一点不平凡的记忆。"}</p><button className="text-button" onClick={search ? () => { setSearch(""); setFilter("all"); } : capture}>{search ? "查看全部时刻" : "记录第一个瞬间"}<Icon name="arrow" size={16}/></button></div>}<p className="storage-note"><Icon name="bookmark" size={13}/>{cloud.user ? "记录已关联当前账号，最多保存 200 条。可随时导出备份。" : "登录后可保存和同步你的记录。当前展示的是演示时刻。"}</p>{cloud.user && legacyCount > 0 && <button className="text-button legacy-import" onClick={() => setModal("import")} disabled={busy}>导入本机旧记录（{legacyCount} 条）</button>}</section>}
    </main>

    <footer className="site-footer"><div className="day-progress"><div className="day-progress-label"><span>今天，已经走过</span><span ref={progressLabelRef} className="mono">0.00%</span></div><div className="progress-track"><div ref={progressRef}/></div></div><div className="footer-bottom"><span className="footer-quote">“ 时间是我们所在的地方。 ”</span><span className="session-time"><span className="status-dot"/>已与你共度 <span ref={elapsedRef} className="mono">00:00:00</span></span><span className="footer-signature">MADE FOR THE MOMENT<span>© 2026</span></span></div></footer>

    <Modal open={modal !== null} title={modal === "capture" ? "留住这一刻" : modal === "edit" ? "编辑时刻" : modal === "detail" ? "时间里的一个坐标" : modal === "login" ? "登录一瞬" : modal === "import" ? "导入本机旧记录" : "关于一瞬"} onClose={() => { if (!busy && !authBusy) setModal(null); }}>
      {(modal === "capture" || modal === "edit") && <form onSubmit={saveMoment}><fieldset className="moment-form-fields" disabled={busy}><div className="captured-time"><span className="eyebrow">A MOMENT TO REMEMBER</span><strong>{formatMomentTime(capturedAt)}</strong><span>{getTimeParts(capturedAt).date} · 北京时间</span></div><label className="field-label" htmlFor="moment-title">为此刻起个名字<span>{title.length}/40</span></label><input id="moment-title" className="form-input" maxLength={40} placeholder="例如：终于完成了那个小目标" value={title} onChange={e => setTitle(e.target.value)} autoFocus/><label className="field-label" htmlFor="moment-note">想对未来的自己说<span>选填</span></label><textarea id="moment-note" className="form-input" rows={3} maxLength={240} placeholder="记下心情、一个念头，或只是天气……" value={note} onChange={e => setNote(e.target.value)}/><span className="field-label">时刻分类</span><div className="category-options">{(Object.keys(categoryMeta) as MomentCategory[]).map(value => <button key={value} type="button" className={category === value ? "selected" : ""} onClick={() => setCategory(value)} aria-pressed={category === value}><Icon name={categoryMeta[value].icon} size={14}/>{categoryMeta[value].label}</button>)}</div><button className="capture-button modal-submit" disabled={busy} type="submit"><Icon name="bookmark" size={16}/>{busy ? "保存中…" : modal === "edit" ? "保存修改" : "存入时刻集"}</button><p className="form-footnote">这一刻已定格，慢慢写也没关系。</p></fieldset></form>}
      {modal === "detail" && selected && (selected.demo || cloud.user) && <div className="moment-detail"><div className="detail-category"><Icon name={categoryMeta[selected.category].icon}/>{categoryMeta[selected.category].label}{selected.demo && <span className="demo-tag">演示数据</span>}</div><h3>{selected.title}</h3><p>{selected.note || "无需太多言语，记住此刻就好。"}</p><div className="detail-time"><span>{getTimeParts(selected.timestamp).date} · 北京时间</span><strong>{formatMomentTime(selected.timestamp)}</strong><span className="mono">UNIX {selected.timestamp} ms</span></div>{selected.demo && <p className="detail-demo-note">这是一条演示记录。点击「记录此刻」，开始写下你自己的时间故事。</p>}{!selected.demo && cloud.user && <div className="detail-actions"><button className="text-button" onClick={editMoment} disabled={busy}>编辑时刻</button>{confirmDelete ? <><span>确定删除这条记录？</span><button className="text-button danger-button" onClick={deleteMoment} disabled={busy}>{busy ? "删除中…" : "确认删除"}</button><button className="text-button" onClick={() => setConfirmDelete(false)} disabled={busy}>取消</button></> : <button className="text-button danger-button" onClick={() => setConfirmDelete(true)}>删除时刻</button>}</div>}<button className="text-button" disabled={busy} onClick={capture}>记录属于我的此刻<Icon name="arrow" size={16}/></button></div>}
      {modal === "login" && <TimelineLogin onBusyChange={setAuthBusy} onLogin={async (phone, code) => { await cloud.login(phone, code); setModal(null); setToast("登录成功，可以记录你的时刻了。"); }}/>}
      {modal === "import" && cloud.user && <div className="import-content"><p>将本机的 {legacyCount} 条旧记录导入到 <strong>{cloud.user.nickname}（{cloud.user.phone}）</strong>。</p><p>请确认这些记录属于当前账号。重复记录会自动跳过，本机原始备份会继续保留。</p><button className="capture-button modal-submit" onClick={importLegacy} disabled={busy}>{busy ? "正在导入…" : "确认导入到此账号"}</button></div>}
      {modal === "about" && <div className="about-content"><div className="about-mark">m<span>.</span></div><h3>让时间，有迹可循。</h3><p>一瞬是一处安静的时间观察站。在流动中感受此刻，也给值得记住的事情留一个位置。</p><div className="about-facts"><div><Icon name="clock"/><span><strong>让时间安静一点</strong>默认显示时、分、秒，点击时钟展开或收起毫秒。使用设备时间，以北京时间展示。</span></div><div><Icon name="sun"/><span><strong>公转，也不断前行</strong>太阳与星球朝同一方向前行，螺旋轨迹在身后逐渐淡去。拖动可观察星球的远近与遮挡；大小、距离与周期为视觉示意。</span></div><div><Icon name="bookmark"/><span><strong>故事只属于你</strong>登录后，记录保存在你的账号中，可跨设备查看。只有你和具有数据管理权限的管理员可以访问，建议定期导出备份。</span></div></div><div className="about-shortcuts"><span><kbd>空格</kbd>暂停 / 继续</span><span><kbd>N</kbd>记录此刻</span><span><kbd>Esc</kbd>关闭弹窗</span></div><p className="about-signoff">THE PRESENT IS A PRESENT.</p></div>}
    </Modal>
    <div className={`toast ${toast ? "visible" : ""}`} role="status" aria-live="polite">{toast && <><Icon name="check" size={16}/>{toast}</>}</div>
  </div>;
}
