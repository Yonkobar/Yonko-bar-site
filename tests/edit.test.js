import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestPatch} from '../functions/api/reservations/[id].js';

// Stripe et Resend simulés : aucun appel réseau réel.
function setup(entry, {stripeFails = false} = {}) {
  const data = new Map([[`res:${entry.id}`, JSON.stringify(entry)]]);
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({url: String(url), body: opts.body});
    const u = String(url);
    if (u.includes('api.resend.com')) return new Response(JSON.stringify({id: 'mail'}), {status: 200});
    if (u.endsWith('/v1/customers')) return Response.json({id: 'cus_new'});
    if (u.endsWith('/v1/checkout/sessions')) {
      if (stripeFails) return Response.json({error: {message: 'stripe down'}}, {status: 500});
      return Response.json({id: 'cs_new', url: 'https://checkout.stripe.com/new', expires_at: 2000000000});
    }
    if (u.includes('/expire')) return Response.json({id: 'cs_old', status: 'expired'});
    throw new Error('unexpected fetch ' + u);
  };
  const env = {DASHBOARD_KEY: 'k', STRIPE_SECRET_KEY: 'sk_test_x', RESEND_API_KEY: 're_x',
    RESERVATIONS: {get: async k => data.get(k), put: async (k, v) => data.set(k, v)}};
  const patch = body => onRequestPatch({
    request: new Request(`https://yonkobar.com/api/reservations/${entry.id}`, {method: 'PATCH', headers: {'x-dashboard-key': 'k'}, body: JSON.stringify(body)}),
    env, params: {id: entry.id}});
  return {patch, calls, stored: () => JSON.parse(data.get(`res:${entry.id}`))};
}

const base = {id: 'r1', name: 'Test', email: 'client@example.com', date: '2026-10-20', time: '20:00', guests: '4', type: 'Taverne', status: 'accepted', depositLink: '', createdAt: 1};

test('A. Sans caution : modification heure/personnes, email envoyé, aucun appel Stripe', async () => {
  const t = setup({...base});
  const res = await (await t.patch({edit: {date: '2026-10-20', time: '21:30', guests: '5', type: 'Taverne', depositAmount: 0}})).json();
  assert.deepEqual(res.changed.sort(), ['guests', 'time']);
  assert.equal(res.depositChanged, false);
  assert.equal(t.calls.filter(c => c.url.includes('stripe')).length, 0);
  assert.equal(t.calls.filter(c => c.url.includes('resend')).length, 1);
  assert.match(JSON.parse(t.calls[0].body).subject, /Modification/);
  const s = t.stored();
  assert.equal(s.time, '21:30'); assert.equal(s.guests, '5');
  assert.deepEqual(s.lockedFields.sort(), ['guests', 'time']);
});

test('B. Avec caution : changement de montant → ancien lien expiré, nouveau lien, email de garantie', async () => {
  const t = setup({...base, guests: '8', depositLink: 'https://checkout.stripe.com/old', depositAmount: 24, depositStatus: 'lien_envoye', depositGuaranteeStatus: 'lien_envoye', stripeCheckoutSessionId: 'cs_old', stripeCustomerId: 'cus_old'});
  const res = await (await t.patch({edit: {guests: '10', type: 'Taverne', depositAmount: 30}})).json();
  assert.equal(res.newLink, true); assert.equal(res.stripeError, null);
  const urls = t.calls.map(c => c.url);
  assert.ok(urls.findIndex(u => u.endsWith('/checkout/sessions')) < urls.findIndex(u => u.includes('/expire')), 'nouveau lien créé avant expiration de l’ancien');
  const s = t.stored();
  assert.equal(s.depositLink, 'https://checkout.stripe.com/new'); assert.equal(s.depositAmount, 30);
  assert.equal(s.stripeCheckoutSessionId, 'cs_new'); assert.equal(s.stripeCustomerId, 'cus_old');
  assert.equal(s.previousDeposits.at(-1).amount, 24);
  const mail = JSON.parse(t.calls.find(c => c.url.includes('resend')).body);
  assert.match(mail.html, /checkout\.stripe\.com\/new/); assert.match(mail.html, /Réservation modifiée/);
});

