const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();
const content = document.getElementById('content');
const balance = document.getElementById('balance');
const welcome = document.getElementById('welcome');
const money = cents => `$${(cents / 100).toFixed(2)}`;

const pages = {
  home: `<h2>Welcome to Earnora</h2><p>Your balance and earning activity will appear here.</p><div class="notice">Use the menu below to explore Tasks, Watch Ads, Referrals and Profile.</div>`,
  tasks: `<h2>📋 Tasks</h2><p>Available tasks will be published here.</p><div class="notice">Task rewards are added only after the task completion is verified by the server.</div>`,
  ads: `<h2>▶ Watch Ads</h2><p>Reward: <strong>$0.01</strong> per eligible completed ad.</p><div class="notice">Ad completion and early-close detection depend on the Monetag ad format and its supported completion callback. The Claim button must not award money based only on a timer or a browser return.</div><button disabled class="disabled">ADS NOT CONFIGURED YET</button>`,
  referral: `<h2>👥 Referral</h2><p>Reward: <strong>$0.10</strong> per verified referral.</p><div class="notice">A referral becomes verified after the invited user completes an eligible task. Self-referrals and duplicate rewards are blocked by the backend.</div>`,
  profile: `<h2>👤 Profile</h2><p>Minimum withdrawal: <strong>$1.00</strong></p><p>Requirement: at least 5 verified referrals.</p><div class="notice">Withdrawals are manual. Payment details and the request form will be enabled after the payout network and admin settings are configured.</div><h3>Help Center</h3><p>Support messaging will be available here.</p><h3>Official Channel</h3><p>Channel link will be added by the administrator.</p>`
};

function showPage(page) {
  content.innerHTML = pages[page] || pages.home;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
}
document.querySelectorAll('.nav-item').forEach(el => el.addEventListener('click', () => showPage(el.dataset.page)));

async function loadAccount() {
  if (!tg?.initData) {
    welcome.textContent = 'Open this Mini App inside Telegram to sign in.';
    content.innerHTML = `<h2>Open Earnora in Telegram</h2><p>Your Telegram account is required to load a real balance.</p><div class="notice">This preview does not create or credit a wallet balance.</div>`;
    return;
  }
  try {
    const response = await fetch('/api/me', { headers: { 'X-Telegram-Init-Data': tg.initData } });
    if (!response.ok) throw new Error('Account request failed');
    const data = await response.json();
    balance.textContent = money(data.user.balance_cents || 0);
    welcome.textContent = `Welcome, ${data.user.first_name || 'Earnora user'}`;
  } catch {
    welcome.textContent = 'Unable to load account. Please try again.';
  }
}
showPage('home');
loadAccount();
