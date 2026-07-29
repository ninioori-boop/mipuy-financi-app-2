/**
 * clientBot — the multi-tenant PRODUCT WhatsApp bot for CLIENTS.
 *
 * Distinct and fully isolated from the personal goalBot (its own secrets, its own
 * Firestore collections). A client, once linked, can:
 *   • LOG an expense by message ("קניתי ב-50 בסופר") → reuses /api/transaction
 *     (categorization + flywheel + transactionInbox), which the app auto-drains.
 *   • ASK a question ("כמה נשאר לי לאוכל?") → answered from AGGREGATES only
 *     (summaries + app link; never raw transactions/merchant names).
 *
 * Identity: a client links their phone to their account ONCE with a short code
 * minted in the app (/api/wa-link-code). We store `whatsappLinks/{phone}→{uid,
 * practiceId, invitedByUid}`. A client only ever acts on THEIR OWN uid's data
 * (resolved from their own verified phone), so cross-client isolation is
 * structural. `practiceId`/`invitedByUid` are captured for the later advisor
 * cockpit + per-firm (white-label) phases. We also log `phone_number_id` now so a
 * per-firm number is a config change later, not a rewrite.
 *
 * Built + tested on the existing test number first (Ori as a stand-in client);
 * the real number is a config swap (CLIENT_WHATSAPP_* secrets + Meta callback).
 */

const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const Anthropic = require("@anthropic-ai/sdk");
const { summaryText } = require("./clientSelectors");
const { verifyMetaSignature } = require("./waSignature");

// ── Secrets (separate from goalBot so the personal bot is untouched) ──────────
const CLIENT_WHATSAPP_TOKEN = defineSecret("CLIENT_WHATSAPP_TOKEN");
const CLIENT_WHATSAPP_PHONE_ID = defineSecret("CLIENT_WHATSAPP_PHONE_ID");
const CLIENT_WHATSAPP_VERIFY_TOKEN = defineSecret("CLIENT_WHATSAPP_VERIFY_TOKEN");
// Meta app secret — verifies X-Hub-Signature-256 so only genuine Meta POSTs are
// processed (both bots share one Meta app, so one shared secret).
const WHATSAPP_APP_SECRET = defineSecret("WHATSAPP_APP_SECRET");
// Reuses the EXISTING Secret Manager secret named "mail" (holds the Claude key).
const ANTHROPIC_API_KEY = defineSecret("mail");

// The client's device token (for POSTing to /api/transaction) is minted by
// /api/wa-link-code and stored on the link — the bot never needs TRANSACTION_SECRET.
const ALL_SECRETS = [
  CLIENT_WHATSAPP_TOKEN,
  CLIENT_WHATSAPP_PHONE_ID,
  CLIENT_WHATSAPP_VERIFY_TOKEN,
  WHATSAPP_APP_SECRET,
  ANTHROPIC_API_KEY,
];

const GRAPH_VERSION = "v21.0";
const APP_URL = "https://app.orimipuy.com";
const DEFAULT_BOT_NAME = "הכלכלן של הבית";

/**
 * White-label: the bot speaks in the CLIENT'S FIRM'S name, not the platform's.
 * Reads practices/{id}.brand (same doc /api/brand resolves for the web app),
 * live and uncached — the bot is far lower-traffic than the AI-quota reads it
 * already pays per message, and "the firm renamed itself" must take effect on
 * the very next message, not up to a minute later.
 *
 * The link is the firm's own short link (/go/{slug}) when they have one —
 * otherwise the plain app URL. Never throws; every caller gets a usable brand
 * even if the practice doc read fails.
 */
/**
 * Single read of practices/{id}, shared by botBrand() and practiceAiConfig()
 * (via brandFromDoc/aiConfigFromDoc below) — a practice client's message used
 * to pay for this same document twice (once per deriver). Never throws.
 */
async function loadPracticeDoc(practiceId) {
  if (!practiceId) return null;
  try {
    const snap = await db().collection("practices").doc(practiceId).get();
    return snap.exists ? snap.data() : null;
  } catch {
    return null;
  }
}

