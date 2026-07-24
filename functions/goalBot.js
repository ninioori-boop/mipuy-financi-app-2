/**
 * goalBot — a PERSONAL daily-goals accountability bot over WhatsApp (Cloud API).
 *
 * This module is completely isolated from the invite-only signup gate and the
 * advisor-management functions in index.js. It only touches its own Firestore
 * collection (`goalBot`) and is wired into the deployment from index.js.
 *
 * It is single-user by design: only messages from WHATSAPP_TO (Ori's own
 * number) are ever acted on — anyone else who messages the bot is ignored.
 *
 * Three moving parts:
 *   1. goalBotEvening   — scheduled 21:00 Asia/Jerusalem → "what are tomorrow's goals?"
 *   2. goalBotMidday    — scheduled 13:00 Asia/Jerusalem → "which goals did you finish?"
 *   3. goalBotWebhook   — HTTP endpoint Meta calls with incoming replies; Claude
 *                         understands them ("finished the 2nd one" / a fresh list)
 *                         and updates the checklist, then replies with ✓/▢ marks.
 */

const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const Anthropic = require("@anthropic-ai/sdk");

// ── Secrets (set via `firebase functions:secrets:set NAME`, never in code) ────
const WHATSAPP_TOKEN = defineSecret("WHATSAPP_TOKEN"); // Meta permanent/temp access token
const WHATSAPP_PHONE_ID = defineSecret("WHATSAPP_PHONE_ID"); // sender phone-number ID
const WHATSAPP_VERIFY_TOKEN = defineSecret("WHATSAPP_VERIFY_TOKEN"); // webhook verify string (we choose it)
const WHATSAPP_TO = defineSecret("WHATSAPP_TO"); // Ori's number, e.g. 9725XXXXXXXX (digits only)
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY"); // server-side only

const ALL_SECRETS = [
  WHATSAPP_TOKEN,
  WHATSAPP_PHONE_ID,
  WHATSAPP_VERIFY_TOKEN,
  WHATSAPP_TO,
  ANTHROPIC_API_KEY,
];

const GRAPH_VERSION = "v21.0";
const TZ = "Asia/Jerusalem";

// Approved template names in Meta (language he). Static text, no variables —
// see docs/whatsapp-goal-bot-setup.md for the exact wording to submit.
const TEMPLATE_EVENING = "goals_evening";
const TEMPLATE_MIDDAY = "goals_midday";

// ── Date helpers (Asia/Jerusalem, YYYY-MM-DD) ────────────────────────────────
function dayKey(offsetDays = 0) {
  const base = new Date(Date.now() + offsetDays * 86_400_000);
  // en-CA formats as YYYY-MM-DD; timeZone pins it to Israel local date.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(base);
}
const todayKey = () => dayKey(0);
const tomorrowKey = () => dayKey(1);

// ── Firestore access (lazy — admin app is initialized in index.js) ───────────
function db() {
  return getFirestore();
}

/** Load a day document, returning a normalized shape even when it doesn't exist. */
async function loadDay(key) {
  const snap = await db().collection("goalBot").doc(key).get();
  const data = snap.exists ? snap.data() : {};
  return { key, goals: Array.isArray(data.goals) ? data.goals : [] };
}

