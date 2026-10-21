import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestPost as create} from '../functions/api/reservations/index.js';
import {onRequestGet as viewGet, onRequestPost as viewPost} from '../functions/api/my-reservation/[token].js';
import {onRequestPost as staffMessage} from '../functions/api/reservations/[id]/messages.js';
import {onRequestPost as accessLink} from '../functions/api/reservations/[id]/access-link.js';
import {onRequestPatch, onRequestDelete} from '../functions/api/reservations/[id].js';
import {parisToUtc} from '../functions/_access.js';

function world({notify = 'staff@yonkobar.com'} = {}) {
  const data = new Map();
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url); calls.push({url: u, body: opts.body});
    if (u.includes('resend')) return new Response('{"id":"m"}', {status: 200});
    if (u.includes('/expire') || u.includes('/detach')) return Response.json({ok: true});
    if (u.endsWith('/v1/customers')) return Response.json({id: 'cus_1'});
    if (u.endsWith('/v1/checkout/sessions')) return Response.json({id: 'cs_1', url: 'https://checkout.stripe.com/1'});
    throw new Error('unexpected ' + u);
  };
  const env = {DASHBOARD_KEY: 'k', RESEND_API_KEY: 're', STRIPE_SECRET_KEY: 'sk', NOTIFY_EMAIL: notify,
    RESERVATIONS: {get: async k => data.get(k) ?? null, put: async (k, v) => data.set(k, v), delete: async k => data.delete(k)}};
  const req = (path, method, body, key) => new Request('https://yonkobar.com' + path, {method, headers: key ? {'x-dashboard-key': key} : {}, body: body ? JSON.stringify(body) : undefined});
  return {data, calls, env, req, get: id => JSON.parse(data.get('res:' + id))};
}
const future = days => { const d = new Date(Date.now() + days * 864e5); return d.toISOString().slice(0, 10); };

test('Création : jeton privé créé et renvoyé, vue client sans données privées', async () => {
  const w = world();
  const r = await (await create({request: w.req('/api/reservations', 'POST', {name: 'Camille Martin', email: 'c@x.fr', contact: '0600000000', date: future(10), time: '20:30', guests: '8', type: 'Taverne', notes: 'Anniversaire'}), env: w.env})).json();
  assert.ok(r.token && r.token.length >= 20);
  assert.equal(w.data.get('tok:' + r.token), r.id);
  const v = await (await viewGet({env: w.env, params: {token: r.token}})).json();
  assert.equal(v.firstName, 'Camille'); assert.equal(v.status, 'pending'); assert.equal(v.canCancel, true);
  const raw = JSON.stringify(v);
  assert.doesNotMatch(raw, /c@x\.fr|0600000000|Anniversaire|accessToken/);
});

test('Jeton invalide ou inconnu : 404', async () => {
  const w = world();
  assert.equal((await viewGet({env: w.env, params: {token: 'nope'}})).status, 404);
  assert.equal((await viewGet({env: w.env, params: {token: 'a'.repeat(32)}})).status, 404);
});

test('Messagerie : client -> non lu + email équipe ; équipe -> email client avec lien', async () => {
  const w = world();
  const r = await (await create({request: w.req('/api/reservations', 'POST', {name: 'Camille', email: 'c@x.fr', date: future(10)}), env: w.env})).json();
  const v = await (await viewPost({request: w.req('/x', 'POST', {action: 'message', text: 'On peut apporter un gâteau ?'}), env: w.env, params: {token: r.token}})).json();
  assert.equal(v.messages.length, 1); assert.equal(w.get(r.id).unreadForStaff, 1);
  const staffMail = w.calls.find(c => c.url.includes('resend'));
  assert.equal(JSON.parse(staffMail.body).to[0], 'staff@yonkobar.com');
  const res = await (await staffMessage({request: w.req('/x', 'POST', {text: 'Bien sûr !'}, 'k'), env: w.env, params: {id: r.id}})).json();
  assert.equal(res.emailResult.sent, true); assert.equal(w.get(r.id).unreadForStaff, 0);
  const clientMail = JSON.parse(w.calls.filter(c => c.url.includes('resend')).at(-1).body);
  assert.equal(clientMail.to[0], 'c@x.fr'); assert.match(clientMail.html, new RegExp('ma-reservation\\?t=' + r.token));
  assert.equal((await staffMessage({request: w.req('/x', 'POST', {text: 'x'}, 'mauvaise'), env: w.env, params: {id: r.id}})).status, 401);
});

