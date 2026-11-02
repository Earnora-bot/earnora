const ADMIN_ID = "8886499198";
const TASK_REWARD_CENTS = 5;
const REFERRAL_REWARD_CENTS = 5;
const MIN_WITHDRAWAL_CENTS = 300;
const REQUIRED_REFERRALS = 5;
const TASK_POST_FEE_CENTS = 100;
const TASK_POST_WALLET = "0x52824938de138886fdf6f7a80262e5c0a173d92c";

const json = (data, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

async function verifyTelegram(initData, botToken) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return null;
  params.delete("hash");
  const data = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`).join("\n");
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const secret = await crypto.subtle.sign("HMAC", key, enc.encode(botToken));
  const vkey = await crypto.subtle.importKey("raw", secret,
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", vkey, enc.encode(data));
  const calculated = [...new Uint8Array(signature)].map(b => b.toString(16).padStart(2, "0")).join("");
  if (calculated.length !== hash.length) return null;
  let mismatch = 0;
  for (let i = 0; i < calculated.length; i++) mismatch |= calculated.charCodeAt(i) ^ hash.charCodeAt(i);
  if (mismatch) return null;
  const authDate = Number(params.get("auth_date"));
  const now = Date.now() / 1000;
  if (!authDate || authDate > now + 30 || now - authDate > 3600) return null;
  try { return JSON.parse(params.get("user")); } catch { return null; }
}

async function ensureUser(db, user) {
  await db.prepare(`INSERT OR IGNORE INTO users (telegram_id, username, first_name) VALUES (?, ?, ?)`)
    .bind(String(user.id), user.username || null, user.first_name || "").run();
  await db.prepare(`UPDATE users SET username = ?, first_name = ? WHERE telegram_id = ?`)
    .bind(user.username || null, user.first_name || "", String(user.id)).run();
  return String(user.id);
}

async function telegramCall(env, method, body) {
  if (!env.BOT_TOKEN) throw new Error("BOT_TOKEN is missing");
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    console.error("Telegram API error:", method, result.description);
    throw new Error("Telegram API request failed");
  }
  return result.result;
}

async function telegramSend(env, chatId, message, extra = {}) {
  return telegramCall(env, "sendMessage", {
    chat_id: chatId, text: message, disable_web_page_preview: true, ...extra
  });
}

async function notifyReferralAfterFirstTask(db, invitee) {
  await db.batch([
    db.prepare(`UPDATE referrals SET status = 'verified'
      WHERE invitee_id = ? AND status = 'unverified' AND rewarded = 0`).bind(invitee),
    db.prepare(`INSERT OR IGNORE INTO ledger (telegram_id, amount_cents, reason, reference_id)
      SELECT inviter_id, ?, 'referral_reward', 'referral:' || id FROM referrals
      WHERE invitee_id = ? AND status = 'verified' AND rewarded = 0`)
      .bind(REFERRAL_REWARD_CENTS, invitee),
    db.prepare(`UPDATE referrals SET rewarded = 1
      WHERE invitee_id = ? AND status = 'verified' AND rewarded = 0
      AND EXISTS (SELECT 1 FROM ledger WHERE ledger.reference_id = 'referral:' || referrals.id)`)
      .bind(invitee)
  ]);
}

async function notifyUser(env, userId, message) {
  try { await telegramSend(env, userId, message); }
  catch (error) { console.error("User notification failed:", error.message); }
}

async function handleTaskPostDecision(env, callback) {
  const adminId = String(callback.from?.id || "");
  const data = String(callback.data || "");
  const match = data.match(/^taskpost:(accept|reject):(\d+)$/);
  if (adminId !== ADMIN_ID || !match) {
    await telegramCall(env, "answerCallbackQuery", {
      callback_query_id: callback.id, text: "Not authorized.", show_alert: true
    });
    return;
  }

  const decision = match[1];
  const requestId = Number(match[2]);
  const db = env.DB;
  const requestRow = await db.prepare(`SELECT id, telegram_id, title, description,
    target_url, task_type, chat_id, tx_hash, status
    FROM task_post_requests WHERE id = ?`).bind(requestId).first();

  if (!requestRow || requestRow.status !== "pending") {
    await telegramCall(env, "answerCallbackQuery", {
      callback_query_id: callback.id, text: "This request has already been reviewed.", show_alert: true
    });
    return;
  }

  // Claim the pending request first. Only the callback that changes pending -> accepted/rejected
  // is allowed to continue, making repeated button presses idempotent.
  const newStatus = decision === "accept" ? "accepted" : "rejected";
  const changed = await db.prepare(`UPDATE task_post_requests
    SET status = ?, reviewed_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'pending'`).bind(newStatus, requestId).run();

  if (!changed.meta?.changes) {
    await telegramCall(env, "answerCallbackQuery", {
      callback_query_id: callback.id, text: "Already processed.", show_alert: true
    });
    return;
  }

  let taskId = null;
  if (decision === "accept") {
    const created = await db.prepare(`INSERT INTO tasks
      (title, description, reward_cents, target_url, active, task_type, chat_id)
      VALUES (?, ?, ?, ?, 1, ?, ?)`)
      .bind(requestRow.title, requestRow.description, TASK_REWARD_CENTS,
        requestRow.target_url, requestRow.task_type || "manual", requestRow.chat_id || null).run();
    taskId = created.meta?.last_row_id || null;
    await notifyUser(env, requestRow.telegram_id,
      `✅ Your task posting request #${requestId} has been ACCEPTED.\n` +
      `Your task is now active${taskId ? ` (Task #${taskId})` : ""}.\n` +
      `Reward: $0.05 per verified completion.`);
  } else {
    await notifyUser(env, requestRow.telegram_id,
      `❌ Your task posting request #${requestId} has been REJECTED.\n` +
      `If you believe this is a mistake, contact Earnora support.`);
  }

  await telegramCall(env, "answerCallbackQuery", {
    callback_query_id: callback.id,
    text: decision === "accept" ? "Request accepted; task activated." : "Request rejected."
  });

  if (callback.message?.chat?.id && callback.message?.message_id) {
    try {
      await telegramCall(env, "editMessageReplyMarkup", {
        chat_id: callback.message.chat.id,
        message_id: callback.message.message_id,
        reply_markup: { inline_keyboard: [] }
      });
    } catch (error) { console.error("Could not remove review buttons:", error.message); }
  }
}

