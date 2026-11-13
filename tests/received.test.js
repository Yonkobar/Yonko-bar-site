import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestPost} from '../functions/api/reservations/index.js';

function setup() {
  const data = new Map();
  const kv = {get: async k => data.get(k) ?? null, put: async (k, v) => data.set(k, v), delete: async k => data.delete(k), list: async () => ({keys: [], list_complete: true})};
  const mails = [];
  globalThis.fetch = async (url, opts) => { if (String(url).includes('resend')) mails.push(JSON.parse(opts.body)); return new Response('{}', {status: 200}); };
  return {env: {DASHBOARD_KEY: 'k', RESEND_API_KEY: 're_x', RESERVATIONS: kv}, mails};
}
const req = (body, headers = {}) => new Request('https://yonkobar.com/api/reservations', {method: 'POST', headers, body: JSON.stringify(body)});
const base = {name: 'Camille', date: '2026-11-20', time: '20:00', guests: '4', type: 'Taverne'};

test('Demande du site avec email : accusé de réception « Demande bien reçue » avec le lien de suivi', async () => {
  const {env, mails} = setup(); const jobs = [];
  const r = await onRequestPost({request: req({...base, email: 'camille@ex.fr'}), env, waitUntil: p => jobs.push(p)});
  assert.equal(r.status, 201); await Promise.all(jobs);
  assert.equal(mails.length, 1);
  assert.deepEqual(mails[0].to, ['camille@ex.fr']);
  assert.match(mails[0].subject, /bien reçu votre demande/);
  assert.match(mails[0].html, /pas encore confirmée/);
  assert.match(mails[0].html, /ma-reservation\?t=/);
});

test('Pas d’accusé de réception sans email, ni pour une réservation créée dans l’appli quand aucun texte du bar ne s’applique', async () => {
  let {env, mails} = setup(); let jobs = [];
  await onRequestPost({request: req(base), env, waitUntil: p => jobs.push(p)}); await Promise.all(jobs);
  assert.equal(mails.length, 0);
  ({env, mails} = setup()); jobs = [];
  await onRequestPost({request: req({...base, email: 'c@ex.fr', manual: true}, {'x-dashboard-key': 'k'}), env, waitUntil: p => jobs.push(p)}); await Promise.all(jobs);
  assert.equal(mails.length, 0);
});

test('Un échec d’envoi de l’accusé ne bloque pas la demande', async () => {
  const {env} = setup(); globalThis.fetch = async () => new Response('down', {status: 500}); const jobs = [];
  const r = await onRequestPost({request: req({...base, email: 'c@ex.fr'}), env, waitUntil: p => jobs.push(p)});
  assert.equal(r.status, 201); await Promise.all(jobs);
});
