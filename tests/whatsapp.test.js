import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestPost as create} from '../functions/api/reservations/index.js';
import {whatsappText} from '../functions/_whatsapp.js';

function world(extraEnv = {}, {providerStatus = 200, providerThrows = false} = {}) {
  const data = new Map();
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url); calls.push(u);
    if (u.startsWith('https://api.callmebot.com/')) {
      if (providerThrows) throw new Error('network down');
      return new Response('ok', {status: providerStatus});
    }
    throw new Error('unexpected ' + u);
  };
  const env = {DASHBOARD_KEY: 'k', RESERVATIONS: {get: async k => data.get(k) ?? null, put: async (k, v) => data.set(k, v), delete: async k => data.delete(k)}, ...extraEnv};
  const req = (body, key) => new Request('https://yonkobar.com/api/reservations', {method: 'POST', headers: key ? {'x-dashboard-key': key} : {}, body: JSON.stringify(body)});
  return {data, calls, env, req, whatsapps: () => calls.filter(c => c.includes('callmebot'))};
}
const future = days => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
const form = (extra = {}) => ({name: 'Camille Martin', email: 'c@x.fr', contact: '0612345678', date: future(10), time: '20:00', guests: '8', type: 'Taverne', notes: 'Anniversaire', source: 'Site internet', ...extra});
const CONF = {CALLMEBOT_PHONE: '+33699887766', CALLMEBOT_APIKEY: 'cle123'};

test('WhatsApp : une demande du site envoie automatiquement le message à l’équipe (rien d’autre à faire pour le client)', async () => {
  const w = world(CONF);
  const res = await create({request: w.req(form()), env: w.env});
  assert.equal(res.status, 201);
  assert.equal(w.whatsapps().length, 1);
  const url = new URL(w.whatsapps()[0]);
  assert.equal(url.searchParams.get('phone'), '+33699887766');
  assert.equal(url.searchParams.get('apikey'), 'cle123');
  const text = url.searchParams.get('text');
  for (const part of ['Nouvelle demande - Yonko Bar', 'Nom: Camille Martin', 'Email: c@x.fr', 'Tel: 0612345678', 'Personnes: 8', 'Espace: Taverne', 'Message: Anniversaire', 'Via Site internet']) assert.ok(text.includes(part), part);
  assert.ok(text.includes('à 20:00'));
});

test('WhatsApp : non configuré -> aucun envoi, la réservation est créée normalement', async () => {
  const w = world({});
  const res = await create({request: w.req(form()), env: w.env});
  assert.equal(res.status, 201); assert.equal(w.whatsapps().length, 0);
  assert.ok([...w.data.keys()].some(k => k.startsWith('res:') && k !== 'res:index'));
});

test('WhatsApp : pas d’envoi pour une réservation saisie dans l’appli (clé du dashboard)', async () => {
  const w = world(CONF);
  const res = await create({request: w.req(form({manual: true}), 'k'), env: w.env});
  assert.equal(res.status, 201); assert.equal(w.whatsapps().length, 0);
});

test('WhatsApp : panne ou refus du service -> la demande du client est quand même enregistrée', async () => {
  for (const opts of [{providerThrows: true}, {providerStatus: 500}, {providerStatus: 403}]) {
    const w = world(CONF, opts);
    const res = await create({request: w.req(form()), env: w.env});
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.ok && body.id && body.token);
    assert.ok(w.data.get('res:' + body.id));
  }
});

test('WhatsApp : numéro saisi sans indicatif corrigé, texte du client nettoyé (retours à la ligne)', async () => {
  const w = world({CALLMEBOT_PHONE: '06 99 88 77 66', CALLMEBOT_APIKEY: 'cle123'});
  await create({request: w.req(form({notes: 'ligne 1\nligne 2\r\n*gras*'})), env: w.env});
  const url = new URL(w.whatsapps()[0]);
  assert.equal(url.searchParams.get('phone'), '+33699887766');
  assert.doesNotMatch(url.searchParams.get('text').split('Message: ')[1], /\n.*\n/s); // une seule ligne pour le message client
  assert.match(whatsappText({name: 'A', date: '2026-12-01', notes: 'a\nb'}), /Message: a b/);
});

test('WhatsApp : la clé n’apparaît jamais dans les journaux', async () => {
  const w = world(CONF, {providerStatus: 500});
  const logs = [];
  const orig = console.warn; console.warn = (...a) => logs.push(JSON.stringify(a));
  try { await create({request: w.req(form()), env: w.env}); } finally { console.warn = orig; }
  assert.ok(logs.length >= 1); assert.ok(logs.every(l => !l.includes('cle123')));
});
