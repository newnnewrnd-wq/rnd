import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { startApplication } from '../server.mjs';
import { token, digest } from '../auth.mjs';

let app, directory, setupToken, admin, employee, employeeId, temporaryPassword;
const adminPassword = 'A private laboratory phrase 42!';
const employeePassword = 'Bright science across the lab 72!';
const nextPassword = 'Another formulation phrase 81!';
const api = async (path, data, session, extra = {}) => {
  const headers = { ...(data === undefined ? {} : { 'Content-Type': 'application/json', Origin: app.origin }), ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}), ...extra };
  const response = await fetch(app.origin + path, { method: data === undefined ? 'GET' : 'POST', headers, body: data === undefined ? undefined : JSON.stringify(data), redirect: 'manual' });
  const payload = (response.headers.get('content-type') ?? '').includes('application/json') ? await response.json() : await response.text();
  return { status: response.status, headers: response.headers, payload, cookie: response.headers.get('set-cookie')?.split(';')[0], csrf: payload.csrf };
};
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'formula-auth-'));setupToken = token();
  app = await startApplication({ origin: 'http://127.0.0.1:0', port: 0, dbPath: join(directory, 'accounts.sqlite'), setupToken });
});
after(async () => { if (app) await app.close();await rm(directory, { recursive: true, force: true }); });

