// app/api/webhooks/meta/route.js
//
// Handles both halves of Meta's webhook contract:
//   GET  — the one-time verification handshake when you register the webhook URL
//   POST — actual messaging events as they happen
//
// Flow on POST, per message event:
//   1. If it carries a `referral` object → this is the first message of a
//      conversation that started from an ad click. Store the ad ID against
//      the sender's PSID and stop — there's nothing to attribute yet.
//   2. Otherwise → this is an ordinary message. Run phone/email detection.
//      If a match is found, look up any pending referral for this PSID and,
//      if one exists, upsert the HubSpot contact with that attribution.

const { verifyWebhookSignature, resolveAdName } = require("../../../../lib/meta");
const { extractPhoneNumber, extractEmail } = require("../../../../lib/detect");
const {
  savePendingReferral,
  getPendingReferral,
  deletePendingReferral,
} = require("../../../../lib/store");
const { upsertContactAttribution } = require("../../../../lib/hubspot");

// --- Verification handshake -------------------------------------------------

async function GET(request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

// --- Incoming events ---------------------------------------------------------

async function POST(request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifyWebhookSignature(rawBody, signature, process.env.META_APP_SECRET)) {
    return new Response("Invalid signature", { status: 401 });
  }

  const payload = JSON.parse(rawBody);

  for (const entry of payload.entry || []) {
    for (const event of entry.messaging || []) {
      try {
        await handleMessagingEvent(event);
      } catch (err) {
        // Log and continue — one malformed event shouldn't drop the rest of
        // the batch. Wire this into your actual logging/alerting.
        console.error("Failed to process messaging event", err);
      }
    }
  }

  // Always 200 quickly — Meta retries aggressively on non-2xx responses.
  return new Response("EVENT_RECEIVED", { status: 200 });
}

async function handleMessagingEvent(event) {
  const psid = event.sender?.id;
  if (!psid) return;

  // Case 1: conversation just started from an ad click.
  const referral = event.referral || event.message?.referral;
  if (referral?.ad_id) {
    await savePendingReferral(psid, {
      adId: referral.ad_id,
      startedAt: Date.now(),
    });
    return;
  }

  // Case 2: an ordinary message — check for a phone number or email.
  const text = event.message?.text;
  if (!text) return;

  const phone = extractPhoneNumber(text);
  const email = extractEmail(text);
  if (!phone && !email) return;

  const pending = await getPendingReferral(psid);
  if (!pending) {
    // No ad referral on file for this PSID — either it's an organic
    // conversation, or the referral was never captured. Nothing to
    // attribute; let Podium/HubSpot's normal contact creation handle it.
    return;
  }

  const attribution = await resolveAdName(
    pending.adId,
    process.env.META_PAGE_ACCESS_TOKEN
  );

  if (phone) {
    await upsertContactAttribution({ phone, email, attribution });
    await deletePendingReferral(psid);
  }
}

module.exports = { GET, POST };
