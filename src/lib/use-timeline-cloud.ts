"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MomentEntry } from "./time";
import { TOKEN_KEY, TimelineApiError, timelineRequest, type LoginResult, type MomentInsights, type MomentPage, type Preferences, type TimelineUser } from "./timeline-api";

export default function useTimelineCloud(query: string, sort: "desc" | "asc" = "desc") {
  const [user, setUser] = useState<TimelineUser | null>(null);
  const [entries, setEntries] = useState<MomentEntry[]>([]);
  const [insights, setInsights] = useState<MomentInsights | null>(null);
  const [total, setTotalState] = useState(0);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preferencesError, setPreferencesError] = useState("");
  const [sessionId, setSessionId] = useState(0);
  const [revision, setRevision] = useState(0);
  const token = useRef<string | null>(null);
  const epoch = useRef(0);
  const requestSequence = useRef(0);
  const totalVersion = useRef(0);
  const setTotal = useCallback((value: number | ((previous: number) => number)) => {
    totalVersion.current += 1;
    setTotalState(value);
  }, []);

  const logout = useCallback(() => {
    epoch.current += 1;
    setSessionId(epoch.current);
    requestSequence.current += 1;
    token.current = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* In-memory logout still succeeds. */ }
    setUser(null); setEntries([]); setInsights(null); setTotal(0); setPreferences(null);
    setLoading(false); setRestoring(false); setError(""); setPreferencesError("");
  }, []);

  const request = useCallback(async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
    const credential = token.current;
    const generation = sessionId;
    if (generation !== epoch.current) throw new DOMException("账号已切换", "AbortError");
    if (!credential) throw new TimelineApiError(401, "请先登录，再管理你的时刻。");
    try {
      const value = await timelineRequest<T>(path, credential, options);
      if (generation !== epoch.current) throw new DOMException("账号已切换", "AbortError");
      return value;
    } catch (cause) {
      if (generation !== epoch.current) throw new DOMException("账号已切换", "AbortError");
      if (generation === epoch.current && cause instanceof TimelineApiError && [401, 403].includes(cause.status)) {
        logout();
        setError(cause.message);
      }
      throw cause;
    }
  }, [logout, sessionId]);

  const initialize = useCallback(async (credential: string) => {
    const generation = ++epoch.current;
    setSessionId(generation);
    token.current = credential;
    setEntries([]); setInsights(null); setTotal(0); setUser(null); setPreferences(null); setRestoring(true); setError(""); setPreferencesError("");
    let authenticated = false;
    try {
      const account = await timelineRequest<TimelineUser>("/me", credential);
      if (generation !== epoch.current) return false;
      setUser(account);
      authenticated = true;
      const summaryVersion = totalVersion.current;
      const [loaded, summary] = await Promise.allSettled([
        timelineRequest<Preferences>("/preferences", credential),
        timelineRequest<MomentPage>("/moments?page=1&size=1", credential),
      ]);
      if (generation !== epoch.current) return false;
      for (const result of [loaded, summary]) {
        if (result.status === "rejected" && result.reason instanceof TimelineApiError && [401, 403].includes(result.reason.status)) throw result.reason;
      }
      if (loaded.status === "fulfilled") setPreferences(loaded.value);
      else setPreferencesError("显示偏好加载失败，暂时无法同步设置。请点击重试。");
      if (summary.status === "fulfilled" && summaryVersion === totalVersion.current) setTotal(summary.value.total);
    } catch (cause) {
      if (generation !== epoch.current) return false;
      if (cause instanceof TimelineApiError && [401, 403].includes(cause.status)) { logout(); authenticated = false; }
      setError(cause instanceof Error ? cause.message : "加载账号失败，请重试。");
    } finally {
      if (generation === epoch.current) setRestoring(false);
    }
    return authenticated;
  }, [logout]);

  useEffect(() => {
    let credential: string | null = null;
    try { credential = localStorage.getItem(TOKEN_KEY); } catch { /* Storage can be disabled. */ }
    if (credential) void initialize(credential);
    else setRestoring(false);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== TOKEN_KEY && event.key !== null) return;
      if (event.newValue) void initialize(event.newValue);
      else logout();
    };
    window.addEventListener("storage", onStorage);
    return () => { epoch.current += 1; window.removeEventListener("storage", onStorage); };
  }, [initialize, logout]);

  useEffect(() => {
    if (!user) return;
    const sequence = ++requestSequence.current;
    const controller = new AbortController();
    setLoading(true); setError("");
    const timer = setTimeout(async () => {
      try {
        const [page, loadedInsights] = await Promise.all([
          request<MomentPage>(`/moments?page=1&size=200&sort=${sort}&q=${encodeURIComponent(query)}`, { signal: controller.signal }),
          query ? Promise.resolve(null) : request<MomentInsights>("/moments/insights", { signal: controller.signal }).catch(() => null),
        ]);
        if (sequence !== requestSequence.current) return;
        setEntries(page.list);
        if (!query) setTotal(page.total);
        if (loadedInsights) setInsights(loadedInsights);
      } catch (cause) {
        if (controller.signal.aborted || sequence !== requestSequence.current || (cause instanceof Error && cause.name === "AbortError")) return;
        setEntries([]);
        setError(cause instanceof Error ? cause.message : "加载时刻失败。");
      } finally {
        if (sequence === requestSequence.current) setLoading(false);
      }
    }, query ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, sort, user, revision, request]);

  const login = async (phone: string, code: string) => {
    const generation = ++epoch.current;
    setSessionId(generation);
    let result: LoginResult;
    try {
      result = await timelineRequest<LoginResult>("/auth/login", null, { method: "POST", body: JSON.stringify({ phone, code }) });
    } catch (cause) {
      if (generation !== epoch.current) throw new DOMException("账号已切换", "AbortError");
      setRestoring(false);
      throw cause;
    }
    if (generation !== epoch.current) throw new DOMException("账号已切换，请使用当前账号。", "AbortError");
    try { localStorage.setItem(TOKEN_KEY, result.token); } catch { /* The active tab can still use the session. */ }
    const authenticated = await initialize(result.token);
    if (epoch.current !== generation + 1) throw new DOMException("账号已切换", "AbortError");
    if (!authenticated) throw new Error("登录状态验证失败，请重试。");
  };

  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const retry = useCallback(() => {
    if (token.current) void initialize(token.current);
    else refresh();
  }, [initialize, refresh]);

  return { user, entries, insights, total, preferences, restoring, loading, error: error || preferencesError, request, login, logout, refresh, retry, setTotal };
}