test('Annulation client > 48 h : annulée, caution libérée (lien fermé, carte retirée), emails', async () => {
  const w = world();
  const r = await (await create({request: w.req('/api/reservations', 'POST', {name: 'Camille', email: 'c@x.fr', date: future(5), time: '20:00', guests: '8', type: 'Taverne'}), env: w.env})).json();
  const e = w.get(r.id); Object.assign(e, {depositLink: 'https://checkout.stripe.com/1', depositAmount: 24, depositStatus: 'autorisee', depositGuaranteeStatus: 'enregistree', stripeCheckoutSessionId: 'cs_1', stripePaymentMethodId: 'pm_1'});
  w.data.set('res:' + r.id, JSON.stringify(e));
  const v = await (await viewPost({request: w.req('/x', 'POST', {action: 'cancel'}), env: w.env, params: {token: r.token}})).json();
  assert.equal(v.status, 'declined'); assert.equal(v.cancelledByClient, true); assert.equal(v.deposit.state, 'liberee');
  const s = w.get(r.id);
  assert.equal(s.stripePaymentMethodId, undefined);
  assert.ok(w.calls.some(c => c.url.includes('/payment_methods/pm_1/detach')));
  assert.equal(w.calls.filter(c => c.url.includes('resend')).length, 2, 'email équipe + email client');
  assert.equal((await viewPost({request: w.req('/x', 'POST', {action: 'cancel'}), env: w.env, params: {token: r.token}})).status, 409);
});

test('Annulation client < 48 h : refusée', async () => {
  const w = world();
  const r = await (await create({request: w.req('/api/reservations', 'POST', {name: 'C', date: future(1), time: '23:00'}), env: w.env})).json();
  const res = await viewPost({request: w.req('/x', 'POST', {action: 'cancel'}), env: w.env, params: {token: r.token}});
  assert.equal(res.status, 409); assert.equal(w.get(r.id).status, 'pending');
});

test('Email d’acceptation : contient le lien « Voir ma réservation »', async () => {
  const w = world();
  const r = await (await create({request: w.req('/api/reservations', 'POST', {name: 'C', email: 'c@x.fr', date: '2026-11-03', guests: '4', type: 'Taverne'}), env: w.env})).json();
  const res = await (await onRequestPatch({request: w.req('/x', 'PATCH', {status: 'accepted'}, 'k'), env: w.env, params: {id: r.id}})).json();
  assert.equal(res.emailResult.sent, true);
  assert.match(JSON.parse(w.calls.find(c => c.url.includes('resend')).body).html, new RegExp('ma-reservation\\?t=' + r.token));
});

test('Lien client depuis le dashboard : créé pour une ancienne réservation sans jeton', async () => {
  const w = world();
  w.data.set('res:old', JSON.stringify({id: 'old', name: 'Ancien', date: future(9), status: 'accepted'}));
  const res = await (await accessLink({request: w.req('/x', 'POST', {}, 'k'), env: w.env, params: {id: 'old'}})).json();
  assert.match(res.url, /^https:\/\/yonkobar\.com\/ma-reservation\?t=/);
  const again = await (await accessLink({request: w.req('/x', 'POST', {}, 'k'), env: w.env, params: {id: 'old'}})).json();
  assert.equal(again.url, res.url, 'le lien reste le même');
});

test('Suppression : le lien client ne fonctionne plus', async () => {
  const w = world();
  const r = await (await create({request: w.req('/api/reservations', 'POST', {name: 'C', date: future(9)}), env: w.env})).json();
  await onRequestDelete({request: w.req('/x', 'DELETE', null, 'k'), env: w.env, params: {id: r.id}});
  assert.equal(w.data.has('tok:' + r.token), false);
});

test('Heure de Paris : hiver UTC+1, été UTC+2', () => {
  assert.equal(new Date(parisToUtc('2026-12-15', '20:00')).toISOString(), '2026-12-15T19:00:00.000Z');
  assert.equal(new Date(parisToUtc('2026-07-15', '20:00')).toISOString(), '2026-07-15T18:00:00.000Z');
});
