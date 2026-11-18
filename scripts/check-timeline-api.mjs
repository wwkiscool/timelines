import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = JSON.parse(await readFile(new URL('../artifacts/timeline-integration-qa/h2-backend-runtime.json', import.meta.url), 'utf8').then(value => value.replace(/^\uFEFF/, '')));
assert.equal(runtime.profile, 'h2', 'Start the isolated H2 QA backend before running these checks.');
assert.equal(runtime.datasource, 'jdbc:h2:mem:timeline_qa_20261109');
const backend = 'http://127.0.0.1:' + runtime.port;
const client = process.env.TIMELINE_QA_CLIENT_URL || 'http://127.0.0.1:3301';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(client).hostname));
const phoneA = '138' + randomInt(100000000).toString().padStart(8, '0');
const phoneB = '139' + randomInt(100000000).toString().padStart(8, '0');
let checks = 0;
async function call(origin, path, token, method = 'GET', data, status = 200) {
  const response = await fetch(origin + path, {
    method,
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    signal: AbortSignal.timeout(20000),
  });
  const body = await response.json();
  assert.equal(response.status, status, method + ' ' + path + ': ' + (body.message || 'unexpected status'));
  if (status === 200) assert.equal(body.code, 0);
  checks += 1;
  return body.data;
}
async function login(origin, prefix, phone, checkWrongCode = false) {
  const code = await call(origin, prefix + '/send-code', null, 'POST', { phone });
  assert.match(code.mockCode, /^\d{6}$/);
  if (checkWrongCode) await call(origin, prefix + '/login', null, 'POST', { phone, code: code.mockCode === '000000' ? '111111' : '000000' }, 400);
  return call(origin, prefix + '/login', null, 'POST', { phone, code: code.mockCode });
}
await call(client, '/api/timeline/me', null, 'GET', undefined, 401);
await call(client, '/api/timeline/auth/send-code', null, 'POST', { phone: 'invalid' }, 400);
const a = await login(client, '/api/timeline/auth', phoneA, true);
const b = await login(client, '/api/timeline/auth', phoneB);
assert.equal(a.user.role, 'USER');
assert.notEqual(a.user.id, b.user.id);
assert.equal((await call(client, '/api/timeline/me', a.token)).id, a.user.id);
await call(client, '/api/timeline/me', 'invalid-token', 'GET', undefined, 401);
await call(backend, '/api/admin/timeline/me', a.token, 'GET', undefined, 403);
const phoneSession = await login(backend, '/api/auth', phoneA);
await call(client, '/api/timeline/me', phoneSession.token, 'GET', undefined, 403);

const input = { title: 'API联调时刻', note: '验证用户端代理与隔离后端', timestamp: Date.now(), category: 'personal' };
const moment = await call(client, '/api/timeline/moments', a.token, 'POST', input);
assert.equal(moment.demo, false);
assert.ok(moment.id);
const other = await call(client, '/api/timeline/moments', b.token, 'POST', { ...input, title: '其他账号的时刻' });
await call(client, '/api/timeline/moments', a.token, 'POST', { ...input, title: 'a'.repeat(41) }, 400);
await call(client, '/api/timeline/moments', a.token, 'POST', { ...input, category: 'invalid' }, 400);
for (const method of ['GET', 'PUT', 'DELETE']) await call(client, '/api/timeline/moments/' + moment.id, b.token, method, method === 'PUT' ? input : undefined, 404);
const results = await call(client, '/api/timeline/moments?page=1&size=200&q=' + encodeURIComponent('  API  ') + '&category=personal', a.token);
assert.equal(results.total, 1);
assert.equal(results.list[0].id, moment.id);
const ascResults = await call(client, '/api/timeline/moments?page=1&size=200&sort=asc&from=' + (input.timestamp - 1000) + '&to=' + (input.timestamp + 1000), a.token);
assert.equal(ascResults.total, 1);
await call(client, '/api/timeline/moments?sort=bad', a.token, 'GET', undefined, 400);
await call(client, '/api/timeline/moments?from=200&to=100', a.token, 'GET', undefined, 400);
const insights = await call(client, '/api/timeline/moments/insights', a.token);
assert.equal(insights.total, 1);
assert.equal(insights.categoryCounts.personal, 1);
assert.ok(insights.activeDays >= 1);
await call(client, '/api/timeline/moments?q=' + 'a'.repeat(241), a.token, 'GET', undefined, 400);

