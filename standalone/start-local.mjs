import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startApplication } from './server.mjs';
import { token } from './auth.mjs';
const major = Number(process.versions.node.split('.')[0]);
if (major !== 24) { console.error('Node.js 24 LTS를 설치한 뒤 다시 실행하세요.');process.exit(1); }
const here = dirname(fileURLToPath(import.meta.url));
const setupToken = token();
try {
  const app = await startApplication({ production: false, origin: 'http://127.0.0.1:3000', host: '127.0.0.1', port: 3000, dbPath: resolve(here, '../data/accounts.sqlite'), setupToken });
  console.log('\nNEW&NEW Formula Lab · 직원 계정 버전');
  console.log('브라우저에서 http://127.0.0.1:3000 을 여세요.');
  if (!app.accounts.hasAdmin()) {
    console.log('\n최초 관리자 설정 키 (초기 설정 화면에 입력):');
    console.log(setupToken);
    console.log('관리자 생성 후 이 키는 자동으로 폐기됩니다.');
  }
  console.log('\n프로그램을 사용하는 동안 이 창을 열어두세요. 종료: Ctrl+C\n');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close();process.exit(0); });
} catch (error) { console.error(error.code === 'EADDRINUSE' ? '3000번 포트를 다른 프로그램이 사용 중입니다. 기존 실행 창을 닫고 다시 시도하세요.' : error.message);process.exitCode = 1; }
