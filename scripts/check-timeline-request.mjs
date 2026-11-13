import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { getEventListeners } from "node:events";
import { afterEach, test } from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("../src/lib/timeline-api.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
const loaded = { exports: {} };
new Function("exports", "require", "module", code)(loaded.exports, require, loaded);
const { timelineRequest, TimelineApiError } = loaded.exports;
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function abortable(signal) {
  return new Promise((resolve, reject) => {
    const cancel = () => reject(new DOMException("Cancelled", "AbortError"));
    if (signal.aborted) cancel();
    else signal.addEventListener("abort", cancel, { once: true });
  });
}
const ok = data => Response.json({ code: 0, data });

test("successful requests preserve headers, credentials and cache settings", async () => {
  const controller = new AbortController();
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/timeline/moments");
    assert.equal(init.headers.get("Authorization"), "Bearer test-only-token");
    assert.equal(init.headers.get("X-Test"), "yes");
    assert.equal(init.headers.get("Content-Type"), "application/json");
    assert.equal(init.cache, "no-store");
    assert.equal("timeoutMs" in init, false);
    return ok({ id: "1" });
  };
  assert.deepEqual(await timelineRequest("/moments", "test-only-token", { method: "POST", body: "{}", headers: { "X-Test": "yes" }, signal: controller.signal }), { id: "1" });
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("HTTP errors retain status and server message", async () => {
  globalThis.fetch = async () => Response.json({ code: 401, message: "请先登录" }, { status: 401 });
  await assert.rejects(timelineRequest("/me", null), error => error instanceof TimelineApiError && error.status === 401 && error.message === "请先登录");
});

test("malformed response produces an API error", async () => {
  globalThis.fetch = async () => new Response("not JSON", { status: 502 });
  await assert.rejects(timelineRequest("/me", null), error => error instanceof TimelineApiError && error.status === 502);
});

test("business errors are not reported as connectivity errors", async () => {
  globalThis.fetch = async () => Response.json({ code: 400, message: "验证码错误" });
  await assert.rejects(timelineRequest("/auth/login", null), error => error.message === "验证码错误");
});

test("network failure has a recoverable message", async () => {
  globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
  await assert.rejects(timelineRequest("/me", null), error => error.status === 0 && error.message.includes("检查网络"));
});

test("read timeout releases the request with status 408", async () => {
  const controller = new AbortController();
  globalThis.fetch = (url, init) => abortable(init.signal);
  await assert.rejects(timelineRequest("/me", null, { timeoutMs: 10, signal: controller.signal }), error => error.status === 408 && error.message.includes("超时"));
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("write timeout does not promise that the server cancelled the write", async () => {
  let calls = 0;
  globalThis.fetch = (url, init) => { calls++; return abortable(init.signal); };
  await assert.rejects(timelineRequest("/moments", null, { method: "POST", body: "{}", timeoutMs: 10 }), error => error.status === 408 && error.message.includes("避免重复提交"));
  assert.equal(calls, 1, "mutations must not be automatically retried");
});

test("deadline covers response-body consumption", async () => {
  globalThis.fetch = async (url, init) => ({ ok: true, status: 200, json: () => abortable(init.signal) });
  await assert.rejects(timelineRequest("/me", null, { timeoutMs: 10 }), error => error.status === 408);
});

test("caller cancellation remains an AbortError", async () => {
  const controller = new AbortController();
  globalThis.fetch = (url, init) => abortable(init.signal);
  const request = timelineRequest("/moments", null, { signal: controller.signal });
  controller.abort();
  await assert.rejects(request, error => error.name === "AbortError");
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("already-aborted signals cancel immediately", async () => {
  const controller = new AbortController();
  controller.abort();
  globalThis.fetch = (url, init) => abortable(init.signal);
  await assert.rejects(timelineRequest("/me", null, { signal: controller.signal }), error => error.name === "AbortError");
});

test("invalid timeout configuration fails without dispatching", async () => {
  globalThis.fetch = async () => { assert.fail("fetch must not run"); };
  for (const timeoutMs of [0, -1, NaN, Infinity]) await assert.rejects(timelineRequest("/me", null, { timeoutMs }), RangeError);
});
