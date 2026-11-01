async function verifyTelegram(initData, botToken) {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;

  params.delete("hash");
  params.delete("signature");

  const data = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const secret = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(botToken)
  );

  const validationKey = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    validationKey,
    encoder.encode(data)
  );

  const calculated = [...new Uint8Array(signature)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  if (calculated !== hash) return null;

  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > 3600) {
    return null;
  }

  try {
    return JSON.parse(params.get("user"));
  } catch {
    return null;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({ status: "ok", app: "Earnora" });
    }

    if (url.pathname.startsWith("/api/")) {
      const initData = request.headers.get("X-Telegram-Init-Data");
      const user = await verifyTelegram(
        initData,
        env.BOT_TOKEN
      );

      if (!user) {
        return Response.json(
          { error: "Unauthorized" },
          { status: 401 }
        );
      }

      if (url.pathname === "/api/me" && request.method === "GET") {
        await env.DB.prepare(`
          INSERT OR IGNORE INTO users
          (telegram_id, username, first_name)
          VALUES (?, ?, ?)
        `).bind(
          String(user.id),
          user.username || null,
          user.first_name || ""
        ).run();

        const account = await env.DB.prepare(`
          SELECT telegram_id, username, first_name, balance_cents
          FROM users WHERE telegram_id = ?
        `).bind(String(user.id)).first();

        return Response.json({
          user: account,
          balance: (account.balance_cents / 100).toFixed(2)
        });
      }

      return Response.json(
        { error: "Not found" },
        { status: 404 }
      );
    }

    return env.ASSETS.fetch(request);
  }
};
