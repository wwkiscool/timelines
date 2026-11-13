"use client";

import { useEffect, useState, type FormEvent } from "react";
import { timelineRequest } from "@/lib/timeline-api";

export default function TimelineLogin({ onLogin, onBusyChange }: { onLogin: (phone: string, code: string) => Promise<void>; onBusyChange: (busy: boolean) => void }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [mockCode, setMockCode] = useState("");
  const [remaining, setRemaining] = useState(0);
  const [sending, setSending] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (!remaining) return;
    const timer = setTimeout(() => setRemaining(value => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);
  const sendCode = async () => {
    if (!/^1\d{10}$/.test(phone)) { setError("请输入 11 位手机号。"); return; }
    setSending(true); setError(""); setMockCode(""); setSent(false);
    try {
      const result = await timelineRequest<{ mockCode?: string } | null>("/auth/send-code", null, { method: "POST", body: JSON.stringify({ phone }) });
      if (result?.mockCode && process.env.NODE_ENV === "production") {
        setRemaining(60);
        setSent(false);
        setError("登录服务仍处于测试模式，请联系管理员完成正式短信配置。");
        return;
      }
      setMockCode(result?.mockCode || ""); setRemaining(60); setSent(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "验证码发送失败。"); }
    finally { setSending(false); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setLoggingIn(true); onBusyChange(true); setError("");
    try { await onLogin(phone, code); }
    catch (cause) { if (!(cause instanceof Error && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : "登录失败，请重试。"); }
    finally { setLoggingIn(false); onBusyChange(false); }
  };
  return <form onSubmit={submit} className="timeline-login">
    <p className="login-intro">登录后，将值得记住的瞬间保存到你的账号。</p>
    <label className="field-label" htmlFor="login-phone">手机号</label>
    <input id="login-phone" className="form-input" type="tel" inputMode="numeric" autoComplete="tel" pattern="1[0-9]{10}" maxLength={11} required value={phone} onChange={event => { setPhone(event.target.value); setMockCode(""); setSent(false); }} disabled={loggingIn || sending} autoFocus/>
    <label className="field-label" htmlFor="login-code">短信验证码</label>
    <div className="login-code-row"><input id="login-code" className="form-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={event => setCode(event.target.value)} disabled={loggingIn}/><button className="text-button" type="button" onClick={sendCode} disabled={sending || loggingIn || remaining > 0}>{sending ? "发送中…" : remaining ? `${remaining} 秒后重发` : "获取验证码"}</button></div>
    {mockCode ? <p className="mock-code" role="status">开发测试环境 · 短信尚未接入，测试验证码：<strong>{mockCode}</strong></p> : sent && <p className="form-footnote" role="status">验证码已发送，请查看短信。</p>}
    {error && <p className="cloud-error" role="alert">{error}</p>}
    <button className="capture-button modal-submit" disabled={loggingIn || sending} type="submit">{loggingIn ? "正在登录…" : "登录 / 注册"}</button>
    <p className="form-footnote">首次登录会创建普通用户账号。你的记录与其他用户分别保存。</p>
  </form>;
}
