// lib/meta.js
const crypto = require("crypto");

// Validates the X-Hub-Signature-256 header Meta sends on every webhook POST,
// so you're not processing forged requests. rawBody must be the raw request
// body string/buffer, not a parsed object — signatures are computed over the
// exact bytes sent.
function verifyWebhookSignature(rawBody, signatureHeader, appSecret) {
  if (!signatureHeader || !appSecret) return false;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signatureHeader);
  // timingSafeEqual throws on length mismatch — a malformed header should be
  // rejected as unauthorized, not crash the handler into a 500.
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

// Resolves an ad ID from a referral payload into human-readable names via
// the Marketing API, so HubSpot gets "Winter sale — carousel" instead of a
// raw numeric ID.
async function resolveAdName(adId, pageAccessToken) {
  const url = `https://graph.facebook.com/v19.0/${adId}?fields=name,adset{name},campaign{name}&access_token=${pageAccessToken}`;
  const res = await fetch(url);
  if (!res.ok) {
    // Ad may have been deleted, or the token may lack ads_read on this asset.
    // Fall back to storing the raw ID so attribution isn't lost entirely.
    return { adName: null, adSetName: null, campaignName: null, rawAdId: adId };
  }
  const data = await res.json();
  return {
    adName: data.name || null,
    adSetName: data.adset?.name || null,
    campaignName: data.campaign?.name || null,
    rawAdId: adId,
  };
}

module.exports = { verifyWebhookSignature, resolveAdName };
