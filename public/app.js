
const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const content = document.getElementById("content");
const balance = document.getElementById("balance");
const welcome = document.getElementById("welcome");
const TASK_POST_WALLET = "0x52824938de138886fdf6f7a80262e5c0a173d92c";

const money = cents => `$${(Number(cents || 0) / 100).toFixed(2)}`;
const headers = () => ({
  "Content-Type": "application/json",
  "X-Telegram-Init-Data": tg?.initData || ""
});

const pages = {
  home: `<h2>Welcome to Earnora</h2>
    <p>Your balance and earning activity will appear here.</p>
    <div class="notice">Use the menu below to explore Tasks, Watch Ads, Referrals and Profile.</div>`,
  tasks: `<h2>📋 Tasks</h2>
    <button id="show-post-task" class="post-task-toggle" type="button">＋ POST A TASK <span>$1.00 USDT</span></button>
    <div id="post-task-area"></div>
    <div class="task-tabs"><button type="button" class="task-tab active" data-task-tab="available">AVAILABLE TASKS</button><button type="button" class="task-tab" data-task-tab="completed">COMPLETED TASKS</button></div>
    <div id="task-results" class="loading">Loading tasks...</div>`,
  ads: `<h2>▶ Watch Ads</h2>
    <p>Reward: <strong>$0.01</strong> per Monetag-confirmed valued impression.</p>
    <div class="notice">Maximum 100 ad attempts per day. Rewards are credited only after Monetag's server confirms a valued impression.</div>
    <button id="watch-ad" class="primary-button">WATCH AD · EARN $0.01</button>
    <p id="ad-status" class="form-status" aria-live="polite"></p>
    <div id="ad-claim-area"></div>`,
  support: `<h2>🎧 Earnora Help Center</h2>
    <p>Send a message directly to Earnora support.</p>
    <form id="support-form" class="withdraw-form">
      <label for="support-message">Your message</label>
      <textarea id="support-message" rows="5" maxlength="2000" required placeholder="Describe how we can help (5–2000 characters)"></textarea>
      <button type="submit" class="primary-button">SEND MESSAGE</button>
      <p id="support-status" class="form-status" aria-live="polite"></p>
    </form>` ,
  referral: `<h2>👥 Invite Friends</h2>
    <p>Earn <strong>$0.05</strong> for each verified referral.</p>
    <div id="referral-box" class="loading">Loading your referral link...</div>
    <div class="notice">A referral is counted only after your invited friend completes their first eligible verified task. Self-referrals and duplicate rewards are blocked.</div>`,
  profile: `<h2>👤 Profile</h2>
    <p>Manage your Earnora account and get official updates.</p>
    <div class="profile-links">
      <a class="profile-link official-link" href="https://t.me/flash_bot_update" target="_blank" rel="noopener noreferrer"><span class="profile-link-icon">📣</span><span class="profile-link-copy"><strong>Official Channel</strong><small>@flash_bot_update</small></span><span class="profile-link-action">OPEN ↗</span></a>
      <a class="profile-link help-link" href="#support" id="open-support"><span class="profile-link-icon">🎧</span><span class="profile-link-copy"><strong>Help Center</strong><small>Contact Earnora Support</small></span><span class="profile-link-action">HELP ↗</span></a>
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
    <p class="muted-note">Requests are reviewed manually by the Earnora admin. The requested amount is deducted from your available balance while pending.</p>`
};

function showPage(page) {
  content.innerHTML = pages[page] || pages.home;
  document.querySelectorAll(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.page === page));
  if (page === "tasks") { bindTaskPosting(); loadTasks(); }
  if (page === "referral") loadReferral();
  if (page === "ads") bindWatchAds();
  if (page === "profile") {
    bindWithdrawal();
    const help = document.getElementById("open-support");
    help?.addEventListener("click", event => { event.preventDefault(); showPage("support"); });
  }
  if (page === "support") bindSupportForm();
}
document.querySelectorAll(".nav-item").forEach(el => el.addEventListener("click", () => showPage(el.dataset.page)));

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed. Please try again.");
  return data;
}

async function loadAccount() {
  if (!tg?.initData) {
    welcome.textContent = "Open this Mini App inside Telegram to sign in.";
    content.innerHTML = `<h2>Open Earnora in Telegram</h2><p>Your Telegram account is required to load a real balance.</p><div class="notice">This preview does not create or credit a wallet balance.</div>`;
    return;
  }
  try {
    const data = await api("/api/me");
    balance.textContent = money(data.user.balance_cents);
    welcome.textContent = `Welcome, ${data.user.first_name || "Earnora user"}`;
  } catch { welcome.textContent = "Unable to load account. Please try again."; }
}

