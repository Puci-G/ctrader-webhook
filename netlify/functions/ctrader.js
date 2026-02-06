export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ ok: false, error: "method_not_allowed" }) };
    }

    const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    // normalize header lookup (Netlify can lowercase headers)
    const secret =
      event.headers?.["x-webhook-secret"] ||
      event.headers?.["X-Webhook-Secret"] ||
      event.headers?.["x-webhook-secret".toLowerCase()];

    if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
      return { statusCode: 401, body: JSON.stringify({ ok: false, error: "unauthorized" }) };
    }

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: "missing_env_vars" }) };
    }

    const payload = event.body ? JSON.parse(event.body) : {};

    const symbol = payload.symbol ?? "UNKNOWN";

    // UTC fields (legacy)
    const utcDate = payload.utcDate ?? "";
    const timeUtc = payload.signalTimeUtc ?? payload.eventTimeUtc ?? "";

    // NEW: NY fields (from updated cBot)
    const nyDate = payload.nyDate ?? payload.dateNY ?? "";
    const timeNY = payload.signalTimeNY ?? payload.eventTimeNY ?? "";

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

    // Show NY time if present; otherwise show UTC (backwards compatible)
    const timeBlock =
      (nyDate || timeNY)
        ? `${nyDate ? `Date(NY): ${nyDate}` : ""}${timeNY ? `\nTime(NY): ${timeNY}` : ""}`
        : `${utcDate ? `Date(UTC): ${utcDate}` : ""}${timeUtc ? `\nTime(UTC): ${timeUtc}` : ""}`;

    const text =
`${title}
Symbol: ${symbol}
${timeBlock}

${zoneBlock ? zoneBlock + "\n\n" : ""}Reason: ${reason}${extra ? `\nExtra: ${extra}` : ""}`;

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

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: "server_error", details: String(e) }) };
  }
}