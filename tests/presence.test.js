import test from 'node:test';
import assert from 'node:assert/strict';
import {needsPresence, publicView, mailClientReminder, confirmPresenceUrl} from '../functions/_access.js';
import {sendDepositEmail} from '../functions/_shared.js';
import {onRequestPost as viewPost, onRequestGet as viewGet} from '../functions/api/my-reservation/[token].js';
import {onRequestPost as remindPost} from '../functions/api/reservations/[id]/send-reminder.js';
import {onRequestPatch} from '../functions/api/reservations/[id].js';

const TOKEN = 'tok_abcdefghijklmnopqrstuvwx';
const MANAGE = `https://yonkobar.com/ma-reservation?t=${TOKEN}`;
const future = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

const base = () => ({
  id: 'r1', name: 'Camille Test', email: 'c@example.com', date: future(10), time: '20:00', guests: '4', type: 'Table',
  status: 'accepted', accessToken: TOKEN, depositLink: '', createdAt: 1,
});

function world(entry) {
  const data = new Map([[`res:${entry.id}`, JSON.stringify(entry)], [`tok:${TOKEN}`, entry.id]]);
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({url: String(url), body: opts.body});
    if (String(url).includes('api.resend.com')) return new Response(JSON.stringify({id: 'mail'}), {status: 200});
    throw new Error('unexpected fetch ' + url);
  };
  const env = {DASHBOARD_KEY: 'k', STRIPE_SECRET_KEY: 'sk_test_x', RESEND_API_KEY: 're_x',
    RESERVATIONS: {get: async k => data.get(k), put: async (k, v) => data.set(k, v)}};
  const stored = () => JSON.parse(data.get(`res:${entry.id}`));
  const client = (body) => viewPost({request: new Request(`https://yonkobar.com/api/my-reservation/${TOKEN}`, {method: 'POST', body: JSON.stringify(body)}), env, params: {token: TOKEN}});
  const remind = () => remindPost({request: new Request('https://yonkobar.com/x', {method: 'POST', headers: {'x-dashboard-key': 'k'}, body: '{}'}), env, params: {id: entry.id}});
  const patch = (body) => onRequestPatch({request: new Request('https://yonkobar.com/x', {method: 'PATCH', headers: {'x-dashboard-key': 'k'}, body: JSON.stringify(body)}), env, params: {id: entry.id}});
  const mails = () => calls.filter(c => c.url.includes('resend')).map(c => JSON.parse(c.body));
  return {client, remind, patch, mails, stored, calls, env};
}

test('Qui doit confirmer sa venue : confirmée, sans caution, hors Privateaser', () => {
  assert.equal(needsPresence(base()), true);
  assert.equal(needsPresence({...base(), status: 'pending'}), false, 'pas encore confirmée par l’équipe');
  assert.equal(needsPresence({...base(), status: 'declined'}), false);
  assert.equal(needsPresence({...base(), depositLink: 'https://x', depositAmount: 24}), false, 'caution demandée');
  assert.equal(needsPresence({...base(), depositAmount: 250, depositStatus: 'autorisee'}), false, 'carte déjà enregistrée');
  assert.equal(needsPresence({...base(), depositAmount: 24, depositStatus: 'deposee'}), false, 'caution déposée au bar');
  assert.equal(needsPresence({...base(), source: 'Privateaser'}), false);
  assert.equal(needsPresence({...base(), depositAmount: 0, skipAutoDeposit: true}), true, 'caution retirée volontairement');
});

test('Page client : presence.required / confirmed', () => {
  assert.deepEqual(publicView(base()).presence, {required: true, confirmed: false, confirmedAt: null});
  const v = publicView({...base(), presenceConfirmedAt: 123});
  assert.equal(v.presence.confirmed, true); assert.equal(v.presence.confirmedAt, 123);
  assert.equal(publicView({...base(), status: 'declined'}).presence.required, false);
  assert.equal(publicView({...base(), depositLink: 'https://x', depositAmount: 24}).presence.required, false);
});

test('Le client confirme sa venue : enregistré une fois, répété sans effet, aucun email envoyé', async () => {
  const w = world(base());
  const v = await (await w.client({action: 'confirm_presence'})).json();
  assert.equal(v.presence.confirmed, true);
  const t1 = w.stored().presenceConfirmedAt; assert.ok(t1 > 0);
  const again = await w.client({action: 'confirm_presence'});
  assert.equal(again.status, 200); assert.equal(w.stored().presenceConfirmedAt, t1);
  assert.equal(w.mails().length, 0);
});

test('Confirmation de venue refusée : réservation annulée, ou avec caution (rien à confirmer)', async () => {
  const a = world({...base(), status: 'declined'});
  assert.equal((await a.client({action: 'confirm_presence'})).status, 409);
  assert.equal(a.stored().presenceConfirmedAt, undefined);
  const b = world({...base(), depositLink: 'https://x', depositAmount: 24, depositStatus: 'lien_envoye'});
  assert.equal((await b.client({action: 'confirm_presence'})).status, 409);
  assert.equal(b.stored().presenceConfirmedAt, undefined);
});