// Process button callbacks separately from ordinary messages.
async function handleTelegramUpdate(request, env) {
  if (!env.WEBHOOK_SECRET ||
      request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
    return json({ error: "Forbidden" }, 403);
  }
  const update = await request.json().catch(() => null);
  if (!update) return json({ error: "Invalid update" }, 400);

  if (update.callback_query) {
    try { await handleTaskPostDecision(env, update.callback_query); }
    catch (error) {
      console.error("Task-post callback failed:", error.message);
      try {
        await telegramCall(env, "answerCallbackQuery", {
          callback_query_id: update.callback_query.id,
          text: "Could not process this action. Check Worker logs.",
          show_alert: true
        });
      } catch {}
    }
    return json({ ok: true });
  }

  const message = update.message;
  if (!message?.from?.id || typeof message.text !== "string") return json({ ok: true });
  const text = message.text.trim();
  const user = message.from;
  const invitee = String(user.id);

  if (text === "/help" || text.startsWith("/help@")) {
    await telegramSend(env, message.chat.id,
      "Earnora Help\n\nOpen the Earnora Mini App to complete tasks and invite friends.\n\nRewards are credited only after verification and claiming.");
    return json({ ok: true });
  }

  const match = text.match(/^\/start(?:@\w+)?(?:\s+ref_(\d+))?/);
  if (!match) return json({ ok: true });
  await ensureUser(env.DB, user);
  const inviter = match[1] || null;

  if (inviter && inviter !== invitee) {
    await env.DB.prepare(`INSERT OR IGNORE INTO referrals (inviter_id, invitee_id, status, rewarded)
      SELECT ?, ?, 'unverified', 0 WHERE EXISTS (SELECT 1 FROM users WHERE telegram_id = ?)`)
      .bind(inviter, invitee, inviter).run();
  }

  const welcome = `🌟 Welcome to Earnora, ${user.first_name || "friend"}!

💰 Complete verified tasks and earn $0.05.

📺 Eligible completed ads can earn $0.01 when ads are enabled.

🎁 Invite friends and earn $0.05 after their first verified task.

🚀 Open Earnora and start earning!`;

  if (env.MINI_APP_URL) {
    await telegramSend(env, message.chat.id, welcome, {
      reply_markup: { inline_keyboard: [[{
        text: "OPEN EARNORA", web_app: { url: env.MINI_APP_URL }
      }]] }
    });
  } else {
    await telegramSend(env, message.chat.id,
      "🌟 Welcome to Earnora!\n\nEarnora Mini App is temporarily unavailable. Please try again later.");
  }
  return json({ ok: true });
}

