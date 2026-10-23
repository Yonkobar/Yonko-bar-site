import test from 'node:test';
import assert from 'node:assert/strict';
import {installTracking} from '../functions/_kv.js';
import {onRequestGet} from '../functions/api/reservations/index.js';
import {onRequestPost as sync} from '../functions/api/sync-privateaser.js';

function fakeKv(seed = {}) {
  const data = new Map(Object.entries(seed).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  const ops = {get: 0, put: 0, delete: 0};
  return {data, ops, kv: {
    get: async k => { ops.get++; return data.has(k) ? data.get(k) : null; },
    put: async (k, v) => { ops.put++; data.set(k, v); },
    delete: async k => { ops.delete++; data.delete(k); },
    list: async () => ({keys: [], list_complete: true}),
  }};
}
const list = env => onRequestGet({request: new Request('https://yonkobar.com/api/reservations', {headers: {'x-dashboard-key': 'k'}}), env}).then(r => r.json());

function seedN(n) {
  const seed = {'res:index': JSON.stringify(Array.from({length: n}, (_, i) => `r${i}`))};
  for (let i = 0; i < n; i++) seed[`res:r${i}`] = {id: `r${i}`, name: `C${i}`, createdAt: i};
  return seed;
}

test('Actualisation sans changement : 2 lectures au lieu de 1 + N', async () => {
  const {kv, ops} = fakeKv(seedN(50));
  const env = {DASHBOARD_KEY: 'k', RESERVATIONS: kv};
  installTracking(env);
  assert.equal((await list(env)).length, 50); // première fois : reconstruction
  ops.get = 0;
  assert.equal((await list(env)).length, 50);
  assert.equal(ops.get, 2);
});

test('Une modification apparaît immédiatement à l’actualisation suivante', async () => {
  const {kv} = fakeKv(seedN(3));
  const env = {DASHBOARD_KEY: 'k', RESERVATIONS: kv};
  installTracking(env);
  await list(env);
  await env.RESERVATIONS.put('res:r1', JSON.stringify({id: 'r1', name: 'Modifié', createdAt: 1}));
  assert.equal((await list(env)).find(e => e.id === 'r1').name, 'Modifié');
  await env.RESERVATIONS.delete('res:r2');
  await env.RESERVATIONS.put('res:index', JSON.stringify(['r0', 'r1']));
  assert.deepEqual((await list(env)).map(e => e.id).sort(), ['r0', 'r1']);
});

test('Sans suivi (environnement non modifiable) : lecture complète, résultat juste', async () => {
  const {kv} = fakeKv(seedN(3));
  const env = Object.freeze({DASHBOARD_KEY: 'k', RESERVATIONS: kv});
  installTracking(env); // ne doit pas planter
  assert.equal((await list(env)).length, 3);
});

test('Les clés hors réservations ne changent pas la version', async () => {
  const {kv, data} = fakeKv(seedN(1));
  const env = {DASHBOARD_KEY: 'k', RESERVATIONS: kv};
  installTracking(env);
  await list(env);
  const rev = data.get('res:rev');
  await env.RESERVATIONS.put('google_rating_cache', '{}');
  await env.RESERVATIONS.put('tok:abc', 'r0');
  assert.equal(data.get('res:rev'), rev);
});

test('Synchro Privateaser : une seule invalidation, la liste suit', async () => {
  const pad = n => String(n).padStart(2, '0');
  const d = new Date(Date.now() + 10 * 864e5);
  const day = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const ics = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:A1\nURL:https://privateaser.com/bookings/A1\nDTSTART:${day}T190000\nSUMMARY:Client A - 10\nDESCRIPTION:x\\nTaverne\nEND:VEVENT\nBEGIN:VEVENT\nUID:B2\nURL:https://privateaser.com/bookings/B2\nDTSTART:${day}T200000\nSUMMARY:Client B - 4\nDESCRIPTION:x\\nTaverne\nEND:VEVENT\nEND:VCALENDAR`;
  globalThis.fetch = async () => new Response(ics, {status: 200});
  const {kv, data} = fakeKv(seedN(2));
  const env = {DASHBOARD_KEY: 'k', PRIVATEASER_ICS_URL: 'https://feed', RESERVATIONS: kv};
  installTracking(env);
  await list(env);
  let bumps = 0; const put = kv.put;
  kv.put = async (k, v) => { if (k === 'res:rev') bumps++; return put(k, v); };
  const res = await sync({request: new Request('https://yonkobar.com/api/sync-privateaser', {method: 'POST', headers: {'x-dashboard-key': 'k'}, body: '{}'}), env}).then(r => r.json());
  assert.equal(res.created, 2);
  assert.equal(bumps, 1);
  const ids = (await list(env)).map(e => e.id).sort();
  assert.deepEqual(ids, ['priv-A1', 'priv-B2', 'r0', 'r1']);
  // deuxième synchro identique : aucune écriture
  bumps = 0;
  const res2 = await sync({request: new Request('https://yonkobar.com/api/sync-privateaser', {method: 'POST', headers: {'x-dashboard-key': 'k'}, body: '{}'}), env}).then(r => r.json());
  assert.equal(res2.created, 0); assert.equal(bumps, 0);
  assert.ok(data.get('res:priv-A1'));
});
