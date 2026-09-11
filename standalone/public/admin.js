import { $, request, showError, escapeHtml as esc, configureDialogs } from '/auth/client.js';
let users = [], pending, issued;
configureDialogs();
const time = value => value ? new Date(value).toLocaleString('ko-KR') : '로그인 기록 없음';
async function loadUsers() {
  users = (await request('/api/admin/users')).users;
  $('userRows').innerHTML = users.map(u => `<tr><td><strong>${esc(u.name)}</strong></td><td>${esc(u.username)}</td><td><span class="badge ${u.role === 'admin' ? 'admin' : ''}">${u.role === 'admin' ? '관리자' : '직원'}</span></td><td><span class="badge ${!u.enabled ? 'disabled' : u.mustChangePassword ? 'pending' : 'active'}">${!u.enabled ? '중지됨' : u.mustChangePassword ? '첫 비밀번호 설정 대기' : '사용 중'}</span></td><td class="date">${esc(time(u.lastLogin))}</td><td>${u.role === 'admin' ? '<span class="muted">내 계정에서 관리</span>' : `<div class="row-actions"><button class="btn small" data-action="reset" data-id="${esc(u.id)}">비밀번호 초기화</button><button class="btn small ${u.enabled ? 'danger' : ''}" data-action="status" data-id="${esc(u.id)}">${u.enabled ? '사용 중지' : '사용 허용'}</button></div>`}</td></tr>`).join('');
}
try { const session = await request('/api/auth/session');if (session.user.role !== 'admin') location.replace('/account');else await loadUsers(); }
catch (error) { showError('message', error.message); }
$('addEmployee').addEventListener('click', () => { $('createForm').reset();showError('createError', '');$('createDialog').showModal(); });
function showCredentials(result) {
  issued = result;$('credentialUser').textContent = `${result.user.name} · ${result.user.username}`;
  $('temporaryPassword').value = result.temporaryPassword;$('credentialExpiry').textContent = `유효 기간: ${time(result.expiresAt)}까지`;
  $('copyCredentials').textContent = '로그인 안내 복사';$('credentialDialog').showModal();
}
$('createForm').addEventListener('submit', async event => {
  event.preventDefault();$('createButton').disabled = true;showError('createError', '');
  try {
    const result = await request('/api/admin/users', { name: $('employeeName').value, username: $('employeeUsername').value });
    $('createDialog').close();showCredentials(result);await loadUsers();
  } catch (error) { showError('createError', error.message); }
  finally { $('createButton').disabled = false; }
});
$('credentialDialog').addEventListener('close', () => { issued = null;$('temporaryPassword').value = ''; });
$('copyCredentials').addEventListener('click', async () => {
  if (!issued) return;
  const text = `NEW&NEW Formula Lab 로그인 안내\n접속 주소: ${location.origin}/login\n아이디: ${issued.user.username}\n임시 비밀번호: ${issued.temporaryPassword}\n유효 기간: ${time(issued.expiresAt)}\n첫 로그인 후 새 비밀번호를 설정해 주세요.`;
  try { await navigator.clipboard.writeText(text);$('copyCredentials').textContent = '복사했습니다'; }
  catch { $('temporaryPassword').focus();$('temporaryPassword').select();$('copyCredentials').textContent = '비밀번호를 선택했습니다. 직접 복사해 주세요.'; }
});
$('userRows').addEventListener('click', event => {
  const button = event.target.closest('[data-action]');if (!button) return;
  const u = users.find(x => x.id === button.dataset.id);if (!u) return;
  const reset = button.dataset.action === 'reset';
  $('confirmTitle').textContent = reset ? '임시 비밀번호를 새로 발급할까요?' : u.enabled ? '계정 사용을 중지할까요?' : '계정 사용을 허용할까요?';
  $('confirmText').textContent = `${u.name} (${u.username})${reset ? '의 기존 비밀번호가 더 이상 작동하지 않고 모든 로그인이 해제됩니다.' : u.enabled ? '의 모든 로그인이 해제되고 다시 로그인할 수 없게 됩니다.' : '이 다시 로그인할 수 있습니다. 임시 비밀번호가 만료됐다면 초기화도 진행하세요.'}`;
  pending = { id: u.id, action: reset ? 'reset-password' : 'status', data: reset ? {} : { enabled: !u.enabled } };
  $('confirmDialog').showModal();
});
$('confirmAction').addEventListener('click', async () => {
  if (!pending) return;$('confirmAction').disabled = true;
  try {
    const item = pending, result = await request(`/api/admin/users/${item.id}/${item.action}`, item.data);
    $('confirmDialog').close();if (item.action === 'reset-password') showCredentials(result);else showError('message', '계정 상태를 변경했습니다.');
    await loadUsers();
  } catch (error) { $('confirmDialog').close();showError('message', error.message); }
  finally { pending = null;$('confirmAction').disabled = false; }
});