test('B2. Carte déjà enregistrée : remplacée (plus débitable), pas d’expire sur une session complétée', async () => {
  const t = setup({...base, depositLink: 'https://old', depositAmount: 250, type: 'Privatisation', depositStatus: 'autorisee', depositGuaranteeStatus: 'enregistree', stripeCheckoutSessionId: 'cs_done', stripePaymentMethodId: 'pm_old', stripeCustomerId: 'cus_old'});
  await t.patch({edit: {type: 'Taverne', guests: '8', depositAmount: 24}});
  const s = t.stored();
  assert.equal(s.stripePaymentMethodId, undefined); assert.equal(s.depositGuaranteeStatus, 'lien_envoye');
  assert.equal(s.previousDeposits.at(-1).paymentMethodId, 'pm_old');
  assert.equal(t.calls.filter(c => c.url.includes('/expire')).length, 0);
});

test('B3. Stripe en échec : l’ancienne caution est conservée, les champs sont quand même enregistrés', async () => {
  const t = setup({...base, depositLink: 'https://old', depositAmount: 24, depositGuaranteeStatus: 'lien_envoye', stripeCheckoutSessionId: 'cs_old', stripeCustomerId: 'cus_old'}, {stripeFails: true});
  const res = await (await t.patch({edit: {guests: '10', depositAmount: 30}})).json();
  assert.ok(res.stripeError);
  const s = t.stored();
  assert.equal(s.depositLink, 'https://old'); assert.equal(s.depositAmount, 24); assert.equal(s.guests, '10');
  assert.equal(t.calls.filter(c => c.url.includes('/expire')).length, 0);
});

test('B4. Retrait de la caution : ancienne annulée, pas de caution auto à l’acceptation', async () => {
  const t = setup({...base, status: 'pending', depositLink: 'https://old', depositAmount: 24, depositGuaranteeStatus: 'lien_envoye', stripeCheckoutSessionId: 'cs_old'});
  await t.patch({edit: {depositAmount: 0}});
  const s = t.stored();
  assert.equal(s.depositLink, ''); assert.equal(s.skipAutoDeposit, true);
  assert.equal(t.calls.filter(c => c.url.includes('/expire')).length, 1);
  assert.equal(t.calls.filter(c => c.url.includes('resend')).length, 0, 'réservation en attente : pas de mail');
});

test('Caution déjà débitée : changement de montant refusé (409), rien n’est modifié', async () => {
  const t = setup({...base, depositLink: 'x', depositAmount: 24, depositStatus: 'debitee'});
  const r = await t.patch({edit: {guests: '9', depositAmount: 27}});
  assert.equal(r.status, 409); assert.equal(t.stored().guests, '4');
});

test('Validation : heure invalide refusée', async () => {
  const t = setup({...base});
  assert.equal((await t.patch({edit: {time: '25:00'}})).status, 400);
});

test('Non-régression : acceptation sans caution envoie toujours la confirmation', async () => {
  const t = setup({...base, status: 'pending', guests: '2'});
  const res = await (await t.patch({status: 'accepted'})).json();
  assert.equal(res.emailResult.sent, true); assert.equal(res.stripeError, null);
  assert.equal(t.calls.filter(c => c.url.includes('stripe')).length, 0);
  assert.match(JSON.parse(t.calls[0].body).html, /Réservation confirmée/);
});

test('Non-régression : acceptation Taverne > 6 génère le lien de garantie', async () => {
  const t = setup({...base, status: 'pending', guests: '8'});
  const res = await (await t.patch({status: 'accepted'})).json();
  assert.equal(res.entry.depositAmount, 24); assert.equal(res.emailResult.sent, true);
});
