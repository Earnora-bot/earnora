const ADMIN_ID = "8886499198";
const json = (data, status=200) => Response.json(data, {status});

async function verifyTelegram(initData, botToken) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const data = [...params.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join("\n");
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode("WebAppData"), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
  const secret = await crypto.subtle.sign("HMAC", key, enc.encode(botToken));
  const vkey = await crypto.subtle.importKey("raw", secret, {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", vkey, enc.encode(data));
  const calculated = [...new Uint8Array(signature)].map(b=>b.toString(16).padStart(2,"0")).join("");
  if (calculated.length !== hash.length) return null;
  let mismatch=0; for(let i=0;i<calculated.length;i++) mismatch |= calculated.charCodeAt(i)^hash.charCodeAt(i);
  if (mismatch) return null;
  const authDate=Number(params.get("auth_date"));
  if (!authDate || authDate>Date.now()/1000+30 || Date.now()/1000-authDate>3600) return null;
  try { return JSON.parse(params.get("user")); } catch { return null; }
}
async function ensureUser(db, user) {
  await db.prepare("INSERT OR IGNORE INTO users (telegram_id,username,first_name) VALUES (?,?,?)")
    .bind(String(user.id),user.username||null,user.first_name||"").run();
  return String(user.id);
}
async function handleTelegramUpdate(request, env) {
  if (env.WEBHOOK_SECRET && request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
    return json({error:"Forbidden"},403);
  }
  let update;
  try { update=await request.json(); } catch { return json({error:"Bad update"},400); }
  const message=update.message;
  if (!message?.from?.id || typeof message.text !== "string") return json({ok:true});
  const match=message.text.trim().match(/^\/start(?:@\w+)?(?:\s+ref_(\d+))?/);
  if (!match) return json({ok:true});
  const invitee=String(message.from.id);
  await ensureUser(env.DB,message.from);
  const inviter=match[1] ? String(match[1]) : null;
  if (inviter && inviter !== invitee) {
    await env.DB.prepare(`INSERT OR IGNORE INTO referrals (inviter_id,invitee_id,status)
      SELECT ?,?,'unverified' WHERE EXISTS (SELECT 1 FROM users WHERE telegram_id=?)`)
      .bind(inviter,invitee,inviter).run();
  }
  return json({ok:true});
}
export default {
 async fetch(request,env) {
  const url=new URL(request.url);
  if(url.pathname==="/telegram/webhook" && request.method==="POST") return handleTelegramUpdate(request,env);
  if(url.pathname==="/api/health") return json({status:"ok",app:"Earnora"});
  if(url.pathname.startsWith("/api/")) {
   if(!["GET","POST"].includes(request.method)) return json({error:"Method not allowed"},405);
   const user=await verifyTelegram(request.headers.get("X-Telegram-Init-Data"),env.BOT_TOKEN);
   if(!user) return json({error:"Unauthorized. Open Earnora inside Telegram."},401);
   const uid=await ensureUser(env.DB,user);
   if(url.pathname==="/api/me" && request.method==="GET") {
    const account=await env.DB.prepare("SELECT telegram_id,username,first_name,balance_cents,reserved_cents FROM users WHERE telegram_id=?").bind(uid).first();
    return json({user:account});
   }
   if(url.pathname==="/api/tasks" && request.method==="GET") {
    const result=await env.DB.prepare(`SELECT t.id,t.title,t.description,t.reward_cents,t.target_url,
      CASE WHEN c.status='verified' THEN 1 ELSE 0 END AS completed
      FROM tasks t LEFT JOIN task_completions c ON c.task_id=t.id AND c.telegram_id=?
      WHERE t.active=1 ORDER BY t.id DESC`).bind(uid).all();
    return json({tasks:result.results||[]});
   }
   if(url.pathname==="/api/referral" && request.method==="GET") {
    const row=await env.DB.prepare("SELECT COUNT(*) AS total FROM referrals WHERE inviter_id=? AND status='verified' AND rewarded=1").bind(uid).first();
    return json({verified_referrals:row?.total||0,referral_link:`https://t.me/earnorav2_bot?start=ref_${uid}`,reward_per_referral_cents:10});
   }
   // Admin-only: mark a real task completion as verified. The database trigger credits
   // the inviter once, when the invitee completes their first eligible verified task.
   if(url.pathname==="/api/admin/verify-task" && request.method==="POST") {
    if(uid!==ADMIN_ID) return json({error:"Admin access required."},403);
    let body; try{body=await request.json();}catch{return json({error:"Invalid request body."},400);}
    const invitee=String(body.telegram_id||"");
    const taskId=Number(body.task_id);
    if(!/^\d+$/.test(invitee)||!Number.isInteger(taskId)||taskId<1) return json({error:"Valid Telegram ID and task ID are required."},400);
    const task=await env.DB.prepare("SELECT id FROM tasks WHERE id=?").bind(taskId).first();
    if(!task) return json({error:"Task not found."},404);
    const completion=await env.DB.prepare("INSERT OR IGNORE INTO task_completions (telegram_id,task_id,status) SELECT ?,?,'pending' WHERE EXISTS (SELECT 1 FROM users WHERE telegram_id=?)")
      .bind(invitee,taskId,invitee).run();
    const exists=await env.DB.prepare("SELECT id FROM task_completions WHERE telegram_id=? AND task_id=?").bind(invitee,taskId).first();
    if(!exists) return json({error:"User not found. They must start the bot first."},404);
    const results=await env.DB.batch([
      env.DB.prepare("UPDATE task_completions SET status='verified',verified_at=CURRENT_TIMESTAMP WHERE telegram_id=? AND task_id=? AND status!='verified'").bind(invitee,taskId),
      env.DB.prepare("UPDATE referrals SET status='verified' WHERE invitee_id=? AND status='unverified'").bind(invitee),
      env.DB.prepare(`INSERT OR IGNORE INTO ledger (telegram_id,amount_cents,reason,reference_id)
        SELECT inviter_id,10,'referral_reward','referral:'||id FROM referrals
        WHERE invitee_id=? AND status='verified' AND rewarded=0`).bind(invitee),
      env.DB.prepare(`UPDATE referrals SET rewarded=1 WHERE invitee_id=? AND status='verified' AND rewarded=0
        AND EXISTS (SELECT 1 FROM ledger WHERE reference_id='referral:'||referrals.id)`).bind(invitee)
    ]);
    const creditedNow=!!results[2]?.meta?.changes;
    const referral=await env.DB.prepare("SELECT rewarded FROM referrals WHERE invitee_id=?").bind(invitee).first();
    return json({ok:true,task_verified:true,referral_rewarded:!!referral?.rewarded,referral_credited_now:creditedNow,referral_reward_cents:creditedNow?10:0});
   }
   if(url.pathname==="/api/withdrawals" && request.method==="POST") {
    let body; try{body=await request.json();}catch{return json({error:"Invalid request body."},400);}
    const amount=Number(body.amount_cents), address=String(body.payout_address||"").trim();
    if(!Number.isInteger(amount)||amount<100||amount>100000000) return json({error:"Minimum withdrawal is $1.00. Enter a valid amount."},400);
    if(!/^0x[a-fA-F0-9]{40}$/.test(address)) return json({error:"Enter a valid BEP20 address (42 characters, starting with 0x)."},400);
    const refs=await env.DB.prepare("SELECT COUNT(*) AS total FROM referrals WHERE inviter_id=? AND status='verified' AND rewarded=1").bind(uid).first();
    if((refs?.total||0)<5) return json({error:"You need at least 5 verified referrals to withdraw."},400);
    const reserve=await env.DB.prepare(`UPDATE users SET reserved_cents=reserved_cents+?
      WHERE telegram_id=? AND is_banned=0 AND balance_cents-reserved_cents>=?`).bind(amount,uid,amount).run();
    if(!reserve.meta?.changes) return json({error:"Insufficient available balance or account unavailable."},400);
    try {
      const inserted=await env.DB.prepare("INSERT INTO withdrawals (telegram_id,amount_cents,payout_address,status) VALUES (?,?,?,'pending')").bind(uid,amount,address).run();
      return json({ok:true,withdrawal_id:inserted.meta?.last_row_id||null,status:"pending"},201);
    } catch(e) {
      await env.DB.prepare("UPDATE users SET reserved_cents=MAX(0,reserved_cents-?) WHERE telegram_id=?").bind(amount,uid).run();
      return json({error:"Could not save withdrawal request. Please try again."},500);
    }
   }
   return json({error:"Not found"},404);
  }
  return env.ASSETS.fetch(request);
 }
};
