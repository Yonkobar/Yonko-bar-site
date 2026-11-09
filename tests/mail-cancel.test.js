import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {onRequestPost as create} from '../functions/api/reservations/index.js';
import {onRequestPost as viewPost} from '../functions/api/my-reservation/[token].js';
import {onRequestPatch} from '../functions/api/reservations/[id].js';
import {htmlToText} from '../functions/_mail-text.js';

// Resend et le service push sont simulés : aucun appel réseau réel.
function world() {
  const data = new Map(); const mails = []; const pushes = [];
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).includes('resend')) { mails.push(JSON.parse(opts.body)); return new Response('{"id":"m"}', {status: 200}); }
    if (String(url).endsWith('/v1/customers')) return Response.json({id: 'cus_1'});
    if (String(url).endsWith('/v1/checkout/sessions')) return Response.json({id: 'cs_1', url: 'https://checkout.stripe.com/1'});
    throw new Error('unexpected ' + url);
  };
  const env = {DASHBOARD_KEY: 'k', RESEND_API_KEY: 're', STRIPE_SECRET_KEY: 'sk', NOTIFY_EMAIL: 'staff@yonkobar.com',
    PUSH_SERVICE: {fetch: async (u, o) => { pushes.push(JSON.parse(o.body)); return Response.json({ok: true}); }},
    RESERVATIONS: {get: async k => data.get(k) ?? null, put: async (k, v) => data.set(k, v), delete: async k => data.delete(k)}};
  const req = (path, method, body, key) => new Request('https://yonkobar.com' + path, {method, headers: key ? {'x-dashboard-key': key} : {}, body: body ? JSON.stringify(body) : undefined});
  return {mails, pushes, env, req};
}
const inDays = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const nextFriday = () => { for (let i = 7; i < 14; i++) { const d = new Date(Date.now() + i * 864e5); if (d.getUTCDay() === 5) return d.toISOString().slice(0, 10); } };
const book = async (w, extra = {}) => (await create({request: w.req('/api/reservations', 'POST', {name: 'Camille Martin', email: 'c@x.fr', date: inDays(10), time: '20:30', guests: '4', type: 'Taverne', ...extra}), env: w.env})).json();
const patch = (w, id, body) => onRequestPatch({request: w.req('/api/reservations/' + id, 'PATCH', body, 'k'), env: w.env, params: {id}});

test('htmlToText : liens, retours à la ligne et entités', () => {
  assert.equal(htmlToText('<p>Bonjour Ana &amp; Co,<br>Merci</p><a href="https://x.fr/a?b=1&amp;c=2">Voir</a>'), 'Bonjour Ana & Co,\nMerci\nVoir : https://x.fr/a?b=1&c=2');
});

test('Emails : version texte brut, document HTML complet, logo hébergé (accusé + confirmation)', async () => {
  const w = world();
  const r = await book(w, {date: nextFriday(), type: 'Privatisation de la Cave', guests: '40'});
  const res = await patch(w, r.id, {status: 'accepted'});
  assert.equal(res.status, 200);
  const clientMails = w.mails.filter(m => m.to[0] === 'c@x.fr');
  assert.equal(clientMails.length, 2, 'accusé de réception + confirmation');
  for (const m of clientMails) {
    assert.ok(m.text && m.text.includes('Bonjour Camille Martin'), 'version texte avec le contenu : ' + m.subject);
    assert.match(m.html, /^<!doctype html>/i);
    assert.match(m.html, /charset="utf-8"/);
    assert.doesNotMatch(m.html, /data:image/, 'pas de logo en data: (bloqué par Gmail/Outlook)');
    assert.doesNotMatch(m.text, /<[a-z][^>]*>/i, 'aucune balise dans le texte brut');
  }
  const confirm = clientMails.find(m => /^Votre réservation au Yonko Bar/.test(m.subject));
  assert.match(confirm.text, /Minimum de consommation : 700 € pour la soirée\./);
  assert.match(confirm.text, /Enregistrer ma carte de garantie — 250€ : https:\/\/checkout\.stripe\.com\/1/);
  assert.match(confirm.html, /yonkobar\.com\/icons\/logo-192\.png/);
});

test('Annulation par le client : push « cancel » (sans donnée client) + emails équipe et client', async () => {
  const w = world();
  const r = await book(w);
  w.mails.length = 0; w.pushes.length = 0;
  const pending = [];
  const res = await viewPost({request: w.req('/x', 'POST', {action: 'cancel'}), env: w.env, params: {token: r.token}, waitUntil: p => pending.push(p)});
  assert.equal(res.status, 200); await Promise.all(pending);
  const ev = w.pushes.find(p => p.type === 'cancel');
  assert.ok(ev, 'événement push d’annulation envoyé');
  assert.equal(ev.id, r.id); assert.ok(Number.isFinite(ev.at));
  assert.doesNotMatch(JSON.stringify(ev), /Camille|c@x\.fr/);
  assert.ok(w.mails.some(m => m.to[0] === 'staff@yonkobar.com' && /annulée par le client/.test(m.subject)));
  assert.ok(w.mails.some(m => m.to[0] === 'c@x.fr' && /Annulation de votre réservation/.test(m.subject)));
});

test('Annulation par l’équipe : email au client si la réservation était confirmée, rien pour une simple demande refusée', async () => {
  const w = world();
  const a = await book(w); await patch(w, a.id, {status: 'accepted'});
  const b = await book(w, {name: 'Autre Client', email: 'b@x.fr'});
  w.mails.length = 0;
  assert.equal((await patch(w, a.id, {status: 'declined'})).status, 200);
  assert.equal(w.mails.length, 1);
  assert.equal(w.mails[0].to[0], 'c@x.fr'); assert.match(w.mails[0].subject, /Annulation de votre réservation/);
  assert.match(w.mails[0].text, /est bien annulée/);
  w.mails.length = 0;
  assert.equal((await patch(w, b.id, {status: 'declined'})).status, 200);
  assert.equal(w.mails.length, 0, 'refus d’une demande en attente : pas d’email (comportement inchangé)');
});

test('Accueil : le minimum de la Cave est précis, plus de fourchette « 500 à 700 »', async () => {
  const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /500 (à|et|–|-) ?700/);
  assert.match(html, /500 € mardi et mercredi, 600 € jeudi, 700 € vendredi et samedi/);
});