function bindTaskPosting() {
  const toggle = document.getElementById("show-post-task");
  const area = document.getElementById("post-task-area");
  if (!toggle || !area) return;
  toggle.addEventListener("click", () => {
    if (area.innerHTML) { area.innerHTML = ""; return; }
    area.innerHTML = `
      <form id="post-task-form" class="post-task-form">
        <h3>Post a new task</h3>
        <div class="notice">Pay exactly <strong>$1.00 USDT</strong> on BNB Smart Chain (BEP20) to the wallet below. Then enter your transaction hash. Admin checks every payment manually; your task is NOT activated just by submitting a TxHash.</div>
        <label for="post-title">Task Title</label><input id="post-title" maxlength="100" required placeholder="Enter task title">
        <label for="post-description">Description</label><textarea id="post-description" maxlength="1000" rows="3" placeholder="Explain what users must do"></textarea>
        <label for="post-url">Task URL</label><input id="post-url" type="url" required placeholder="https://...">
        <label>Payment network</label><input value="BNB Smart Chain · USDT BEP20 · $1.00" readonly>
        <label>Send USDT to this wallet</label>
        <div class="wallet-copy-row"><input id="post-wallet" value="${TASK_POST_WALLET}" readonly><button id="copy-post-wallet" type="button" class="copy-button">COPY</button></div>
        <label for="post-txhash">Transaction Hash (TxHash)</label><input id="post-txhash" required placeholder="Paste your TxHash (with or without 0x)" autocomplete="off" spellcheck="false">
        <button type="submit" class="primary-button">SEND TO ADMIN</button>
        <p id="post-task-status" class="form-status" aria-live="polite"></p>
        <p class="muted-note">Do not send funds on another network or token. Never share your wallet recovery phrase or private key. Payment is subject to manual verification.</p>
      </form>`;
    document.getElementById("copy-post-wallet").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(TASK_POST_WALLET); }
      catch { const input = document.getElementById("post-wallet"); input.select(); document.execCommand("copy"); }
      document.getElementById("post-task-status").textContent = "Wallet address copied.";
    });
    document.getElementById("post-task-form").addEventListener("submit", submitTaskPost);
  });
}

async function submitTaskPost(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const status = document.getElementById("post-task-status");

  // Accept a TxHash with or without the 0x prefix.
  const enteredHash = document.getElementById("post-txhash").value.trim();
  const cleanHash = enteredHash.replace(/^0x/i, "");

  // A standard transaction hash contains exactly 64 hexadecimal characters.
  if (!/^[a-fA-F0-9]{64}$/.test(cleanHash)) {
    status.textContent = "Enter a valid transaction hash containing 64 hexadecimal characters. You may include or omit 0x.";
    return;
  }

  // Add 0x automatically if the user entered the hash without it.
  const txHash = "0x" + cleanHash;

  button.disabled = true;
  button.textContent = "SENDING...";
  status.textContent = "";

  try {
    const result = await api("/api/task-post-requests", {
      method: "POST",
      body: JSON.stringify({
        title: document.getElementById("post-title").value.trim(),
        description: document.getElementById("post-description").value.trim(),
        target_url: document.getElementById("post-url").value.trim(),
        tx_hash: txHash,
        task_type: "manual"
      })
    });
    status.textContent = `Request #${result.request_id} submitted. ${result.message}`;
    form.reset();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "SEND TO ADMIN";
  }
}

