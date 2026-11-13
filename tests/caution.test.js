import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestGet} from '../functions/api/caution/[token].js';
import {sendGuaranteeEmail} from '../functions/_stripe-guarantee.js';
import {publicView, cautionUrl} from '../functions/_access.js';

// Stripe et Resend simulés : aucun appel réseau réel.
const TOKEN = 'tok_abcdefghijklmnopqrstuvwx'; // 20 à 64 caractères [A-Za-z0-9_-]
const HOUR = 3600 * 1000;

function world(entryOverrides = {}, {stripeFails = false} = {}) {
  const entry = {
    id: 'r1', name: 'Camille Test', email: 'c@example.com', date: '2026-12-12', time: '20:00', guests: '8', type: 'Taverne',
    status: 'accepted', accessToken: TOKEN, stripeCustomerId: 'cus_1',
    depositLink: 'https://checkout.stripe.com/old', depositAmount: 24, depositStatus: 'lien_envoye',
    depositGuaranteeStatus: 'lien_envoye', stripeCheckoutSessionId: 'cs_old',
    depositLinkCreatedAt: Date.now() - 30 * HOUR, depositLinkExpiresAt: Date.now() - 6 * HOUR,
    ...entryOverrides,
  };
  const data = new Map([[`res:${entry.id}`, JSON.stringify(entry)], [`tok:${TOKEN}`, entry.id]]);
  const calls = [];
  let sessions = 0;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({url: u, body: opts.body});
    if (u.includes('api.resend.com')) return new Response(JSON.stringify({id: 'mail'}), {status: 200});
    if (u.endsWith('/v1/checkout/sessions')) {
      if (stripeFails) return Response.json({error: {message: 'stripe down'}}, {status: 500});
      sessions += 1;
      return Response.json({id: `cs_new${sessions}`, url: `https://checkout.stripe.com/new${sessions}`, expires_at: Math.floor((Date.now() + 24 * HOUR) / 1000)});
    }
    throw new Error('unexpected fetch ' + u);
  };
  const env = {STRIPE_SECRET_KEY: 'sk_test_x', RESEND_API_KEY: 're_x',
    RESERVATIONS: {get: async k => data.get(k), put: async (k, v) => data.set(k, v)}};
  const hit = (token = TOKEN) => onRequestGet({request: new Request(`https://yonkobar.com/api/caution/${token}`), env, params: {token}});
  return {hit, calls, env, stored: () => JSON.parse(data.get(`res:${entry.id}`)), stripeCalls: () => calls.filter(c => c.url.includes('stripe.com')).length};
}

test('Lien Stripe d\'origine expiré : le lien permanent crée une nouvelle page de paiement et y redirige', async () => {
  const w = world();
  const res = await w.hit();
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), 'https://checkout.stripe.com/new1');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const s = w.stored();
  assert.equal(s.depositLink, 'https://checkout.stripe.com/new1');
  assert.equal(s.stripeCheckoutSessionId, 'cs_new1');
  assert.ok(s.depositLinkExpiresAt > Date.now() + 20 * HOUR);
  assert.equal(s.depositAmount, 24);
  // mode "setup" : aucune somme n'est débitée
  const body = new URLSearchParams(w.calls.find(c => c.url.endsWith('/checkout/sessions')).body);
  assert.equal(body.get('mode'), 'setup');
  assert.equal(body.get('success_url'), 'https://yonkobar.com/?caution=ok');
  assert.equal(body.get('metadata[reservation_id]'), 'r1');
});

test('Page Stripe encore ouverte : le lien permanent y redirige sans rien créer (scan antivirus ou double clic)', async () => {
  const w = world({depositLinkExpiresAt: Date.now() + 20 * HOUR});
  const res = await w.hit();
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), 'https://checkout.stripe.com/old');
  assert.equal(w.stripeCalls(), 0);
});

test('Deux ouvertures d\'affilée (après expiration) : une seule page de paiement créée, la même pour les deux', async () => {
  const w = world();
  const a = await w.hit();
  const b = await w.hit();
  assert.equal(a.headers.get('Location'), 'https://checkout.stripe.com/new1');
  assert.equal(b.headers.get('Location'), 'https://checkout.stripe.com/new1');
  assert.equal(w.stripeCalls(), 1);
});

test('Page Stripe qui se ferme dans moins de 2 h : on en crée une nouvelle', async () => {
  const w = world({depositLinkExpiresAt: Date.now() + 1 * HOUR});
  const res = await w.hit();
  assert.equal(res.headers.get('Location'), 'https://checkout.stripe.com/new1');
});

