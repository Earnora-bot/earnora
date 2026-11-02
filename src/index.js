const ADMIN_ID = "8886499198";
const json = (data, status = 200) => Response.json(data, { status });

async function verifyTelegram(initData, botToken) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const data = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const secret = await crypto.subtle.sign("HMAC", key, enc.encode(botToken));
  const vkey = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
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
  await db.prepare("INSERT OR IGNORE INTO users (telegram_id,username,first_name) VALUES (?,?,?)")
    .bind(String(user.id), user.username || null, user.first_name || "").run();
  return String(user.id);
}

async function telegramSend(env, chatId, text) {
  if (!env.BOT_TOKEN) throw new Error("BOT_TOKEN secret is missing");
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    console.error("Telegram sendMessage failed", response.status, result.description || "unknown error");
    throw new Error("Telegram sendMessage failed");
  }
}

async function handleTelegramUpdate(request, env) {
  if (!env.WEBHOOK_SECRET || request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
    return json({ error: "Forbidden" }, 403);
  }
  let update;
  try { update = await request.json(); } catch { return json({ error: "Bad update" }, 400); }
  const message = update.message;
  if (!message?.from?.id || typeof message.text !== "string") return json({ ok: true });
  const text = message.text.trim();
  const match = text.match(/^\/start(?:@\w+)?(?:\s+ref_(\d+))?/);
  if (!match) {
    if (text === "/help" || text.startsWith("/help@")) {
      await telegramSend(env, message.chat.id, "Earnora Help\n\nOpen the Earnora Mini App to complete tasks, watch eligible ads and invite friends. Rewards are credited only after verification.");
    }
    return json({ ok: true });
  }

  const invitee = String(message.from.id);
  await ensureUser(env.DB, message.from);
  const inviter = match[1] ? String(match[1]) : null;
  if (inviter && inviter !== invitee) {
    await env.DB.prepare(`INSERT OR IGNORE INTO referrals (inviter_id, invitee_id, status)
      SELECT ?, ?, 'unverified' WHERE EXISTS (SELECT 1 FROM users WHERE telegram_id = ?)`)
      .bind(inviter, invitee, inviter).run();
  }
  await telegramSend(env, message.chat.id,
    `🌟 Welcome to Earnora, ${message.from.first_name || "friend"}!\n\n💰 Complete tasks and earn $0.05 each.\n📺 Earn $0.01 for each eligible completed ad.\n🎁 Invite friends and earn $0.05 after their first verified task.\n\n🚀 Open Earnora and start earning!`);
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/telegram/webhook" && request.method === "POST") {
      try { return await handleTelegramUpdate(request, env); }
      catch (error) {
        console.error("Telegram webhook failed:", error?.message || error);
        return json({ ok: false, error: "Webhook processing failed" }, 200);
      }
    }
    if (url.pathname === "/api/health") return json({ status: "ok", app: "Earnora" });

    if (url.pathname.startsWith("/api/")) {
      if (!["GET", "POST"].includes(request.method)) return json({ error: "Method not allowed" }, 405);
      const user = await verifyTelegram(request.headers.get("X-Telegram-Init-Data"), env.BOT_TOKEN);
      if (!user) return json({ error: "Unauthorized. Open Earnora inside Telegram." }, 401);
      const uid = await ensureUser(env.DB, user);

      if (url.pathname === "/api/me" && request.method === "GET") {
        const account = await env.DB.prepare("SELECT telegram_id,username,first_name,balance_cents,reserved_cents FROM users WHERE telegram_id=?").bind(uid).first();
        return json({ user: account });
      }
      if (url.pathname === "/api/tasks" && request.method === "GET") {
        const result = await env.DB.prepare(`SELECT t.id,t.title,t.description,t.reward_cents,t.target_url,
          CASE WHEN c.status='verified' THEN 1 ELSE 0 END AS completed
          FROM tasks t LEFT JOIN task_completions c ON c.task_id=t.id AND c.telegram_id=?
          WHERE t.active=1 ORDER BY t.id DESC`).bind(uid).all();
        return json({ tasks: result.results || [] });
      }
      if (url.pathname === "/api/referral" && request.method === "GET") {
        const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM referrals WHERE inviter_id=? AND status='verified' AND rewarded=1").bind(uid).first();
        return json({ verified_referrals: row?.total || 0, referral_link: `https://t.me/earnorav2_bot?start=ref_${uid}`, reward_per_referral_cents: 5 });
      }

      if (url.pathname === "/api/admin/verify-task" && request.method === "POST") {
        if (uid !== ADMIN_ID) return json({ error: "Admin access required." }, 403);
        let body;
        try { body = await request.json(); } catch { return json({ error: "Invalid request body." }, 400); }
        const invitee = String(body.telegram_id || "");
        const taskId = Number(body.task_id);
        if (!/^\d+$/.test(invitee) || !Number.isInteger(taskId) || taskId < 1) return json({ error: "Valid Telegram ID and task ID are required." }, 400);
        const task = await env.DB.prepare("SELECT id,reward_cents FROM tasks WHERE id=? AND active=1").bind(taskId).first();
        if (!task) return json({ error: "Active task not found." }, 404);
        await env.DB.prepare(`INSERT OR IGNORE INTO task_completions (telegram_id,task_id,status)
          SELECT ?,?,'pending' WHERE EXISTS (SELECT 1 FROM users WHERE telegram_id=?)`).bind(invitee, taskId, invitee).run();
        const completion = await env.DB.prepare("SELECT id,status FROM task_completions WHERE telegram_id=? AND task_id=?").bind(invitee, taskId).first();
        if (!completion) return json({ error: "User not found. They must start the bot first." }, 404);
        if (completion.status === "rejected") return json({ error: "This task completion was rejected." }, 409);
        await env.DB.batch([
          env.DB.prepare("UPDATE task_completions SET status='verified',verified_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(completion.id),
          env.DB.prepare(`INSERT OR IGNORE INTO ledger (telegram_id,amount_cents,reason,reference_id)
            SELECT telegram_id,?,'task_reward','task:'||id FROM task_completions WHERE id=? AND status='verified'`).bind(task.reward_cents, completion.id),
          env.DB.prepare("UPDATE referrals SET status='verified' WHERE invitee_id=? AND status='unverified' AND EXISTS (SELECT 1 FROM task_completions WHERE telegram_id=? AND status='verified')").bind(invitee, invitee),
          env.DB.prepare(`INSERT OR IGNORE INTO ledger (telegram_id,amount_cents,reason,reference_id)
            SELECT inviter_id,5,'referral_reward','referral:'||id FROM referrals WHERE invitee_id=? AND status='verified' AND rewarded=0`).bind(invitee),
          env.DB.prepare(`UPDATE referrals SET rewarded=1 WHERE invitee_id=? AND status='verified' AND rewarded=0
            AND EXISTS (SELECT 1 FROM ledger WHERE reference_id='referral:'||referrals.id)`).bind(invitee)
        ]);
        const referral = await env.DB.prepare("SELECT rewarded FROM referrals WHERE invitee_id=?").bind(invitee).first();
        return json({ ok: true, task_verified: true, task_reward_cents: task.reward_cents, referral_rewarded: !!referral?.rewarded, referral_reward_cents: referral?.rewarded ? 5 : 0 });
      }

      if (url.pathname === "/api/withdrawals" && request.method === "POST") {
        let body;
        try { body = await request.json(); } catch { return json({ error: "Invalid request body." }, 400); }
        const amount = Number(body.amount_cents), address = String(body.payout_address || "").trim();
        if (!Number.isInteger(amount) || amount < 300 || amount > 100000000) return json({ error: "Minimum withdrawal is $3.00. Enter a valid amount." }, 400);
        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return json({ error: "Enter a valid BEP20 address (42 characters, starting with 0x)." }, 400);
        const refs = await env.DB.prepare("SELECT COUNT(*) AS total FROM referrals WHERE inviter_id=? AND status='verified' AND rewarded=1").bind(uid).first();
        if ((refs?.total || 0) < 5) return json({ error: "You need at least 5 verified referrals to withdraw." }, 400);
        const reserve = await env.DB.prepare(`UPDATE users SET reserved_cents=reserved_cents+?
          WHERE telegram_id=? AND is_banned=0 AND balance_cents-reserved_cents>=?`).bind(amount, uid, amount).run();
        if (!reserve.meta?.changes) return json({ error: "Insufficient available balance or account unavailable." }, 400);
        try {
          const inserted = await env.DB.prepare("INSERT INTO withdrawals (telegram_id,amount_cents,payout_address,status) VALUES (?,?,?,'pending')").bind(uid, amount, address).run();
          return json({ ok: true, withdrawal_id: inserted.meta?.last_row_id || null, status: "pending" }, 201);
        } catch (error) {
          await env.DB.prepare("UPDATE users SET reserved_cents=MAX(0,reserved_cents-?) WHERE telegram_id=?").bind(amount, uid).run();
          console.error("Withdrawal insert failed:", error?.message || error);
          return json({ error: "Could not save withdrawal request. Please try again." }, 500);
        }
      }
      return json({ error: "Not found" }, 404);
    }
    return env.ASSETS.fetch(request);
  }
};
