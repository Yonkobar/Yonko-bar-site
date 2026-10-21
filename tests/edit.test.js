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

test('Taverne > 6 un mardi : pas de caution automatique, confirmation simple', async () => {
  const t = setup({...base, status: 'pending', guests: '8', date: '2026-10-20'});
  const res = await (await t.patch({status: 'accepted'})).json();
  assert.equal(res.entry.depositLink, ''); assert.equal(res.emailResult.sent, true);
  assert.equal(t.calls.filter(c => c.url.includes('stripe')).length, 0);
});

test('Non-régression : acceptation Taverne > 6 un samedi génère le lien de garantie', async () => {
  const t = setup({...base, status: 'pending', guests: '8', date: '2026-10-24'});
  const res = await (await t.patch({status: 'accepted'})).json();
  assert.equal(res.entry.depositAmount, 24); assert.equal(res.emailResult.sent, true);
});

import {onRequestPost as sendConfirmation} from '../functions/api/reservations/[id]/send-confirmation.js';
import {computeDepositAmount} from '../functions/_shared.js';

test('Règle caution : Taverne uniquement vendredi/samedi, privatisation tous les jours', () => {
  const t = (date, type = 'Taverne', guests = '8') => computeDepositAmount({date, type, guests});
  assert.equal(t('2026-10-20'), null); assert.equal(t('2026-10-21'), null); assert.equal(t('2026-10-22'), null);
  assert.equal(t('2026-10-23'), 24); assert.equal(t('2026-10-24'), 24);
  assert.equal(t('2026-10-24', 'Taverne', '6'), null);
  assert.equal(t('2026-10-21', 'Privatisation', '20'), 250);
});

async function confirm(entry) {
  const t = setup(entry);
  const env = {DASHBOARD_KEY: 'k', RESEND_API_KEY: 're_x', RESERVATIONS: {get: async () => JSON.stringify(entry), put: async (k, v) => { if (k.startsWith('res:')) t.saved = JSON.parse(v); }}};
  const r = await sendConfirmation({request: new Request('https://yonkobar.com/x', {method: 'POST', headers: {'x-dashboard-key': 'k'}}), env, params: {id: entry.id}});
  return {r, body: await r.json(), calls: t.calls, t};
}

test('Email de confirmation sans caution', async () => {
  const {r, calls, t} = await confirm({...base});
  assert.equal(r.status, 200);
  const mail = JSON.parse(calls[0].body);
  assert.match(mail.subject, /confirmée/); assert.match(mail.html, /Réservation confirmée/); assert.doesNotMatch(mail.html, /stripe/);
  assert.ok(t.saved.confirmationEmailSentAt);
});

test('Email de confirmation avec caution en attente : contient le lien', async () => {
  const {calls} = await confirm({...base, depositLink: 'https://checkout.stripe.com/abc', depositAmount: 24, depositStatus: 'lien_envoye'});
  assert.match(JSON.parse(calls[0].body).html, /checkout\.stripe\.com\/abc/);
});

test('Email de confirmation avec carte déjà enregistrée : sans lien', async () => {
  const {calls} = await confirm({...base, depositLink: 'https://checkout.stripe.com/abc', depositAmount: 24, depositStatus: 'autorisee'});
  assert.doesNotMatch(JSON.parse(calls[0].body).html, /checkout\.stripe/);
});

test('Email de confirmation refusé sans email ou si annulée', async () => {
  assert.equal((await confirm({...base, email: ''})).r.status, 400);
  assert.equal((await confirm({...base, status: 'declined'})).r.status, 409);
});

import {onRequestPost as manualDeposit} from '../functions/api/reservations/[id]/manual-deposit.js';
import {onRequestPost as createReservation} from '../functions/api/reservations/index.js';

async function manual(entry, body) {
  const t = setup(entry);
  let saved = entry;
  const env = {DASHBOARD_KEY: 'k', STRIPE_SECRET_KEY: 'sk_test_x', RESERVATIONS: {get: async () => JSON.stringify(saved), put: async (k, v) => { saved = JSON.parse(v); }}};
  const r = await manualDeposit({request: new Request('https://yonkobar.com/x', {method: 'POST', headers: {'x-dashboard-key': 'k'}, body: JSON.stringify(body)}), env, params: {id: entry.id}});
  return {r, saved: () => saved, calls: t.calls, again: b => manualDeposit({request: new Request('https://yonkobar.com/x', {method: 'POST', headers: {'x-dashboard-key': 'k'}, body: JSON.stringify(b)}), env, params: {id: entry.id}})};
}

test('Caution déposée au bar : validée, lien Stripe fermé, plus en attente, annulation possible', async () => {
  const entry = {...base, date: '2026-10-22', depositLink: 'https://checkout.stripe.com/g', depositAmount: 24, depositStatus: 'lien_envoye', depositGuaranteeStatus: 'lien_envoye', stripeCheckoutSessionId: 'cs_g'};
  const m = await manual(entry, {amount: 30});
  assert.equal(m.r.status, 200);
  assert.equal(m.saved().depositStatus, 'deposee'); assert.equal(m.saved().depositAmount, 30);
  assert.equal(m.calls.filter(c => c.url.includes('/expire')).length, 1);
  assert.equal((await m.again({amount: 30})).status, 409, 'pas de double validation');
  const undo = await m.again({undo: true});
  assert.equal(undo.status, 200);
  assert.equal(m.saved().depositStatus, 'lien_envoye'); assert.equal(m.saved().depositAmount, 24);
});

test('Caution déposée : la modification du montant est bloquée, l’email de confirmation n’a pas de lien', async () => {
  const t = setup({...base, depositLink: 'https://checkout.stripe.com/g', depositAmount: 24, depositStatus: 'deposee', depositGuaranteeStatus: 'deposee_manuellement'});
  assert.equal((await t.patch({edit: {depositAmount: 50}})).status, 409);
  const res = await (await t.patch({edit: {time: '22:00'}})).json();
  assert.doesNotMatch(JSON.parse(t.calls.find(c => c.url.includes('resend')).body).html, /checkout\.stripe/);
  assert.equal(res.changed[0], 'time');
});

test('Note interne cuisine : enregistrée, sans email au client', async () => {
  const t = setup({...base});
  const res = await (await t.patch({edit: {kitchenNote: '2 planches mixtes\n30 tapas'}})).json();
  assert.deepEqual(res.changed, ['kitchenNote']);
  assert.equal(t.stored().kitchenNote, '2 planches mixtes\n30 tapas');
  assert.equal(t.calls.length, 0);
});

test('Note interne : acceptée à la création depuis le dashboard, ignorée depuis le site public', async () => {
  const data = new Map();
  const env = {DASHBOARD_KEY: 'k', RESERVATIONS: {get: async k => data.get(k), put: async (k, v) => data.set(k, v)}};
  const mk = async body => { const r = await createReservation({request: new Request('https://yonkobar.com/api/reservations', {method: 'POST', body: JSON.stringify(body)}), env}); return JSON.parse(data.get('res:' + (await r.json()).id)); };
  assert.equal((await mk({name: 'A', date: '2026-10-22', manual: true, kitchenNote: 'gâteau'})).kitchenNote, 'gâteau');
  assert.equal((await mk({name: 'B', date: '2026-10-22', kitchenNote: 'hack'})).kitchenNote, undefined);
});
