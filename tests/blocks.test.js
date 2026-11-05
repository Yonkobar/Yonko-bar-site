import test from 'node:test';
import assert from 'node:assert/strict';
import {spaceOf} from '../functions/_spaces.js';
import {findBlock, blockMessage, parisToday} from '../functions/_blocks.js';
import {onRequestGet, onRequestPost, onRequestDelete} from '../functions/api/blocked-days.js';
import {onRequestPost as createReservation} from '../functions/api/reservations/index.js';
import {computeDepositAmount} from '../functions/_shared.js';

test('Espaces : nouveaux et anciens noms reconnus', () => {
  for (const [t, s] of [['Table', 'table'], ['Taverne', 'table'], ['Cave', 'cave'], ['Privatisation de la Cave (500-700 euros min.)', 'cave'],
    ['Privatisation', 'cave'], ['Bar', 'bar'], ['Bar entier (sur devis)', 'bar'], ['', null], ['Mezzanine', null]]) assert.equal(spaceOf(t), s, t);
});

test('Cautions inchangées avec les nouveaux noms (Cave 250 €, Table 3 €/pers. ven-sam > 6, Bar sur devis)', () => {
  const fri = '2026-11-13', tue = '2026-11-10';
  assert.equal(computeDepositAmount({type: 'Cave', guests: '40', date: tue}), 250);
  assert.equal(computeDepositAmount({type: 'Table', guests: '10', date: fri}), 30);
  assert.equal(computeDepositAmount({type: 'Table', guests: '10', date: tue}), null);
  assert.equal(computeDepositAmount({type: 'Bar', guests: '70', date: fri}), null);
  assert.equal(computeDepositAmount({type: 'Taverne', guests: '8', date: fri}), 24);
});

test('Blocage : tout le bar, un espace, et le bar entier impossible si une partie est bloquée', () => {
  const b = [{date: '2026-12-01', space: 'cave', reason: 'privatise'}];
  assert.equal(findBlock(b, '2026-12-01', 'table'), null);
  assert.equal(findBlock(b, '2026-12-01', 'cave').space, 'cave');
  assert.equal(findBlock(b, '2026-12-01', 'bar').space, 'cave');
  assert.equal(findBlock(b, '2026-12-02', 'cave'), null);
  assert.equal(findBlock([{date: '2026-12-01', space: 'all', reason: 'ferme'}], '2026-12-01', 'table').space, 'all');
  assert.match(blockMessage(b[0]), /La cave est privatisée/);
});

function store() {
  const data = new Map();
  return {data, get: async k => data.get(k) ?? null, put: async (k, v) => data.set(k, v)};
}
const future = (n) => { const d = new Date(parisToday() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

test('API jours bloqués : protégée, ajout, lecture publique, suppression', async () => {
  const kv = store(), env = {DASHBOARD_KEY: 'k', RESERVATIONS: kv}, date = future(5);
  const post = (body, key = 'k') => onRequestPost({request: new Request('https://x/api/blocked-days', {method: 'POST', headers: {'x-dashboard-key': key}, body: JSON.stringify(body)}), env});
  assert.equal((await post({date, space: 'cave', reason: 'complet'}, 'mauvaise')).status, 401);
  assert.equal((await post({date, space: 'cave', reason: 'nimporte'})).status, 400);
  assert.equal((await post({date: future(-2), space: 'cave', reason: 'complet'})).status, 400);
  assert.equal((await post({date, space: 'cave', reason: 'complet'})).status, 200);
  assert.equal((await post({date, space: 'cave', reason: 'privatise'})).status, 200); // remplace, pas de doublon
  let list = await (await onRequestGet({env})).json();
  assert.deepEqual(list, [{date, space: 'cave', reason: 'privatise'}]);
  await post({date, space: 'all', reason: 'ferme'}); // tout le bar remplace les blocages par espace
  list = await (await onRequestGet({env})).json();
  assert.deepEqual(list.map(b => b.space), ['all']);
  const del = await onRequestDelete({request: new Request(`https://x/api/blocked-days?date=${date}&space=all`, {method: 'DELETE', headers: {'x-dashboard-key': 'k'}}), env});
  assert.equal(del.status, 200);
  assert.deepEqual(await (await onRequestGet({env})).json(), []);
});

test('Formulaire du site : demande refusée un jour bloqué, acceptée pour un autre espace, toujours possible depuis le dashboard', async () => {
  const kv = store(), date = future(6);
  kv.data.set('meta:blocked-days', JSON.stringify([{date, space: 'cave', reason: 'privatise'}]));
  const env = {DASHBOARD_KEY: 'k', RESERVATIONS: kv};
  const send = (type, headers = {}) => createReservation({request: new Request('https://x/api/reservations', {method: 'POST', headers, body: JSON.stringify({name: 'A', date, time: '20:00', guests: '40', type})}), env});
  const refused = await send('Privatisation de la Cave');
  assert.equal(refused.status, 409);
  assert.match((await refused.json()).error, /cave est privatisée/);
  assert.equal((await send('Bar entier (sur devis)')).status, 409);
  assert.equal((await send('Taverne')).status, 201);
  assert.equal((await send('Cave', {'x-dashboard-key': 'k'})).status, 201);
});
