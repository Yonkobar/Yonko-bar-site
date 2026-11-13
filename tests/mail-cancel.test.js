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
const nextDay = wd => { for (let i = 7; i < 14; i++) { const d = new Date(Date.now() + i * 864e5); if (d.getUTCDay() === wd) return d.toISOString().slice(0, 10); } };
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
    assert.ok(m.text && m.text.includes('Bonjour'), 'version texte avec le contenu : ' + m.subject);
    assert.match(m.html, /^<!doctype html>/i);
    assert.match(m.html, /charset="utf-8"/);
    assert.doesNotMatch(m.html, /data:image/, 'pas de logo en data: (bloqué par Gmail/Outlook)');
    assert.doesNotMatch(m.text, /<[a-z][^>]*>/i, 'aucune balise dans le texte brut');
  }
  const confirm = clientMails.find(m => /^Votre réservation au Yonko Bar/.test(m.subject));
  assert.match(confirm.text, /Minimum de consommation : 600 € pour la soirée\./);
  assert.match(confirm.text, /Valider ma caution — 250 € : https:\/\/[^\s]+\/api\/caution\/[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(confirm.text + confirm.html, /checkout\.stripe\.com/);
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

test('Annulation / refus par l’équipe : le client est toujours prévenu par email, une seule fois', async () => {
  const w = world();
  // Réservation confirmée puis annulée : email d'annulation.
  const a = await book(w); await patch(w, a.id, {status: 'accepted'});
  // Demande en attente refusée : email de refus.
  const b = await book(w, {name: 'Autre Client', email: 'b@x.fr'});
  w.mails.length = 0;
  assert.equal((await patch(w, a.id, {status: 'declined'})).status, 200);
  assert.equal(w.mails.length, 1);
  assert.equal(w.mails[0].to[0], 'c@x.fr'); assert.match(w.mails[0].subject, /Annulation de votre réservation/);
  assert.match(w.mails[0].text, /est bien annulée/);
  w.mails.length = 0;
  assert.equal((await patch(w, b.id, {status: 'declined'})).status, 200);
  assert.equal(w.mails.length, 1);
  assert.equal(w.mails[0].to[0], 'b@x.fr'); assert.match(w.mails[0].subject, /Réponse à votre demande de réservation/);
  assert.match(w.mails[0].text, /Bonjour Autre Client/); assert.match(w.mails[0].text, /ne pouvons malheureusement pas y donner suite/);
  assert.match(w.mails[0].text, /Voir ma demande : https:\/\/yonkobar\.com\/ma-reservation\?t=/);
  assert.match(w.mails[0].html, /^<!doctype html>/i);
  // Déjà refusée : aucun second email.
  w.mails.length = 0;
  assert.equal((await patch(w, b.id, {status: 'declined'})).status, 200);
  assert.equal(w.mails.length, 0);
  // Demande sans email : le refus passe, aucun email.
  const c = await book(w, {name: 'Sans Mail', email: ''});
  assert.equal((await patch(w, c.id, {status: 'declined'})).status, 200);
  assert.equal(w.mails.length, 0);
});

test('Demande de privatisation de la cave (mar-sam) : email « demande bien reçue » avec le texte du bar, montant du jour', async () => {
  const amounts = {2: 500, 3: 500, 4: 500, 5: 600, 6: 700};
  for (const wd of [2, 3, 4, 5, 6]) {
    const w = world();
    await book(w, {date: nextDay(wd), type: 'Privatisation de la Cave', guests: '40'});
    const m = w.mails.find(x => x.to[0] === 'c@x.fr');
    assert.match(m.subject, /Nous avons bien reçu votre demande/);
    for (const phrase of [
      'Bonjour,',
      `Merci pour la demande de réservation. Pour privatiser la cave nous demandons un minimum de consommation de ${amounts[wd]} euros.`,
      'Vous aurez la possibilité de passer votre musique ainsi qu\'un karaoké disponible sur le pc en libre service mis à disposition.',
      'Vous aurez aussi accès aux consoles de jeux et jeux de sociétés, la salle est aménageable selon votre envie (décoration possible sauf confettis, guirlandes etc...).',
      'La nourriture et boissons extérieures ne sont pas admises sauf pour les gâteaux d\'anniversaire. Prévoir vos assiettes et couverts ;)',
      'Bien cordialement',
    ]) assert.ok(m.text.includes(phrase), `jour ${wd} : texte manquant : ${phrase}`);
    assert.equal(m.text.includes('Nous fermons à 2h du matin.'), wd >= 4, `jour ${wd} : fermeture à 2h seulement du jeudi au samedi`);
    assert.match(m.text, /Voir ma demande : https:\/\/yonkobar\.com\/ma-reservation\?t=/);
  }
});

test('Demande de table simple le samedi (plus de 6 personnes) : email « demande bien reçue » avec le texte du bar', async () => {
  const w = world();
  await book(w, {date: nextDay(6), type: 'Taverne', guests: '8'});
  const m = w.mails.find(x => x.to[0] === 'c@x.fr');
  assert.match(m.subject, /Nous avons bien reçu votre demande/);
  for (const phrase of [
    'Bonjour,',
    'Merci pour la demande de réservation.\nNous avons de la place pour votre groupe au RDC.\nVous aurez accès aux consoles de jeux et jeux de sociétés.',
    'Pour la réservation, nous demandons un minimum de consommation de 15 euros/personnes.',
    'La nourriture et boissons extérieures ne sont pas admises sauf pour les gâteaux d\'anniversaire. Prévoir vos assiettes et couverts ;)',
    'Bien cordialement',
  ]) assert.ok(m.text.includes(phrase), 'texte manquant : ' + phrase);
  assert.doesNotMatch(m.text, /fermons|karaoké|cave/i);
  assert.match(m.text, /Voir ma demande : https:\/\/yonkobar\.com\/ma-reservation\?t=/);
});

test('Autres demandes : texte standard pour une table le samedi à 6 personnes ou moins, une table le vendredi et la cave le dimanche (sur devis)', async () => {
  const w = world();
  await book(w, {date: nextDay(6), type: 'Taverne', guests: '4'});
  await book(w, {date: nextDay(5), type: 'Taverne', guests: '8'});
  await book(w, {date: nextDay(0), type: 'Privatisation de la Cave', guests: '40'});
  const mails = w.mails.filter(x => x.to[0] === 'c@x.fr');
  assert.equal(mails.length, 3);
  for (const m of mails) {
    assert.doesNotMatch(m.text, /Nous fermons à 2h du matin|Bien cordialement|Nous avons de la place/);
    assert.match(m.text, /pas encore confirmée/);
  }
});

test('Accueil : le minimum de la Cave est précis, plus de fourchette « 500 à 700 »', async () => {
  const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /500 (à|et|–|-) ?700/);
  assert.match(html, /500 € mardi et mercredi, 600 € jeudi, 700 € vendredi et samedi/);
});


// ——— Les textes du bar partent UNE fois, dans l'accusé de réception de la demande, pas dans la confirmation ———
const CAVE_PHRASES = [
  'Pour privatiser la cave nous demandons',
  'Vous aurez la possibilité de passer votre musique',
  'Vous aurez aussi accès aux consoles de jeux et jeux de sociétés',
  'La nourriture et boissons extérieures ne sont pas admises',
  'Nous fermons à 2h du matin.',
];
const TABLE_PHRASES = ['Nous avons de la place pour votre groupe au RDC.', '15 euros/personnes'];
const clientMails = (w) => w.mails.filter(m => m.to[0] === 'c@x.fr');
const receivedOf = (w) => clientMails(w).find(m => /Nous avons bien reçu votre demande/.test(m.subject));
const confirmationOf = (w) => clientMails(w).find(m => /Votre réservation au Yonko Bar/.test(m.subject));
const hasBarText = (m) => [...CAVE_PHRASES, ...TABLE_PHRASES].some(p => m.text.includes(p));

test('Cave du mardi au samedi : le texte du bar est dans l’accusé de réception, pas dans la confirmation', async () => {
  const amounts = {2: 500, 3: 500, 4: 500, 5: 600, 6: 700};
  for (const wd of [2, 3, 4, 5, 6]) {
    const w = world();
    const r = await book(w, {date: nextDay(wd), type: 'Privatisation de la Cave', guests: '40'});
    assert.ok(receivedOf(w).text.includes(`un minimum de consommation de ${amounts[wd]} euros.`), `jour ${wd} : accusé avec le minimum du jour`);
    assert.equal((await patch(w, r.id, {status: 'accepted'})).status, 200);
    const m = confirmationOf(w);
    assert.ok(m, `jour ${wd} : confirmation envoyée`);
    assert.match(m.text, /Votre réservation au Yonko Bar est confirmée/);
    assert.equal(hasBarText(m), false, `jour ${wd} : la confirmation ne répète pas le texte du bar`);
    assert.match(m.text, new RegExp(`Minimum de consommation : ${amounts[wd]} € pour la soirée\\.`));
    assert.equal(clientMails(w).filter(hasBarText).length, 1, `jour ${wd} : le texte n’apparaît qu’une fois chez le client`);
  }
});

test('Confirmation avec caution : nouvelle phrase, bouton « Valider ma caution », sans « carte de garantie », sans texte du bar', async () => {
  const w = world();
  const r = await book(w, {date: nextFriday(), type: 'Privatisation de la Cave', guests: '40'});
  await patch(w, r.id, {status: 'accepted'});
  const m = confirmationOf(w);
  assert.match(m.text, /Pour finaliser, merci d'enregistrer une carte bancaire pour la caution de 250 €\. Rien n'est débité aujourd'hui : la somme ne sera prélevée qu'en cas d'absence non annoncée\./);
  assert.match(m.text, /Valider ma caution — 250 € : https:\/\/[^\s]+\/api\/caution\/[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(m.text + m.html, /checkout\.stripe\.com/);
  assert.doesNotMatch(m.text + m.html + m.subject, /garantie/i);
  assert.equal(hasBarText(m), false);
});

test('Table du samedi (plus de 6 personnes) : texte du bar dans l’accusé seulement', async () => {
  const w = world();
  const r = await book(w, {date: nextDay(6), type: 'Taverne', guests: '8'});
  assert.ok(receivedOf(w).text.includes('Nous avons de la place pour votre groupe au RDC.'));
  await patch(w, r.id, {status: 'accepted'});
  assert.equal(hasBarText(confirmationOf(w)), false);
  assert.equal(clientMails(w).filter(hasBarText).length, 1);
});

test('Confirmation de la cave un dimanche (sur devis) : email standard', async () => {
  const w = world();
  const r = await book(w, {date: nextDay(0), type: 'Privatisation de la Cave', guests: '40'});
  await patch(w, r.id, {status: 'accepted'});
  assert.match(confirmationOf(w).text, /Minimum de consommation : sur devis pour cette date\./);
});

test('Bouton « Renvoyer la confirmation » : pas de texte du bar non plus', async () => {
  const {onRequestPost: sendConfirmation} = await import('../functions/api/reservations/[id]/send-confirmation.js');
  const w = world();
  const r = await book(w, {date: nextDay(3), type: 'Privatisation de la Cave', guests: '40'});
  await patch(w, r.id, {status: 'accepted'});
  w.mails.length = 0;
  const res = await sendConfirmation({request: w.req('/x', 'POST', null, 'k'), env: w.env, params: {id: r.id}});
  assert.equal(res.status, 200);
  const m = clientMails(w)[0];
  assert.match(m.text, /Minimum de consommation : 500 € pour la soirée\./);
  assert.equal(hasBarText(m), false);
});

test('Demande créée à la main dans le dashboard : le texte du bar part aussi, une seule fois, puis plus dans la confirmation', async () => {
  const manual = (w, extra) => create({request: w.req('/api/reservations', 'POST', {name: 'Camille Martin', email: 'c@x.fr', date: nextDay(5), time: '21:00', guests: '40', type: 'Cave', manual: true, ...extra}, 'k'), env: w.env}).then(r => r.json());
  const w = world();
  const r = await manual(w);
  const rec = receivedOf(w);
  assert.ok(rec, 'accusé envoyé pour une demande manuelle');
  assert.ok(rec.text.includes('Pour privatiser la cave nous demandons un minimum de consommation de 600 euros.'));
  assert.ok(rec.text.includes('Nous fermons à 2h du matin.'));
  await patch(w, r.id, {status: 'accepted'});
  assert.equal(hasBarText(confirmationOf(w)), false);
  assert.equal(clientMails(w).filter(hasBarText).length, 1, 'texte reçu une seule fois');

  // table du samedi, plus de 6 personnes
  const w2 = world();
  await manual(w2, {date: nextDay(6), type: 'Table', guests: '9'});
  assert.ok(receivedOf(w2).text.includes('15 euros/personnes'));

  // pas de texte du bar pour ce cas (dimanche, table simple) : pas d'email à la création, comme avant
  const w3 = world();
  await manual(w3, {date: nextDay(0)});
  await manual(w3, {date: nextDay(5), type: 'Table', guests: '4'});
  assert.equal(clientMails(w3).length, 0);

  // sans email : rien
  const w4 = world();
  await manual(w4, {email: ''});
  assert.equal(w4.mails.length, 0);
});

test('Page de caution Stripe : phrase claire, sans « carte de garantie »', async () => {
  const w = world();
  const bodies = [];
  const base = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => { if (String(url).endsWith('/v1/checkout/sessions')) bodies.push(String(opts.body)); return base(url, opts); };
  const r = await book(w, {date: nextFriday(), type: 'Privatisation de la Cave', guests: '40'});
  await patch(w, r.id, {status: 'accepted'});
  assert.equal(bodies.length, 1);
  const msg = new URLSearchParams(bodies[0]).get('custom_text[submit][message]');
  assert.equal(msg, 'Rien n’est débité aujourd’hui. En validant, vous autorisez Yonko Bar à prélever jusqu’à 250 € sur cette carte en cas d’absence non annoncée, selon les conditions de réservation.');
  assert.doesNotMatch(msg, /garantie/i);
});

test('Page « Ma réservation » : plus de « carte de garantie »', async () => {
  const html = await fs.readFile(new URL('../ma-reservation.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /garantie/i);
  assert.match(html, /Valider ma caution/);
});
