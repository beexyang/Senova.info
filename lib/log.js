// lib/log.js — minimal PII-redacting wrapper around console.
// Use everywhere instead of console.log/error so emails, phones, JWTs, and
// UUIDs don't leak into Vercel/Datadog logs in plaintext.
const RE = [
  [/(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g, '[JWT]'],
  [/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email]'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[uuid]'],
  [/\b\+?\d[\d -]{8,}\d\b/g, '[phone]'],
];
function redact(v) {
  if (v == null) return v;
  let s = typeof v === 'string' ? v : JSON.stringify(v);
  for (const [re, sub] of RE) s = s.replace(re, sub);
  return s;
}
function info(msg, meta)  { console.log('[info]',  redact(msg), meta != null ? redact(meta) : ''); }
function warn(msg, meta)  { console.warn('[warn]', redact(msg), meta != null ? redact(meta) : ''); }
function error(msg, meta) { console.error('[err]', redact(msg), meta != null ? redact(meta) : ''); }
module.exports = { info, warn, error, redact };
