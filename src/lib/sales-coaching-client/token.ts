import { createHmac } from 'node:crypto';

const VERSION = 'v1';
const MAX_TTL_SECONDS = 60;

function base64url(buf: Buffer | string): string {
  return (typeof buf === 'string' ? Buffer.from(buf) : buf).toString('base64url');
}

export function signDashboardToken(email: string, opts: { ttlSeconds?: number } = {}): string {
  const secret = process.env.DASHBOARD_BRIDGE_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('DASHBOARD_BRIDGE_SECRET is missing or too short (min 32 chars).');
  }
  const ttl = Math.min(Math.max(opts.ttlSeconds ?? 30, 1), MAX_TTL_SECONDS);
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + ttl;
  const payload = { email: email.toLowerCase(), iat, exp };
  const encoded = base64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${VERSION}.${encoded}`).digest('base64url');
  return `${VERSION}.${encoded}.${sig}`;
}
