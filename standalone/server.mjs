import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { isIP } from 'node:net';
import { Accounts, openDatabase, HttpError, safeEqual } from './auth.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appFiles = new Map([
  ['/app.js', ['app.js', 'text/javascript']], ['/data.js', ['data.js', 'text/javascript']],
  ['/engine.js', ['engine.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']],
]);
const publicFiles = new Map([
  ['/auth/client.js', ['client.js', 'text/javascript']],
  ['/auth/accounts.css', ['accounts.css', 'text/css']],
  ['/auth/login.js', ['login.js', 'text/javascript']],
]);
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
function redirect(res, path) { res.writeHead(303, { Location: path }); res.end(); }
async function body(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? ''))
    throw new HttpError(415, 'JSON 형식으로 요청하세요.');
  let bytes = 0;const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 16384) throw new HttpError(413, '입력 내용이 너무 큽니다.');
    chunks.push(chunk);
  }
  try { const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();return result; }
  catch { throw new HttpError(400, '입력 내용을 확인하세요.'); }
}
function cookieValue(req, name) {
  const matches = (req.headers.cookie ?? '').split(';').map(x => x.trim()).filter(x => x.startsWith(`${name}=`));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : '';
}
function securityHeaders(res, secure) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}
export async function startApplication(options = {}) {
  const production = options.production ?? process.env.NODE_ENV === 'production';
  let origin = options.origin ?? process.env.PUBLIC_ORIGIN ?? (production ? '' : 'http://127.0.0.1:3000');
  let url;
  try { url = new URL(origin); } catch { throw new Error('PUBLIC_ORIGIN에 https://도메인 형식의 접속 주소를 설정하세요.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('PUBLIC_ORIGIN은 경로나 인증 정보가 없는 사이트 주소여야 합니다.');
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && (production || !loopback)) throw new Error('외부 배포는 HTTPS가 필요합니다. HTTP는 로컬 개발에서만 사용할 수 있습니다.');
  const secure = url.protocol === 'https:', cookieName = secure ? '__Host-formula_session' : 'formula_dev_session';
  const dbPath = options.dbPath ?? process.env.DATABASE_PATH ?? resolve(here, '../data/accounts.sqlite');
  if (production && !process.env.DATABASE_PATH && !options.dbPath) throw new Error('지속 저장소 경로 DATABASE_PATH를 설정하세요.');
  const db = openDatabase(dbPath);
  const setupToken = options.setupToken ?? process.env.SETUP_TOKEN;
  const accounts = await Accounts.create(db, setupToken);
  const hops = options.trustProxyHops ?? Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (!Number.isInteger(hops) || hops < 0 || hops > 5) { db.close();throw new Error('TRUST_PROXY_HOPS는 0~5의 정수여야 합니다.'); }
  function ip(req) {
    let address = req.socket.remoteAddress ?? 'unknown';
    if (hops) {
      const chain = String(req.headers['x-forwarded-for'] ?? '').split(',').map(x => x.trim()).filter(Boolean);
      if (chain.length >= hops && isIP(chain[chain.length - hops])) address = chain[chain.length - hops];
    }
    return address;
  }
  function writeSession(res, session) {
    res.setHeader('Set-Cookie', `${cookieName}=${session.raw}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.max(1, Math.floor((session.expires - Date.now()) / 1000))}${secure ? '; Secure' : ''}`);
  }
  function sessionJson(res, session) { writeSession(res, session);json(res, 200, { user: session.user, csrf: session.csrf, expiresAt: session.expires }); }
  function requireSession(req, allowTemporary = false) {
    const user = accounts.session(cookieValue(req, cookieName));
    if (!user) throw new HttpError(401, '로그인이 필요합니다.');
    if (!allowTemporary && user.must_change) throw new HttpError(403, '먼저 임시 비밀번호를 변경하세요.');
    return user;
  }
  function requireMutation(req, user) {
    if (req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site')
      throw new HttpError(403, '이 사이트에서 다시 요청하세요.');
    if (user && !safeEqual(req.headers['x-csrf-token'], user.csrf)) throw new HttpError(403, '요청이 만료되었습니다. 화면을 새로고침하세요.');
  }
  async function sendFile(req, res, path, type) {
    const data = await readFile(path);res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });res.end(req.method === 'HEAD' ? undefined : data);
  }
  const server = http.createServer({ maxHeaderSize: 16384 }, async (req, res) => {
    securityHeaders(res, secure);
    try {
      const path = new URL(req.url, origin).pathname;
      if (path === '/healthz' && req.method === 'GET') return json(res, 200, { status: 'ok' });
      if (req.headers.host !== new URL(origin).host) throw new HttpError(400, '접속 주소가 올바르지 않습니다.');
      if (!['GET', 'HEAD', 'POST'].includes(req.method)) throw new HttpError(405, '지원하지 않는 요청 방식입니다.');
      if (req.method === 'POST' && !path.startsWith('/api/')) throw new HttpError(404, '페이지를 찾을 수 없습니다.');
      if (path.startsWith('/api/')) {
        if (req.method === 'GET' && path === '/api/auth/status') return json(res, 200, { setupRequired: !accounts.hasAdmin() });
        if (req.method === 'POST' && ['/api/auth/login', '/api/auth/setup'].includes(path)) {
          requireMutation(req);
          const input = await body(req), result = path.endsWith('/setup') ? await accounts.setup(input, ip(req)) : await accounts.login(input, ip(req));
          return sessionJson(res, result);
        }
        const allowTemporary = ['/api/auth/session', '/api/auth/logout', '/api/auth/password'].includes(path);
        const user = requireSession(req, allowTemporary);
        if (req.method === 'GET' && path === '/api/auth/session') return json(res, 200, { user: accounts.publicUser(user), csrf: user.csrf, expiresAt: user.expires_at });
        if (req.method === 'GET' && path === '/api/admin/users') return json(res, 200, { users: accounts.listUsers(user) });
        if (req.method === 'POST') {
          requireMutation(req, user);const input = await body(req);
          if (path === '/api/auth/logout') {
            accounts.logout(user);res.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`);
            return json(res, 200, { ok: true });
          }
          if (path === '/api/auth/password') return sessionJson(res, await accounts.changePassword(user, input));
          if (path === '/api/admin/users') return json(res, 201, await accounts.createUser(user, input));
          const match = path.match(/^\/api\/admin\/users\/([a-f0-9-]{36})\/(reset-password|status)$/);
          if (match) return json(res, 200, match[2] === 'status' ? accounts.setEnabled(user, match[1], input.enabled) : await accounts.resetPassword(user, match[1]));
        }
        throw new HttpError(404, '기능을 찾을 수 없습니다.');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, '지원하지 않는 요청 방식입니다.');
      if (path === '/favicon.svg') return await sendFile(req, res, resolve(here, '../dist/favicon.svg'), 'image/svg+xml');
      if (publicFiles.has(path)) { const [file, type] = publicFiles.get(path);return await sendFile(req, res, resolve(here, 'public', file), type); }
      if (path === '/login' || path === '/setup') {
        const user = accounts.session(cookieValue(req, cookieName));
        if (user) return redirect(res, user.must_change ? '/account' : '/');
        if (path === '/setup' && accounts.hasAdmin()) return redirect(res, '/login');
        return await sendFile(req, res, resolve(here, 'public/login.html'), 'text/html');
      }
      const user = accounts.session(cookieValue(req, cookieName));
      if (!user) {
        if (['/', '/index.html', '/account', '/admin'].includes(path)) return redirect(res, accounts.hasAdmin() ? '/login' : '/setup');
        throw new HttpError(401, '로그인이 필요합니다.');
      }
      if (path === '/account') return await sendFile(req, res, resolve(here, 'public/account.html'), 'text/html');
      if (path === '/auth/account.js') return await sendFile(req, res, resolve(here, 'public/account.js'), 'text/javascript');
      if (user.must_change) {
        if (path === '/' || path === '/index.html') return redirect(res, '/account');
        throw new HttpError(403, '먼저 임시 비밀번호를 변경하세요.');
      }
      if (path === '/admin' || path === '/auth/admin.js') {
        accounts.requireAdmin(user);
        return await sendFile(req, res, resolve(here, 'public', path === '/admin' ? 'admin.html' : 'admin.js'), path === '/admin' ? 'text/html' : 'text/javascript');
      }
      if (path === '/auth/session.js') return await sendFile(req, res, resolve(here, 'public/session.js'), 'text/javascript');
      if (path === '/' || path === '/index.html') {
        let html = await readFile(resolve(here, '../dist/index.html'), 'utf8');
        html = html.replace('<div class="top-meta">', '<div class="top-meta"><a class="text-button" style="color:white;text-decoration:none" href="/account">내 계정</a>')
          .replace('</body>', '<script type="module" src="/auth/session.js"></script></body>')
          .replace('입력 내용은 서버에 전송하거나 자동 저장하지 않습니다.', '처방 입력값은 서버에 전송하거나 자동 저장하지 않습니다. 계정 정보는 로그인 서버에서 관리합니다.');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });return res.end(req.method === 'HEAD' ? undefined : html);
      }
      if (appFiles.has(path)) { const [file, type] = appFiles.get(path);return await sendFile(req, res, resolve(here, '../dist', file), type); }
      throw new HttpError(404, '페이지를 찾을 수 없습니다.');
    } catch (error) {
      if (res.headersSent || res.destroyed) { res.destroy();return; }
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 429) res.setHeader('Retry-After', '900');
      if (status === 500) console.error('request_failed', error?.code ?? error?.name ?? 'Error');
      json(res, status, { error: status === 500 ? '서버 요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.' : error.message });
    }
  });
  server.requestTimeout = 15000;server.headersTimeout = 10000;server.keepAliveTimeout = 5000;
  const port = options.port ?? Number(process.env.PORT ?? 3000);
  const host = options.host ?? (production ? '0.0.0.0' : '127.0.0.1');
  await new Promise((resolveListen, reject) => { server.once('error', reject);server.listen(port, host, resolveListen); });
  if (!production && url.port === '0') { url.port = String(server.address().port);origin = url.origin; } else origin = url.origin;
  return { server, accounts, db, origin, cookieName, async close() { server.closeIdleConnections();await new Promise(resolveClose => server.close(resolveClose));db.close(); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startApplication().then(app => {
    console.log(`Formula Lab account server ready: ${app.origin}`);
    if (!app.accounts.hasAdmin()) console.log('초기 관리자를 설정하려면 /setup을 열어 서버에 설정한 초기 설정 키를 입력하세요.');
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await app.close();process.exit(0); });
  }).catch(error => { console.error(error.message);process.exitCode = 1; });
}
