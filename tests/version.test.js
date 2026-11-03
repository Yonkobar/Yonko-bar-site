import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Les trois numéros de version doivent toujours être identiques : sinon l'application affiche un bandeau
// « mise à jour disponible » qui ne disparaît jamais, ou un téléphone garde une ancienne copie du script.
test('Version de l’application : app-version.json, mobile-app.js et adresse du script dans dashboard.html concordent', () => {
  const served = JSON.parse(fs.readFileSync(new URL('../app-version.json', import.meta.url), 'utf8')).version;
  const inScript = /const VERSION='([^']+)'/.exec(fs.readFileSync(new URL('../mobile-app.js', import.meta.url), 'utf8'))?.[1];
  const inPage = /<script src="\/mobile-app\.js\?v=([^"]+)"/.exec(fs.readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8'))?.[1];
  assert.ok(served && inScript && inPage, 'un des trois numéros est introuvable');
  assert.equal(inScript, served);
  assert.equal(inPage, served);
});

test('Bouton « Mettre à jour » : aucune boîte de dialogue du navigateur, logique dans la page', () => {
  const html = fs.readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');
  const btn = /<button[^>]*id="appUpdateBtn"[^>]*>/.exec(html)?.[0] || '';
  assert.match(btn, /onclick="yonkoUpdateApp\(this\)"/);
  assert.doesNotMatch(btn, /confirm\(/);
  assert.match(html, /function yonkoUpdateApp\(/);
});
