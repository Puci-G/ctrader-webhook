export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ ok: false, error: "method_not_allowed" }) };
    }

    const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    const secret = event.headers["x-webhook-secret"] || event.headers["X-Webhook-Secret"];
    if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
      return { statusCode: 401, body: JSON.stringify({ ok: false, error: "unauthorized" }) };
    }

    const payload = event.body ? JSON.parse(event.body) : {};

    const symbol = payload.symbol ?? "UNKNOWN";
    const utcDate = payload.utcDate ?? "";
    const eventType = payload.eventType ?? "signal";
    const rangeHigh = payload.rangeHigh ?? "";
    const rangeLow = payload.rangeLow ?? "";
    const mid = payload.mid ?? "";
    const session = payload.session ?? "00:00–04:00 UTC";
    const timeUtc = payload.signalTimeUtc ?? payload.eventTimeUtc ?? "";
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

    const text =
`${title}
Symbol: ${symbol}
Date(UTC): ${utcDate}${timeUtc ? `\nTime: ${timeUtc} UTC` : ""}

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
