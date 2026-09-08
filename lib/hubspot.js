// lib/hubspot.js
const hubspot = require("@hubspot/api-client");

const client = new hubspot.Client({
  accessToken: process.env.HUBSPOT_PRIVATE_APP_TOKEN,
});

const ATTRIBUTION_PROPERTY =
  process.env.HUBSPOT_ATTRIBUTION_PROPERTY || "true_marketing_source";

// Searches HubSpot for an existing contact by phone number. Returns the
// contact ID if found, otherwise null.
//
// Podium writes numbers with spaces ("+61 481 951 379"), so an exact string
// match on our spaceless E.164 value can miss. Filter groups are OR'd, so
// this also matches on hs_searchable_calculated_phone_number — HubSpot's
// digits-only normalized shadow property for phone search.
async function findContactByPhone(phone) {
  const digitsOnly = phone.replace(/\D/g, "");
  const searchResponse = await client.crm.contacts.searchApi.doSearch({
    filterGroups: [
      {
        filters: [{ propertyName: "phone", operator: "EQ", value: phone }],
      },
      {
        filters: [
          {
            propertyName: "hs_searchable_calculated_phone_number",
            operator: "EQ",
            value: digitsOnly,
          },
        ],
      },
    ],
    limit: 1,
  });

  const results = searchResponse.results || [];
  return results.length > 0 ? results[0].id : null;
}

// The core upsert: update the attribution field on an existing contact if
// one already exists for this phone number (most likely case — Podium or
// the client's own HubSpot form probably got there first), otherwise create
// a new contact with the phone number and attribution attached.
async function upsertContactAttribution({ phone, email, attribution }) {
  const attributionValue = formatAttribution(attribution);
  const existingId = await findContactByPhone(phone);

  if (existingId) {
    await client.crm.contacts.basicApi.update(existingId, {
      properties: { [ATTRIBUTION_PROPERTY]: attributionValue },
    });
    return { action: "updated", contactId: existingId };
  }

  const properties = {
    phone,
    [ATTRIBUTION_PROPERTY]: attributionValue,
  };
  if (email) properties.email = email;

  const created = await client.crm.contacts.basicApi.create({ properties });
  return { action: "created", contactId: created.id };
}

// Fuller upsert used by the guided lead-capture flow: the person explicitly
// submitted these details, so name/email are written on update as well as
// create. Attribution is optional — a lead captured without an ad referral
// is still pushed.
async function upsertContact({ phone, email, firstname, lastname, attribution }) {
  const properties = {};
  if (email) properties.email = email;
  if (firstname) properties.firstname = firstname;
  if (lastname) properties.lastname = lastname;
  if (attribution) properties[ATTRIBUTION_PROPERTY] = formatAttribution(attribution);

  const existingId = await findContactByPhone(phone);
  if (existingId) {
    await client.crm.contacts.basicApi.update(existingId, { properties });
    return { action: "updated", contactId: existingId };
  }

  const created = await client.crm.contacts.basicApi.create({
    properties: { phone, ...properties },
  });
  return { action: "created", contactId: created.id };
}

function formatAttribution({ campaignName, adSetName, adName, rawAdId }) {
  // Keep this human-readable — it's going straight into a HubSpot property
  // your team will read in reports, not just raw IDs.
  if (campaignName || adName) {
    return [campaignName, adSetName, adName].filter(Boolean).join(" / ");
  }
  return `Meta ad ${rawAdId}`;
}

module.exports = { upsertContactAttribution, upsertContact, findContactByPhone };
