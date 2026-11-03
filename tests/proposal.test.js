import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestPost as create} from '../functions/api/reservations/index.js';
import {onRequestGet as viewGet, onRequestPost as viewPost} from '../functions/api/my-reservation/[token].js';
import {onRequestPost as staffMessage} from '../functions/api/reservations/[id]/messages.js';

function world() {
  const data = new Map();
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url); calls.push({url: u, body: opts.body});
    if (u.includes('resend')) return new Response('{"id":"m"}', {status: 200});
    throw new Error('unexpected ' + u);
  };
  const env = {DASHBOARD_KEY: 'k', RESEND_API_KEY: 're', NOTIFY_EMAIL: 'staff@yonkobar.com',
    RESERVATIONS: {get: async k => data.get(k) ?? null, put: async (k, v) => data.set(k, v), delete: async k => data.delete(k)}};
  const req = (path, method, body, key) => new Request('https://yonkobar.com' + path, {method, headers: key ? {'x-dashboard-key': key} : {}, body: body ? JSON.stringify(body) : undefined});
  const mails = () => calls.filter(c => c.url.includes('resend')).map(c => JSON.parse(c.body));
  return {data, calls, env, req, mails, get: id => JSON.parse(data.get('res:' + id))};
}
const future = days => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
const past = days => new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);

async function pending(w, extra = {}) {
  return (await create({request: w.req('/api/reservations', 'POST', {name: 'Camille Martin', email: 'c@x.fr', date: future(10), time: '20:00', guests: '8', type: 'Taverne', ...extra}), env: w.env})).json();
}
const propose = (w, id, body) => staffMessage({request: w.req('/x', 'POST', body, 'k'), env: w.env, params: {id}});

test('Proposition : possible sur une demande non validée, email au client avec le lien, visible sur sa page', async () => {
  const w = world();
  const r = await pending(w);
  const res = await propose(w, r.id, {proposal: {date: future(12), time: '19:30'}, text: 'Nous sommes complets ce soir-là.'});
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.emailResult.sent, true);
  const e = w.get(r.id);
  assert.equal(e.status, 'pending'); assert.equal(e.date, future(10)); // rien ne bouge tant que le client n'a pas accepté
  assert.equal(e.messages.at(-1).proposal.status, 'open');
  assert.match(e.messages.at(-1).text, /complets ce soir-là/);
  const mail = w.mails().at(-1);
  assert.equal(mail.to[0], 'c@x.fr'); assert.match(mail.subject, /autre date/i); assert.match(mail.html, new RegExp('ma-reservation\\?t=' + r.token));
  const v = await (await viewGet({env: w.env, params: {token: r.token}})).json();
  assert.deepEqual(v.messages.at(-1).proposal, {date: future(12), time: '19:30', status: 'open'});
});

test('Proposition : date invalide, heure invalide ou créneau passé refusés ; mauvaise clé 401', async () => {
  const w = world();
  const r = await pending(w);
  assert.equal((await propose(w, r.id, {proposal: {date: 'demain'}})).status, 400);
  assert.equal((await propose(w, r.id, {proposal: {date: future(5), time: '25:99'}})).status, 400);
  assert.equal((await propose(w, r.id, {proposal: {date: past(3), time: '20:00'}})).status, 400);
  assert.equal((await staffMessage({request: w.req('/x', 'POST', {proposal: {date: future(5)}}, 'mauvaise'), env: w.env, params: {id: r.id}})).status, 401);
  assert.equal(w.get(r.id).messages, undefined);
});

test('Proposition : une nouvelle proposition remplace la précédente', async () => {
  const w = world();
  const r = await pending(w);
  await propose(w, r.id, {proposal: {date: future(11)}});
  await propose(w, r.id, {proposal: {date: future(13), time: '21:00'}});
  const [a, b] = w.get(r.id).messages;
  assert.equal(a.proposal.status, 'replaced'); assert.equal(b.proposal.status, 'open');
});

test('Le client accepte : réservation déplacée (demande restée en attente), équipe prévenue, non-écrasement Privateaser', async () => {
  const w = world();
  const r = await pending(w);
  await propose(w, r.id, {proposal: {date: future(12), time: '19:30'}});
  const at = w.get(r.id).messages[0].at;
  const res = await viewPost({request: w.req('/x', 'POST', {action: 'proposal', at, decision: 'accept'}), env: w.env, params: {token: r.token}});
  assert.equal(res.status, 200);
  const e = w.get(r.id);
  assert.equal(e.date, future(12)); assert.equal(e.time, '19:30'); assert.equal(e.status, 'pending');
  assert.ok(e.lockedFields.includes('date') && e.lockedFields.includes('time'));
  assert.equal(e.messages[0].proposal.status, 'accepted');
  assert.equal(e.messages.at(-1).from, 'client'); assert.equal(e.unreadForStaff, 1);
  const staffMail = w.mails().at(-1);
  assert.equal(staffMail.to[0], 'staff@yonkobar.com'); assert.match(staffMail.html, /déplacée automatiquement/); assert.match(staffMail.html, /reste en attente/);
  assert.doesNotMatch(staffMail.html, /caution/i); // pas de caution sur cette réservation
  // Deuxième réponse sur la même proposition : refusée, rien ne rebouge.
  const again = await viewPost({request: w.req('/x', 'POST', {action: 'proposal', at, decision: 'accept'}), env: w.env, params: {token: r.token}});
  assert.equal(again.status, 409);
});

