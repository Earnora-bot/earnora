const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();
const content = document.getElementById('content');
const balance = document.getElementById('balance');
const welcome = document.getElementById('welcome');
const money = cents => `$${(Number(cents || 0) / 100).toFixed(2)}`;
const headers = () => ({ 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tg?.initData || '' });

const pages = {
  home: `<h2>Welcome to Earnora</h2><p>Your balance and earning activity will appear here.</p><div class="notice">Use the menu below to explore Tasks, Watch Ads, Referrals and Profile.</div>`,
  tasks: `<h2>📋 Available Tasks</h2><div class="loading">Loading tasks...</div>`,
  ads: `<h2>▶ Watch Ads</h2><p>Reward: <strong>$0.01</strong> per eligible completed ad.</p><div class="notice">Ads are not enabled yet. Rewards will only be credited after Monetag confirms a completed view.</div><button disabled class="disabled">ADS NOT CONFIGURED YET</button>`,
  referral: `<h2>👥 Invite Friends</h2><p>Earn <strong>$0.05</strong> for each verified referral.</p><div id="referral-box" class="loading">Loading your referral link...</div><div class="notice">A referral is counted only after your invited friend completes their first eligible task. Self-referrals and duplicate rewards are blocked.</div>`,
  profile: `<h2>👤 Profile</h2>
    <p>Manage your Earnora account and get official updates.</p>
    <div class="profile-links">
      <a class="profile-link official-link" href="https://t.me/flash_bot_update" target="_blank" rel="noopener noreferrer"><span class="profile-link-icon">📣</span><span class="profile-link-copy"><strong>Official Channel</strong><small>@flash_bot_update</small></span><span class="profile-link-action">OPEN ↗</span></a>
      <a class="profile-link help-link" href="https://t.me/earnorav2_bot" target="_blank" rel="noopener noreferrer"><span class="profile-link-icon">🎧</span><span class="profile-link-copy"><strong>Help Center</strong><small>Contact Earnora Support</small></span><span class="profile-link-action">HELP ↗</span></a>
      <a class="profile-link payment-link" href="https://t.me/flash_bot_pay" target="_blank" rel="noopener noreferrer"><span class="profile-link-icon">🧾</span><span class="profile-link-copy"><strong>Payment Channel</strong><small>@flash_bot_pay · Payment proofs</small></span><span class="profile-link-action">VIEW ↗</span></a>
    </div>
    <h3>💸 Withdraw Funds</h3>
    <div class="withdraw-summary"><span>Minimum withdrawal</span><strong>$3.00</strong></div>
    <div class="withdraw-summary"><span>Verified referrals required</span><strong>5</strong></div>
    <div class="notice">Only Trust Wallet BEP20 addresses are accepted. Other wallets and networks are not supported. Never enter your recovery phrase or private key.</div>
    <form id="withdraw-form" class="withdraw-form">
      <label for="withdraw-amount">Amount (USD)</label><input id="withdraw-amount" name="amount" type="number" min="3" step="0.01" placeholder="3.00" required>
      <label for="withdraw-address">Trust Wallet BEP20 address</label><input id="withdraw-address" name="address" type="text" placeholder="0x..." minlength="42" maxlength="42" required>
      <button type="submit" class="primary-button">REQUEST WITHDRAWAL</button>
      <p id="withdraw-status" class="form-status" aria-live="polite"></p>
    </form>
    <p class="muted-note">Requests are reviewed manually by the Earnora admin. Your requested amount is reserved while pending.</p>`
};

