# Meta & Google Ads → HubSpot Attribution Middleware
### Technical specification — Phase 1 (attribution fix)

## 1. Problem statement

Marketing-sourced leads lose attribution before they reach HubSpot:

- **Meta click-to-message ads** open a Messenger/Instagram DM. The ad's referral
  data (which ad drove the conversation) is only available at the moment the DM
  opens, tied to a page-scoped ID (PSID/IGSID) — not a phone number. The phone
  number is usually given naturally, sometimes much later in the conversation
  (this is a luxury sales flow, not a transactional one, so a bot demanding a
  number up front is not acceptable).
- **Google Ads click-to-call** currently dials Podium's number directly, so no
  campaign/keyword/ad data is ever captured for the call.
- **Podium** creates/updates HubSpot contacts when a conversation starts or a
  number is texted. HubSpot and Podium sync **bidirectionally**: a contact
  created in HubSpot syncs down into Podium, and a new number texted in Podium
  pushes a new contact up into HubSpot immediately. Neither side reliably wins
  a "race" — whichever system captures a phone number first, the other
  receives a corresponding contact shortly after.

Because HubSpot's default "Original Source" is set once, whichever system
happens to create the contact first currently determines the reported source
— which today is usually Podium, discarding the actual Meta/Google campaign
data.

## 2. Solution overview

Two independent fixes feed one shared destination (a protected HubSpot
attribution property), and both rely on the same underlying pattern —
**upsert by phone number, not creation order.**

1. **Call tracking** (Google Ads + any Meta call ads) — a dynamic tracking
   number sits between the ad and Podium's real number. It logs the call with
   full campaign/keyword/ad attribution, then transparently forwards the call
   through to Podium. This is a configuration project on a third-party call
   tracking platform (CallRail, WhatConverts, or similar) — not custom code.
   Covered here only as a dependency; not part of this codebase.

2. **Middleware (this codebase)** — a webhook listener subscribed to the same
   Meta Page's Messenger/Instagram messaging events that:
   - Captures the ad referral (ad ID) the moment a DM opens, keyed by PSID
   - Watches subsequent messages in that same conversation for a phone
     number or email address appearing naturally
   - The moment one is found, resolves the ad ID to a campaign/ad name via
     the Meta Marketing API, then **upserts** the matching HubSpot contact:
     updates it if Podium already created it, creates it if not
   - Writes attribution to a **custom, protected HubSpot property**
     (`true_marketing_source`) that only this middleware ever writes to —
     HubSpot's default Original Source field is left alone and may still say
     "Podium"; reporting should be built against the custom field instead

Because HubSpot ⇄ Podium sync is fast in both directions, and the middleware
detects phone numbers programmatically (sub-second), the middleware will
usually create/update the HubSpot contact well before a staff member manually
opens Podium — but the upsert-by-phone logic makes the outcome correct
regardless of which side gets there first.

## 3. Components

### 3.1 Meta webhook listener (`/app/api/webhooks/meta`)
- Verifies Meta's webhook subscription (GET challenge) and validates the
  `X-Hub-Signature-256` header on incoming events (POST)
- Parses `messaging` events from the payload
- If an event carries a `referral` object → store `{ psid, adId, timestamp }`
  in a short-lived store (see 3.4)
- If an event is a plain message → run phone/email detection on the text
- On a detected match → look up the stored referral for that PSID, resolve
  the ad name/campaign, and call the HubSpot upsert function

### 3.2 Detection (`/lib/detect.js`)
- Regex-based phone number extraction, tunable for local number formats
- Regex-based email extraction
- **This will not be 100% reliable** — unusual formats, numbers given by
  voice on a follow-up call, etc. will be missed. Recommend a fallback: a
  small internal search tool staff can use to manually attribute a lead that
  detection missed (not built in this phase — flag as a phase 1.5 item if
  misses turn out to be frequent in testing).

