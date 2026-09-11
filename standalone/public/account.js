import { $, request, showError } from '/auth/client.js';
let me;
function update(user) {
  me = user;$('userSummary').textContent = `${user.name} · ${user.username} · ${user.role === 'admin' ? '관리자' : '직원'}`;
  $('mustChange').hidden = !user.mustChangePassword;
  $('workspaceLink').hidden = user.mustChangePassword;
  $('adminLink').hidden = user.role !== 'admin' || user.mustChangePassword;
}
$('changeButton').disabled = true;
try { update((await request('/api/auth/session')).user);$('changeButton').disabled = false; }
catch (error) { showError('error', error.message); }
$('passwordForm').addEventListener('submit', async event => {
  event.preventDefault();showError('error', '');$('success').hidden = true;
  if ($('newPassword').value !== $('confirmPassword').value) return showError('error', '새 비밀번호가 일치하지 않습니다.');
  $('changeButton').disabled = true;
  try {
    const result = await request('/api/auth/password', { currentPassword: $('currentPassword').value, newPassword: $('newPassword').value });
    update(result.user);$('passwordForm').reset();
    $('success').textContent = '비밀번호를 변경했습니다. 위의 ‘배합 시뮬레이터로’를 눌러 시작하세요.';$('success').hidden = false;
  } catch (error) { showError('error', error.message); }
  finally { $('changeButton').disabled = false; }
});
$('logoutButton').addEventListener('click', async () => {
  $('logoutButton').disabled = true;
  try { await request('/api/auth/logout', {});location.assign('/login'); }
  catch (error) { showError('error', error.message);$('logoutButton').disabled = false; }
});
