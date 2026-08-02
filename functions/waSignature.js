/**
 * Verify Meta's `X-Hub-Signature-256` on an incoming WhatsApp webhook POST.
 *
 * Meta signs the RAW request body with the app secret and sends it as
 * "sha256=<hex>". Without this check the webhook is a public endpoint anyone can
 * POST to — a forged body with a spoofed `from` would be acted on as that user.
 *
 * Uses `req.rawBody` (Cloud Functions provides the raw bytes; the parsed
 * `req.body` cannot be re-serialized byte-identically). Fail-closed: any missing
 * piece (header, secret, raw body) returns false, so unsigned requests are
 * rejected rather than trusted.
 */
const { createHmac, timingSafeEqual } = require("crypto");

function verifyMetaSignature(req, appSecret) {
  if (!appSecret) return false;
  const header = (typeof req.get === "function"
    ? req.get("x-hub-signature-256")
    : req.headers && req.headers["x-hub-signature-256"]) || "";
  const raw = req.rawBody;
  if (!header || !raw) return false;

  const expected = "sha256=" + createHmac("sha256", appSecret).update(raw).digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

module.exports = { verifyMetaSignature };
