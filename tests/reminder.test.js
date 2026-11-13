import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {onRequestPost as create} from '../functions/api/reservations/index.js';
import {onRequestPost as remind} from '../functions/api/reservations/[id]/send-reminder.js';
import {onRequestPatch} from '../functions/api/reservations/[id].js';

// Resend simulé : aucun appel réseau réel.
function world() {
  const data = new Map(); const mails = [];
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).includes('resend')) { mails.push(JSON.parse(opts.body)); return new Response('{"id":"m"}', {status: 200}); }
    throw new Error('unexpected ' + url);
  };
  const env = {DASHBOARD_KEY: 'k', RESEND_API_KEY: 're',
    RESERVATIONS: {get: async k => data.get(k) ?? null, put: async (k, v) => data.set(k, v), delete: async k => data.delete(k)}};
  const req = (path, method, body, key) => new Request('https://yonkobar.com' + path, {method, headers: key ? {'x-dashboard-key': key} : {}, body: body ? JSON.stringify(body) : undefined});
  return {data, mails, env, req};
}
const inDays = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const book = async (w, extra = {}) => (await create({request: w.req('/api/reservations', 'POST', {name: 'Camille Martin', email: 'c@x.fr', date: inDays(10), time: '20:30', guests: '4', type: 'Taverne', ...extra}), env: w.env})).json();
const relance = (w, id, key = 'k') => remind({request: w.req(`/api/reservations/${id}/send-reminder`, 'POST', {}, key), env: w.env, params: {id}});
const get = (w, id) => JSON.parse(w.data.get('res:' + id));

test('Relance : email avec le texte du bar, lien vers la page du client, date et compteur enregistrés', async () => {
  const w = world();
  const r = await book(w);
  w.mails.length = 0;
  const res = await relance(w, r.id);
  assert.equal(res.status, 200);
  assert.equal(w.mails.length, 1);
  const m = w.mails[0];
  assert.equal(m.to[0], 'c@x.fr');
  assert.equal(m.subject, 'Votre demande de réservation au Yonko Bar');
  for (const phrase of [
    'Bonjour,',
    "J'espère que vous allez bien.",
    "Je n'ai pas encore eu de retour de votre part concernant votre demande.",
    "Je vous invite à confirmer rapidement votre réservation afin de bloquer la disponibilité dans notre établissement et vous assurer de la place.",
    "N'hésitez pas à revenir vers moi si vous avez des questions.",
    "Merci pour votre retour et bonne journée !",
  ]) assert.ok(m.text.includes(phrase), 'texte manquant : ' + phrase);
  assert.match(m.text, /Voir ma réservation : https:\/\/yonkobar\.com\/ma-reservation\?t=/);
  assert.match(m.html, /^<!doctype html>/i);
  const e = get(w, r.id);
  assert.ok(Number.isFinite(e.lastReminderAt)); assert.equal(e.reminderCount, 1);
  await relance(w, r.id);
  assert.equal(get(w, r.id).reminderCount, 2);
});

test('Relance : accès protégé, et refusée si pas d’email, réservation refusée ou client déjà confirmé', async () => {
  const w = world();
  assert.equal((await relance(w, 'nope')).status, 404);
  const a = await book(w);
  assert.equal((await relance(w, a.id, 'mauvaise')).status, 401);
  assert.equal((await relance(w, a.id, '')).status, 401);
  // Sans email
  const noMail = await book(w, {email: ''});
  assert.equal((await relance(w, noMail.id)).status, 400);
  // Acceptée sans caution : on attend que le client confirme sa venue, puis plus rien à relancer
  const b = await book(w, {name: 'Autre'});
  await onRequestPatch({request: w.req('/api/reservations/' + b.id, 'PATCH', {status: 'accepted'}, 'k'), env: w.env, params: {id: b.id}});
  w.mails.length = 0;
  assert.equal((await relance(w, b.id)).status, 200, 'sans caution et venue non confirmée : relance possible');
  assert.match(w.mails.at(-1).subject, /confirmer votre venue/);
  const sb = JSON.parse(w.data.get('res:' + b.id)); sb.presenceConfirmedAt = Date.now(); w.data.set('res:' + b.id, JSON.stringify(sb));
  w.mails.length = 0;
  assert.equal((await relance(w, b.id)).status, 409, 'venue confirmée : rien à relancer');
  // Refusée
  await onRequestPatch({request: w.req('/api/reservations/' + a.id, 'PATCH', {status: 'declined'}, 'k'), env: w.env, params: {id: a.id}});
  w.mails.length = 0;
  assert.equal((await relance(w, a.id)).status, 409);
  assert.equal(w.mails.length, 0, 'aucun email envoyé dans ces cas');
});

test('Relance : acceptée avec caution non validée = relançable ; caution validée = non', async () => {
  const w = world();
  const r = await book(w);
  const e = get(w, r.id); e.status = 'accepted'; e.depositLink = 'https://checkout.stripe.com/x'; e.depositStatus = 'pending';
  w.data.set('res:' + r.id, JSON.stringify(e));
  assert.equal((await relance(w, r.id)).status, 200);
  e.depositStatus = 'autorisee'; w.data.set('res:' + r.id, JSON.stringify(e));
  assert.equal((await relance(w, r.id)).status, 409);
});

test('Dashboard : bouton « Relancer » branché sur l’endpoint, visible seulement quand le client doit répondre', async () => {
  const html = await fs.readFile(new URL('../dashboard.html', import.meta.url), 'utf8');
  assert.match(html, /action\('remind',e\.lastReminderAt\?'Relancer à nouveau':'Relancer'/);
  assert.match(html, /e\.email&&e\.status!=='declined'&&\(e\.status==='pending'\|\|depositPending\(e\)\|\|presencePending\(e\)\)/);
  assert.match(html, /case 'remind':await sendReminder\(entry\);break;/);
  assert.match(html, /\/\$\{entry\.id\}\/send-reminder/);
});