function brandFromDoc(doc) {
  const fallback = { nameHe: DEFAULT_BOT_NAME, url: APP_URL };
  const b = doc && doc.brand;
  if (!b || typeof b !== "object") return fallback;
  const nameHe = typeof b.nameHe === "string" && b.nameHe.trim() ? b.nameHe.trim() : fallback.nameHe;
  // Defensive re-validation independent of whoever wrote the field — this
  // string goes straight into a URL sent to a client's WhatsApp.
  const slug = typeof b.slug === "string" ? b.slug.trim() : "";
  const url = /^[a-z0-9-]{2,32}$/.test(slug) ? `${APP_URL}/go/${slug}` : APP_URL;
  return { nameHe, url };
}

async function botBrand(practiceId) {
  if (!practiceId) return { nameHe: DEFAULT_BOT_NAME, url: APP_URL };
  return brandFromDoc(await loadPracticeDoc(practiceId));
}

function helpText(brand) {
  return (
    `אני הבוט של ${brand.nameHe} 🙂\n` +
    "אפשר:\n" +
    '• לרשום הוצאה: "קניתי ב-50 בסופר"\n' +
    '• לשאול: "כמה נשאר לי לאוכל החודש?"\n' +
    "הפירוט המלא תמיד באפליקציה: " + brand.url
  );
}

// ── Firestore (lazy — admin app initialized in index.js) ─────────────────────
function db() {
  return getFirestore();
}

const normalizePhone = (from) => String(from || "").replace(/\D/g, "");

const TZ = "Asia/Jerusalem";
/** Today's date in Israel (YYYY-MM-DD) — anchors relative dates like "אתמול". */
function todayKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/**
 * Owner-access model: the bot serves ANY user whose phone resolves to a uid via
 * whatsappLinks — including a self-serve user with NO advisor link. Possessing a
 * whatsappLink is itself the proof of ownership (it is minted only from an
 * authenticated in-app session, in /api/wa-link-code), so access is NOT gated on
 * an advisor clientLink — this mirrors the app's own owner-access model.
 *
 * clientLinks is read live only to resolve FRESH tenancy (practiceId/invitedByUid)
 * for a practice client, for white-label routing/observability; a self-serve user
 * simply resolves to nulls. This NEVER denies access — fail-open on tenancy.
 */
// ── AI cost guards ───────────────────────────────────────────────────────────
// Every inbound message costs at least one model call (intent routing), and a
// question costs two — this is the highest-frequency AI surface in the product
// and until now it had NO limit of any kind. Fixed-window counters in the same
// `rateLimits` collection the web routes use; fail-open, because a counter
// failure must never silence the bot.
const AI_DAY_MS = 86_400_000;
const AI_HOUR_MS = 3_600_000;
const BOT_USER_HOURLY = 40;              // one person, one hour
const BOT_PRACTICE_DAILY = 2500;         // matches the web default ceiling
const BOT_USER_DAILY = 300;              // a user with no practice gets their own

/**
 * The firm's own settings, read live so a ceiling raised (or a firm switched
 * off) in Firestore applies to WhatsApp too — this counter is SHARED with the
 * web routes, so a hardcoded number here would silently override it.
 */
function aiConfigFromDoc(doc) {
  const q = (doc && doc.aiQuota) || {};
  const lim = Number(q.dailyLimit);
  return { dailyLimit: lim > 0 ? lim : BOT_PRACTICE_DAILY, disabled: q.disabled === true };
}

async function practiceAiConfig(practiceId) {
  if (!practiceId) return { dailyLimit: BOT_PRACTICE_DAILY, disabled: false };
  return aiConfigFromDoc(await loadPracticeDoc(practiceId));
}

/**
 * Shared emergency stop. The web's AI_KILL_SWITCH is a Vercel env var and
 * cannot reach Cloud Functions, so the real panic button lives in Firestore
 * (config/ai.killSwitch) and both deploys honour it. Cached briefly so the
 * highest-frequency AI surface does not pay a read per message.
 */
let killCache = { at: 0, value: false };
async function aiKillSwitchOn() {
  if (Date.now() - killCache.at < 60_000) return killCache.value;
  try {
    const snap = await db().collection("config").doc("ai").get();
    killCache = { at: Date.now(), value: snap.exists && snap.data().killSwitch === true };
  } catch {
    killCache = { at: Date.now(), value: false };   // fail-open
  }
  return killCache.value;
}

