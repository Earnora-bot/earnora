
const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const content = document.getElementById("content");
const balance = document.getElementById("balance");
const welcome = document.getElementById("welcome");
const TASK_POST_WALLET = "0x52824938de138886fdf6f7a80262e5c0a173d92c";
let isAdmin = false;

const money = cents => `$${(Number(cents || 0) / 100).toFixed(2)}`;
const headers = () => ({
  "Content-Type": "application/json",
  "X-Telegram-Init-Data": tg?.initData || ""
});

const pages = {
  home: `<div class="home-heading"><p class="eyebrow">YOUR REWARDS HUB</p><h2>Welcome to Earnora ✨</h2><p>Your earning journey starts here.</p></div>
    <div class="dashboard-grid">
      <button class="dashboard-tile" type="button" data-go-page="tasks"><span>📋</span><strong>DAILY TASKS</strong><small>Complete & earn</small></button>
      <button class="dashboard-tile" type="button" data-go-page="ads"><span>▶️</span><strong>WATCH ADS</strong><small>Earn $0.01 per valued ad</small></button>
      <button class="dashboard-tile" type="button" data-go-page="referral"><span>👥</span><strong>INVITE FRIENDS</strong><small>Earn referral rewards</small></button>
      <button class="dashboard-tile" type="button" data-go-page="profile"><span>👑</span><strong>MY PROFILE</strong><small>Account & withdrawals</small></button>
    </div>
    <div class="notice">✨ Your balance is updated from your verified Earnora account. Rewards are never estimated or animated as fake earnings.</div>`,
  tasks: `<h2>📋 Available Tasks</h2>
    <div id="admin-task-panel"></div>
    <button id="show-post-task" class="post-task-toggle" type="button">＋ POST A TASK <span>$1.00 USDT</span></button>
    <div id="post-task-area"></div>
    <div id="task-results" class="loading">Loading tasks...</div>`,
  ads: `<h2>✨ Earn with Ads</h2>
    <div class="ads-hero"><div class="ads-coin">🪙</div><strong>WATCH & EARN</strong><small>Get $0.01 for each Monetag-confirmed valued impression</small></div>
    <div class="notice">Daily limit: 100 ad attempts. Your reward becomes available only after Monetag confirms a valued impression on the server.</div>
    <button id="watch-ad" class="primary-button">▶ WATCH AD · EARN $0.01</button>
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
      <a class="profile-link official-link" href="https://t.me/Earnora_bot_update" target="_blank" rel="noopener noreferrer"><span class="profile-link-icon">📣</span><span class="profile-link-copy"><strong>Official Channel</strong><small>@flash_bot_update</small></span><span class="profile-link-action">OPEN ↗</span></a>
      <a class="profile-link help-link" href="#support" id="open-support"><span class="profile-link-icon">🎧</span><span class="profile-link-copy"><strong>Help Center</strong><small>Contact Earnora Support</small></span><span class="profile-link-action">HELP ↗</span></a>
      <a class="profile-link payment-link" href="https://t.me/Earnora_bot_pay" target="_blank" rel="noopener noreferrer"><span class="profile-link-icon">🧾</span><span class="profile-link-copy"><strong>Payment Channel</strong><small>@flash_bot_pay · Payment proofs</small></span><span class="profile-link-action">VIEW ↗</span></a>
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
  content.querySelectorAll("[data-go-page]").forEach(button =>
    button.addEventListener("click", () => showPage(button.dataset.goPage)));
  document.querySelectorAll(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.page === page));
  if (page === "tasks") { renderAdminTaskPanel(); bindTaskPosting(); loadTasks(); }
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

function animateBalance(targetCents) {
  const from = Number(balance.dataset.cents || 0);
  const to = Number(targetCents || 0);
  balance.dataset.cents = String(to);
  const started = performance.now();
  const duration = 850;
  const tick = now => {
    const progress = Math.min(1, (now - started) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    balance.textContent = money(Math.round(from + (to - from) * eased));
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function hideSplash() {
  const splash = document.getElementById("splash-screen");
  if (splash) {
    splash.classList.add("hide");
    setTimeout(() => splash.remove(), 650);
  }
}

async function loadAccount() {
  try {
    if (!tg?.initData) {
      welcome.textContent = "Open this Mini App inside Telegram to sign in.";
      content.innerHTML = `<h2>Open Earnora in Telegram</h2><p>Your Telegram account is required to load a real balance.</p><div class="notice">This preview does not create or credit a wallet balance.</div>`;
      return;
    }
    const data = await api("/api/me");
    isAdmin = !!data.is_admin;
    animateBalance(data.user.balance_cents);
    welcome.textContent = `Welcome, ${data.user.first_name || "Earnora user"}`;
  } catch {
    welcome.textContent = "Unable to load account. Please try again.";
  } finally {
    hideSplash();
  }
}

function renderAdminTaskPanel() {
  const panel = document.getElementById("admin-task-panel");
  if (!panel || !isAdmin) return;
  panel.innerHTML = `<section class="admin-panel"><div class="admin-panel-heading"><span>🛡️ ADMIN CONTROL</span><small>Admin account only</small></div><form id="admin-task-form" class="post-task-form"><h3>＋ Publish New Task</h3><label for="admin-task-title">Task title</label><input id="admin-task-title" maxlength="100" required placeholder="Task title"><label for="admin-task-description">Description</label><textarea id="admin-task-description" rows="3" maxlength="1000" placeholder="Task instructions"></textarea><label for="admin-task-url">Task URL</label><input id="admin-task-url" type="url" required placeholder="https://..."><label for="admin-task-type">Task type</label><select id="admin-task-type"><option value="manual">Manual verification</option><option value="telegram_join">Telegram join</option></select><label for="admin-task-chat">Telegram channel/group ID (join tasks only)</label><input id="admin-task-chat" placeholder="@channel or -100..."><button type="submit" class="primary-button">PUBLISH & NOTIFY USERS</button><p id="admin-task-status" class="form-status" aria-live="polite"></p></form></section>`;
  document.getElementById("admin-task-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const status = document.getElementById("admin-task-status");
    button.disabled = true; button.textContent = "PUBLISHING & NOTIFYING..."; status.textContent = "";
    try {
      const result = await api("/api/admin/tasks", { method: "POST", body: JSON.stringify({ title: document.getElementById("admin-task-title").value.trim(), description: document.getElementById("admin-task-description").value.trim(), target_url: document.getElementById("admin-task-url").value.trim(), task_type: document.getElementById("admin-task-type").value, chat_id: document.getElementById("admin-task-chat").value.trim() || null }) });
      status.textContent = `Task #${result.task_id} published. Notifications sent: ${result.notifications_sent}; failed: ${result.notifications_failed}.`;
      form.reset(); await loadTasks();
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; button.textContent = "PUBLISH & NOTIFY USERS"; }
  });
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
    const completedTasks = data.completed_tasks || [];
    const availableHtml = tasks.length ? tasks.map(task => {
      const status = task.task_status || "available";
      let action = "";
      if (status === "verified") action = `<button class="primary-button task-claim" data-task-id="${Number(task.id)}">CLAIM ${money(task.reward_cents)}</button>`;
      else if (status === "pending") action = `<button class="primary-button" disabled>WAITING FOR REVIEW</button>`;
      else if (status === "rejected") action = `<button class="primary-button" disabled>REJECTED · CONTACT SUPPORT</button>`;
      else if (task.task_type === "telegram_join") action = `<button class="primary-button task-verify" data-task-id="${Number(task.id)}">VERIFY JOIN</button>`;
      else action = `<button class="primary-button task-submit" data-task-id="${Number(task.id)}">SUBMIT FOR VERIFICATION</button>`;
      const tag = status === "verified" ? "VERIFIED · CLAIM REWARD" : status === "pending" ? "PENDING" : status === "rejected" ? "REJECTED" : "AVAILABLE";
      const taskLink = status === "available"
        ? `<a class="task-open" href="${safeUrl(task.target_url)}" target="_blank" rel="noopener noreferrer">OPEN TASK ↗</a>`
        : `<span class="task-open task-open-disabled">${status === "verified" ? "TASK FINISHED · CLAIM REWARD" : "TASK ALREADY SUBMITTED"}</span>`;
      const adminRemove = isAdmin ? `<button class="admin-remove-button" type="button" data-remove-task-id="${Number(task.id)}">REMOVE TASK</button>` : "";
      return `<article class="task-card"><div class="task-top"><span class="task-tag">${tag}</span><strong>+${money(task.reward_cents)}</strong></div><h3>${escapeHtml(task.title)}</h3><p>${escapeHtml(task.description || "Complete this task to earn a reward.")}</p>${taskLink}${action}${adminRemove}<small class="muted-note">Reward is credited only after verification and claiming.</small><p class="form-status task-status" aria-live="polite"></p></article>`;
    }).join("") : `<div class="empty-state">No available tasks right now. Please check again later.</div>`;
    const completedHtml = completedTasks.length ? completedTasks.map(task =>
      `<article class="task-card completed-task-card"><div class="task-top"><span class="task-tag completed-task-tag">✓ COMPLETED</span><strong class="completed-reward">+${money(task.reward_cents)}</strong></div><h3>${escapeHtml(task.title)}</h3><p>${escapeHtml(task.description || "Task completed successfully.")}</p><div class="completed-task-meta">Reward claimed · ${escapeHtml(task.claimed_at || "")}</div></article>`
    ).join("") : `<div class="empty-state">Completed tasks will appear here after you claim their rewards.</div>`;
    holder.outerHTML = `<div id="task-results"><h3 class="task-section-title">📋 Available Tasks</h3><div class="task-list">${availableHtml}</div><section class="completed-tasks-section"><h3 class="task-section-title">✅ Completed Tasks <span>${completedTasks.length}</span></h3><div class="task-list">${completedHtml}</div></section></div>`;
    content.querySelectorAll(".task-submit").forEach(button => button.addEventListener("click", () => submitTaskAction(button, "/api/tasks/complete")));
    content.querySelectorAll(".task-verify").forEach(button => button.addEventListener("click", () => submitTaskAction(button, "/api/tasks/verify")));
    content.querySelectorAll(".task-claim").forEach(button => button.addEventListener("click", () => submitTaskAction(button, "/api/tasks/claim")));
    content.querySelectorAll(".admin-remove-button").forEach(button => button.addEventListener("click", async () => {
      if (!isAdmin || !confirm(`Remove Task #${button.dataset.removeTaskId}?`)) return;
      button.disabled = true; button.textContent = "REMOVING...";
      try { await api("/api/admin/tasks/remove", { method: "POST", body: JSON.stringify({ task_id: Number(button.dataset.removeTaskId) }) }); await loadTasks(); }
      catch (error) { button.disabled = false; button.textContent = "REMOVE TASK"; alert(error.message); }
    }));
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
      status.textContent = "Membership verified. Claim your reward.";
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
    const referrals = data.referrals || [];
    const referralRows = referrals.length ? referrals.map(ref => {
      const name = ref.first_name || (ref.username ? `@${ref.username}` : `User ${String(ref.invitee_id).slice(-4)}`);
      const verified = ref.status === "verified";
      const status = verified ? "VERIFIED" : ref.status === "rejected" ? "REJECTED" : "UNVERIFIED";
      return `<div class="referral-user-row"><span class="referral-user-name">${escapeHtml(name)}</span><span class="referral-status ${verified ? "verified" : ref.status === "rejected" ? "rejected" : "unverified"}">${status}</span></div>`;
    }).join("") : `<div class="empty-state">No referrals yet. Share your link to invite friends.</div>`;
    holder.innerHTML = `<div class="referral-count"><strong>${Number(data.verified_referrals || 0)}</strong><span>Verified referrals</span></div><label for="my-referral-link">Your personal referral link</label><div class="copy-row"><input id="my-referral-link" value="${escapeHtml(data.referral_link)}" readonly><button id="copy-referral" type="button" class="copy-button">COPY</button></div><p id="copy-status" class="form-status" aria-live="polite"></p><section class="referral-list-section"><h3>👥 Your Referrals <span>${referrals.length}</span></h3><div class="referral-user-list">${referralRows}</div></section>`;
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