test('Un simple lien (aperçu antivirus, clic sur l’email) ne confirme jamais : seule l’action du bouton confirme', async () => {
  const w = world(base());
  assert.equal(confirmPresenceUrl(base(), {}, 'https://yonkobar.com'), `${MANAGE}&confirmer=1`);
  // Ouvrir la page = un GET sur l'API de la page : lecture seule.
  const res = await viewGet({request: new Request(`https://yonkobar.com/api/my-reservation/${TOKEN}`), env: w.env, params: {token: TOKEN}});
  assert.equal(res.status, 200);
  assert.equal((await res.json()).presence.confirmed, false);
  assert.equal(w.stored().presenceConfirmedAt, undefined);
});

test('Email de confirmation sans caution : bouton « Confirmer ma venue » vers la page de réservation', async () => {
  const w = world(base());
  const r = await sendDepositEmail(base(), w.env, {manageUrl: MANAGE});
  assert.equal(r.sent, true);
  const m = w.mails()[0];
  assert.match(m.html, /Dernière étape : confirmez votre venue/);
  assert.ok(m.html.includes(`${MANAGE}&amp;confirmer=1`) || m.html.includes(`${MANAGE}&confirmer=1`));
  assert.match(m.html, /Confirmer ma venue/);
  assert.match(m.text, /Confirmer ma venue/);
});

test('Email de confirmation : pas de demande de confirmation avec caution, carte enregistrée, ou venue déjà confirmée', async () => {
  for (const entry of [
    {...base(), depositLink: 'https://checkout.stripe.com/x', depositAmount: 24, depositStatus: 'lien_envoye'},
    {...base(), depositLink: '', depositAmount: 250, depositStatus: 'autorisee'}, // chemin send-confirmation : lien masqué, montant conservé
    {...base(), presenceConfirmedAt: 5},
    {...base(), source: 'Privateaser'},
  ]) {
    const w = world(entry);
    await sendDepositEmail(entry, w.env, {manageUrl: MANAGE});
    assert.doesNotMatch(w.mails()[0].html, /Confirmer ma venue/, JSON.stringify(entry));
  }
});

test('Relance dashboard : un client sans caution qui n\'a pas confirmé reçoit une relance « confirmer votre venue »', async () => {
  const w = world(base());
  const res = await w.remind();
  assert.equal(res.status, 200);
  const m = w.mails()[0];
  assert.match(m.subject, /confirmer votre venue/);
  assert.match(m.html, /Confirmer ma venue/);
  assert.ok(w.stored().lastReminderAt > 0);
});

test('Relance dashboard : refusée si le client a déjà confirmé sa venue', async () => {
  const w = world({...base(), presenceConfirmedAt: 5});
  const res = await w.remind();
  assert.equal(res.status, 409);
  assert.equal(w.mails().length, 0);
});

test('Relance d\'une demande en attente : le texte habituel est inchangé', async () => {
  const w = world({...base(), status: 'pending'});
  const res = await w.remind();
  assert.equal(res.status, 200);
  const m = w.mails()[0];
  assert.equal(m.subject, 'Votre demande de réservation au Yonko Bar');
  assert.doesNotMatch(m.html, /Confirmer ma venue/);
});

test('Date ou heure modifiée par l\'équipe : la confirmation de venue est à refaire (et redemandée dans l\'email)', async () => {
  const w = world({...base(), presenceConfirmedAt: 99});
  const res = await (await w.patch({edit: {time: '21:30'}})).json();
  assert.deepEqual(res.changed, ['time']);
  assert.equal(w.stored().presenceConfirmedAt, undefined);
  assert.match(w.mails()[0].html, /Confirmer ma venue/);
});

test('Autre modification (nombre de personnes) : la confirmation de venue est conservée', async () => {
  const w = world({...base(), presenceConfirmedAt: 99});
  await w.patch({edit: {guests: '6'}});
  assert.equal(w.stored().presenceConfirmedAt, 99);
  if (w.mails().length) assert.doesNotMatch(w.mails()[0].html, /Confirmer ma venue/);
});

test('mailClientReminder : sans caution = relance de venue ; avec caution = texte habituel', async () => {
  const w = world(base());
  await mailClientReminder(base(), w.env, 'https://yonkobar.com');
  assert.match(w.mails()[0].subject, /confirmer votre venue/);
  const w2 = world({...base(), depositLink: 'https://x', depositAmount: 24});
  await mailClientReminder({...base(), depositLink: 'https://x', depositAmount: 24}, w2.env, 'https://yonkobar.com');
  assert.doesNotMatch(w2.mails()[0].html, /Confirmer ma venue/);
});