test('Le client accepte sur une réservation confirmée avec caution : l’équipe est invitée à vérifier la caution', async () => {
  const w = world();
  const r = await pending(w);
  const e0 = w.get(r.id);
  Object.assign(e0, {status: 'accepted', depositLink: 'https://checkout.stripe.com/x', depositAmount: 100, depositStatus: 'en_attente'});
  w.data.set('res:' + r.id, JSON.stringify(e0));
  await propose(w, r.id, {proposal: {date: future(14)}});
  const at = w.get(r.id).messages[0].at;
  await viewPost({request: w.req('/x', 'POST', {action: 'proposal', at, decision: 'accept'}), env: w.env, params: {token: r.token}});
  const e = w.get(r.id);
  assert.equal(e.date, future(14)); assert.equal(e.time, '20:00'); // pas d'heure proposée : l'heure d'origine reste
  assert.equal(e.status, 'accepted'); assert.equal(e.depositAmount, 100); // la caution n'est jamais touchée automatiquement
  const staffMail = w.mails().at(-1);
  assert.match(staffMail.html, /vérifiez que son montant/); assert.match(staffMail.html, /déjà confirmée/);
});

test('Le client refuse le créneau : réservation inchangée, équipe prévenue', async () => {
  const w = world();
  const r = await pending(w);
  await propose(w, r.id, {proposal: {date: future(12)}});
  const at = w.get(r.id).messages[0].at;
  const res = await viewPost({request: w.req('/x', 'POST', {action: 'proposal', at, decision: 'decline'}), env: w.env, params: {token: r.token}});
  assert.equal(res.status, 200);
  const e = w.get(r.id);
  assert.equal(e.date, future(10)); assert.equal(e.messages[0].proposal.status, 'declined');
  assert.match(w.mails().at(-1).html, /ne me convient pas/); assert.equal(e.unreadForStaff, 1);
});

test('Réponse client : proposition inconnue, réservation annulée, décision invalide, créneau passé', async () => {
  const w = world();
  const r = await pending(w);
  const answer = (at, decision) => viewPost({request: w.req('/x', 'POST', {action: 'proposal', at, decision}), env: w.env, params: {token: r.token}});
  assert.equal((await answer(123, 'accept')).status, 404);
  await propose(w, r.id, {proposal: {date: future(12)}});
  const at = w.get(r.id).messages[0].at;
  assert.equal((await answer(at, 'peut-etre')).status, 400);
  // Le créneau proposé est devenu passé avant la réponse du client.
  const e1 = w.get(r.id); e1.messages[0].proposal.date = past(1); w.data.set('res:' + r.id, JSON.stringify(e1));
  assert.equal((await answer(at, 'accept')).status, 409);
  assert.equal(w.get(r.id).date, future(10));
  // Réservation annulée : on ne déplace plus rien.
  const e2 = w.get(r.id); e2.messages[0].proposal.date = future(12); e2.status = 'declined'; w.data.set('res:' + r.id, JSON.stringify(e2));
  assert.equal((await answer(at, 'accept')).status, 409);
});

test('Sans email : proposition enregistrée sur la page du client, aucun email parti', async () => {
  const w = world();
  const r = await pending(w, {email: ''});
  const before = w.mails().length;
  const body = await (await propose(w, r.id, {proposal: {date: future(12)}})).json();
  assert.equal(body.emailResult.sent, false); assert.equal(body.emailResult.reason, 'no_email');
  assert.equal(w.mails().length, before);
  assert.equal(w.get(r.id).messages[0].proposal.status, 'open');
});

test('Messagerie ordinaire : fonctionne toujours pour une demande en attente, sans changement de date', async () => {
  const w = world();
  const r = await pending(w);
  const res = await propose(w, r.id, {text: 'Bonjour, une question sur votre demande.'});
  assert.equal(res.status, 200);
  const e = w.get(r.id);
  assert.equal(e.status, 'pending'); assert.equal(e.messages[0].proposal, undefined);
  assert.match(w.mails().at(-1).subject, /Nouveau message/);
});
