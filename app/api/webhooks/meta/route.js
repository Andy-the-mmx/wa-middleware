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
const {
  START_PAYLOAD,
  isStartCommand,
  startLeadFlow,
  handleLeadFlowMessage,
} = require("../../../../lib/leadflow");
const { sendQuickReplies } = require("../../../../lib/send");

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

  // Ignore echoes of our own outbound messages (delivered if the
  // message_echoes field is ever subscribed) — otherwise the bot's own
  // prompts would be fed back through the flow.
  if (event.message?.is_echo) return;

  // Capture the ad referral wherever it appears: standalone event, attached
  // to the first message, or attached to a postback (ads that open with an
  // ice breaker / button tap deliver it there).
  const referral =
    event.referral || event.message?.referral || event.postback?.referral;
  if (referral?.ad_id) {
    await savePendingReferral(psid, {
      adId: referral.ad_id,
      startedAt: Date.now(),
    });
    // No return — the same event may also carry a message or button press.
  }

  // Get Started button (Messenger) — greet and offer the capture flow.
  if (event.postback?.payload === "GET_STARTED") {
    await sendQuickReplies(psid, "Hi! Thanks for reaching out — how can we help?", [
      { title: "Leave my details", payload: START_PAYLOAD },
    ]);
    return;
  }

  // Guided lead capture: a button press or keyword starts the flow...
  if (isStartCommand(event)) {
    await startLeadFlow(psid);
    return;
  }

  const text = event.message?.text;
  if (!text) return;

  // ...and while active, the flow consumes messages (name → email → phone).
  if (await handleLeadFlowMessage(psid, text)) return;

  // Passive path: watch ordinary messages for a phone number or email.
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
