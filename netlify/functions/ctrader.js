export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ ok: false, error: "method_not_allowed" }) };
    }

    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    // Support one or multiple secrets:
    // - WEBHOOK_SECRET=abc
    // - or WEBHOOK_SECRETS=abc,def,ghi
    const singleSecret = process.env.WEBHOOK_SECRET;
    const multiSecrets = process.env.WEBHOOK_SECRETS; // comma-separated
    const allowedSecrets = (multiSecrets ? multiSecrets.split(",") : [])
      .map(s => s.trim())
      .filter(Boolean);

    if (singleSecret && !allowedSecrets.includes(singleSecret)) {
      allowedSecrets.push(singleSecret);
    }

    // normalize header lookup (Netlify can lowercase headers)
    const secret =
      event.headers?.["x-webhook-secret"] ||
      event.headers?.["X-Webhook-Secret"] ||
      event.headers?.["x-webhook-secret".toLowerCase()];

    if (!allowedSecrets.length || !secret || !allowedSecrets.includes(secret)) {
      return { statusCode: 401, body: JSON.stringify({ ok: false, error: "unauthorized" }) };
    }

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: "missing_env_vars" }) };
    }

    let payload = {};
    try {
      payload = event.body ? JSON.parse(event.body) : {};
    } catch {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: "invalid_json" }) };
    }

    const symbol = payload.symbol ?? "UNKNOWN";

    // ---- Detect which bot/schema this payload is ----
    // Bot A (your existing zone/breakout bot):
    //  - eventType: zoneReady/breakout/entered/closeInside/test
    //  - rangeHigh/rangeLow/mid/session/reason/extra
    //
    // Bot B (Slow MA crosses bot):
    //  - eventType: CROSS_UP / CROSS_DOWN
    //  - line, value, threshold, timeframe, price, serverTimeUtc
    const isCrossBot =
      payload?.eventType === "CROSS_UP" ||
      payload?.eventType === "CROSS_DOWN" ||
      (typeof payload?.threshold !== "undefined" && typeof payload?.value !== "undefined") ||
      payload?.line === "slow_ma_of_rsi";

    // ---- Time fields (keep your legacy UTC + NY logic) ----
    const utcDate = payload.utcDate ?? "";
    const timeUtc = payload.signalTimeUtc ?? payload.eventTimeUtc ?? payload.serverTimeUtc ?? "";

    const nyDate = payload.nyDate ?? payload.dateNY ?? "";
    const timeNY = payload.signalTimeNY ?? payload.eventTimeNY ?? "";

    const timeBlock =
      (nyDate || timeNY)
        ? `${nyDate ? `Date(NY): ${nyDate}` : ""}${timeNY ? `\nTime(NY): ${timeNY}` : ""}`
        : `${utcDate ? `Date(UTC): ${utcDate}` : ""}${timeUtc ? `\nTime(UTC): ${timeUtc}` : ""}`;

    // ---- Build Telegram text depending on bot type ----
    let text = "";

    if (isCrossBot) {
      const eventType = payload.eventType ?? "signal";
      const tf = payload.timeframe ?? payload.tf ?? "";
      const line = payload.line ?? "slow_line";
      const value = typeof payload.value === "number" ? payload.value : Number(payload.value);
      const threshold = typeof payload.threshold === "number" ? payload.threshold : Number(payload.threshold);
      const price = payload.price ?? payload.bid ?? payload.ask ?? "";

      const title =
        eventType === "CROSS_UP" ? "📈 THRESHOLD BREAK (UP)" :
        eventType === "CROSS_DOWN" ? "📉 THRESHOLD BREAK (DOWN)" :
        "📌 cTrader Alert";

      const safeVal = Number.isFinite(value) ? value.toFixed(3) : String(payload.value ?? "");
      const safeThr = Number.isFinite(threshold) ? threshold.toFixed(3) : String(payload.threshold ?? "");

      text =
`${title}
Symbol: ${symbol}${tf ? ` (${tf})` : ""}
${timeBlock ? timeBlock + "\n" : ""}
Line: ${line}
Value: ${safeVal}
Threshold: ${safeThr}${price !== "" ? `\nPrice: ${price}` : ""}`;
    } else {
      // existing bot format (your current logic)
      const eventType = payload.eventType ?? "signal";
      const rangeHigh = payload.rangeHigh ?? "";
      const rangeLow = payload.rangeLow ?? "";
      const mid = payload.mid ?? "";
      const session = payload.session ?? "00:00–04:00 UTC";
      const reason = payload.reason ?? "";
      const extra = payload.extra ?? "";

      const title = (() => {
        switch (eventType) {
          case "zoneReady": return "🟦 ZONE READY";
          case "breakout": return "🚨 OUT OF ZONE";
          case "entered": return "🟩 ENTERED ZONE";
          case "closeInside": return "✅ CLOSE INSIDE";
          case "test": return "🔧 TEST";
          default: return "📌 cTrader Alert";
        }
      })();

      const zoneBlock = (rangeHigh && rangeLow)
        ? `Zone (${session})
H: ${rangeHigh}
L: ${rangeLow}${mid ? `\nMID: ${mid}` : ""}`
        : "";

      text =
`${title}
Symbol: ${symbol}
${timeBlock}

${zoneBlock ? zoneBlock + "\n\n" : ""}Reason: ${reason}${extra ? `\nExtra: ${extra}` : ""}`;
    }

    // Telegram max message length is 4096, keep it safe
    if (text.length > 3900) {
      text = text.slice(0, 3900) + "\n…(truncated)";
    }

    const tgUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const tgResp = await fetch(tgUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text })
    });

    if (!tgResp.ok) {
      const errText = await tgResp.text();
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: "telegram_failed", details: errText }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, type: isCrossBot ? "cross_bot" : "zone_bot" }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: "server_error", details: String(e) }) };
  }
}