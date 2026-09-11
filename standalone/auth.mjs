import { DatabaseSync } from 'node:sqlite';
import { scrypt, randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

const derive = promisify(scrypt);
const KDF = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const SESSION_MS = 8 * 60 * 60 * 1000;
const TEMP_SESSION_MS = 20 * 60 * 1000;
const TEMP_PASSWORD_MS = 24 * 60 * 60 * 1000;
export const digest = text => createHash('sha256').update(text).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function username(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._@+\-]{2,79}$/.test(value.trim()))
    throw new HttpError(400, '아이디는 영문·숫자·이메일 형식으로 3~80자 입력하세요.');
  return value.trim().toLowerCase();
}
export function displayName(value) {
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 60 || /[\u0000-\u001f]/.test(value))
    throw new HttpError(400, '이름은 1~60자로 입력하세요.');
  return value.trim();
}
export function validatePassword(value, login = '') {
  if (typeof value !== 'string' || Array.from(value).length < 15 || Array.from(value).length > 128 || /[\u0000-\u001f]/.test(value))
    throw new HttpError(400, '비밀번호는 15~128자로 입력하세요. 공백을 포함한 문장도 사용할 수 있습니다.');
  if (/^(.)\1+$/.test(value) || value.toLowerCase().includes(login.toLowerCase()) && login.length >= 3)
    throw new HttpError(400, '아이디나 한 글자의 반복 대신 다른 비밀번호를 사용하세요.');
  const blocked = ['passwordpassword', '123456789012345', '1234567890123456', 'qwertyuiopasdfgh', 'newnewnewnewnewnew'];
  if (blocked.includes(value.toLowerCase())) throw new HttpError(400, '쉽게 추측할 수 있는 비밀번호입니다. 다른 비밀번호를 사용하세요.');
  return value;
}
let busy = 0;
async function hashBytes(password, salt) {
  if (busy >= 4) throw new HttpError(503, '로그인 요청이 많습니다. 잠시 후 다시 시도하세요.');
  busy++;
  try { return await derive(password, salt, 64, KDF); } finally { busy--; }
}
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await hashBytes(password, salt);
  return `scrypt-v1$${salt}$${hash.toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 512) return false;
  const [version, salt, expected] = String(encoded).split('$');
  if (version !== 'scrypt-v1' || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(expected)) return false;
  const result = await hashBytes(password, salt);
  return timingSafeEqual(result, Buffer.from(expected, 'hex'));
}
export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  if (path !== ':memory:') chmodSync(path, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','employee')),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
      must_change INTEGER NOT NULL DEFAULT 0, temporary_expires INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_login INTEGER
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_events (id INTEGER PRIMARY KEY, actor_id TEXT, action TEXT NOT NULL, target_id TEXT, created_at INTEGER NOT NULL);
  `);
  return db;
}
export function transaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = operation(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
export class Accounts {
  constructor(db, dummyHash) { this.db = db; this.dummyHash = dummyHash; this.lastCleanup = 0; }
  static async create(db, setupToken) {
    const a = new Accounts(db, await hashPassword(token()));
    if (setupToken && typeof setupToken === 'string' && setupToken.length >= 32 && setupToken.length <= 256 && !a.hasAdmin())
      db.prepare("INSERT INTO settings(key,value) VALUES('setup_hash',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(digest(setupToken));
    return a;
  }
  hasAdmin() { return Boolean(this.db.prepare("SELECT 1 FROM users WHERE role='admin' LIMIT 1").get()); }
  audit(actor, action, target = null) { this.db.prepare('INSERT INTO audit_events(actor_id,action,target_id,created_at) VALUES(?,?,?,?)').run(actor, action, target, Date.now()); }
  publicUser(user) { return { id: user.id, username: user.username, name: user.name, role: user.role, enabled: !!user.enabled, mustChangePassword: !!user.must_change, createdAt: user.created_at, lastLogin: user.last_login }; }
  rateLimit(key, limit, windowMs = 15 * 60 * 1000) {
    const now = Date.now();
    if (now - this.lastCleanup > 60000) {
      this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
      this.db.prepare('DELETE FROM rate_limits WHERE expires_at < ?').run(now);
      this.lastCleanup = now;
    }
    const id = digest(key);
    this.db.prepare(`INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?)
      ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,
      expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END`).run(id, now + windowMs, now, now);
    if (this.db.prepare('SELECT count FROM rate_limits WHERE key=?').get(id).count > limit)
      throw new HttpError(429, '시도 횟수를 초과했습니다. 15분 후 다시 시도하세요.');
  }
  clearUserRate(login) { this.db.prepare('DELETE FROM rate_limits WHERE key=?').run(digest(`login-user:${login}`)); }
  issueSession(user) {
    const raw = token(), now = Date.now(), expires = now + (user.must_change ? TEMP_SESSION_MS : SESSION_MS);
    const csrf = token();
    // Keep at most five concurrent sessions for one account.
    this.db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 4)').run(user.id, user.id);
    this.db.prepare('INSERT INTO sessions(token_hash,user_id,csrf,expires_at,created_at) VALUES(?,?,?,?,?)').run(digest(raw), user.id, csrf, expires, now);
    return { raw, csrf, expires, user: this.publicUser(user) };
  }
  session(raw) {
    if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
    const row = this.db.prepare(`SELECT u.*,s.csrf,s.expires_at,s.token_hash FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>? AND u.enabled=1`).get(digest(raw), Date.now());
    if (!row || row.must_change && row.temporary_expires <= Date.now()) return null;
    return row;
  }
  async setup(input, ip) {
    this.rateLimit(`setup:${ip}`, 8);
    if (this.hasAdmin()) throw new HttpError(409, '초기 관리자 설정이 이미 완료되었습니다.');
    const known = this.db.prepare("SELECT value FROM settings WHERE key='setup_hash'").get()?.value;
    if (!known) throw new HttpError(503, '서버의 초기 설정 키가 준비되지 않았습니다. 설치 담당자에게 문의하세요.');
    if (typeof input.setupToken !== 'string' || !safeEqual(digest(input.setupToken), known)) throw new HttpError(403, '초기 설정 키가 올바르지 않습니다.');
    const login = username(input.username), name = displayName(input.name);
    const password = validatePassword(input.password, login), passwordHash = await hashPassword(password);
    return transaction(this.db, () => {
      if (this.hasAdmin() || this.db.prepare("SELECT value FROM settings WHERE key='setup_hash'").get()?.value !== known)
        throw new HttpError(409, '초기 설정 상태가 바뀌었습니다. 로그인 화면을 열어주세요.');
      const id = randomUUID(), now = Date.now();
      this.db.prepare("INSERT INTO users(id,username,name,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,'admin',?,?)").run(id, login, name, passwordHash, now, now);
      this.db.prepare("DELETE FROM settings WHERE key='setup_hash'").run();
      this.audit(id, 'setup_admin', id);
      return this.issueSession(this.db.prepare('SELECT * FROM users WHERE id=?').get(id));
    });
  }
  async login(input, ip) {
    this.rateLimit(`login-ip:${ip}`, 120);
    const login = username(input.username);
    this.rateLimit(`login-user:${login}`, 10);
    const snapshot = this.db.prepare('SELECT * FROM users WHERE username=?').get(login);
    const correct = await verifyPassword(input.password, snapshot?.password_hash ?? this.dummyHash);
    const user = snapshot ? this.db.prepare('SELECT * FROM users WHERE id=?').get(snapshot.id) : null;
    if (!correct || !user?.enabled || user.password_hash !== snapshot.password_hash || user.must_change && user.temporary_expires <= Date.now())
      throw new HttpError(401, '아이디 또는 비밀번호를 확인하세요. 임시 비밀번호가 만료된 경우 관리자에게 문의하세요.');
    this.clearUserRate(login);
    this.db.prepare('UPDATE users SET last_login=? WHERE id=?').run(Date.now(), user.id);
    this.audit(user.id, 'login', user.id);
    return this.issueSession(user);
  }
  logout(user) { this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(user.token_hash); this.audit(user.id, 'logout'); }
  async changePassword(user, input) {
    this.rateLimit(`password:${user.id}`, 10);
    if (!await verifyPassword(input.currentPassword, user.password_hash)) throw new HttpError(400, '현재 비밀번호가 올바르지 않습니다.');
    const next = validatePassword(input.newPassword, user.username);
    if (safeEqual(next, input.currentPassword)) throw new HttpError(400, '현재와 다른 새 비밀번호를 입력하세요.');
    const hash = await hashPassword(next);
    return transaction(this.db, () => {
      const result = this.db.prepare('UPDATE users SET password_hash=?,must_change=0,temporary_expires=NULL,updated_at=? WHERE id=? AND password_hash=? AND enabled=1').run(hash, Date.now(), user.id, user.password_hash);
      if (!result.changes) throw new HttpError(409, '계정 상태가 바뀌었습니다. 다시 로그인하세요.');
      this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      this.clearUserRate(user.username);this.audit(user.id, 'change_password', user.id);
      return this.issueSession(this.db.prepare('SELECT * FROM users WHERE id=?').get(user.id));
    });
  }
  requireAdmin(user) {
    const current = this.db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    if (!current?.enabled || current.role !== 'admin' || current.must_change || current.password_hash !== user.password_hash)
      throw new HttpError(403, '관리자만 사용할 수 있습니다.');
  }
  listUsers(user) { this.requireAdmin(user); return this.db.prepare('SELECT * FROM users ORDER BY created_at ASC').all().map(u => this.publicUser(u)); }
  async createUser(user, input) {
    this.requireAdmin(user);this.rateLimit(`admin:${user.id}`, 80);
    const login = username(input.username), name = displayName(input.name), temporaryPassword = randomBytes(18).toString('base64url');
    const hash = await hashPassword(temporaryPassword);
    return transaction(this.db, () => {
      this.requireAdmin(user);
      if (this.db.prepare('SELECT 1 FROM users WHERE username=?').get(login)) throw new HttpError(409, '이미 등록된 아이디입니다.');
      const now = Date.now(), id = randomUUID(), expires = now + TEMP_PASSWORD_MS;
      this.db.prepare("INSERT INTO users(id,username,name,password_hash,role,must_change,temporary_expires,created_at,updated_at) VALUES(?,?,?,?,'employee',1,?,?,?)").run(id, login, name, hash, expires, now, now);
      this.audit(user.id, 'create_employee', id);
      return { user: this.publicUser(this.db.prepare('SELECT * FROM users WHERE id=?').get(id)), temporaryPassword, expiresAt: expires };
    });
  }
  async resetPassword(user, id) {
    this.requireAdmin(user);this.rateLimit(`admin:${user.id}`, 80);
    const temporaryPassword = randomBytes(18).toString('base64url'), hash = await hashPassword(temporaryPassword);
    return transaction(this.db, () => {
      this.requireAdmin(user);
      const target = this.db.prepare('SELECT * FROM users WHERE id=?').get(id);
      if (!target || target.role === 'admin') throw new HttpError(400, '직원 계정만 초기화할 수 있습니다.');
      const expires = Date.now() + TEMP_PASSWORD_MS;
      this.db.prepare('UPDATE users SET password_hash=?,must_change=1,temporary_expires=?,updated_at=? WHERE id=?').run(hash, expires, Date.now(), id);
      this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);this.clearUserRate(target.username);this.audit(user.id, 'reset_employee_password', id);
      return { user: this.publicUser(this.db.prepare('SELECT * FROM users WHERE id=?').get(id)), temporaryPassword, expiresAt: expires };
    });
  }
  setEnabled(user, id, enabled) {
    this.requireAdmin(user);
    if (typeof enabled !== 'boolean') throw new HttpError(400, '계정 상태 값이 올바르지 않습니다.');
    const target = this.db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if (!target || target.role === 'admin') throw new HttpError(400, '직원 계정만 변경할 수 있습니다.');
    return transaction(this.db, () => {
      this.db.prepare('UPDATE users SET enabled=?,updated_at=? WHERE id=?').run(enabled ? 1 : 0, Date.now(), id);
      this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);this.clearUserRate(target.username);
      this.audit(user.id, enabled ? 'enable_employee' : 'disable_employee', id);
      return { enabled };
    });
  }
}
