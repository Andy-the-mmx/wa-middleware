// lib/store.js
//
// Serverless functions are stateless between invocations, so the link
// between "this PSID opened a DM from this ad" and "this PSID later gave a
// phone number" has to live somewhere persistent in between — which, given
// the luxury sales cycle described in the spec, could be days.
//
// Uses Upstash Redis directly (the product Vercel KV was built on, and its
// official replacement now that Vercel KV itself is discontinued). If you're
// not deploying on Vercel, swap the client below for your own Redis/DB
// client — keep the same three function signatures so the rest of the app
// doesn't need to change.
//
// Vercel's marketplace integration for Upstash has historically injected
// credentials under slightly different variable names depending on the
// install path (KV_REST_API_URL/TOKEN for backward compatibility with the
// old Vercel KV product, or UPSTASH_REDIS_REST_URL/TOKEN if connected more
// directly). This checks both so it works regardless of which one Vercel
// actually created in your project.

const { Redis } = require("@upstash/redis");

const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

if (!redisUrl || !redisToken) {
  // Fail loudly at import time rather than on first use — a silently-missing
  // store means referrals just vanish with no error until someone notices
  // attribution isn't showing up in HubSpot.
  throw new Error(
    "Redis credentials not found. Expected KV_REST_API_URL/KV_REST_API_TOKEN " +
      "or UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN in the environment. " +
      "Check Project Settings > Environment Variables in Vercel for the " +
      "actual names your Upstash integration created."
  );
}

const redis = new Redis({ url: redisUrl, token: redisToken });

const KEY_PREFIX = "referral:";
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days — adjust to match how long a DM-to-phone gap can realistically be

async function savePendingReferral(psid, data) {
  await redis.set(`${KEY_PREFIX}${psid}`, JSON.stringify(data), { ex: TTL_SECONDS });
}

async function getPendingReferral(psid) {
  const raw = await redis.get(`${KEY_PREFIX}${psid}`);
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function deletePendingReferral(psid) {
  await redis.del(`${KEY_PREFIX}${psid}`);
}

module.exports = { savePendingReferral, getPendingReferral, deletePendingReferral };