async function saveGoals(key, goals) {
  await db()
    .collection("goalBot")
    .doc(key)
    .set(
      { date: key, goals, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
}

/** The bot's last proactive prompt, so a bare reply defaults to the right day. */
async function getLastPrompt() {
  const snap = await db().collection("goalBot").doc("_state").get();
  return snap.exists ? snap.data().lastPrompt || null : null;
}
async function setLastPrompt(kind) {
  await db()
    .collection("goalBot")
    .doc("_state")
    .set(
      { lastPrompt: kind, lastPromptAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
}

// ── WhatsApp Cloud API senders ───────────────────────────────────────────────
async function waPost(body) {
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${WHATSAPP_PHONE_ID.value()}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN.value()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
    },
  );
  if (!res.ok) {
    console.error("waPost failed", res.status, await res.text().catch(() => ""));
  }
  return res.ok;
}

/** Free-form text — only valid inside the 24h window after the user wrote. */
function sendText(to, bodyText) {
  return waPost({ to, type: "text", text: { body: bodyText } });
}

/** Approved template — the only way to message proactively (scheduled sends). */
function sendTemplate(to, name) {
  return waPost({
    to,
    type: "template",
    template: { name, language: { code: "he" } },
  });
}

// ── Rendering ─────────────────────────────────────────────────────────────--
function renderChecklist(dayLabel, goals) {
  if (!goals.length) return `אין עדיין מטרות ל${dayLabel}.`;
  const lines = goals.map(
    (g, i) => `${i + 1}. ${g.done ? "✅" : "▢"} ${g.text}`,
  );
  return `📋 המטרות ל${dayLabel}:\n${lines.join("\n")}`;
}

// ── Claude: understand a free-text reply into a structured action ────────────
const ACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: { type: "string", enum: ["set_goals", "complete", "status", "other"] },
    day: { type: "string", enum: ["today", "tomorrow"] },
    new_goals: { type: "array", items: { type: "string" } },
    completed_indices: { type: "array", items: { type: "integer" } },
    reply: { type: "string" },
  },
  required: ["action", "day", "new_goals", "completed_indices", "reply"],
};

const SYSTEM_PROMPT = `אתה העוזר של בוט מטרות אישי בוואטסאפ, בעברית. המשתמש הוא בעל המערכת (אורי).
תפקידך: להבין הודעה חופשית ולהחזיר פעולה מובנית בלבד.

הקשר שיינתן לך: איזו הודעה יזומה הבוט שלח לאחרונה (evening = ביקש מטרות למחר, midday = ביקש לדעת מה הושלם, none), ורשימות המטרות הקיימות של היום ושל מחר עם אינדקסים.

כללי החלטה:
- אם המשתמש מפרט רשימת מטרות חדשה → action="set_goals". day="tomorrow" אם ההקשר evening או אם הוא אמר "מחר", אחרת "today".
- אם המשתמש אומר שסיים/עשה משימות ("סיימתי", "עשיתי", "השלמתי", "בוצע") → action="complete". מלא את completed_indices עם האינדקסים (מספר הסידור ברשימה) של המטרות שהושלמו, לפי מה שהוא תיאר (למשל "השנייה", "הספורט"). day = היום שאליו שייכות אותן מטרות (בדרך כלל "today").
- אם הוא שואל מה נשאר / מה המצב → action="status", day לפי ההקשר.
- אחרת → action="other".

new_goals ריק אלא אם action="set_goals". completed_indices ריק אלא אם action="complete".
reply = משפט קצר, חם וטבעי בעברית שמאשר את הפעולה (בלי אימוג'ים מוגזמים, בלי מקפים ארוכים). אל תוסיף את רשימת המטרות ל-reply, המערכת מוסיפה אותה בעצמה.`;

async function understand(message, lastPrompt, today, tomorrow) {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
  const context =
    `הודעה יזומה אחרונה של הבוט: ${lastPrompt || "none"}\n\n` +
    `מטרות היום (${today.key}):\n` +
    (today.goals.length
      ? today.goals.map((g, i) => `${i + 1}. ${g.done ? "[הושלם]" : "[פתוח]"} ${g.text}`).join("\n")
      : "(ריק)") +
    `\n\nמטרות מחר (${tomorrow.key}):\n` +
    (tomorrow.goals.length
      ? tomorrow.goals.map((g, i) => `${i + 1}. ${g.text}`).join("\n")
      : "(ריק)") +
    `\n\nההודעה של המשתמש:\n${message}`;

  const res = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1024,
    output_config: { effort: "low", format: { type: "json_schema", schema: ACTION_SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: context }],
  });
  const text = res.content.find((b) => b.type === "text")?.text || "{}";
  return JSON.parse(text);
}

/** Heuristic fallback if the model call fails — keeps the bot responsive. */
function heuristic(message, lastPrompt) {
  const done = /(סיימתי|עשיתי|השלמתי|בוצע|גמרתי)/.test(message);
  if (done) return { action: "complete", day: "today", new_goals: [], completed_indices: [], reply: "רשמתי, כל הכבוד!" };
  if (lastPrompt === "evening")
    return {
      action: "set_goals",
      day: "tomorrow",
      new_goals: message.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean),
      completed_indices: [],
      reply: "רשמתי את המטרות למחר.",
    };
  return { action: "status", day: "today", new_goals: [], completed_indices: [], reply: "" };
}

