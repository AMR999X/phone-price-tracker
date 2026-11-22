// Each channel is enabled only if its env vars are set. Returns how many channels delivered.
const env = process.env;

const channels = [
  // Phone push via the free ntfy app (Android/iOS). Pick a long random topic name: anyone who knows it can read it.
  env.NTFY_TOPIC && ((title, text, link) =>
    fetch(`https://ntfy.sh/${encodeURIComponent(env.NTFY_TOPIC)}`, {
      method: "POST", body: text,
      headers: { Title: encodeURIComponent(title), Tags: "iphone,money_with_wings", Priority: "high", ...(link && { Click: link }) },
    })),

  env.DISCORD_WEBHOOK_URL && ((title, text, link) =>
    fetch(env.DISCORD_WEBHOOK_URL, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: `**${title}**\n${text}${link ? `\n${link}` : ""}` }),
    })),

  // Free SMS to your own number for Free Mobile subscribers (enable "Notifications par SMS" in your Free account).
  env.FREE_MOBILE_USER && env.FREE_MOBILE_PASS && ((title, text, link) =>
    fetch(`https://smsapi.free-mobile.fr/sendmsg?${new URLSearchParams({
      user: env.FREE_MOBILE_USER, pass: env.FREE_MOBILE_PASS, msg: `${title}\n${text}${link ? `\n${link}` : ""}`,
    })}`)),

  // SMS to any operator (paid, ~0.08 €/SMS).
  env.TWILIO_SID && env.TWILIO_TOKEN && env.TWILIO_FROM && env.ALERT_PHONE && ((title, text, link) =>
    fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_SID}/Messages.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${env.TWILIO_SID}:${env.TWILIO_TOKEN}`).toString("base64") },
      body: new URLSearchParams({ From: env.TWILIO_FROM, To: env.ALERT_PHONE, Body: `${title}\n${text}${link ? `\n${link}` : ""}` }),
    })),

  // Email via Resend (free tier). Without your own domain, it can only send to the address you signed up with.
  env.RESEND_API_KEY && env.ALERT_EMAIL && ((title, text, link) =>
    fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: env.ALERT_FROM || "Price Watch <onboarding@resend.dev>", to: env.ALERT_EMAIL, subject: title,
        text: `${text}${link ? `\n\n${link}` : ""}`,
      }),
    })),
].filter(Boolean);

export const channelCount = channels.length;

export async function notify(title, text, link) {
  const results = await Promise.allSettled(channels.map((send) => send(title, text, link)));
  let ok = 0;
  for (const r of results) {
    if (r.status === "fulfilled" && r.value.ok) ok++;
    else console.error("notify failed:", r.reason?.message ?? `HTTP ${r.value.status} ${await r.value.text()}`);
  }
  return ok;
}
