// Yonko Bar — accueil v2
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var reduit = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Navigation : fond plein après le haut de page
  var nav = $('nav');
  function navFond() { nav.classList.toggle('solide', scrollY > 40); }
  addEventListener('scroll', navFond, { passive: true }); navFond();

  // Menu mobile
  var menu = $('menu'), burger = $('burger');
  function ouvrir(o) { menu.hidden = !o; burger.setAttribute('aria-expanded', String(o)); document.body.style.overflow = o ? 'hidden' : ''; if (o) $('fermer').focus(); else burger.focus(); }
  burger.onclick = function () { ouvrir(true); };
  $('fermer').onclick = function () { ouvrir(false); };
  menu.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', function () { ouvrir(false); }); });
  addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menu.hidden) ouvrir(false); });

  // Heure de Paris
  function paris() {
    var p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(function (x) { return [x.type, x.value]; }));
    var jours = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return { j: jours[p.weekday], m: Number(p.hour) * 60 + Number(p.minute) };
  }
  // Horaires (Google) : ouverture et fermeture en minutes, fermeture après minuit = +1440
  var H = { 2: [1050, 1440], 3: [1050, 1440], 4: [1050, 1560], 5: [1050, 1560], 6: [900, 1560] };
  function hm(min) { min = min % 1440; var h = Math.floor(min / 60), m = min % 60; return h === 0 && m === 0 ? 'minuit' : h + 'h' + (m ? String(m).padStart(2, '0') : ''); }
  function etat() {
    var t = paris(), ouvert = false, ferme = 0, hhReste = 0;
    var auj = H[t.j];
    if (auj && t.m >= auj[0]) { ouvert = true; ferme = auj[1]; }
    var veille = H[(t.j + 6) % 7];
    if (!ouvert && veille && veille[1] > 1440 && t.m < veille[1] - 1440) { ouvert = true; ferme = veille[1]; }
    if (ouvert && auj && t.m >= 1050 && t.m < 1260) hhReste = 1260 - t.m;
    var el = $('etat'), txt = $('etat-txt');
    el.classList.toggle('ouvert', ouvert);
    if (ouvert) txt.textContent = 'Ouvert jusqu’à ' + hm(ferme);
    else {
      var prochain = null;
      for (var i = 0; i < 7 && !prochain; i++) { var j = (t.j + i) % 7; if (H[j] && (i > 0 || t.m < H[j][0])) prochain = { i: i, h: H[j][0] }; }
      txt.textContent = prochain ? (prochain.i === 0 ? 'Ouvre ce soir à ' : prochain.i === 1 ? 'Ouvre demain à ' : 'Ouvre ' + ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][(t.j + prochain.i) % 7] + ' à ') + hm(prochain.h) : 'Fermé';
    }
    $('hh-txt').textContent = hhReste ? 'Happy hour encore ' + (hhReste >= 60 ? Math.floor(hhReste / 60) + ' h ' + String(hhReste % 60).padStart(2, '0') : hhReste + ' min') : '';
    var row = document.querySelector('#horaires tr[data-j="' + (t.j === 1 ? 0 : t.j) + '"]');
    document.querySelectorAll('#horaires tr').forEach(function (r) { r.classList.toggle('auj', r === row); });
    return hhReste > 0;
  }
  var enHH = etat();
  setInterval(etat, 60000);

  // Carte : interrupteur happy hour (activé d'office pendant le happy hour)
  var sw = $('hh-switch'), prix = $('menu-prix');
  function hh() { prix.classList.toggle('happy', sw.checked); }
  sw.checked = enHH; sw.addEventListener('change', hh); hh();

  // Carte : onglets (flèches gauche / droite au clavier)
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
  function choisir(tab, focus) {
    tabs.forEach(function (t) {
      var on = t === tab; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
    });
    if (focus) tab.focus();
  }
  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { choisir(t); });
    t.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); choisir(tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length], true); }
    });
  });

  // Panorama de la cave : défile avec la page
  var pano = document.querySelector('.pano'), bande = $('bande');
  if (pano && bande && !reduit) {
    var tic = false;
    function bouge() {
      tic = false;
      var r = pano.getBoundingClientRect(), course = pano.offsetHeight - innerHeight;
      var p = Math.min(1, Math.max(0, -r.top / Math.max(1, course)));
      var depasse = Math.max(0, bande.scrollWidth - innerWidth);
      bande.style.transform = 'translate3d(' + (-p * depasse) + 'px,0,0)';
    }
    addEventListener('scroll', function () { if (!tic) { tic = true; requestAnimationFrame(bouge); } }, { passive: true });
    addEventListener('resize', bouge);
    bande.querySelector('img').addEventListener('load', bouge);
    bouge();
  }

  // Note Google en direct
  fetch('/api/google-rating', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    if (!d || !d.rating || !Number.isInteger(Number(d.count))) return;
    $('g-note').textContent = Number(d.rating).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    $('g-nb').textContent = Number(d.count).toLocaleString('fr-FR');
  }).catch(function () {});
})();
