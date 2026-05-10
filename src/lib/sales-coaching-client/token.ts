import { createHmac } from 'node:crypto';

const VERSION = 'v1';
const MAX_TTL_SECONDS = 60;
// Backdate `iat` to absorb clock skew between Dashboard host and upstream.
// Upstream rejects iat > server_now with `future_dated_token` (zero leeway),
// so a few seconds of host-clock drift is enough to break every request.
// 5 s is the standard JWT-library leeway default and well within MAX_TTL.
const IAT_BACKDATE_SECONDS = 5;

function base64url(buf: Buffer | string): string {
  return (typeof buf === 'string' ? Buffer.from(buf) : buf).toString('base64url');
}

export function signDashboardToken(email: string, opts: { ttlSeconds?: number } = {}): string {
  const secret = process.env.DASHBOARD_BRIDGE_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('DASHBOARD_BRIDGE_SECRET is missing or too short (min 32 chars).');
  }
  const ttl = Math.min(Math.max(opts.ttlSeconds ?? 30, 1), MAX_TTL_SECONDS);
  const iat = Math.floor(Date.now() / 1000) - IAT_BACKDATE_SECONDS;
  const exp = iat + ttl;
  const payload = { email: email.toLowerCase(), iat, exp };
  const encoded = base64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${VERSION}.${encoded}`).digest('base64url');
  return `${VERSION}.${encoded}.${sig}`;
}
