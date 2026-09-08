// lib/send.js
//
// Outbound messages via Meta's Send API. Works for both Messenger and
// Instagram DMs — Instagram messaging rides on the same /me/messages
// endpoint using the Page access token, provided the token carries
// instagram_manage_messages for IG conversations.

const GRAPH_API_BASE = "https://graph.facebook.com/v19.0";

async function callSendApi(body) {
  const res = await fetch(
    `${GRAPH_API_BASE}/me/messages?access_token=${process.env.META_PAGE_ACCESS_TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Meta Send API ${res.status}: ${detail}`);
  }
  return res.json();
}

async function sendTextMessage(psid, text) {
  return callSendApi({
    recipient: { id: psid },
    messaging_type: "RESPONSE",
    message: { text },
  });
}

// Quick replies render as tappable chips under the message. Messenger and
// Instagram both support text quick replies.
async function sendQuickReplies(psid, text, replies) {
  return callSendApi({
    recipient: { id: psid },
    messaging_type: "RESPONSE",
    message: {
      text,
      quick_replies: replies.map((r) => ({
        content_type: "text",
        title: r.title,
        payload: r.payload,
      })),
    },
  });
}

module.exports = { sendTextMessage, sendQuickReplies };
