import fs from 'node:fs/promises';
// Run locally. The private output is ignored by Git and must NEVER be uploaded.
const pair = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
const raw = await crypto.subtle.exportKey('raw', pair.publicKey);
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
await fs.writeFile('vapid-keys.json', JSON.stringify({
  VAPID_PUBLIC_KEY: Buffer.from(raw).toString('base64url'),
  VAPID_PRIVATE_KEY: jwk.d,
}, null, 2), {flag: 'wx', mode: 0o600});
console.log('Created vapid-keys.json locally. Put values into Cloudflare secrets; never upload this file to GitHub.');
