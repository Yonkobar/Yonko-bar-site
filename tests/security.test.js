import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestPost as createReservation} from '../functions/api/reservations/index.js';
import {onRequestPost as webhook, verifyStripeSignature} from '../functions/api/stripe-webhook.js';
import {buildEmailHtml} from '../functions/_shared.js';

const kv = () => { const data = new Map(); return {data, get: async k => data.get(k) ?? null, put: async (k, v) => data.set(k, v)}; };
const post = (body, headers = {}) => new Request('https://yonkobar.com/api/reservations', {method: 'POST', headers, body: JSON.stringify(body)});

test('Formulaire public : formats invalides refusés', async () => {
  const env = {DASHBOARD_KEY: 'k', RESERVATIONS: kv()};
  for (const bad of [{date: '2026-10-30<script>'}, {date: '2026-10-30', time: '"><img'}, {date: '2026-10-30', guests: '-5'}, {date: '2026-10-30', email: 'a<b>@x.fr'}]) {
    const r = await createReservation({request: post({name: 'X', ...bad}), env});
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  const ok = await createReservation({request: post({name: 'X', date: '2026-10-30', time: '19:30', guests: '4', email: 'a@b.fr'}), env});
  assert.equal(ok.status, 201);
});

test('Formulaire public : 5 demandes max par heure et par IP', async () => {
  const env = {DASHBOARD_KEY: 'k', RESERVATIONS: kv()};
  const send = ip => createReservation({request: post({name: 'X', date: '2026-10-30'}, {'CF-Connecting-IP': ip}), env});
  for (let i = 0; i < 5; i++) assert.equal((await send('1.2.3.4')).status, 201);
  assert.equal((await send('1.2.3.4')).status, 429);
  assert.equal((await send('5.6.7.8')).status, 201);
  // Le dashboard n'est pas limité.
  const r = await createReservation({request: post({name: 'X', date: '2026-10-30'}, {'CF-Connecting-IP': '1.2.3.4', 'x-dashboard-key': 'k'}), env});
  assert.equal(r.status, 201);
});

async function sign(payload, secret, t) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`));
  return `t=${t},v1=${[...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('')}`;
}

test('Webhook Stripe : signature obligatoire et récente', async () => {
  const payload = JSON.stringify({type: 'checkout.session.completed', data: {object: {mode: 'payment', metadata: {reservation_id: 'r1'}}}});
  const now = Math.floor(Date.now() / 1000);
  assert.equal(await verifyStripeSignature(payload, await sign(payload, 'whsec_x', now), 'whsec_x'), true);
  assert.equal(await verifyStripeSignature(payload, await sign(payload, 'autre', now), 'whsec_x'), false);
  assert.equal(await verifyStripeSignature(payload, await sign(payload, 'whsec_x', now - 3600), 'whsec_x'), false, 'rejeu refusé');

  const store = kv(); store.data.set('res:r1', JSON.stringify({id: 'r1'}));
  const call = (env, sig) => webhook({request: new Request('https://yonkobar.com/api/stripe-webhook', {method: 'POST', headers: sig ? {'stripe-signature': sig} : {}, body: payload}), env});
  // Sans secret configuré : refus (Stripe réessaiera), aucune caution validée.
  assert.equal((await call({RESERVATIONS: store}, null)).status, 500);
  assert.equal((await call({RESERVATIONS: store, STRIPE_WEBHOOK_SECRET: 'whsec_x'}, null)).status, 400);
  assert.equal(JSON.parse(store.data.get('res:r1')).depositStatus, undefined);
  assert.equal((await call({RESERVATIONS: store, STRIPE_WEBHOOK_SECRET: 'whsec_x'}, await sign(payload, 'whsec_x', now))).status, 200);
  assert.equal(JSON.parse(store.data.get('res:r1')).depositStatus, 'autorisee');
});

test('Email : les champs du client sont échappés', () => {
  const html = buildEmailHtml({name: '<a href="https://pirate.example">Cliquez</a>', date: '2026-10-30', time: '19:00', guests: '4', type: '<b>x</b>'});
  assert.ok(!html.includes('<a href="https://pirate.example">'));
  assert.ok(html.includes('&lt;a href=&quot;https://pirate.example&quot;&gt;'));
  assert.ok(!html.includes('<b>x</b>'));
});
