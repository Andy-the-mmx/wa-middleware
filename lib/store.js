// lib/store.js
//
// Serverless functions are stateless between invocations, so the link
// between "this PSID opened a DM from this ad" and "this PSID later gave a
// phone number" has to live somewhere persistent in between — which, given
// the luxury sales cycle described in the spec, could be days.
//
// This file wraps Vercel KV by default. If you're not deploying on Vercel,
// swap the implementation below for your own Redis/DB client — keep the same
// three function signatures so the rest of the app doesn't need to change.

const { kv } = require("@vercel/kv");

const KEY_PREFIX = "referral:";
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days — adjust to match how long a DM-to-phone gap can realistically be

async function savePendingReferral(psid, data) {
  await kv.set(`${KEY_PREFIX}${psid}`, JSON.stringify(data), { ex: TTL_SECONDS });
}

async function getPendingReferral(psid) {
  const raw = await kv.get(`${KEY_PREFIX}${psid}`);
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function deletePendingReferral(psid) {
  await kv.del(`${KEY_PREFIX}${psid}`);
}

module.exports = { savePendingReferral, getPendingReferral, deletePendingReferral };