async function loadTasks() {
  const holder = document.getElementById("task-results");
  if (!holder) return;
  try {
    const data = await api("/api/tasks");
    const tasks = data.tasks || [];
    if (!tasks.length) { holder.innerHTML = `<div class="empty-state">No tasks are available right now. Please check again later.</div>`; return; }
    const cards = tasks.map(task => {
      const status = task.task_status || "available";
      let action = "";
      if (task.claimed) action = `<button class="primary-button" disabled>✓ COMPLETED · REWARD CREDITED</button>`;
      else if (status === "verified") action = `<button class="primary-button task-claim" data-task-id="${Number(task.id)}">CLAIM ${money(task.reward_cents)}</button>`;
      else if (status === "pending") action = `<button class="primary-button" disabled>WAITING FOR REVIEW</button>`;
      else if (status === "rejected") action = `<button class="primary-button" disabled>REJECTED · CONTACT SUPPORT</button>`;
      else if (task.task_type === "telegram_join") action = `<button class="primary-button task-verify" data-task-id="${Number(task.id)}">VERIFY JOIN</button>`;
      else action = `<button class="primary-button task-submit" data-task-id="${Number(task.id)}">SUBMIT FOR VERIFICATION</button>`;
      const tag = task.claimed ? "COMPLETED" : status === "verified" ? "VERIFIED" : status === "pending" ? "PENDING" : status === "rejected" ? "REJECTED" : "AVAILABLE";
      const group = task.claimed ? "completed" : "available";
      const note = task.claimed ? "Reward has been added to your balance." : task.task_type === "telegram_join" ? "Join the channel/group, then verify. Eligible rewards are credited automatically." : "Reward is credited after admin verification and claiming.";
      return `<article class="task-card" data-task-group="${group}"><div class="task-top"><span class="task-tag">${tag}</span><strong>+${money(task.reward_cents)}</strong></div><h3>${escapeHtml(task.title)}</h3><p>${escapeHtml(task.description || "Complete this task to earn a reward.")}</p><a class="task-open" href="${safeUrl(task.target_url)}" target="_blank" rel="noopener noreferrer">OPEN TASK ↗</a>${action}<small class="muted-note">${note}</small><p class="form-status task-status" aria-live="polite"></p></article>`;
    }).join("");
    holder.innerHTML = `<div class="task-list">${cards}</div>`;
    const tabs = content.querySelectorAll(".task-tab");
    const filterTasks = group => {
      tabs.forEach(tab => tab.classList.toggle("active", tab.dataset.taskTab === group));
      holder.querySelectorAll(".task-card").forEach(card => { card.hidden = card.dataset.taskGroup !== group; });
      const visible = [...holder.querySelectorAll(".task-card")].some(card => !card.hidden);
      let empty = holder.querySelector(".task-filter-empty");
      if (!visible && !empty) { empty = document.createElement("div"); empty.className = "empty-state task-filter-empty"; empty.textContent = group === "completed" ? "You have no completed tasks yet." : "No available tasks right now."; holder.appendChild(empty); }
      if (visible && empty) empty.remove();
    };
    tabs.forEach(tab => tab.addEventListener("click", () => filterTasks(tab.dataset.taskTab)));
    filterTasks("available");
    content.querySelectorAll(".task-submit").forEach(button => button.addEventListener("click", () => submitTaskAction(button, "/api/tasks/complete")));
    content.querySelectorAll(".task-verify").forEach(button => button.addEventListener("click", () => submitTaskAction(button, "/api/tasks/verify")));
    content.querySelectorAll(".task-claim").forEach(button => button.addEventListener("click", () => submitTaskAction(button, "/api/tasks/claim")));
  } catch (error) { holder.innerHTML = `<div class="notice">${escapeHtml(error.message)}</div>`; }
}

async function submitTaskAction(button, path) {
  const card = button.closest(".task-card");
  const status = card.querySelector(".task-status");
  const taskId = Number(button.dataset.taskId);
  button.disabled = true; button.textContent = "PLEASE WAIT..."; status.textContent = "";
  try {
    const result = await api(path, { method: "POST", body: JSON.stringify({ task_id: taskId }) });
    if (path === "/api/tasks/claim") {
      status.textContent = `Reward ${money(result.reward_cents)} credited to your balance.`;
      await loadAccount();
    } else if (path === "/api/tasks/verify" && result.status === "verified") {
      status.textContent = result.claimed ? `Membership verified. ${money(result.reward_cents)} was automatically credited!` : "Membership verified.";
    } else status.textContent = result.status === "verified" ? "Already verified. Claim your reward." : "Submitted. Waiting for admin verification.";
    await loadTasks();
  } catch (error) { button.disabled = false; button.textContent = path.endsWith("claim") ? "CLAIM REWARD" : path.endsWith("verify") ? "VERIFY JOIN" : "SUBMIT FOR VERIFICATION"; status.textContent = error.message; }
}

async function bindSupportForm() {
  const form = document.getElementById("support-form");
  if (!form) return;
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const status = document.getElementById("support-status");
    const message = document.getElementById("support-message").value.trim();
    button.disabled = true;
    button.textContent = "SENDING...";
    status.textContent = "";
    try {
      const result = await api("/api/support", { method: "POST", body: JSON.stringify({ message }) });
      status.textContent = `${result.message} Reference #${result.support_id || "saved"}.`;
      form.reset();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = "SEND MESSAGE";
    }
  });
}

function bindWatchAds() {
  const button = document.getElementById("watch-ad");
  if (!button) return;
  button.addEventListener("click", startWatchAd);
}

async function startWatchAd() {
  const button = document.getElementById("watch-ad");
  const status = document.getElementById("ad-status");
  const claimArea = document.getElementById("ad-claim-area");
  if (!button || !status) return;
  const showAd = window["show_12181637"];
  if (typeof showAd !== "function") {
    status.textContent = "Monetag is still loading. Please wait a moment and try again.";
    return;
  }

  button.disabled = true;
  button.textContent = "PREPARING AD...";
  status.textContent = "";
  claimArea.innerHTML = "";
  let ymid = "";
  try {
    const started = await api("/api/monetag/start", { method: "POST", body: "{}" });
    ymid = started.ymid;
    button.textContent = "AD IN PROGRESS...";
    const result = await showAd({ type: "end", ymid, requestVar: "watch_ads" });
    if (result?.reward_event_type === "non_valued") {
      status.textContent = "Monetag marked this ad as non-valued. No reward is available.";
    } else {
      status.textContent = "Ad finished. Waiting for Monetag's server confirmation...";
      await pollMonetagStatus(ymid, 15);
    }
  } catch (error) {
    status.textContent = error.message || "The ad could not be completed. No reward has been added.";
    if (ymid) {
      claimArea.innerHTML = `<button id="check-ad-status" class="copy-button" type="button">CHECK REWARD STATUS</button>`;
      document.getElementById("check-ad-status")?.addEventListener("click", () => pollMonetagStatus(ymid, 5));
    }
  } finally {
    button.disabled = false;
    button.textContent = "WATCH AD · EARN $0.01";
  }
}