test('anonymous visitors cannot retrieve the simulator, protected assets or account APIs', async () => {
  assert.equal((await api('/')).headers.get('location'), '/setup');
  for (const path of ['/app.js', '/engine.js', '/data.js', '/api/admin/users', '/api/auth/session']) assert.equal((await api(path)).status, 401, path);
  assert.equal((await api('/login')).status, 200);
  assert.equal((await api('/auth/client.js')).status, 200);
});
test('setup rejects wrong secret and cross-site requests before creating an administrator', async () => {
  const input = { setupToken: token(), username: 'lab-admin', name: '관리자', password: adminPassword };
  assert.equal((await api('/api/auth/setup', input)).status, 403);
  assert.equal((await api('/api/auth/setup', { ...input, setupToken }, null, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal(app.accounts.hasAdmin(), false);
});
test('one-time setup creates a hashed-password admin and secure session attributes', async () => {
  admin = await api('/api/auth/setup', { setupToken, username: 'lab-admin', name: '관리자', password: adminPassword });
  assert.equal(admin.status, 200);assert.equal(admin.payload.user.role, 'admin');
  assert.match(admin.headers.get('set-cookie'), /HttpOnly/);assert.match(admin.headers.get('set-cookie'), /SameSite=Strict/);
  const dbUser = app.db.prepare('SELECT * FROM users WHERE username=?').get('lab-admin');
  assert.match(dbUser.password_hash, /^scrypt-v1\$/);assert.ok(!dbUser.password_hash.includes(adminPassword));
  assert.equal(app.db.prepare("SELECT 1 FROM settings WHERE key='setup_hash'").get(), undefined);
  const stored = app.db.prepare('SELECT token_hash FROM sessions WHERE user_id=?').get(dbUser.id).token_hash;
  assert.equal(stored, digest(admin.cookie.split('=')[1]));
  assert.equal((await api('/api/auth/setup', { setupToken, username: 'another-admin', name: '다른 관리자', password: adminPassword })).status, 409);
});
test('authenticated simulator preserves existing calculation UI and sources', async () => {
  const page = await api('/', undefined, admin);assert.equal(page.status, 200);
  assert.match(page.payload, /배합 시뮬레이터/);assert.match(page.payload, /href="\/account"/);
  assert.match(page.headers.get('cache-control'), /no-store/);
  const script = await api('/engine.js', undefined, admin);assert.equal(script.status, 200);assert.match(script.payload, /calculate/);
  assert.equal((await api('/.git/config', undefined, admin)).status, 404);
  assert.equal((await api('/standalone/auth.mjs', undefined, admin)).status, 404);
});
test('mutations require CSRF and exact Origin, and reject unsupported media type', async () => {
  const data = { username: 'researcher', name: '연구원' };
  assert.equal((await api('/api/admin/users', data, admin, { 'X-CSRF-Token': 'wrong' })).status, 403);
  assert.equal((await api('/api/admin/users', data, admin, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await api('/api/admin/users', data, admin, { 'Content-Type': 'text/plain' })).status, 415);
});
test('admin issues a unique employee password; no anonymous signup or administrator role injection', async () => {
  const created = await api('/api/admin/users', { username: 'Researcher@newnew.example', name: '연구원', role: 'admin' }, admin);
  assert.equal(created.status, 201);employeeId = created.payload.user.id;temporaryPassword = created.payload.temporaryPassword;
  assert.equal(created.payload.user.role, 'employee');assert.equal(created.payload.user.mustChangePassword, true);
  assert.ok(temporaryPassword.length >= 24);
  assert.equal((await api('/api/admin/users', { username: 'researcher@newnew.example', name: '중복' }, admin)).status, 409);
  assert.equal((await api('/api/admin/users', { username: 'stranger', name: '외부' })).status, 401);
});
test('temporary-password login is restricted until the password is changed', async () => {
  employee = await api('/api/auth/login', { username: 'researcher@newnew.example', password: temporaryPassword });
  assert.equal(employee.status, 200);assert.equal(employee.payload.user.mustChangePassword, true);
  assert.equal((await api('/', undefined, employee)).headers.get('location'), '/account');
  assert.equal((await api('/app.js', undefined, employee)).status, 403);
  assert.equal((await api('/api/admin/users', undefined, employee)).status, 403);
  assert.equal((await api('/account', undefined, employee)).status, 200);
});
test('password changes require the current password, reject weak values, and rotate sessions', async () => {
  assert.equal((await api('/api/auth/password', { currentPassword: 'incorrect', newPassword: employeePassword }, employee)).status, 400);
  assert.equal((await api('/api/auth/password', { currentPassword: temporaryPassword, newPassword: 'short' }, employee)).status, 400);
  const previous = employee;
  employee = await api('/api/auth/password', { currentPassword: temporaryPassword, newPassword: employeePassword }, employee);
  assert.equal(employee.status, 200);assert.equal(employee.payload.user.mustChangePassword, false);
  assert.notEqual(employee.cookie, previous.cookie);
  assert.equal((await api('/api/auth/session', undefined, previous)).status, 401);
  assert.equal((await api('/', undefined, employee)).status, 200);
});
test('employees cannot list accounts, issue accounts, reset passwords or change another account status', async () => {
  const action = `/api/admin/users/${admin.payload.user.id}`;
  assert.equal((await api('/api/admin/users', undefined, employee)).status, 403);
  assert.equal((await api('/api/admin/users', { username: 'intruder', name: '검증' }, employee)).status, 403);
  assert.equal((await api(`${action}/reset-password`, {}, employee)).status, 403);
  assert.equal((await api(`${action}/status`, { enabled: false }, employee)).status, 403);
  assert.equal((await api('/admin', undefined, employee)).status, 403);
});
test('password change revokes every previously issued session across devices', async () => {
  const second = await api('/api/auth/login', { username: 'researcher@newnew.example', password: employeePassword });
  assert.equal(second.status, 200);
  const old = employee;employee = await api('/api/auth/password', { currentPassword: employeePassword, newPassword: nextPassword }, employee);
  assert.equal(employee.status, 200);
  assert.equal((await api('/api/auth/session', undefined, second)).status, 401);
  assert.equal((await api('/api/auth/session', undefined, old)).status, 401);
});
test('disabling a user revokes sessions and blocks login; re-enabling requires a new login', async () => {
  const route = `/api/admin/users/${employeeId}/status`;
  assert.equal((await api(route, { enabled: false }, admin)).status, 200);
  assert.equal((await api('/api/auth/session', undefined, employee)).status, 401);
  assert.equal((await api('/api/auth/login', { username: 'researcher@newnew.example', password: nextPassword })).status, 401);
  assert.equal((await api(route, { enabled: true }, admin)).status, 200);
  assert.equal((await api('/api/auth/session', undefined, employee)).status, 401);
  employee = await api('/api/auth/login', { username: 'researcher@newnew.example', password: nextPassword });assert.equal(employee.status, 200);
});
test('reset invalidates the old password and session; temporary passwords expire after 24 hours', async () => {
  const result = await api(`/api/admin/users/${employeeId}/reset-password`, {}, admin);
  assert.equal(result.status, 200);assert.equal(result.payload.user.mustChangePassword, true);
  assert.equal((await api('/api/auth/session', undefined, employee)).status, 401);
  assert.equal((await api('/api/auth/login', { username: 'researcher@newnew.example', password: nextPassword })).status, 401);
  const temp = await api('/api/auth/login', { username: 'researcher@newnew.example', password: result.payload.temporaryPassword });assert.equal(temp.status, 200);
  app.db.prepare('UPDATE users SET temporary_expires=? WHERE id=?').run(Date.now() - 1, employeeId);
  assert.equal((await api('/api/auth/session', undefined, temp)).status, 401);
  assert.equal((await api('/api/auth/login', { username: 'researcher@newnew.example', password: result.payload.temporaryPassword })).status, 401);
});
test('logout removes the session; forged sessions and expired sessions fail', async () => {
  const signed = await api('/api/auth/login', { username: 'lab-admin', password: adminPassword });
  assert.equal((await api('/api/auth/logout', {}, signed)).status, 200);
  assert.equal((await api('/api/auth/session', undefined, signed)).status, 401);
  assert.equal((await api('/api/auth/session', undefined, { cookie: `${app.cookieName}=${token()}` })).status, 401);
  const expiry = await api('/api/auth/login', { username: 'lab-admin', password: adminPassword });
  app.db.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').run(Date.now() - 1, digest(expiry.cookie.split('=')[1]));
  assert.equal((await api('/api/auth/session', undefined, expiry)).status, 401);
});
test('login throttling persists in the database and works for non-existent usernames', async () => {
  for (let i = 0; i < 10; i++) assert.equal((await api('/api/auth/login', { username: 'does-not-exist', password: 'invalid but long enough 999' })).status, 401);
  assert.equal((await api('/api/auth/login', { username: 'does-not-exist', password: 'invalid but long enough 999' })).status, 429);
  assert.ok(app.db.prepare('SELECT count FROM rate_limits WHERE key=?').get(digest('login-user:does-not-exist')).count > 10);
});
test('account data and password verification survive server restart, setup stays closed', async () => {
  await app.close();app = await startApplication({ origin: 'http://127.0.0.1:0', port: 0, dbPath: join(directory, 'accounts.sqlite'), setupToken });
  assert.equal((await api('/api/auth/status')).payload.setupRequired, false);
  assert.equal((await api('/api/auth/login', { username: 'lab-admin', password: adminPassword })).status, 200);
  assert.equal((await api('/api/auth/login', { username: 'does-not-exist', password: 'invalid but long enough 999' })).status, 429);
});
test('production mode refuses unencrypted public origin', async () => {
  await assert.rejects(startApplication({ production: true, origin: 'http://example.com', dbPath: ':memory:', port: 0 }), /HTTPS/);
});
test('production cookies use Secure and __Host prefix behind an HTTPS reverse proxy', async () => {
  const secret = token();
  const production = await startApplication({ production: true, origin: 'https://formula.example', host: '127.0.0.1', port: 0, dbPath: ':memory:', setupToken: secret });
  try {
    const response = await new Promise((resolveResponse,reject)=>{
      const req=http.request({hostname:'127.0.0.1',port:production.server.address().port,path:'/api/auth/setup',method:'POST',headers:{Host:'formula.example',Origin:'https://formula.example','Content-Type':'application/json'}},res=>{res.resume();res.on('end',()=>resolveResponse(res));});
      req.on('error',reject);req.end(JSON.stringify({setupToken:secret,username:'secure-admin',name:'보안 검증',password:adminPassword}));
    });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['set-cookie'][0], /^__Host-formula_session=/);
    assert.match(response.headers['set-cookie'][0], /; Secure/);
    assert.match(response.headers['strict-transport-security'], /max-age=31536000/);
  } finally { await production.close(); }
});
test('administrator recovery replaces credentials and requires a password change', async () => {
  if(!app.accounts.hasAdmin())await api('/api/auth/setup',{setupToken,username:'lab-admin',name:'관리자',password:adminPassword});
  const previousApp=app;app=null;await previousApp.close();
  const output = spawnSync(process.execPath, [fileURLToPath(new URL('../recover-admin.mjs', import.meta.url))], { env: { ...process.env, DATABASE_PATH: join(directory, 'accounts.sqlite') }, encoding: 'utf8' });
  assert.equal(output.status, 0);
  const recovered = output.stdout.match(/임시 비밀번호: ([A-Za-z0-9_-]+)/)?.[1];assert.ok(recovered);
  app = await startApplication({ origin: 'http://127.0.0.1:0', port: 0, dbPath: join(directory, 'accounts.sqlite'), setupToken });
  assert.equal((await api('/api/auth/login', { username: 'lab-admin', password: adminPassword })).status, 401);
  const signed = await api('/api/auth/login', { username: 'lab-admin', password: recovered });assert.equal(signed.status, 200);assert.equal(signed.payload.user.mustChangePassword, true);
  assert.equal((await api('/admin', undefined, signed)).status, 403);
});