test('Carte déjà enregistrée : renvoie vers Ma réservation, aucun appel Stripe', async () => {
  const w = world({depositGuaranteeStatus: 'enregistree', depositStatus: 'autorisee', stripePaymentMethodId: 'pm_1'});
  const res = await w.hit();
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), `https://yonkobar.com/ma-reservation?t=${TOKEN}`);
  assert.equal(w.stripeCalls(), 0);
});

test('Réservation annulée / caution libérée / déposée au bar / débitée : aucune nouvelle page de paiement', async () => {
  for (const o of [
    {status: 'declined'},
    {depositStatus: 'liberee', depositGuaranteeStatus: 'liberee'},
    {depositStatus: 'deposee', depositGuaranteeStatus: 'deposee_manuellement'},
    {depositStatus: 'debitee', depositGuaranteeStatus: 'debitee'},
  ]) {
    const w = world(o);
    const res = await w.hit();
    assert.equal(res.headers.get('Location'), `https://yonkobar.com/ma-reservation?t=${TOKEN}`, JSON.stringify(o));
    assert.equal(w.stripeCalls(), 0, JSON.stringify(o));
  }
});

test('Réservation sans caution : aucune page de paiement', async () => {
  const w = world({depositLink: '', depositAmount: 0, depositStatus: undefined, depositGuaranteeStatus: undefined, stripeCheckoutSessionId: undefined});
  const res = await w.hit();
  assert.equal(res.headers.get('Location'), `https://yonkobar.com/ma-reservation?t=${TOKEN}`);
  assert.equal(w.stripeCalls(), 0);
});

test('Jeton inconnu ou mal formé : renvoie vers Ma réservation (« introuvable »), aucun appel Stripe', async () => {
  const w = world();
  for (const t of ['inconnu_inconnu_inconnu_xx', 'x', '../../etc']) {
    const res = await w.hit(t);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('Location'), 'https://yonkobar.com/ma-reservation');
  }
  assert.equal(w.stripeCalls(), 0);
});

test('Stripe en panne : page d\'erreur claire (502), rien n\'est modifié, ancien état conservé', async () => {
  const w = world({}, {stripeFails: true});
  const before = JSON.stringify(w.stored());
  const res = await w.hit();
  assert.equal(res.status, 502);
  assert.match(await res.text(), /Rien n’a été débité/);
  assert.equal(JSON.stringify(w.stored()), before);
});

test('Email de caution : le bouton pointe vers le lien permanent, jamais directement vers Stripe', async () => {
  const w = world();
  const entry = w.stored();
  const r = await sendGuaranteeEmail(entry, w.env, {manageUrl: `https://yonkobar.com/ma-reservation?t=${TOKEN}`});
  assert.equal(r.sent, true);
  const mail = JSON.parse(w.calls.find(c => c.url.includes('resend')).body);
  assert.ok(mail.html.includes(`https://yonkobar.com/api/caution/${TOKEN}`));
  assert.ok(!mail.html.includes('checkout.stripe.com'));
  assert.ok(!mail.text.includes('checkout.stripe.com'));
  assert.equal(entry.depositLinkPermanent, true);
});

test('Email de caution sans jeton d\'accès (cas anormal) : repli sur le lien Stripe, pas de lien cassé', async () => {
  const w = world({accessToken: undefined});
  const entry = w.stored();
  const r = await sendGuaranteeEmail(entry, w.env, {});
  assert.equal(r.sent, true);
  const mail = JSON.parse(w.calls.find(c => c.url.includes('resend')).body);
  assert.ok(mail.html.includes('https://checkout.stripe.com/old'));
  assert.equal(entry.depositLinkPermanent, undefined);
});

test('Page Ma réservation : le bouton de caution utilise le lien permanent (relatif), pas le lien Stripe', () => {
  const w = world();
  const v = publicView(w.stored());
  assert.equal(v.deposit.state, 'pending');
  assert.equal(v.deposit.link, `/api/caution/${TOKEN}`);
  assert.equal(cautionUrl(w.stored(), {}, 'https://yonkobar.com/'), `https://yonkobar.com/api/caution/${TOKEN}`);
  // caution déjà validée : aucun lien
  assert.equal(publicView({...w.stored(), depositStatus: 'autorisee'}).deposit.link, '');
});
