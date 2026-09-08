// lib/detect.js
//
// Best-effort pattern matching for phone numbers and emails appearing
// naturally in a conversation. This will not catch every format — tune the
// phone regex for the market(s) you operate in, and treat this as a
// first-pass filter, not a guarantee. See SPEC.md section 3.2 for the
// recommended fallback for missed detections.

// Default tuned loosely for AU/UK/US style numbers with optional country
// code, spacing, dashes, or parentheses. Adjust for your actual market(s).
const PHONE_REGEX = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}/g;

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Filters out short numeric noise (order numbers, years, etc.) by requiring
// a minimum count of digits once separators are stripped.
function extractPhoneNumber(text) {
  if (!text) return null;
  const matches = text.match(PHONE_REGEX);
  if (!matches) return null;

  for (const raw of matches) {
    const digitsOnly = raw.replace(/\D/g, "");
    if (digitsOnly.length >= 8 && digitsOnly.length <= 15) {
      return normalizePhone(digitsOnly);
    }
  }
  return null;
}

function extractEmail(text) {
  if (!text) return null;
  const match = text.match(EMAIL_REGEX);
  return match ? match[0].toLowerCase() : null;
}

// Normalizes to E.164 without spaces, AU-focused — Podium writes numbers to
// HubSpot as "+61 481 951 379", so the digits must carry the 61 country code
// (never a leading 0) for the upsert-by-phone match to work.
function normalizePhone(digitsOnly) {
  // Already has the AU country code (e.g. typed as +61 481 951 379).
  if (digitsOnly.startsWith("61") && digitsOnly.length === 11) {
    return `+${digitsOnly}`;
  }
  // Local format with leading 0 (e.g. 0481 951 379) → swap the 0 for 61.
  if (digitsOnly.startsWith("0") && digitsOnly.length === 10) {
    return `+61${digitsOnly.slice(1)}`;
  }
  // Anything else (overseas numbers, unusual formats) — pass through as-is.
  return `+${digitsOnly}`;
}

module.exports = { extractPhoneNumber, extractEmail };
