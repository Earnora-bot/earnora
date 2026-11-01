async function verifyTelegram(initData, botToken) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData), hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const data = [...params.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join("\n");
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode("WebAppData"), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
  const secret = await crypto.subtle.sign("HMAC", key, enc.encode(botToken));
  const vkey = await crypto.subtle.importKey("raw", secret, {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", vkey, enc.encode(data));
  const calc = [...new Uint8Array(sig)].map(b=>b.toString(16).padStart(2,"0")).join("");
  if (calc.length !== hash.length) return null;
  let mismatch=0; for(let i=0;i<calc.length;i++) mismatch |= calc.charCodeAt(i)^hash.charCodeAt(i);
  if(mismatch) return null;
  const authDate=Number(params.get("auth_date"));
  if(!authDate || authDate>Date.now()/1000+30 || Date.now()/1000-authDate>3600) return null;
  try{return JSON.parse(params.get("user"));}catch{return null;}
}
const json=(data,status=200)=>Response.json(data,{status});
async function ensureUser(db,user){
  await db.prepare("INSERT OR IGNORE INTO users (telegram_id, username, first_name) VALUES (?, ?, ?)")
    .bind(String(user.id),user.username||null,user.first_name||"").run();
  return String(user.id);
}
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==="/api/health") return json({status:"ok",app:"Earnora"});
  if(url.pathname.startsWith("/api/")){
   if(!["GET","POST"].includes(request.method)) return json({error:"Method not allowed"},405);
   const user=await verifyTelegram(request.headers.get("X-Telegram-Init-Data"),env.BOT_TOKEN);
   if(!user) return json({error:"Unauthorized. Open Earnora inside Telegram."},401);
   const uid=await ensureUser(env.DB,user);
   if(url.pathname==="/api/me" && request.method==="GET"){
    const account=await env.DB.prepare("SELECT telegram_id,username,first_name,balance_cents,reserved_cents FROM users WHERE telegram_id=?").bind(uid).first();
    return json({user:account});
   }
   if(url.pathname==="/api/tasks" && request.method==="GET"){
    const result=await env.DB.prepare(`SELECT t.id,t.title,t.description,t.reward_cents,t.target_url,
      CASE WHEN c.status='verified' THEN 1 ELSE 0 END AS completed
      FROM tasks t LEFT JOIN task_completions c ON c.task_id=t.id AND c.telegram_id=?
      WHERE t.active=1 ORDER BY t.id DESC`).bind(uid).all();
    return json({tasks:result.results||[]});
   }
   if(url.pathname==="/api/referral" && request.method==="GET"){
    const row=await env.DB.prepare("SELECT COUNT(*) AS total FROM referrals WHERE inviter_id=? AND status='verified' AND rewarded=1").bind(uid).first();
    return json({verified_referrals:row?.total||0,referral_link:`https://t.me/earnorav2_bot?start=ref_${uid}`});
   }
   if(url.pathname==="/api/withdrawals" && request.method==="POST"){
    let body; try{body=await request.json();}catch{return json({error:"Invalid request body."},400);}
    const amount=Number(body.amount_cents), address=String(body.payout_address||"").trim();
    if(!Number.isInteger(amount)||amount<100||amount>100000000) return json({error:"Minimum withdrawal is $1.00. Enter a valid amount."},400);
    if(!/^0x[a-fA-F0-9]{40}$/.test(address)) return json({error:"Enter a valid BEP20 address (42 characters, starting with 0x)."},400);
    const refs=await env.DB.prepare("SELECT COUNT(*) AS total FROM referrals WHERE inviter_id=? AND status='verified' AND rewarded=1").bind(uid).first();
    if((refs?.total||0)<5) return json({error:"You need at least 5 verified referrals to withdraw."},400);
    const reserve=await env.DB.prepare(`UPDATE users SET reserved_cents=reserved_cents+?
      WHERE telegram_id=? AND is_banned=0 AND balance_cents-reserved_cents>=?`).bind(amount,uid,amount).run();
    if(!reserve.meta?.changes) return json({error:"Insufficient available balance or account unavailable."},400);
    try{
      const inserted=await env.DB.prepare("INSERT INTO withdrawals (telegram_id,amount_cents,payout_address,status) VALUES (?,?,?,'pending')").bind(uid,amount,address).run();
      return json({ok:true,withdrawal_id:inserted.meta?.last_row_id||null,status:"pending"},201);
    }catch(e){
      await env.DB.prepare("UPDATE users SET reserved_cents=MAX(0,reserved_cents-?) WHERE telegram_id=?").bind(amount,uid).run();
      return json({error:"Could not save withdrawal request. Please try again."},500);
    }
   }
   return json({error:"Not found"},404);
  }
  return env.ASSETS.fetch(request);
 }
};
