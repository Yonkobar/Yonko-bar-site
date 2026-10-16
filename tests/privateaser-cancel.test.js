import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestPost} from '../functions/api/sync-privateaser.js';

const pad = n => String(n).padStart(2, '0');
function day(offset) { const d = new Date(Date.now() + offset * 864e5); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; }
const iso = c => `${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}`;
const vevent = (code, date, extra = '') => `BEGIN:VEVENT\nUID:${code}\nURL:https://privateaser.com/bookings/${code}\nDTSTART:${date}T190000\nSUMMARY:Client ${code} - 10\nDESCRIPTION:x\\nTaverne\n${extra}END:VEVENT\n`;

function run(ics, stored) {
  const data = new Map(Object.entries(stored).map(([k, v]) => [k, JSON.stringify(v)]));
  data.set('res:index', JSON.stringify(Object.values(stored).map(e => e.id)));
  globalThis.fetch = async () => new Response(ics, {status: 200});
  const env = {DASHBOARD_KEY: 'k', PRIVATEASER_ICS_URL: 'https://feed', RESERVATIONS: {get: async k => data.get(k), put: async (k, v) => data.set(k, v), delete: async k => data.delete(k)}};
  return onRequestPost({request: new Request('https://yonkobar.com/api/sync-privateaser', {method: 'POST', headers: {'x-dashboard-key': 'k'}, body: '{}'}), env})
    .then(r => r.json()).then(res => ({res, get: id => JSON.parse(data.get('res:' + id))}));
}
const priv = (code, date, status = 'accepted') => ({id: `priv-${code}`, name: code, source: 'Privateaser', date, time: '19:00', guests: '10', type: 'Taverne', status});

test('Réservation à venir disparue du flux → annulée', async () => {
  const ics = 'BEGIN:VCALENDAR\n' + vevent('KEEP', day(20)) + 'END:VCALENDAR';
  const {res, get} = await run(ics, {'res:priv-GONE': priv('GONE', iso(day(8))), 'res:priv-KEEP': priv('KEEP', iso(day(20)))});
  assert.equal(res.cancelled, 1);
  assert.equal(get('priv-GONE').status, 'declined'); assert.equal(get('priv-GONE').cancelledOnPrivateaser, true);
  assert.equal(get('priv-KEEP').status, 'accepted');
});

test('STATUS:CANCELLED dans le flux → annulée', async () => {
  const ics = 'BEGIN:VCALENDAR\n' + vevent('C1', day(8), 'STATUS:CANCELLED\n') + 'END:VCALENDAR';
  const {get} = await run(ics, {'res:priv-C1': priv('C1', iso(day(8)))});
  assert.equal(get('priv-C1').status, 'declined'); assert.equal(get('priv-C1').cancelledOnPrivateaser, true);
});

test('Garde-fous : passé, hors période du flux, flux vide, réservations non Privateaser intactes', async () => {
  const ics = 'BEGIN:VCALENDAR\n' + vevent('KEEP', day(10)) + 'END:VCALENDAR';
  const site = {id: 'abc', name: 'Site', source: 'Site internet', date: iso(day(5)), status: 'accepted'};
  const {res, get} = await run(ics, {'res:priv-PAST': priv('PAST', iso(day(-3))), 'res:priv-FAR': priv('FAR', iso(day(60))), 'res:abc': site, 'res:priv-KEEP': priv('KEEP', iso(day(10)))});
  assert.equal(res.cancelled, 0);
  assert.equal(get('priv-PAST').status, 'accepted'); assert.equal(get('priv-FAR').status, 'accepted'); assert.equal(get('abc').status, 'accepted');
  const empty = await run('BEGIN:VCALENDAR\nEND:VCALENDAR', {'res:priv-X': priv('X', iso(day(5)))});
  assert.equal(empty.res.cancelled, 0); assert.equal(empty.get('priv-X').status, 'accepted');
});

test('Réservation qui réapparaît dans le flux → rétablie', async () => {
  const ics = 'BEGIN:VCALENDAR\n' + vevent('BACK', day(8), 'STATUS:CONFIRMED\n') + 'END:VCALENDAR';
  const {get} = await run(ics, {'res:priv-BACK': {...priv('BACK', iso(day(8)), 'declined'), cancelledOnPrivateaser: true}});
  assert.equal(get('priv-BACK').status, 'accepted'); assert.equal(get('priv-BACK').cancelledOnPrivateaser, undefined);
});