const defaults = await call(client, '/api/timeline/preferences', a.token);
assert.deepEqual(defaults, { speed: 1, immersive: true, showMilliseconds: false });
const prefs = { speed: 2, immersive: false, showMilliseconds: true };
await call(client, '/api/timeline/preferences', a.token, 'PUT', prefs);
assert.deepEqual(await call(client, '/api/timeline/preferences', a.token), prefs);
await call(client, '/api/timeline/preferences', a.token, 'PUT', { ...prefs, speed: 3 }, 400);
assert.deepEqual(await call(client, '/api/timeline/preferences', b.token), defaults);

const old = { ...input, title: '本机旧记录', id: 'legacy-api-qa', demo: false };
assert.deepEqual(await call(client, '/api/timeline/moments/import', a.token, 'POST', { moments: [old, old] }), { imported: 1, skipped: 1 });
assert.deepEqual(await call(client, '/api/timeline/moments/import', a.token, 'POST', { moments: [old] }), { imported: 0, skipped: 1 });
await call(client, '/api/timeline/moments/import', a.token, 'POST', { moments: [{ ...old, id: 'demo-must-not-import', demo: true }] }, 400);
const overLimit = Array.from({ length: 199 }, (_, index) => ({ ...old, id: 'over-limit-' + index }));
await call(client, '/api/timeline/moments/import', a.token, 'POST', { moments: overLimit }, 409);
assert.equal((await call(client, '/api/timeline/moments', a.token)).total, 2);
const exported = await call(client, '/api/timeline/moments/export', a.token);
assert.equal(exported.version, 1);
assert.equal(exported.timezone, 'Asia/Shanghai');
assert.equal(exported.moments.length, 2);
assert.ok(exported.moments.every(item => !item.demo && item.id !== other.id));
await call(client, '/api/timeline/moments/' + moment.id, a.token, 'PUT', { ...input, title: '更新后的时刻' });
assert.equal((await call(client, '/api/timeline/moments/' + moment.id, a.token)).title, '更新后的时刻');
const returning = await login(client, '/api/timeline/auth', phoneA);
assert.equal(returning.user.id, a.user.id);
assert.deepEqual(await call(client, '/api/timeline/preferences', returning.token), prefs);
assert.equal((await call(client, '/api/timeline/moments/' + moment.id, returning.token)).title, '更新后的时刻');
await call(client, '/api/timeline/moments/' + moment.id, a.token, 'DELETE');
await call(client, '/api/timeline/moments/' + moment.id, a.token, 'GET', undefined, 404);
const remaining = await call(client, '/api/timeline/moments/export', a.token);
for (const item of remaining.moments) await call(client, '/api/timeline/moments/' + item.id, a.token, 'DELETE');
await call(client, '/api/timeline/moments/' + other.id, b.token, 'DELETE');
assert.equal((await call(client, '/api/timeline/moments', a.token)).total, 0);
const report = { passed: true, checks, client, backend, completedAt: new Date().toISOString(), coverage: ['login', 're-login persistence', 'JWT source', 'account isolation', 'CRUD', 'search', 'preferences', 'legacy import', '200-record limit', 'export'] };
await mkdir(root + 'artifacts/timeline-integration-qa', { recursive: true });
await writeFile(root + 'artifacts/timeline-integration-qa/api-checks.json', JSON.stringify(report, null, 2));
console.log('Passed ' + checks + ' HTTP checks through the Next.js proxy and isolated H2 backend.');