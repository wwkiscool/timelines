import type { MomentEntry } from "./time";

export type TimelineUser = { id: number; phone: string | null; nickname: string; role: "USER" | "ADMIN"; status: number };
export type Preferences = { speed: number; immersive: boolean; showMilliseconds: boolean };
export type MomentInput = Pick<MomentEntry, "title" | "note" | "timestamp" | "category">;
export type MomentPage = { list: MomentEntry[]; total: number; page: number; size: number };
export type LoginResult = { token: string; expiresAt: number; user: TimelineUser };
export type MomentExport = { version: number; timezone: string; moments: MomentEntry[] };
export const TOKEN_KEY = "moment.timeline.token.v1";

export class TimelineApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const REQUEST_TIMEOUT_MS = 20_000;
export type TimelineRequestOptions = RequestInit & { timeoutMs?: number };

export async function timelineRequest<T>(path: string, token: string | null, options: TimelineRequestOptions = {}): Promise<T> {
  const { signal, timeoutMs = REQUEST_TIMEOUT_MS, ...init } = options;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError("timeoutMs must be positive and finite");
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(`/api/timeline${path}`, { ...init, headers, signal: controller.signal, cache: "no-store" });
    // Keep the deadline active until the body is consumed, not just until headers arrive.
    const body = await response.json().catch(error => {
      if (controller.signal.aborted) throw error;
      return null;
    }) as { code?: number; message?: string; data?: T } | null;
    if (controller.signal.aborted) throw new DOMException("请求已取消", "AbortError");
    if (!response.ok || body?.code !== 0) {
      throw new TimelineApiError(response.status, body?.message || "服务暂时不可用，请稍后重试。");
    }
    return body.data as T;
  } catch (error) {
    // Account switches and search cancellation must remain silent AbortErrors.
    if (signal?.aborted) throw new DOMException("请求已取消", "AbortError");
    if (timedOut) {
      const readOnly = !init.method || ["GET", "HEAD"].includes(init.method.toUpperCase());
      throw new TimelineApiError(408, readOnly
        ? "请求超时，请检查网络后重试。"
        : "请求超时，操作结果尚未确认。请先刷新核对，避免重复提交；验证码请检查是否已收到。");
    }
    if (error instanceof TimelineApiError || (error instanceof Error && error.name === "AbortError")) throw error;
    throw new TimelineApiError(0, "暂时无法连接服务，请检查网络后重试。");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