async function consumeBotQuota(key, limit, windowMs) {
  try {
    const bucket = Math.floor(Date.now() / windowMs);
    const ref = db().collection("rateLimits").doc(`${key}_${bucket}`.replace(/\//g, "_"));
    return await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const count = snap.exists ? Number(snap.data().count || 0) : 0;
      if (count >= limit) return false;
      tx.set(ref, { count: FieldValue.increment(1), expireAt: new Date((bucket + 1) * windowMs + 60_000) }, { merge: true });
      return true;
    });
  } catch (e) {
    console.warn("consumeBotQuota failed (fail-open)", e && e.message ? e.message : e);
    return true;
  }
}

/** Per-practice daily usage rollup — the same shape the web routes write. */
async function recordBotUsage(practiceId) {
  try {
    const day = todayKey();
    await db().collection("aiUsage").doc(`${practiceId || "_none"}_${day}`).set({
      practiceId: practiceId || "_none",
      day,
      total: FieldValue.increment(1),
      // Nested map, not a dotted key — set({merge:true}) would store the dot
      // as part of the field NAME and the usage report would read zeros.
      byRoute: { whatsapp: FieldValue.increment(1) },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch { /* accounting never blocks a reply */ }
}

async function resolveTenancy(uid) {
  try {
    const snap = await db().collection("clientLinks").doc(uid).get();
    if (!snap.exists) return { practiceId: null, invitedByUid: null };
    const d = snap.data() || {};
    return { practiceId: d.practiceId || null, invitedByUid: d.invitedByUid || null };
  } catch (e) {
    console.error("resolveTenancy failed", e && e.message ? e.message : e);
    return { practiceId: null, invitedByUid: null };
  }
}

// ── WhatsApp Cloud API senders (product-bot number) ──────────────────────────
async function waPost(body) {
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${CLIENT_WHATSAPP_PHONE_ID.value()}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CLIENT_WHATSAPP_TOKEN.value()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
    },
  );
  if (!res.ok) {
    console.error("clientBot waPost failed", res.status, await res.text().catch(() => ""));
  }
  return res.ok;
}
const sendText = (to, bodyText) => waPost({ to, type: "text", text: { body: bodyText } });

// ── Identity: phone ↔ uid ────────────────────────────────────────────────────
async function resolveLink(phone) {
  const snap = await db().collection("whatsappLinks").doc(phone).get();
  if (!snap.exists) return null;
  const d = snap.data() || {};
  return {
    uid: d.uid,
    practiceId: d.practiceId || null,
    invitedByUid: d.invitedByUid || null,
    deviceToken: d.deviceToken || null,
  };
}

/** Look for a one-time link code in the message and, if valid, bind phone→uid. */
async function tryConsumeCode(phone, text) {
  const candidates = String(text || "").toUpperCase().match(/[A-Z0-9]{4,10}/g);
  if (!candidates) return { ok: false };
  for (const code of candidates) {
    const codeRef = db().collection("whatsappLinkCodes").doc(code);
    try {
      const result = await db().runTransaction(async (tx) => {
        const snap = await tx.get(codeRef);
        if (!snap.exists) return { ok: false };
        const d = snap.data() || {};
        if (d.consumed) return { ok: false, reason: "used" };
        const exp = d.expiresAt && typeof d.expiresAt.toMillis === "function" ? d.expiresAt.toMillis() : 0;
        if (exp && exp < Date.now()) return { ok: false, reason: "expired" };
        tx.set(db().collection("whatsappLinks").doc(phone), {
          uid: d.uid,
          practiceId: d.practiceId || null,
          invitedByUid: d.invitedByUid || null,
          deviceToken: d.deviceToken || null,
          linkedAt: FieldValue.serverTimestamp(),
        });
        // Move (not copy) the credential: strip it from the code doc once linked,
        // so a long-lived bearer token doesn't linger in whatsappLinkCodes.
        tx.update(codeRef, {
          consumed: true,
          consumedAt: FieldValue.serverTimestamp(),
          consumedByPhone: phone,
          deviceToken: FieldValue.delete(),
        });
        return { ok: true, uid: d.uid, practiceId: d.practiceId || null };
      });
      if (result.ok) return result;
    } catch (e) {
      console.error("tryConsumeCode tx failed", e && e.message ? e.message : e);
    }
  }
  return { ok: false };
}

// ── Expense capture — reuse /api/transaction (categorize + inbox + budget) ────
async function logExpense(deviceToken, expense, msgId) {
  if (!deviceToken) return "החיבור לא הושלם. פתח/י מחדש את החיבור לוואטסאפ באפליקציה.";
  const payload = {
    token: deviceToken,
    merchant: expense.merchant,
    amount: expense.amount,
    ref: "wa:" + msgId, // idempotency on the app's inbox drain
    source: "whatsapp",
  };
  if (expense.date) payload.date = expense.date;

  let res, json;
  try {
    res = await fetch(`${APP_URL}/api/transaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    json = await res.json().catch(() => ({}));
  } catch (e) {
    console.error("logExpense fetch failed", e && e.message ? e.message : e);
    return "לא הצלחתי לרשום את ההוצאה כרגע, נסה/י שוב עוד רגע.";
  }
  if (res.ok && json.ok) {
    // The endpoint's 180s same-merchant+amount guard returns ok+duplicate WITHOUT
    // writing — be honest rather than claiming "נרשם" for something we didn't add.
    if (json.duplicate) return "נראה שזה כבר נרשם לאחרונה, אז לא הוספתי שוב 🙂";
    return (json.notify && json.notify.text) || "נרשם ✅";
  }
  if (res.status === 400 && json.error === "echo") return "ההודעה הזאת כבר נרשמה 🙂";
  if (res.status === 401) return "החיבור פג. פתח/י מחדש את החיבור לוואטסאפ באפליקציה.";
  if (res.status === 503) return "השירות בהרצה, נסה/י שוב עוד רגע.";
  console.error("logExpense rejected", res.status, JSON.stringify(json).slice(0, 200));
  return "לא הצלחתי לרשום את ההוצאה כרגע.";
}

// ── Intent parsing (Claude structured output + heuristic fallback) ───────────
const INTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: { type: "string", enum: ["log_expense", "ask_question", "help", "other"] },
    merchant: { type: "string" }, // for log_expense; "" otherwise
    amount: { type: "number" }, // for log_expense; 0 otherwise
    date: { type: "string" }, // "YYYY-MM-DD" or ""
    question: { type: "string" }, // for ask_question; "" otherwise
    reply: { type: "string" }, // used only for help/other
  },
  required: ["intent", "merchant", "amount", "date", "question", "reply"],
};

const INTENT_SYSTEM = `אתה מנתב של בוט פיננסי בוואטסאפ, בעברית. הבוט רושם הוצאות ועונה על שאלות פיננסיות. החזר סיווג מובנה בלבד.

כללי החלטה:
- ניסוח של קנייה/תשלום אחת ("קניתי ב-50 בסופר", "שילמתי 120 חשמל", "50 שקל אוכל", "הוצאתי 90 בתחנת דלק") → intent="log_expense". merchant = שם בית העסק או תיאור קצר ("סופר", "חשמל", "דלק"). amount = הסכום כמספר (חיובי).
  - date = "YYYY-MM-DD". אם צוין תאריך מפורש או ביטוי יחסי ("אתמול", "שלשום", "ביום ראשון") — חשב אותו ביחס לתאריך של היום שיינתן לך. אם לא צוין תאריך כלל — "".
  - אם זו כוונת תיעוד אבל חסר הסכום — amount=0. אם חסר שם בית העסק — merchant="". (המערכת תשאל להשלמה, אל תמציא.)
- **כמה קניות שונות בהודעה אחת** ("קניתי ב-50 בסופר וב-30 בפארם") → intent="other", ו-reply שמבקש בעדינות לשלוח כל הוצאה בהודעה נפרדת. אל תנסה לאחד אותן לרשומה אחת.
- שאלה על תקציב/הוצאות/יתרה/יעדים/מצב ("כמה נשאר לי לאוכל", "כמה הוצאתי החודש", "מה המצב שלי", "כמה נשאר בתקציב") → intent="ask_question". question = השאלה כפי שנשאלה.
- בקשת עזרה/מה אתה יודע לעשות → intent="help".
- אחרת → intent="other".

שדות לא-רלוונטיים: merchant="", amount=0, question="", date="".
reply = משמש רק ל-help/other: הודעה קצרה ומועילה בעברית, **בשם הזהות שתינתן לך בהודעת המשתמש** (לעולם לא בשם קבוע אחר). אחרת reply="".`;

async function understand(message, brand) {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
  const b = brand || { nameHe: DEFAULT_BOT_NAME, url: APP_URL };
  // Router runs on EVERY message and must extract amount + merchant from free
  // Hebrew accurately (a misparse logs a wrong expense — data-quality stake), so
  // it uses Sonnet: much cheaper than Opus, stronger than Haiku on messy Hebrew.
  // max_tokens is generous (1024) because Sonnet's adaptive thinking shares this
  // budget with the JSON output — too tight and the structured output truncates,
  // which would throw on JSON.parse and silently drop us to the heuristic parser.
  //
  // Brand is injected in the USER turn, not the (static, cache-friendly) system
  // prompt: the model free-writes `reply` for help/other intents (e.g. the
  // multi-purchase nudge), and without this it silently names itself after
  // nothing/the wrong firm — the exact gap a live test caught (2026-07-29).
  const res = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    output_config: { format: { type: "json_schema", schema: INTENT_SCHEMA } },
    system: INTENT_SYSTEM,
    messages: [{
      role: "user",
      content: `התאריך היום (Asia/Jerusalem): ${todayKey()}\nזהות הבוט: אתה הבוט של "${b.nameHe}". אם ה-reply שאתה כותב מזכיר את שמך או מפנה לאפליקציה, השתמש רק בשם ובקישור האלה: ${b.url}. אל תמציא שם או קישור אחר.\n\nההודעה של הלקוח:\n${message}`,
    }],
  });
  const text = res.content.find((block) => block.type === "text")?.text || "{}";
  return JSON.parse(text);
}

/**
 * Keyword fallback if the model call fails — keeps the bot responsive.
 * `brand` is threaded through: this runs exactly when the AI call just
 * failed, i.e. the worst moment to answer a white-label client under the
 * PLATFORM's name instead of their own firm's.
 */
function heuristic(message, brand) {
  const m = String(message || "");
  const numMatch = m.match(/(\d[\d,]*(?:\.\d+)?)/); // handles "1,234.56"
  const looksExpense = /(קניתי|שילמתי|שילמת|הוצאתי|₪|שקל|ש"?ח|\bב-?\d)/.test(m) && numMatch;
  if (looksExpense) {
    const amount = Number(numMatch[1].replace(/,/g, "")); // strip thousands separators
    const merchant = m.replace(numMatch[0], " ").replace(/(קניתי|שילמתי|הוצאתי|₪|שקל|ש"?ח|ב-)/g, " ").replace(/\s+/g, " ").trim();
    return { intent: "log_expense", merchant: merchant || "הוצאה", amount, date: "", question: "", reply: "" };
  }
  if (/(כמה|נשאר|מצב|תקציב|יתרה|הוצאתי|יעד)/.test(m)) {
    return { intent: "ask_question", merchant: "", amount: 0, date: "", question: m, reply: "" };
  }
  return { intent: "other", merchant: "", amount: 0, date: "", question: "", reply: helpText(brand || { nameHe: DEFAULT_BOT_NAME, url: APP_URL }) };
}

// ── Question answering — AGGREGATES ONLY, grounded in the snapshot ───────────
const QA_SYSTEM = `אתה עוזר פיננסי בוואטסאפ, בעברית. ענה על שאלת הלקוח אך ורק לפי הנתונים שניתנו (אגרגטים בלבד).
- תשובה קצרה וברורה, עם המספרים מהנתונים.
- אל תמציא מספרים או עובדות שלא בנתונים. אם המידע חסר, אמור שאפשר לראות את הפירוט המלא באפליקציה.
- לעולם אל תפרט שמות בתי-עסק או עסקאות בודדות (אין לך אותם ואסור להמציא).
- בלי מקפים ארוכים.`;

async function answerQuestion(uid, question, brand) {
  const url = (brand && brand.url) || APP_URL;
  let data = null;
  try {
    const uDoc = await db().collection("users").doc(uid).get();
    data = uDoc.exists ? uDoc.data().data : null;
  } catch (e) {
    console.error("answerQuestion read failed", e && e.message ? e.message : e);
  }
  if (!data) return "עדיין אין נתונים בחשבון שלך. אפשר להתחיל לתעד הוצאות כאן 🙂";
  const summary = summaryText(data);
  try {
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
    const res = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 400,
      output_config: { effort: "low" },
      system: QA_SYSTEM,
      messages: [{ role: "user", content: `נתוני הלקוח (אגרגטים בלבד):\n${summary}\n\nהשאלה: ${question}` }],
    });
    const text = res.content.find((b) => b.type === "text")?.text?.trim();
    return text || `אפשר לראות את התמונה המלאה באפליקציה: ${url}`;
  } catch (e) {
    console.error("answerQuestion AI failed", e && e.message ? e.message : e);
    return `לא הצלחתי לחשב את זה כרגע. אפשר לראות הכל באפליקציה: ${url}`;
  }
}

// ── Webhook ──────────────────────────────────────────────────────────────────
exports.clientBotWebhook = onRequest({ secrets: ALL_SECRETS }, async (req, res) => {
  // Meta subscription verification handshake.
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    if (mode === "subscribe" && token === CLIENT_WHATSAPP_VERIFY_TOKEN.value()) {
      return res.status(200).send(req.query["hub.challenge"]);
    }
    return res.sendStatus(403);
  }
  if (req.method !== "POST") return res.sendStatus(405);

  // Authenticate the request as genuinely from Meta before trusting anything in
  // it — otherwise a forged POST with a spoofed `from` acts as that linked user.
  if (!verifyMetaSignature(req, WHATSAPP_APP_SECRET.value())) {
    console.error("clientBot: invalid X-Hub-Signature-256");
    return res.sendStatus(403);
  }

  // Always ack fast so Meta doesn't retry; process best-effort.
  try {
    const change = req.body?.entry?.[0]?.changes?.[0];
    const value = change?.value;
    const msg = value?.messages?.[0];
    // Future per-firm routing key (white-label). Logged now, mapped in Phase 5.
    const phoneNumberId = value?.metadata?.phone_number_id;

    if (!msg || msg.type !== "text") return res.sendStatus(200);
    const phone = normalizePhone(msg.from);
    const body = (msg.text?.body || "").trim();

    // Dedup: Meta retries the same message id.
    const seenRef = db().collection("clientBot").doc(`_seen_${msg.id}`);
    if ((await seenRef.get()).exists) return res.sendStatus(200);
    await seenRef.set({ at: FieldValue.serverTimestamp() });

    // A valid link code re-binds the phone on ANY message — even an already-linked
    // one — so a client whose token died can reconnect. (Otherwise the bot bricks:
    // it would parse "קוד ABC123" as an expense.) Normal messages carry no code, so
    // this is a cheap regex miss for them.
    const consumed = await tryConsumeCode(phone, body);
    if (consumed.ok) {
      // Re-resolve tenancy FRESH rather than trust the code's practiceId
      // snapshot (up to 15 minutes stale) — every message after this one
      // brands from a live read, so the welcome message must match, not lag.
      const welcomeTenancy = await resolveTenancy(consumed.uid);
      const brand = await botBrand(welcomeTenancy.practiceId || consumed.practiceId);
      await sendText(msg.from,
        `מעולה, התחברת ל${brand.nameHe}! ✅\nמעכשיו אפשר לרשום הוצאות (למשל "קניתי ב-50 בסופר") ולשאול שאלות ("כמה נשאר לי לאוכל?").`);
      return res.sendStatus(200);
    }

    const link = await resolveLink(phone);
    if (!link) {
      // No uid yet — there is no firm to brand this as. Generic by necessity.
      await sendText(msg.from,
        `היי 👋 כדי להתחבר לחשבון שלך: פתח/י את האפליקציה, היכנס/י למסך "וואטסאפ", ושלח/י לי את הקוד שמופיע שם.\n${APP_URL}`);
      return res.sendStatus(200);
    }

    // Owner-access: the resolved whatsappLink IS the authorization (minted from an
    // authenticated app session), so a linked user is never denied — a self-serve
    // user with no advisor link works too. We resolve tenancy live only for
    // white-label routing/observability (Phase 2+), never as a gate.
    const tenancy = await resolveTenancy(link.uid);
    if (tenancy.practiceId) console.log("clientBot msg", { phoneNumberId, practiceId: tenancy.practiceId });
    // One read of the practice doc, shared by the brand and AI-quota derivers
    // below — the log_expense path never touches aiQuota, and the guard path
    // never needs a second fetch of the same document.
    const practiceDoc = await loadPracticeDoc(tenancy.practiceId);
    // Every reply from here on speaks in the client's own firm's name.
    const brand = brandFromDoc(practiceDoc);

    // AI cost guards, checked BEFORE any model call. Runaway guards sized far
    // above real conversation, not conversational rationing.
    if (await aiKillSwitchOn()) {
      await sendText(msg.from, "השירות מושהה זמנית לתחזוקה. אפשר להמשיך לעבוד באפליקציה כרגיל: " + brand.url);
      return res.sendStatus(200);
    }
    // Per-person first: someone who floods must not eat the firm's budget.
    const userOk = await consumeBotQuota(`wa-ai:${link.uid}`, BOT_USER_HOURLY, AI_HOUR_MS);
    if (!userOk) {
      await sendText(msg.from, "קיבלתי הרבה הודעות בזמן קצר. אני חוזר לזמינות מלאה בעוד שעה. בינתיים אפשר להיכנס לאפליקציה: " + brand.url);
      return res.sendStatus(200);
    }
    if (tenancy.practiceId) {
      const cfg = aiConfigFromDoc(practiceDoc);
      if (cfg.disabled) {
        await sendText(msg.from, "שירות ההודעות מושהה כרגע עבור המשרד שלך. אפשר להמשיך לעבוד באפליקציה כרגיל: " + brand.url);
        return res.sendStatus(200);
      }
      const practiceOk = await consumeBotQuota(`ai:practice:${tenancy.practiceId}`, cfg.dailyLimit, AI_DAY_MS);
      if (!practiceOk) {
        await sendText(msg.from, "המשרד שלך הגיע למכסת ה-AI היומית. המכסה מתאפסת מחר, ובינתיים אפשר להמשיך באפליקציה: " + brand.url);
        return res.sendStatus(200);
      }
    } else {
      // No practice: a per-user daily ceiling, never a pool shared with strangers.
      const selfOk = await consumeBotQuota(`ai:user-day:${link.uid}`, BOT_USER_DAILY, AI_DAY_MS);
      if (!selfOk) {
        await sendText(msg.from, "הגעת למכסת ההודעות היומית. המכסה מתאפסת מחר, ובינתיים אפשר להמשיך באפליקציה: " + brand.url);
        return res.sendStatus(200);
      }
    }
    await recordBotUsage(tenancy.practiceId);

    // Classify intent and act on the client's OWN data (uid).
    let parsed;
    try {
      parsed = await understand(body, brand);
    } catch (e) {
      console.error("clientBot understand failed, using heuristic", e && e.message ? e.message : e);
      parsed = heuristic(body, brand);
    }

    let reply;
    if (parsed.intent === "log_expense") {
      const amount = Number(parsed.amount);
      const merchant = String(parsed.merchant || "").trim();
      if (!(amount > 0) || !merchant) {
        // Missing amount or merchant → ask, never guess (don't log "50" as a merchant).
        reply = 'רוצה לתעד הוצאה? כתוב/כתבי לי גם כמה וגם על מה, למשל: "קניתי ב-50 בסופר".';
      } else {
        reply = await logExpense(link.deviceToken, { merchant, amount, date: parsed.date }, msg.id);
      }
    } else if (parsed.intent === "ask_question") {
      reply = await answerQuestion(link.uid, parsed.question || body, brand);
    } else {
      reply = parsed.reply || helpText(brand);
    }

    await sendText(msg.from, reply);
    return res.sendStatus(200);
  } catch (e) {
    console.error("clientBotWebhook error", e && e.message ? e.message : e);
    return res.sendStatus(200); // never make Meta retry on our internal error
  }
});
