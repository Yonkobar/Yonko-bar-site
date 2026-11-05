import test from 'node:test';
import assert from 'node:assert/strict';
import {isReviewDue, dueReviews, sendDueReviews, REVIEW_START_DATE} from '../functions/_reviews.js';
import {onRequestGet} from '../functions/api/reservations/index.js';

// 2026-11-21 à 12 h, heure de Paris (UTC+1).
const NOON = Date.UTC(2026, 10, 21, 11, 0);
const MORNING = Date.UTC(2026, 10, 21, 8, 0); // 9 h à Paris
const base = {id: 'r1', name: 'Camille', email: 'camille@example.com', date: '2026-11-20', time: '20:00', guests: '4', status: 'accepted'};

test('Avis : dû le lendemain à partir de 11 h, pas avant', () => {
  assert.equal(isReviewDue(base, NOON), true);
  assert.equal(isReviewDue(base, MORNING), false);
});

test('Avis : jamais pour une visite à venir, refusée, sans email, débitée (no-show) ou déjà demandée', () => {
  assert.equal(isReviewDue({...base, date: '2026-11-21'}, NOON), false);
  assert.equal(isReviewDue({...base, status: 'declined'}, NOON), false);
  assert.equal(isReviewDue({...base, status: 'pending'}, NOON), false);
  assert.equal(isReviewDue({...base, email: ''}, NOON), false);
  assert.equal(isReviewDue({...base, depositStatus: 'debitee'}, NOON), false);
  assert.equal(isReviewDue({...base, reviewRequestedAt: 1}, NOON), false);
  assert.equal(isReviewDue({...base, reviewRequestAttempts: 3}, NOON), false);
});

test('Avis : pas de rattrapage de l’historique ni des visites de plus de 3 jours', () => {
  assert.equal(isReviewDue({...base, date: '2026-11-17'}, NOON), false);
  assert.equal(isReviewDue({...base, date: '2026-11-18'}, NOON), true);
  const before = new Date(REVIEW_START_DATE + 'T12:00:00Z'); before.setUTCDate(before.getUTCDate() - 1);
  assert.equal(isReviewDue({...base, date: before.toISOString().slice(0, 10)}, Date.UTC(2026, 10, 6, 12)), false);
});

test('Avis : rien si Resend ou le lien Google ne sont pas configurés', () => {
  assert.deepEqual(dueReviews([base], {RESEND_API_KEY: 're_x'}, NOON), []);
  assert.deepEqual(dueReviews([base], {GOOGLE_PLACE_ID: 'p'}, NOON), []);
  assert.equal(dueReviews([base], {RESEND_API_KEY: 're_x', GOOGLE_PLACE_ID: 'p'}, NOON).length, 1);
});

function kv(entries) {
  const data = new Map(entries.map(e => [`res:${e.id}`, JSON.stringify(e)]));
  return {data, get: async k => data.get(k) ?? null, put: async (k, v) => data.set(k, v)};
}

test('Avis : un seul email, avec le lien Google, puis marqué comme envoyé', async () => {
  const calls = [];
  globalThis.fetch = async (url, opts) => { calls.push({url: String(url), opts}); return new Response('{}', {status: 200}); };
  const store = kv([base]);
  const env = {RESEND_API_KEY: 're_x', GOOGLE_PLACE_ID: 'PLACE123', RESERVATIONS: store};
  await sendDueReviews(env, dueReviews([base], env, NOON), NOON);
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].opts.body);
  assert.deepEqual(body.to, ['camille@example.com']);
  assert.match(body.html, /writereview\?placeid=PLACE123/);
  assert.equal(calls[0].opts.headers['Idempotency-Key'], 'review-r1');
  const saved = JSON.parse(store.data.get('res:r1'));
  assert.equal(saved.reviewRequestedAt, NOON);
  // Deuxième passage : la réservation relue est déjà marquée, aucun nouvel envoi.
  await sendDueReviews(env, [base], NOON);
  assert.equal(calls.length, 1);
});

test('Avis : un échec d’envoi est compté et réessayé, sans marquer comme envoyé', async () => {
  globalThis.fetch = async () => new Response('down', {status: 500});
  const store = kv([base]);
  const env = {RESEND_API_KEY: 're_x', GOOGLE_PLACE_ID: 'p', RESERVATIONS: store};
  await sendDueReviews(env, [base], NOON);
  const saved = JSON.parse(store.data.get('res:r1'));
  assert.equal(saved.reviewRequestedAt, undefined);
  assert.equal(saved.reviewRequestAttempts, 1);
});

test('Liste du dashboard : l’envoi des avis part en arrière-plan sans bloquer la réponse', async () => {
  const sent = [];
  globalThis.fetch = async (url) => { sent.push(String(url)); return new Response('{}', {status: 200}); };
  const yesterday = new Date(Date.now() - 86400000 * 2).toISOString().slice(0, 10);
  const e = {...base, date: yesterday < REVIEW_START_DATE ? REVIEW_START_DATE : yesterday};
  const store = kv([e]);
  store.data.set('res:index', JSON.stringify([e.id]));
  const jobs = [];
  const res = await onRequestGet({
    request: new Request('https://yonkobar.com/api/reservations', {headers: {'x-dashboard-key': 'k'}}),
    env: {DASHBOARD_KEY: 'k', RESEND_API_KEY: 're_x', GOOGLE_PLACE_ID: 'p', RESERVATIONS: store},
    waitUntil: p => jobs.push(p),
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).length, 1);
  await Promise.all(jobs);
  // Envoyé seulement si la date de visite rentre dans la fenêtre au moment du test.
  assert.equal(sent.length, isReviewDue(e) ? 1 : 0);
});
