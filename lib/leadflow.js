// lib/leadflow.js
//
// Guided lead capture: instead of waiting for a phone number to appear
// naturally in conversation, the user presses a button (persistent menu,
// ice breaker, or quick reply — all deliver a payload) or types a keyword,
// and the bot walks them through name → email → phone, then pushes the
// lead to HubSpot immediately. Ad attribution is attached if a pending
// referral exists for the PSID; the lead is pushed either way.

const { extractPhoneNumber, extractEmail } = require("./detect");
const { sendTextMessage } = require("./send");
const {
  getPendingReferral,
  deletePendingReferral,
  saveLeadFlowState,
  getLeadFlowState,
  deleteLeadFlowState,
} = require("./store");
const { upsertContact } = require("./hubspot");
const { resolveAdName } = require("./meta");

const START_PAYLOAD = "LEAD_CAPTURE_START";

// Exact-match (case-insensitive) text commands that also start the flow,
// for users who type instead of tapping. Keep these to unambiguous words —
// this is matched against the whole message, not a substring.
const START_KEYWORDS = ["contact", "callback", "call me", "enquire", "enquiry"];

function isStartCommand(event) {
  const payload = event.postback?.payload || event.message?.quick_reply?.payload;
  if (payload === START_PAYLOAD) return true;
  const text = event.message?.text?.trim().toLowerCase();
  return Boolean(text) && START_KEYWORDS.includes(text);
}

async function startLeadFlow(psid) {
  await saveLeadFlowState(psid, { step: "name", lead: {} });
  await sendTextMessage(
    psid,
    "Happy to help — I'll just grab a few details so our team can reach you. What's your name?"
  );
}

// Processes a text message against any active flow for this PSID.
// Returns true if the message was consumed by the flow (so the caller
// skips passive phone/email detection), false if no flow is active.
async function handleLeadFlowMessage(psid, text) {
  const state = await getLeadFlowState(psid);
  if (!state) return false;

  const trimmed = (text || "").trim();
  if (!trimmed) return true;

  if (trimmed.toLowerCase() === "cancel") {
    await deleteLeadFlowState(psid);
    await sendTextMessage(psid, "No problem, cancelled — message us here any time.");
    return true;
  }

  if (state.step === "name") {
    state.lead.name = trimmed;
    state.step = "email";
    await saveLeadFlowState(psid, state);
    const firstName = trimmed.split(/\s+/)[0];
    await sendTextMessage(
      psid,
      `Thanks ${firstName}! What's your email address? (or type "skip")`
    );
    return true;
  }

  if (state.step === "email") {
    if (trimmed.toLowerCase() !== "skip") {
      const email = extractEmail(trimmed);
      if (!email) {
        await sendTextMessage(
          psid,
          'Hmm, that doesn\'t look like an email address — try again, or type "skip".'
        );
        return true;
      }
      state.lead.email = email;
    }
    state.step = "phone";
    await saveLeadFlowState(psid, state);
    await sendTextMessage(psid, "And the best phone number to reach you on?");
    return true;
  }

  if (state.step === "phone") {
    const phone = extractPhoneNumber(trimmed);
    if (!phone) {
      await sendTextMessage(
        psid,
        "That doesn't look like a phone number — could you re-type it? Digits only is fine."
      );
      return true;
    }
    state.lead.phone = phone;
    await finalizeLeadFlow(psid, state.lead);
    return true;
  }

  // Unknown step (bad data / old version) — clear it so the user isn't stuck.
  await deleteLeadFlowState(psid);
  return false;
}

async function finalizeLeadFlow(psid, lead) {
  let attribution = null;
  const pending = await getPendingReferral(psid);
  if (pending) {
    attribution = await resolveAdName(
      pending.adId,
      process.env.META_PAGE_ACCESS_TOKEN
    );
  }

  const [firstname, ...rest] = (lead.name || "").split(/\s+/);
  await upsertContact({
    phone: lead.phone,
    email: lead.email,
    firstname: firstname || undefined,
    lastname: rest.join(" ") || undefined,
    attribution,
  });

  await deleteLeadFlowState(psid);
  if (pending) await deletePendingReferral(psid);

  await sendTextMessage(
    psid,
    "Perfect, you're all set — our team will be in touch soon. Thanks!"
  );
}

module.exports = {
  START_PAYLOAD,
  isStartCommand,
  startLeadFlow,
  handleLeadFlowMessage,
};