async function authenticate(request, env) {
  const user = await verifyTelegram(request.headers.get("X-Telegram-Init-Data"), env.BOT_TOKEN);
  if (!user?.id) return null;
  const uid = await ensureUser(env.DB, user);
  const account = await env.DB.prepare(`SELECT is_banned FROM users WHERE telegram_id = ?`).bind(uid).first();
  if (!account || account.is_banned) return null;
  return { user, uid };
}

async function verifyJoinTask(env, task, uid) {
  if (!task.chat_id) throw new Error("This join task is not configured correctly");
  const member = await telegramCall(env, "getChatMember", { chat_id: task.chat_id, user_id: Number(uid) });
  return member.status === "creator" || member.status === "administrator" ||
    member.status === "member" || (member.status === "restricted" && member.is_member === true);
}

async function verifyTask(db, env, uid, taskId) {
  const task = await db.prepare(`SELECT id, title, reward_cents, target_url, task_type, chat_id
    FROM tasks WHERE id = ? AND active = 1`).bind(taskId).first();
  if (!task) return { error: "Task not found", status: 404 };
  if (task.task_type !== "telegram_join") return { error: "This task requires admin verification.", status: 409 };
  let joined = false;
  try { joined = await verifyJoinTask(env, task, uid); }
  catch (error) {
    console.error("Membership verification failed:", error.message);
    return { error: "Could not verify membership. Please try again later.", status: 503 };
  }
  if (!joined) return { error: "You have not joined the required channel or group yet.", status: 400 };

  await db.prepare(`INSERT OR IGNORE INTO task_completions (telegram_id, task_id, status)
    VALUES (?, ?, 'pending')`).bind(uid, taskId).run();
  const completion = await db.prepare(`SELECT id, status, claimed_at FROM task_completions
    WHERE telegram_id = ? AND task_id = ?`).bind(uid, taskId).first();
  if (completion.status === "rejected") return { error: "This task was rejected. Contact support.", status: 409 };
  if (completion.status !== "verified") {
    await db.prepare(`UPDATE task_completions SET status = 'verified', verified_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'`).bind(completion.id).run();
  }
  await notifyReferralAfterFirstTask(db, uid);
  const updated = await db.prepare(`SELECT status, claimed_at FROM task_completions WHERE id = ?`)
    .bind(completion.id).first();
  return { ok: true, status: updated.status, claimed: !!updated.claimed_at, reward_cents: task.reward_cents };
}

async function claimTask(db, uid, taskId) {
  const completion = await db.prepare(`SELECT tc.id, tc.status, tc.claimed_at, t.reward_cents
    FROM task_completions tc JOIN tasks t ON t.id = tc.task_id
    WHERE tc.telegram_id = ? AND tc.task_id = ? AND t.active = 1`).bind(uid, taskId).first();
  if (!completion) return { error: "Task completion not found", status: 404 };
  if (completion.status !== "verified") return { error: "Task has not been verified", status: 409 };
  if (completion.claimed_at) return { error: "Reward already claimed", status: 409 };

  // Conditional claim and ledger insert are performed in one D1 batch.
  await db.batch([
    db.prepare(`UPDATE task_completions SET claimed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'verified' AND claimed_at IS NULL`).bind(completion.id),
    db.prepare(`INSERT OR IGNORE INTO ledger (telegram_id, amount_cents, reason, reference_id)
      SELECT telegram_id, ?, 'task_reward', 'task:' || id FROM task_completions
      WHERE id = ? AND status = 'verified' AND claimed_at IS NOT NULL`)
      .bind(completion.reward_cents, completion.id)
  ]);
  const ledgerRow = await db.prepare(`SELECT id FROM ledger WHERE reference_id = ?`)
    .bind(`task:${completion.id}`).first();
  if (!ledgerRow) return { error: "Could not claim reward. Please contact support.", status: 500 };
  return { ok: true, reward_cents: completion.reward_cents };
}

