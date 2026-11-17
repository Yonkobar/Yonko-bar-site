// Email d'acceptation = « pré-confirmation ». « Confirmée » seulement quand le client a confirmé sa venue
// (réservation sans caution) ou enregistré sa caution (réservation avec caution).
import test from 'node:test';
import assert from 'node:assert/strict';
import {isFinallyConfirmed} from '../functions/_access.js';
import {buildEmailHtml, sendDepositEmail} from '../functions/_shared.js';
import {sendGuaranteeEmail} from '../functions/_stripe-guarantee.js';
import {minConsoText} from '../functions/_spaces.js';
import {htmlToText} from '../functions/_mail-text.js';

const TOKEN = 'tok_abcdefghijklmnopqrstuvwx';
const MANAGE = `https://yonkobar.com/ma-reservation?t=${TOKEN}`;
const base = () => ({id: 'r1', name: 'Camille', email: 'c@x.fr', date: '2026-11-20', time: '20:00', guests: '4', type: 'Table',
  status: 'accepted', accessToken: TOKEN, depositLink: '', createdAt: 1});
const withCaution = (extra = {}) => ({...base(), type: 'Cave', guests: '40', depositLink: 'https://checkout.stripe.com/x', depositAmount: 250, depositStatus: 'lien_envoye', ...extra});
const text = (entry, opts = {manageUrl: MANAGE}) => htmlToText(buildEmailHtml(entry, opts));

test('Qui est confirmé définitivement : venue confirmée, caution enregistrée ou déposée au bar, Privateaser', () => {
  assert.equal(isFinallyConfirmed(base()), false, 'sans caution, venue pas confirmée');
  assert.equal(isFinallyConfirmed({...base(), presenceConfirmedAt: 5}), true, 'sans caution, venue confirmée');
  assert.equal(isFinallyConfirmed(withCaution()), false, 'caution en attente');
  assert.equal(isFinallyConfirmed(withCaution({depositStatus: 'autorisee'})), true, 'carte enregistrée');
  assert.equal(isFinallyConfirmed(withCaution({depositStatus: 'deposee'})), true, 'caution déposée au bar');
  assert.equal(isFinallyConfirmed(withCaution({depositLink: '', depositStatus: ''})), false, 'montant de caution sans lien ni carte : toujours en attente');
  assert.equal(isFinallyConfirmed({...base(), source: 'Privateaser'}), true, 'gérée sur Privateaser');
  assert.equal(isFinallyConfirmed({...base(), status: 'pending'}), false, 'demande pas acceptée');
  assert.equal(isFinallyConfirmed({...base(), status: 'declined'}), false, 'annulée');
});

test('Sans caution, venue pas confirmée : « pré-confirmation », jamais « confirmée »', () => {
  const t = text(base());
  assert.match(t, /Pré-confirmation de votre réservation/);
  assert.match(t, /Votre réservation au Yonko Bar est pré-confirmée/);
  assert.match(t, /confirmée définitivement dès que vous aurez confirmé votre venue/);
  assert.match(t, /Confirmer ma venue/);
  assert.doesNotMatch(t, /Réservation confirmée|est confirmée/);
});

test('Avec caution en attente : « pré-confirmation », confirmée dès que la caution est enregistrée', () => {
  const t = text(withCaution());
  assert.match(t, /Pré-confirmation de votre réservation/);
  assert.match(t, /confirmée définitivement dès que votre caution sera enregistrée/);
  assert.match(t, /Valider ma caution — 250 €/);
  assert.doesNotMatch(t, /Réservation confirmée|est confirmée|Confirmer ma venue/);
});

test('Venue confirmée ou caution enregistrée : « Réservation confirmée »', () => {
  for (const entry of [{...base(), presenceConfirmedAt: 5}, withCaution({depositLink: '', depositStatus: 'autorisee'}), withCaution({depositLink: '', depositStatus: 'deposee'})]) {
    const t = text(entry);
    assert.match(t, /Réservation confirmée/, JSON.stringify(entry));
    assert.match(t, /Votre réservation au Yonko Bar est confirmée/);
    assert.doesNotMatch(t, /pré-confirm/i);
  }
});

test('Email de modification : son titre et son introduction ne changent pas', () => {
  const t = text(base(), {manageUrl: MANAGE, title: 'Réservation modifiée', intro: 'Votre réservation au Yonko Bar a été modifiée. Voici le récapitulatif à jour :'});
  assert.match(t, /Réservation modifiée/);
  assert.match(t, /a été modifiée/);
});

test('Objets des emails : pré-confirmation tant que ce n’est pas définitif, confirmée ensuite', async () => {
  const sent = [];
  globalThis.fetch = async (url, opts = {}) => { sent.push(JSON.parse(opts.body)); return new Response('{}', {status: 200}); };
  const env = {RESEND_API_KEY: 're_x'};
  await sendDepositEmail(base(), env, {manageUrl: MANAGE});
  await sendGuaranteeEmail(withCaution(), env, {manageUrl: MANAGE});
  await sendDepositEmail({...base(), presenceConfirmedAt: 5}, env, {manageUrl: MANAGE});
  await sendDepositEmail(withCaution({depositLink: '', depositStatus: 'autorisee'}), env, {manageUrl: MANAGE});
  assert.deepEqual(sent.map(m => m.subject), [
    'Pré-confirmation de votre réservation au Yonko Bar',
    'Pré-confirmation de votre réservation au Yonko Bar — caution à valider',
    'Votre réservation au Yonko Bar est confirmée',
    'Votre réservation au Yonko Bar est confirmée',
  ]);
});

test('Minimum de consommation : aucune ligne dans les emails pour les réservations qui n’en ont pas', () => {
  const noMin = [
    ['Table 4 personnes un samedi', {type: 'Table', date: '2026-11-21', guests: '4'}],
    ['Table 10 personnes un mercredi', {type: 'Table', date: '2026-11-18', guests: '10'}],
    ['Cave un dimanche', {type: 'Cave', date: '2026-11-22', guests: '30'}],
    ['Cave un lundi', {type: 'Cave', date: '2026-11-23', guests: '30'}],
  ];
  for (const [label, e] of noMin) {
    assert.equal(minConsoText(e), '', label);
    assert.doesNotMatch(text({...base(), ...e}), /Minimum de consommation/, label);
  }
  // Et il reste affiché quand il existe.
  assert.match(text({...base(), type: 'Cave', date: '2026-11-21', guests: '30'}), /Minimum de consommation : 700 € pour la soirée/);
  assert.match(text({...base(), type: 'Table', date: '2026-11-21', guests: '10'}), /Minimum de consommation : 15 € par personne, soit 150 €/);
});