// ── Apply a parsed action to Firestore, return the reply text ────────────────
async function applyAction(parsed) {
  const dayLabel = parsed.day === "tomorrow" ? "מחר" : "היום";
  const key = parsed.day === "tomorrow" ? tomorrowKey() : todayKey();

  if (parsed.action === "set_goals") {
    const goals = (parsed.new_goals || [])
      .map((t) => String(t).trim())
      .filter(Boolean)
      .map((text) => ({ text, done: false, doneAt: null }));
    await saveGoals(key, goals);
    return `${parsed.reply}\n\n${renderChecklist(dayLabel, goals)}`;
  }

  if (parsed.action === "complete") {
    const day = await loadDay(key);
    for (const idx of parsed.completed_indices || []) {
      const g = day.goals[idx - 1]; // model uses 1-based indices
      if (g && !g.done) {
        g.done = true;
        g.doneAt = new Date().toISOString();
      }
    }
    await saveGoals(key, day.goals);
    const remaining = day.goals.filter((g) => !g.done).length;
    const tail = remaining === 0 ? "\n\n🎉 סיימת את כל המטרות של היום!" : "";
    return `${parsed.reply}\n\n${renderChecklist(dayLabel, day.goals)}${tail}`;
  }

  // status / other → just show the relevant checklist
  const day = await loadDay(key);
  const prefix = parsed.reply ? `${parsed.reply}\n\n` : "";
  return `${prefix}${renderChecklist(dayLabel, day.goals)}`;
}

// ── Exported functions ───────────────────────────────────────────────────────

/** 21:00 Asia/Jerusalem — ask for tomorrow's goals. */
exports.goalBotEvening = onSchedule(
  { schedule: "0 21 * * *", timeZone: TZ, secrets: ALL_SECRETS },
  async () => {
    await setLastPrompt("evening");
    await sendTemplate(WHATSAPP_TO.value(), TEMPLATE_EVENING);
  },
);

/** 13:00 Asia/Jerusalem — ask which of today's goals are done. */
exports.goalBotMidday = onSchedule(
  { schedule: "0 13 * * *", timeZone: TZ, secrets: ALL_SECRETS },
  async () => {
    await setLastPrompt("midday");
    await sendTemplate(WHATSAPP_TO.value(), TEMPLATE_MIDDAY);
  },
);

/**
 * WhatsApp webhook.
 *   GET  — Meta's subscription verification handshake.
 *   POST — incoming messages. Only text from WHATSAPP_TO is acted on.
 */
exports.goalBotWebhook = onRequest({ secrets: ALL_SECRETS }, async (req, res) => {
  // 1) Verification handshake
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN.value()) {
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }

  if (req.method !== "POST") return res.sendStatus(405);

  // Always ack fast so Meta doesn't retry; process best-effort.
  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];

    // Ignore status callbacks / non-text / anyone who isn't the owner.
    if (!msg || msg.type !== "text" || msg.from !== WHATSAPP_TO.value()) {
      return res.sendStatus(200);
    }

    // Dedupe: Meta may retry the same message id.
    const seenRef = db().collection("goalBot").doc(`_seen_${msg.id}`);
    if ((await seenRef.get()).exists) return res.sendStatus(200);
    await seenRef.set({ at: FieldValue.serverTimestamp() });

    const body = (msg.text?.body || "").trim();
    const lastPrompt = await getLastPrompt();
    const today = await loadDay(todayKey());
    const tomorrow = await loadDay(tomorrowKey());

    let parsed;
    try {
      parsed = await understand(body, lastPrompt, today, tomorrow);
    } catch (e) {
      console.error("understand() failed, using heuristic", e?.message || e);
      parsed = heuristic(body, lastPrompt);
    }

    const reply = await applyAction(parsed);
    await sendText(msg.from, reply);

    // Consume the proactive-prompt context after the first reply to it.
    if (lastPrompt) await setLastPrompt(null);

    return res.sendStatus(200);
  } catch (e) {
    console.error("goalBotWebhook error", e?.message || e);
    return res.sendStatus(200); // never make Meta retry on our internal error
  }
});
