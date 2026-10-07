const loginForm = document.querySelector('#login-form');
const errorBox = document.querySelector('#login-error');
const submit = document.querySelector('#login-submit');
document.querySelector('#password-toggle').addEventListener('click', event => {
  const input = document.querySelector('#login-password');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  event.currentTarget.setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
  event.currentTarget.setAttribute('aria-pressed', String(show));
  event.currentTarget.innerHTML = `<i class="fa-solid fa-eye${show ? '-slash' : ''}" aria-hidden="true"></i>`;
});
loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  errorBox.hidden = true;
  submit.disabled = true;
  submit.textContent = 'Входим…';
  try {
    const fields = new FormData(loginForm);
    const response = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: fields.get('username'), password: fields.get('password') }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Проверьте логин и пароль');
    location.replace('/#cabinet');
  } catch (error) {
    errorBox.textContent = error.message === 'Failed to fetch' ? 'Сервер недоступен. Попробуйте ещё раз.' : error.message;
    errorBox.hidden = false;
    submit.disabled = false;
    submit.innerHTML = 'Войти <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>';
  }
});
