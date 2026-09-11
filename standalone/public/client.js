export const $ = id => document.getElementById(id);
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let csrf = '';
export async function request(path, data) {
  const response = await fetch(path, { method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: data === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: data === undefined ? undefined : JSON.stringify(data) });
  let result;try { result = await response.json(); } catch { throw new Error('서버 연결을 확인하세요.'); }
  if (!response.ok) {
    if (response.status === 401 && !path.endsWith('/login')) location.assign('/login');
    throw new Error(result.error ?? '요청을 처리하지 못했습니다.');
  }
  if (result.csrf) csrf = result.csrf;
  return result;
}
export function showError(id, message) { $(id).textContent = message;$(id).hidden = !message; }
export function configureDialogs() {
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
}