async function pollMonetagStatus(ymid, attempts) {
  const status = document.getElementById("ad-status");
  const claimArea = document.getElementById("ad-claim-area");
  if (!status || !claimArea) return;
  for (let i = 0; i < attempts; i++) {
    try {
      const result = await api(`/api/monetag/status?ymid=${encodeURIComponent(ymid)}`);
      if (result.status === "verified") {
        status.textContent = "Monetag confirmed your valued ad view. Claim your $0.01 reward below.";
        claimArea.innerHTML = `<button id="claim-ad" class="primary-button">CLAIM REWARD · $0.01</button>`;
        document.getElementById("claim-ad")?.addEventListener("click", () => claimMonetagReward(ymid));
        return;
      }
      if (result.status === "rejected") {
        status.textContent = "This ad was not valued by Monetag. No reward is available.";
        claimArea.innerHTML = "";
        return;
      }
    } catch (error) {
      status.textContent = error.message;
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  status.textContent = "Confirmation is still pending. You can check again shortly.";
  claimArea.innerHTML = `<button id="check-ad-status" class="copy-button" type="button">CHECK REWARD STATUS</button>`;
  document.getElementById("check-ad-status")?.addEventListener("click", () => pollMonetagStatus(ymid, 10));
}

async function claimMonetagReward(ymid) {
  const button = document.getElementById("claim-ad");
  const status = document.getElementById("ad-status");
  if (button) { button.disabled = true; button.textContent = "CLAIMING..."; }
  try {
    const result = await api("/api/monetag/claim", {
      method: "POST", body: JSON.stringify({ ymid })
    });
    status.textContent = `Your ${money(result.reward_cents)} ad reward has been credited.`;
    document.getElementById("ad-claim-area").innerHTML = "";
    await loadAccount();
  } catch (error) {
    status.textContent = error.message;
    if (button) { button.disabled = false; button.textContent = "CLAIM REWARD · $0.01"; }
  }
}

async function loadReferral() {
  const holder = document.getElementById("referral-box");
  if (!holder) return;
  try {
    const data = await api("/api/referral");
    holder.innerHTML = `<div class="referral-count"><strong>${Number(data.verified_referrals || 0)}</strong><span>Verified referrals</span></div><label for="my-referral-link">Your personal referral link</label><div class="copy-row"><input id="my-referral-link" value="${escapeHtml(data.referral_link)}" readonly><button id="copy-referral" type="button" class="copy-button">COPY</button></div><p id="copy-status" class="form-status" aria-live="polite"></p>`;
    document.getElementById("copy-referral").addEventListener("click", async () => {
      const input = document.getElementById("my-referral-link");
      try { await navigator.clipboard.writeText(input.value); }
      catch { input.select(); document.execCommand("copy"); }
      document.getElementById("copy-status").textContent = "Referral link copied!";
    });
  } catch (error) { holder.innerHTML = `<div class="notice">${escapeHtml(error.message)}</div>`; }
}

function bindWithdrawal() {
  const form = document.getElementById("withdraw-form");
  if (!form) return;
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const status = document.getElementById("withdraw-status");
    const button = form.querySelector('button[type="submit"]');
    const amount = Number(document.getElementById("withdraw-amount").value);
    const address = document.getElementById("withdraw-address").value.trim();
    if (!Number.isFinite(amount) || amount < 3) { status.textContent = "Minimum withdrawal is $3.00."; return; }
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) { status.textContent = "Enter a valid BEP20 address starting with 0x."; return; }
    button.disabled = true; button.textContent = "SENDING..."; status.textContent = "";
    try {
      const data = await api("/api/withdrawals", { method: "POST", body: JSON.stringify({ amount_cents: Math.round(amount * 100), payout_address: address }) });
      status.textContent = `Withdrawal request #${data.withdrawal_id} submitted. Waiting for admin review.`;
      form.reset(); await loadAccount();
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; button.textContent = "REQUEST WITHDRAWAL"; }
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
function safeUrl(value) {
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? escapeHtml(url.href) : "#"; }
  catch { return "#"; }
}

showPage("home");
loadAccount();
