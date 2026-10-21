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


  // ===== Défilement fluide =====
  var lenis = null;
  if (!reduit && window.Lenis) {
    lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.95 });
    (function boucle(t) { lenis.raf(t); requestAnimationFrame(boucle); })(performance.now());
    document.querySelectorAll('a[href^="#"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var id = a.getAttribute('href'); if (id.length < 2) return;
        var cible = document.querySelector(id); if (!cible) return;
        e.preventDefault(); lenis.scrollTo(cible, { offset: id === '#cave' ? 0 : -76, duration: 1.4 });
      });
    });
  }

  // ===== Intro : le logo tranché en deux =====
  var html = document.documentElement;
  if (html.classList.contains('avec-intro')) {
    if (!location.hash) { try { history.scrollRestoration = 'manual'; } catch (e) {} scrollTo(0, 0); }
    if (lenis) lenis.stop();
    var t0 = 0, ouvert = false, COUPE = 1520, minuterie = null;
    // Le trait de sabre en pixels réels (pour que le tracé reste net)
    var sab = $('sabre');
    var placeSabre = function () {
      if (!sab) return; var W = innerWidth, Hh = innerHeight, l = sab.querySelector('line');
      sab.setAttribute('viewBox', '0 0 ' + W + ' ' + Hh);
      l.setAttribute('x1', W * .632); l.setAttribute('y1', -10); l.setAttribute('x2', W * .372); l.setAttribute('y2', Hh + 10);
    };
    placeSabre(); addEventListener('resize', placeSabre);
    var ouvrirIntro = function () {
      if (ouvert) return; ouvert = true;
      html.classList.add('ouvre'); html.classList.remove('intro-en-cours');
      if (lenis) lenis.start();
      setTimeout(function () { var i = $('intro'); if (i) i.remove(); vitesseOn = false; }, 1250);
    };

    // Lignes de vitesse (集中線) autour du logo, redessinées 14 fois par seconde
    var vc = $('vitesse'), vitesseOn = true;
    if (vc && vc.getContext) {
      var vx = vc.getContext('2d'), vd = Math.min(2, devicePixelRatio || 1);
      var trace = function () {
        if (!vitesseOn) return;
        var W = innerWidth, Hh = innerHeight; vc.width = W * vd; vc.height = Hh * vd; vx.setTransform(vd, 0, 0, vd, 0, 0);
        var cx0 = W / 2, cy0 = Hh / 2, R = Math.hypot(W, Hh) / 2 + 20, base = Math.min(W, Hh) * 0.36, n = W < 700 ? 70 : 120;
        vx.fillStyle = 'rgba(243,230,207,.5)';
        for (var i = 0; i < n; i++) {
          var a = Math.random() * Math.PI * 2, l = 0.004 + Math.random() * 0.014, r0 = base * (1 + Math.random() * 0.5);
          vx.globalAlpha = 0.25 + Math.random() * 0.6;
          vx.beginPath();
          vx.moveTo(cx0 + Math.cos(a) * r0, cy0 + Math.sin(a) * r0);
          vx.lineTo(cx0 + Math.cos(a - l) * R, cy0 + Math.sin(a - l) * R);
          vx.lineTo(cx0 + Math.cos(a + l) * R, cy0 + Math.sin(a + l) * R);
          vx.closePath(); vx.fill();
        }
        setTimeout(trace, 70);
      };
      trace();
    }
    var demarre = function () { t0 = window.yonkoT0 || performance.now(); minuterie = setTimeout(ouvrirIntro, COUPE); };
    if (html.classList.contains('go')) demarre(); else addEventListener('yonko-go', demarre, { once: true });
    var passer = function () {
      if (ouvert) return;
      if (window.yonkoGo) window.yonkoGo();
      var reste = COUPE - (performance.now() - (t0 || performance.now()));
      if (reste > 0 && document.getAnimations) document.getAnimations().forEach(function (an) {
        try { an.currentTime = (Number(an.currentTime) || 0) + reste; } catch (e) {}
      });
      clearTimeout(minuterie); ouvrirIntro();
    };
    $('passer').addEventListener('click', passer);
    ['keydown', 'wheel', 'touchstart', 'pointerdown'].forEach(function (ev) { addEventListener(ev, passer, { once: true, passive: true }); });
  }

  // ===== Hero : la photo glisse, le texte s'efface en douceur =====
  var hero = document.querySelector('.hero'), photo = hero && hero.querySelector('.photo'), heroTxt = hero && hero.querySelector('.wrap');
  if (hero && !reduit) {
    var tHero = false;
    var parallaxe = function () {
      tHero = false; var y = scrollY, h = innerHeight; if (y > h * 1.2) return;
      photo.style.translate = '0 ' + (y * 0.32).toFixed(1) + 'px';
      heroTxt.style.translate = '0 ' + (y * -0.12).toFixed(1) + 'px';
      heroTxt.style.opacity = String(Math.max(0, 1 - y / (h * 0.75)).toFixed(3));
    };
    addEventListener('scroll', function () { if (!tHero) { tHero = true; requestAnimationFrame(parallaxe); } }, { passive: true });
  }

  // ===== Braises =====
  var cv = $('braises');
  if (cv && !reduit && cv.getContext) {
    var cx = cv.getContext('2d'), dpr = Math.min(2, devicePixelRatio || 1), W = 0, Hh = 0, parts = [], actif = true;
    var sprite = document.createElement('canvas'); sprite.width = sprite.height = 64;
    var sg = sprite.getContext('2d'), gr = sg.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,214,150,1)'); gr.addColorStop(.18, 'rgba(255,138,31,.9)'); gr.addColorStop(.5, 'rgba(255,90,20,.25)'); gr.addColorStop(1, 'rgba(255,60,0,0)');
    sg.fillStyle = gr; sg.fillRect(0, 0, 64, 64);
    var nouvelle = function (bas) {
      return { x: Math.random() * W, y: bas ? Hh + Math.random() * 40 : Math.random() * Hh, r: 3 + Math.random() * 9, v: .25 + Math.random() * .7,
        a: .25 + Math.random() * .6, ph: Math.random() * 6.28, amp: .2 + Math.random() * .6 };
    };
    var taille = function () {
      var r = cv.getBoundingClientRect(); W = r.width; Hh = r.height;
      cv.width = W * dpr; cv.height = Hh * dpr; cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var n = W < 700 ? 26 : 52; parts = []; for (var i = 0; i < n; i++) parts.push(nouvelle(false));
    };
    var dessine = function (t) {
      if (!actif) return;
      cx.clearRect(0, 0, W, Hh);
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i]; p.y -= p.v; p.x += Math.sin(t / 1400 + p.ph) * p.amp;
        if (p.y < -20) parts[i] = p = nouvelle(true);
        var vie = Math.min(1, (Hh - p.y) / 160) * Math.min(1, p.y / 220);
        cx.globalAlpha = Math.max(0, p.a * vie * (.75 + .25 * Math.sin(t / 220 + p.ph * 3)));
        cx.drawImage(sprite, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
      }
      requestAnimationFrame(dessine);
    };
    taille(); addEventListener('resize', taille);
    new IntersectionObserver(function (e) {
      var v = e[0].isIntersecting && !document.hidden;
      if (v && !actif) { actif = true; requestAnimationFrame(dessine); } else if (!v) actif = false;
    }).observe(hero);
    requestAnimationFrame(dessine);
  }

  // ===== Apparitions au défilement =====
  if (!reduit && 'IntersectionObserver' in window) {
    var marque = function (els, cls, pas) {
      Array.prototype.forEach.call(els, function (el, i) { if (el.closest('.hero')) return; el.classList.add(cls); if (pas) el.style.setProperty('--d', (i % 4) * pas + 's'); obs.observe(cls === 'anim-i' ? el.parentElement : el); });
    };
    var obs = new IntersectionObserver(function (entrees) {
      entrees.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('vu'); obs.unobserve(e.target);
        // Les cases découpées sont observées via leur conteneur (une case masquée n'a pas de surface visible)
        Array.prototype.forEach.call(e.target.children, function (c) { if (c.classList.contains('anim-i')) c.classList.add('vu'); });
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
    document.querySelectorAll('.titre').forEach(function (t) { if (!t.closest('.hero')) t.innerHTML = '<span class="l"><span>' + t.innerHTML + '</span></span>'; });
    marque(document.querySelectorAll('.titre'), 'anim-l');
    marque(document.querySelectorAll('.salle'), 'anim-i', .12);
    document.querySelectorAll('.jeux .photos img').forEach(function (i) { i.style.setProperty('--r', '18px'); });
    marque(document.querySelectorAll('.jeux .photos img'), 'anim-i', .14);
    marque(document.querySelectorAll('.bloc .intro, .pano .carte-cave > :not(.titre), .jeux li, .bloc figure, .onglets, #horaires, details'), 'anim-f', .08);
  }

  // Note Google en direct
  fetch('/api/google-rating', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    if (!d || !d.rating || !Number.isInteger(Number(d.count))) return;
    $('g-note').textContent = Number(d.rating).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    $('g-nb').textContent = Number(d.count).toLocaleString('fr-FR');
  }).catch(function () {});
})();