async function handleApi(request, env, url, auth) {
  const { uid } = auth;
  const db = env.DB;
  const path = url.pathname;

  if (path === "/api/me" && request.method === "GET") {
    const account = await db.prepare(`SELECT telegram_id, username, first_name, balance_cents
      FROM users WHERE telegram_id = ?`).bind(uid).first();
    return json({ user: account });
  }

  if (path === "/api/tasks" && request.method === "GET") {
    const result = await db.prepare(`SELECT t.id, t.title, t.description, t.reward_cents,
      t.target_url, t.task_type, COALESCE(c.status, 'available') AS task_status,
      CASE WHEN c.status = 'verified' THEN 1 ELSE 0 END AS completed,
      CASE WHEN c.claimed_at IS NOT NULL THEN 1 ELSE 0 END AS claimed
      FROM tasks t LEFT JOIN task_completions c
      ON c.task_id = t.id AND c.telegram_id = ?
      WHERE t.active = 1 ORDER BY t.id DESC`).bind(uid).all();
    return json({ tasks: result.results || [] });
  }

  // Submit a paid task-posting request. TxHash is recorded for manual admin verification only.
  if (path === "/api/task-post-requests" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const title = String(body?.title || "").trim();
    const description = String(body?.description || "").trim();
    const targetUrl = String(body?.target_url || "").trim();
    const txHash = String(body?.tx_hash || "").trim();
    const taskType = String(body?.task_type || "manual");
    const chatId = body?.chat_id ? String(body.chat_id).trim() : null;

    if (!title || title.length > 100) return json({ error: "Task title is required (maximum 100 characters)." }, 400);
    if (description.length > 1000) return json({ error: "Description must be 1000 characters or fewer." }, 400);
    if (!/^https?:\/\//i.test(targetUrl)) return json({ error: "Enter a valid http/https task URL." }, 400);
    if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) return json({ error: "Enter a valid transaction hash (0x followed by 64 hex characters)." }, 400);
    if (!["manual", "telegram_join"].includes(taskType)) return json({ error: "Invalid task type." }, 400);
    if (taskType === "telegram_join" && !chatId) return json({ error: "Telegram join tasks require a channel/group chat ID." }, 400);

    let inserted;
    try {
      inserted = await db.prepare(`INSERT INTO task_post_requests
        (telegram_id, title, description, target_url, task_type, chat_id, tx_hash, amount_cents, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`)
        .bind(uid, title, description, targetUrl, taskType, chatId, txHash, TASK_POST_FEE_CENTS * 20).run();
    } catch (error) {
      if (/UNIQUE|constraint/i.test(error.message || "")) return json({ error: "This transaction hash has already been submitted." }, 409);
      throw error;
    }

    const requestId = inserted.meta?.last_row_id;
    const adminMessage =
      `🆕 EARNORA TASK POST REQUEST #${requestId}\n\n` +
      `User ID: ${uid}\n` +
      `Task: ${title}\n` +
      `Description: ${description || "(none)"}\n` +
      `URL: ${targetUrl}\n` +
      `Type: ${taskType}\n` +
      `Payment: 1.00 USDT (BEP20)\n` +
      `To wallet: ${TASK_POST_WALLET}\n` +
      `TxHash: ${txHash}\n\n` +
      `MANUAL CHECK REQUIRED: verify BSC network, official USDT contract, exactly 1 USDT, recipient wallet, and successful transaction on BscScan.`;
    let notified = true;
    try {
      await telegramSend(env, ADMIN_ID, adminMessage, {
        reply_markup: { inline_keyboard: [[
          { text: "✅ ACCEPT", callback_data: `taskpost:accept:${requestId}` },
          { text: "❌ REJECT", callback_data: `taskpost:reject:${requestId}` }
        ]] }
      });
    } catch (error) {
      notified = false;
      console.error("Admin task-post notification failed:", error.message);
    }
    return json({
      ok: true, request_id: requestId, status: "pending",
      message: notified
        ? "Request sent to admin. It will remain pending until payment and task details are checked."
        : "Request saved, but admin notification failed. Contact support and quote your request ID."
    }, 201);
  }

  if (path === "/api/tasks/complete" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const taskId = Number(body?.task_id);
    if (!Number.isInteger(taskId) || taskId < 1) return json({ error: "Invalid task ID" }, 400);
    const task = await db.prepare(`SELECT id, task_type, active FROM tasks WHERE id = ?`).bind(taskId).first();
    if (!task || !task.active) return json({ error: "Task not found or inactive" }, 404);
    if (task.task_type !== "manual") return json({ error: "This task uses automatic Telegram verification." }, 409);
    await db.prepare(`INSERT OR IGNORE INTO task_completions (telegram_id, task_id, status)
      VALUES (?, ?, 'pending')`).bind(uid, taskId).run();
    const completion = await db.prepare(`SELECT status, claimed_at FROM task_completions
      WHERE telegram_id = ? AND task_id = ?`).bind(uid, taskId).first();
    return json({ ok: true, status: completion.status, claimed: !!completion.claimed_at });
  }

  if (path === "/api/tasks/verify" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const taskId = Number(body?.task_id);
    if (!Number.isInteger(taskId) || taskId < 1) return json({ error: "Invalid task ID" }, 400);
    const result = await verifyTask(db, env, uid, taskId);
    return result.error ? json({ error: result.error }, result.status) : json(result);
  }

  if (path === "/api/tasks/claim" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const taskId = Number(body?.task_id);
    if (!Number.isInteger(taskId) || taskId < 1) return json({ error: "Invalid task ID" }, 400);
    const result = await claimTask(db, uid, taskId);
    return result.error ? json({ error: result.error }, result.status) : json(result);
  }

  if (path === "/api/referral" && request.method === "GET") {
    const row = await db.prepare(`SELECT COUNT(*) AS total FROM referrals
      WHERE inviter_id = ? AND rewarded = 1`).bind(uid).first();
    return json({
      verified_referrals: row?.total || 0,
      referral_link: `https://t.me/earnorav2_bot?start=ref_${uid}`,
      reward_per_referral_cents: REFERRAL_REWARD_CENTS
    });
  }

  if (path === "/api/withdrawals" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const amount = Number(body?.amount_cents);
    const address = String(body?.payout_address || "").trim();
    if (!Number.isInteger(amount) || amount < MIN_WITHDRAWAL_CENTS) return json({ error: "Minimum withdrawal is $3.00" }, 400);
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return json({ error: "Enter a valid BEP20 wallet address" }, 400);
    const refs = await db.prepare(`SELECT COUNT(*) AS total FROM referrals WHERE inviter_id = ? AND rewarded = 1`).bind(uid).first();
    if ((refs?.total || 0) < REQUIRED_REFERRALS) return json({ error: "You need at least 5 rewarded referrals to withdraw" }, 400);

    const deduction = await db.prepare(`UPDATE users SET balance_cents = balance_cents - ?, reserved_cents = reserved_cents + ?
      WHERE telegram_id = ? AND balance_cents >= ?`).bind(amount, amount, uid, amount).run();
    if (!deduction.meta?.changes) return json({ error: "Insufficient available balance" }, 400);
    try {
      const inserted = await db.prepare(`INSERT INTO withdrawals
        (telegram_id, amount_cents, payout_address, status) VALUES (?, ?, ?, 'pending')`).bind(uid, amount, address).run();
      return json({ ok: true, withdrawal_id: inserted.meta?.last_row_id || null, status: "pending" }, 201);
    } catch (error) {
      await db.prepare(`UPDATE users SET balance_cents = balance_cents + ?, reserved_cents = MAX(0, reserved_cents - ?)
        WHERE telegram_id = ?`).bind(amount, amount, uid).run();
      console.error("Withdrawal save failed:", error.message);
      return json({ error: "Could not save withdrawal request" }, 500);
    }
  }

  if (path.startsWith("/api/admin/")) {
    if (uid !== ADMIN_ID) return json({ error: "Admin access required" }, 403);

    if (path === "/api/admin/tasks" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      const title = String(body?.title || "").trim();
      const description = String(body?.description || "").trim();
      const targetUrl = String(body?.target_url || "").trim();
      const taskType = String(body?.task_type || "manual");
      const chatId = body?.chat_id ? String(body.chat_id).trim() : null;
      if (!title || !targetUrl || !/^https?:\/\//i.test(targetUrl)) return json({ error: "Enter a task title and valid task URL" }, 400);
      if (!["manual", "telegram_join"].includes(taskType)) return json({ error: "Invalid task type" }, 400);
      if (taskType === "telegram_join" && !chatId) return json({ error: "Telegram join tasks require chat_id" }, 400);
      const result = await db.prepare(`INSERT INTO tasks
        (title, description, reward_cents, target_url, active, task_type, chat_id)
        VALUES (?, ?, ?, ?, 1, ?, ?)`).bind(title, description, TASK_REWARD_CENTS, targetUrl, taskType, chatId).run();
      return json({ ok: true, task_id: result.meta?.last_row_id || null }, 201);
    }

    if (path === "/api/admin/tasks" && request.method === "GET") {
      const result = await db.prepare(`SELECT id, title, description, reward_cents, target_url, active, task_type, chat_id
        FROM tasks ORDER BY id DESC`).all();
      return json({ tasks: result.results || [] });
    }

    if (path === "/api/admin/verify-task" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      const invitee = String(body?.telegram_id || "");
      const taskId = Number(body?.task_id);
      const decision = String(body?.decision || "verify");
      if (!/^\d+$/.test(invitee) || !Number.isInteger(taskId) || taskId < 1) return json({ error: "Valid Telegram ID and task ID required" }, 400);
      if (!["verify", "reject"].includes(decision)) return json({ error: "Invalid decision" }, 400);
      const completion = await db.prepare(`SELECT id, status FROM task_completions WHERE telegram_id = ? AND task_id = ?`).bind(invitee, taskId).first();
      if (!completion) return json({ error: "Task completion not found" }, 404);
      if (completion.status === "verified" || completion.status === "rejected") return json({ error: "Task already reviewed" }, 409);
      if (decision === "reject") {
        await db.prepare(`UPDATE task_completions SET status = 'rejected' WHERE id = ? AND status = 'pending'`).bind(completion.id).run();
        return json({ ok: true, status: "rejected" });
      }
      await db.prepare(`UPDATE task_completions SET status = 'verified', verified_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'`).bind(completion.id).run();
      await notifyReferralAfterFirstTask(db, invitee);
      return json({ ok: true, status: "verified" });
    }

    if (path === "/api/admin/withdrawals" && request.method === "GET") {
      const result = await db.prepare(`SELECT id, telegram_id, amount_cents, payout_address, status, tx_hash, created_at
        FROM withdrawals ORDER BY id DESC LIMIT 100`).all();
      return json({ withdrawals: result.results || [] });
    }

    if (path === "/api/admin/withdrawals/review" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      const withdrawalId = Number(body?.withdrawal_id);
      const decision = String(body?.decision || "");
      const txHash = String(body?.tx_hash || "").trim();
      if (!Number.isInteger(withdrawalId) || withdrawalId < 1) return json({ error: "Invalid withdrawal ID" }, 400);
      if (!["approve", "reject"].includes(decision)) return json({ error: "Invalid decision" }, 400);
      const withdrawal = await db.prepare(`SELECT id, telegram_id, amount_cents, status FROM withdrawals WHERE id = ?`).bind(withdrawalId).first();
      if (!withdrawal || withdrawal.status !== "pending") return json({ error: "Pending withdrawal not found" }, 404);
      if (decision === "approve" && !txHash) return json({ error: "Enter the transaction hash after payment" }, 400);
      if (decision === "approve") {
        await db.batch([
          db.prepare(`UPDATE withdrawals SET status = 'paid', tx_hash = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'`).bind(txHash, withdrawalId),
          db.prepare(`UPDATE users SET reserved_cents = MAX(0, reserved_cents - ?) WHERE telegram_id = ?`).bind(withdrawal.amount_cents, withdrawal.telegram_id)
        ]);
      } else {
        await db.batch([
          db.prepare(`UPDATE withdrawals SET status = 'rejected', reviewed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'`).bind(withdrawalId),
          db.prepare(`UPDATE users SET balance_cents = balance_cents + ?, reserved_cents = MAX(0, reserved_cents - ?) WHERE telegram_id = ?`)
            .bind(withdrawal.amount_cents, withdrawal.amount_cents, withdrawal.telegram_id)
        ]);
      }
      return json({ ok: true, status: decision === "approve" ? "paid" : "rejected" });
    }
    return json({ error: "Admin endpoint not found" }, 404);
  }
  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/telegram/webhook" && request.method === "POST") {
      try { return await handleTelegramUpdate(request, env); }
      catch (error) {
        console.error("Webhook failed:", error.message);
        return json({ ok: false }, 200);
      }
    }
    if (url.pathname === "/api/health") return json({ status: "ok", app: "Earnora" });
    if (url.pathname.startsWith("/api/")) {
      if (!["GET", "POST"].includes(request.method)) return json({ error: "Method not allowed" }, 405);
      if (!env.DB || !env.BOT_TOKEN) return json({ error: "Worker configuration missing" }, 500);
      const auth = await authenticate(request, env);
      if (!auth) return json({ error: "Unauthorized or account restricted" }, 401);
      try { return await handleApi(request, env, url, auth); }
      catch (error) {
        console.error("API error:", url.pathname, error.message);
        return json({ error: "Server error. Please try again." }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  }
};
