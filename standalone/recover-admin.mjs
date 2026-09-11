// Run only from a trusted server terminal, with the web server stopped.
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { openDatabase, hashPassword, transaction } from './auth.mjs';
const path = process.env.DATABASE_PATH;
if (!path) { console.error('기존 계정 데이터베이스의 DATABASE_PATH를 지정하세요. 웹 서버를 먼저 중지해야 합니다.');process.exit(1); }
const db = openDatabase(resolve(path));
try {
  const admin = db.prepare("SELECT * FROM users WHERE role='admin' LIMIT 1").get();
  if (!admin) throw new Error('초기 관리자 계정이 없습니다. 초기 설정을 먼저 완료하세요.');
  const password = randomBytes(18).toString('base64url'), hash = await hashPassword(password), now = Date.now();
  transaction(db, () => {
    db.prepare('UPDATE users SET password_hash=?,must_change=1,temporary_expires=?,enabled=1,updated_at=? WHERE id=?').run(hash, now + 86400000, now, admin.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(admin.id);
    db.prepare('DELETE FROM rate_limits').run();
    db.prepare("INSERT INTO audit_events(actor_id,action,target_id,created_at) VALUES(NULL,'recover_admin',?,?)").run(admin.id, now);
  });
  console.log(`관리자 아이디: ${admin.username}\n임시 비밀번호: ${password}\n24시간 이내 로그인하고 새 비밀번호를 설정하세요.`);
} finally { db.close(); }
