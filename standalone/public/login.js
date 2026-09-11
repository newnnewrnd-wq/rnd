import { $, request, showError } from '/auth/client.js';
let setup = false, ready = false;
$('submitButton').disabled = true;
try {
  const status = await request('/api/auth/status');setup = status.setupRequired;
  if (setup) {
    document.title = '최초 관리자 설정 · NEW&NEW Formula Lab';
    $('loginTitle').textContent = '최초 관리자 설정';
    $('loginDescription').textContent = '관리자 계정을 만든 뒤 직원 계정을 발급할 수 있습니다.';
    $('setupFields').hidden = false;$('setupToken').required = true;$('name').required = true;
    $('password').minLength = 15;$('password').autocomplete = 'new-password';
    $('passwordHint').hidden = false;$('submitButton').textContent = '관리자 계정 만들기';$('forgotHint').hidden = true;
  }
  ready = true;$('submitButton').disabled = false;
} catch (error) { showError('error', error.message); }
$('showPassword').addEventListener('click', () => {
  const visible = $('password').type === 'password';$('password').type = visible ? 'text' : 'password';
  $('showPassword').textContent = visible ? '숨김' : '표시';$('showPassword').setAttribute('aria-label', visible ? '비밀번호 숨기기' : '비밀번호 표시');
});
$('loginForm').addEventListener('submit', async event => {
  event.preventDefault();if (!ready) return;
  showError('error', '');$('submitButton').disabled = true;
  try {
    const input = { username: $('username').value, password: $('password').value };
    if (setup) { input.setupToken = $('setupToken').value;input.name = $('name').value; }
    const result = await request(setup ? '/api/auth/setup' : '/api/auth/login', input);
    $('password').value = '';$('setupToken').value = '';
    location.assign(result.user.mustChangePassword ? '/account' : setup ? '/admin' : '/');
  } catch (error) { showError('error', error.message);$('submitButton').disabled = false; }
});
