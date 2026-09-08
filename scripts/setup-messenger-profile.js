// scripts/setup-messenger-profile.js
//
// One-time setup for the pressable entry points into the lead-capture flow:
//   - Messenger: a Get Started button + a persistent menu item
//   - Instagram: an ice breaker (shown at the start of new conversations)
//
// All of them deliver the LEAD_CAPTURE_START payload the webhook handler
// listens for. Re-run any time you change the wording — it overwrites.
//
// Usage:
//   META_PAGE_ACCESS_TOKEN=<token> node scripts/setup-messenger-profile.js

const GRAPH_API_BASE = "https://graph.facebook.com/v19.0";
const token = process.env.META_PAGE_ACCESS_TOKEN;

if (!token) {
  console.error("Set META_PAGE_ACCESS_TOKEN in the environment first.");
  process.exit(1);
}

async function setProfile(body, platform) {
  const platformParam = platform ? `&platform=${platform}` : "";
  const res = await fetch(
    `${GRAPH_API_BASE}/me/messenger_profile?access_token=${token}${platformParam}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`${platform || "messenger"}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function main() {
  // Messenger: Get Started button (required before a persistent menu is
  // allowed) plus a menu item that starts the flow.
  await setProfile({
    get_started: { payload: "GET_STARTED" },
    persistent_menu: [
      {
        locale: "default",
        composer_input_disabled: false,
        call_to_actions: [
          {
            type: "postback",
            title: "Leave my contact details",
            payload: "LEAD_CAPTURE_START",
          },
        ],
      },
    ],
  });
  console.log("Messenger profile set: Get Started + persistent menu.");

  // Instagram: ice breakers only show for brand-new conversations, but
  // they're the closest IG equivalent of a menu button.
  await setProfile(
    {
      ice_breakers: [
        {
          locale: "default",
          call_to_actions: [
            {
              question: "Leave my contact details",
              payload: "LEAD_CAPTURE_START",
            },
          ],
        },
      ],
    },
    "instagram"
  );
  console.log("Instagram ice breaker set.");
}

main().catch((err) => {
  console.error("Setup failed:", err.message);
  process.exit(1);
});
