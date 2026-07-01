# Meta attribution middleware

Captures ad attribution for Meta click-to-message conversations and writes it
to HubSpot, even when the phone number only appears well into the
conversation. See `SPEC.md` for the full design and the reasoning behind it.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in real values (see comments
   in that file for where each one comes from)
3. Create the `true_marketing_source` custom property on the HubSpot Contact
   object (or whatever name you set `HUBSPOT_ATTRIBUTION_PROPERTY` to)
4. `npm run dev` to run locally, or push to GitHub and connect the repo to a
   new Vercel project for deployment
5. In the Meta App dashboard, add a webhook subscription pointing at
   `https://<your-deployment>/api/webhooks/meta`, subscribed to the `messages`
   and `messaging_referrals` fields for the relevant Page

## What's scaffolded vs what still needs work

**Scaffolded:**
- Webhook verification + signature validation
- Referral capture and short-term storage (Vercel KV)
- Phone/email detection in message text
- HubSpot upsert-by-phone logic

**Still needed before production:**
- Real testing against live Meta webhook traffic — the payload shapes here
  are based on Meta's documented format but should be verified against
  actual events from your Page
- Meta app review for the permissions needed to read Page conversations
  (this is a process, not just a config toggle — budget time for it)
- Decide on and tune the phone number regex for your actual market(s)
- A fallback tool for the leads detection misses (see SPEC.md section 3.2)
- Basic monitoring/alerting on the webhook endpoint — you want to know if
  this silently stops working, not find out three months later in a
  reporting review