let currentPage = 'home';
function showPage(page) {
  currentPage = page;
  content.innerHTML = pages[page] || pages.home;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  if (page === 'tasks') loadTasks();
  if (page === 'referral') loadReferral();
  if (page === 'profile') bindWithdrawal();
}
document.querySelectorAll('.nav-item').forEach(el => el.addEventListener('click', () => showPage(el.dataset.page)));

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed. Please try again.');
  return data;
}
async function loadAccount() {
  if (!tg?.initData) {
    welcome.textContent = 'Open this Mini App inside Telegram to sign in.';
    content.innerHTML = `<h2>Open Earnora in Telegram</h2><p>Your Telegram account is required to load a real balance.</p><div class="notice">This preview does not create or credit a wallet balance.</div>`;
    return;
  }
  try {
    const data = await api('/api/me');
    balance.textContent = money(data.user.balance_cents);
    welcome.textContent = `Welcome, ${data.user.first_name || 'Earnora user'}`;
  } catch {
    welcome.textContent = 'Unable to load account. Please try again.';
  }
}
async function loadTasks() {
  const holder = content.querySelector('.loading');
  try {
    const data = await api('/api/tasks');
    if (!data.tasks?.length) {
      holder.outerHTML = `<div class="empty-state">No tasks are available right now. Please check again later.</div>`;
      return;
    }
    holder.outerHTML = `<div class="task-list">${data.tasks.map(task => `
      <article class="task-card">
        <div class="task-top"><span class="task-tag">AVAILABLE</span><strong>+$${(task.reward_cents / 100).toFixed(2)}</strong></div>
        <h3>${escapeHtml(task.title)}</h3><p>${escapeHtml(task.description || 'Complete this task to earn a reward.')}</p>
        <a class="task-open" href="${safeUrl(task.target_url)}" target="_blank" rel="noopener noreferrer">OPEN TASK ↗</a>
        <small class="muted-note">Reward is credited only after server-side verification.</small>
      </article>`).join('')}</div>`;
  } catch (error) { holder.outerHTML = `<div class="notice">${escapeHtml(error.message)}</div>`; }
}
async function loadReferral() {
  const holder = document.getElementById('referral-box');
  try {
    const data = await api('/api/referral');
    holder.innerHTML = `<div class="referral-count"><strong>${data.verified_referrals}</strong><span>Verified referrals</span></div>
      <label for="my-referral-link">Your personal referral link</label>
      <div class="copy-row"><input id="my-referral-link" value="${escapeHtml(data.referral_link)}" readonly><button id="copy-referral" type="button" class="copy-button">COPY</button></div>
      <p id="copy-status" class="form-status" aria-live="polite"></p>`;
    document.getElementById('copy-referral').addEventListener('click', async () => {
      const link = document.getElementById('my-referral-link').value;
      try { await navigator.clipboard.writeText(link); }
      catch { document.getElementById('my-referral-link').select(); document.execCommand('copy'); }
      document.getElementById('copy-status').textContent = 'Referral link copied!';
    });
  } catch (error) { holder.outerHTML = `<div class="notice">${escapeHtml(error.message)}</div>`; }
}
function bindWithdrawal() {
  const form = document.getElementById('withdraw-form');
  form?.addEventListener('submit', async event => {
    event.preventDefault();
    const status = document.getElementById('withdraw-status');
    const button = form.querySelector('button[type="submit"]');
    const amount = Number(document.getElementById('withdraw-amount').value);
    const address = document.getElementById('withdraw-address').value.trim();
    if (!Number.isFinite(amount) || amount < 3) { status.textContent = 'Minimum withdrawal is $3.00.'; return; }
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) { status.textContent = 'Enter a valid BEP20 address starting with 0x.'; return; }
    button.disabled = true; button.textContent = 'SENDING...'; status.textContent = '';
    try {
      const data = await api('/api/withdrawals', { method: 'POST', body: JSON.stringify({ amount_cents: Math.round(amount * 100), payout_address: address }) });
      status.textContent = `Withdrawal request #${data.withdrawal_id} submitted. Amount reserved for admin review.`;
      form.reset();
      await loadAccount();
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; button.textContent = 'REQUEST WITHDRAWAL'; }
  });
}
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function safeUrl(value) { try { const u = new URL(value); return ['https:','http:'].includes(u.protocol) ? escapeHtml(u.href) : '#'; } catch { return '#'; } }
showPage('home');
loadAccount();
