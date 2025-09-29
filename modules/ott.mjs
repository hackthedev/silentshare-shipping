import crypto from "crypto";

const DEFAULT_TTL = 5 * 60 * 1000;
const CLEANUP_INTERVAL = 60 * 1000;
const store = new Map();

function base64url(buf) {
    return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function sha256Hex(s) {
    return crypto.createHash("sha256").update(s).digest("hex");
}

setInterval(() => {
    const now = Date.now();
    for (const [k, v] of store) if (v.expiresAt <= now) store.delete(k);
}, CLEANUP_INTERVAL).unref();

export function generateOneTimeToken({ ttl = DEFAULT_TTL, meta = null } = {}) {
    const raw = base64url(crypto.randomBytes(24));
    const key = sha256Hex(raw);
    store.set(key, { meta, createdAt: Date.now(), expiresAt: Date.now() + Math.max(1000, ttl) });
    return raw;
}

export function verifyOneTimeToken(rawToken) {
    if (!rawToken) return false;
    const key = sha256Hex(String(rawToken));
    const rec = store.get(key);
    if (!rec) return false;
    if (rec.expiresAt <= Date.now()) { store.delete(key); return false; }
    return true;
}