### 3.3 Meta ad resolution (`/lib/meta.js`)
- Given an `ad_id` from a referral payload, calls the Graph Marketing API to
  resolve the ad name, ad set, and campaign name for storage in HubSpot

### 3.4 Temporary referral store (`/lib/store.js`)
- Serverless functions are stateless between invocations — the mapping of
  "this PSID saw this ad" must be persisted somewhere between the first
  message and whenever the phone number eventually appears (which, per the
  luxury sales context, could be days later)
- Scaffolded here as a simple interface; **production requires a real
  persistent store** — Vercel KV, Vercel Postgres, or any Redis/DB reachable
  from the function. Do not ship with the in-memory fallback.

### 3.5 HubSpot upsert (`/lib/hubspot.js`)
- Searches HubSpot contacts by phone number
- If found → updates only the attribution property (leaves all other contact
  data untouched)
- If not found → creates a new contact with phone number + attribution
  property set
- Uses a HubSpot Private App token (not OAuth) for simplicity in a
  single-tenant, single-client setup

## 4. Dependencies to confirm before/during build

- **Meta app review & permissions** — reading Page conversations requires
  `pages_messaging` permission and the Page owner's approval to add this app
  as a second subscriber alongside Podium's own app. This needs to go through
  Meta's standard app review process; budget time for this, it isn't instant.
- **HubSpot custom property** — create `true_marketing_source` (single-line
  text or dropdown) on the Contact object before deploying, and set up
  reporting/dashboards against it rather than the default Original Source.
- **Persistent store selection** — Vercel KV is the path of least friction if
  staying inside the Vercel ecosystem; confirm expected data retention needs
  (a referral with no phone number yet might need to persist for days, per
  the luxury sales cycle).
- **Podium's own dedupe behavior** — low risk given the confirmed
  bidirectional sync, but worth a real test: create a HubSpot contact by
  phone number, then have Podium text that same number, and confirm Podium
  updates the existing contact rather than creating a duplicate.

## 5. Environment variables

```
META_VERIFY_TOKEN=            # arbitrary string you choose, used in webhook verification handshake
META_APP_SECRET=              # from the Meta App dashboard, used to validate signatures
META_PAGE_ACCESS_TOKEN=       # long-lived Page access token
HUBSPOT_PRIVATE_APP_TOKEN=    # HubSpot private app token with crm.objects.contacts.write/read scopes
HUBSPOT_ATTRIBUTION_PROPERTY=true_marketing_source
KV_REST_API_URL=              # if using Vercel KV
KV_REST_API_TOKEN=
```

## 6. Testing & validation plan

1. Send a test click-to-message ad click end-to-end; confirm the referral
   payload is received and stored against the correct PSID
2. Type a phone number into that same test conversation at varying delays
   (immediately, and after a simulated multi-day gap) and confirm detection
   fires and HubSpot is updated correctly in both cases
3. Confirm the custom attribution property is set correctly whether HubSpot
   or Podium creates the contact first — test both orderings deliberately
4. Confirm no duplicate contacts are created for the same phone number under
   either ordering
5. Load-test detection against a sample of real (anonymized) past
   conversations to estimate the miss rate before relying on it fully

## 7. Deployment

- Repo on GitHub, deployed to Vercel (connect the repo, Vercel handles CI/CD
  on push)
- Environment variables set in the Vercel project settings, not committed
- Meta webhook URL points to the deployed `/api/webhooks/meta` endpoint

## 8. Note on the LAMP alternative

If it's preferable to run this inside the client's existing LAMP stack
instead of Vercel: the same logic applies — a PHP endpoint receiving the Meta
webhook POST, MySQL in place of the KV store for the referral mapping, and
cURL calls to the HubSpot and Meta Graph APIs in place of the JS SDK calls
used here. The architecture doesn't change, only the language/runtime. Happy
to produce a PHP version of this scaffold if that ends up being the preferred
home for it.
