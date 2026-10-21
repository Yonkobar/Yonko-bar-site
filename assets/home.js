// Yonko Bar — page d'accueil : intro manga, défilement fluide, apparitions, carte, FAQ, horaires en direct.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var html = document.documentElement;
  var reduit = matchMedia('(prefers-reduced-motion: reduce)').matches;
  html.classList.add('home-ok'); // le script tourne : la sécurité de l'intro (dans <head>) ne se déclenche pas

  // ===== Défilement fluide =====
  var lenis = null;
  if (!reduit && window.Lenis) {
    lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.95 });
    (function boucle(t) { lenis.raf(t); requestAnimationFrame(boucle); })(performance.now());
  }
  function allerA(cible) {
    if (lenis) lenis.scrollTo(cible, { offset: -80, duration: 1.4 });
    else cible.scrollIntoView({ behavior: reduit ? 'auto' : 'smooth' });
  }
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var id = a.getAttribute('href'); if (id.length < 2) return;
      var cible = document.querySelector(id); if (!cible) return;
      e.preventDefault(); fermerMenu(); allerA(cible);
    });
  });

  // ===== Intro : le logo tranché en deux =====
  if (html.classList.contains('avec-intro')) {
    if (!location.hash) { try { history.scrollRestoration = 'manual'; } catch (e) {} scrollTo(0, 0); }
    if (lenis) lenis.stop();
    var t0 = 0, ouvert = false, COUPE = 1520, minuterie = null, vitesseOn = true;
    var sab = $('sabre');
    var placeSabre = function () {
      if (!sab) return; var W = innerWidth, Hh = innerHeight, l = sab.querySelector('line');
      sab.setAttribute('viewBox', '0 0 ' + W + ' ' + Hh);
      l.setAttribute('x1', W * .632); l.setAttribute('y1', -10); l.setAttribute('x2', W * .372); l.setAttribute('y2', Hh + 10);
    };
    placeSabre(); addEventListener('resize', placeSabre);

    // Lignes de vitesse (集中線) autour du logo, redessinées 14 fois par seconde
    var vc = $('vitesse');
    if (vc && vc.getContext) {
      var vx = vc.getContext('2d'), vd = Math.min(2, devicePixelRatio || 1);
      var trace = function () {
        if (!vitesseOn) return;
        var W = innerWidth, Hh = innerHeight; vc.width = W * vd; vc.height = Hh * vd; vx.setTransform(vd, 0, 0, vd, 0, 0);
        var cx0 = W / 2, cy0 = Hh / 2, R = Math.hypot(W, Hh) / 2 + 20, base = Math.min(W, Hh) * 0.36, n = W < 700 ? 70 : 120;
        vx.fillStyle = 'rgba(244,232,212,.5)';
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

    var ouvrirIntro = function () {
      if (ouvert) return; ouvert = true;
      html.classList.add('ouvre'); html.classList.remove('intro-en-cours');
      if (lenis) lenis.start();
      setTimeout(function () { var i = $('intro'); if (i) i.remove(); vitesseOn = false; }, 1250);
    };
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

  // ===== Menu mobile =====
  var menu = $('mobileMenu'), burger = $('burgerBtn');
  function fermerMenu() {
    if (!menu.classList.contains('open')) return;
    menu.classList.remove('open'); burger.classList.remove('open'); burger.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = ''; if (lenis) lenis.start();
  }
  burger.addEventListener('click', function () {
    var o = !menu.classList.contains('open');
    if (!o) return fermerMenu();
    menu.classList.add('open'); burger.classList.add('open'); burger.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden'; if (lenis) lenis.stop();
  });
  menu.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', fermerMenu); });

  // ===== Visionneuse photos =====
  var lb = $('lb'), lbImg = $('lb-img');
  function fermerLB() { lb.classList.remove('open'); document.body.style.overflow = ''; if (lenis) lenis.start(); }
  document.querySelectorAll('.gal-item').forEach(function (b) {
    b.addEventListener('click', function () {
      var im = b.querySelector('img'); lbImg.src = im.src; lbImg.alt = im.alt;
      lb.classList.add('open'); document.body.style.overflow = 'hidden'; if (lenis) lenis.stop(); $('lb-x').focus();
    });
  });
  lb.addEventListener('click', fermerLB);
  addEventListener('keydown', function (e) { if (e.key === 'Escape') { fermerLB(); fermerMenu(); } });

  // ===== Carte : onglets (flèches gauche / droite au clavier) =====
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.mtabs [role="tab"]'));
  function choisir(tab, focus) {
    tabs.forEach(function (t) {
      var on = t === tab; t.classList.toggle('on', on); t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).classList.toggle('on', on);
    });
    if (focus) tab.focus();
  }
  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { choisir(t); });
    t.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); choisir(tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length], true); }
    });
  });

  // ===== FAQ =====
  document.querySelectorAll('.faq-q').forEach(function (q) {
    q.addEventListener('click', function () {
      var ouvre = !q.classList.contains('open');
      document.querySelectorAll('.faq-q.open').forEach(function (o) { o.classList.remove('open'); o.setAttribute('aria-expanded', 'false'); o.nextElementSibling.classList.remove('open'); });
      if (ouvre) { q.classList.add('open'); q.setAttribute('aria-expanded', 'true'); q.nextElementSibling.classList.add('open'); }
    });
  });

  // ===== Ouvert ce soir ? (heure de Paris, horaires Google) =====
  function paris() {
    var p = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    return { j: { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday], m: Number(p.hour) * 60 + Number(p.minute) };
  }
  var H = { 2: [1050, 1440], 3: [1050, 1440], 4: [1050, 1560], 5: [1050, 1560], 6: [900, 1560] };
  var JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  function hm(min) { min = min % 1440; var h = Math.floor(min / 60), m = min % 60; return h === 0 && m === 0 ? 'minuit' : h + 'h' + (m ? String(m).padStart(2, '0') : ''); }
  function duree(min) { return min >= 60 ? Math.floor(min / 60) + ' h ' + String(min % 60).padStart(2, '0') : min + ' min'; }
  function etat() {
    var t = paris(), ouvert = false, ferme = 0, hh = 0, auj = H[t.j], veille = H[(t.j + 6) % 7];
    if (auj && t.m >= auj[0]) { ouvert = true; ferme = auj[1]; }
    if (!ouvert && veille && veille[1] > 1440 && t.m < veille[1] - 1440) { ouvert = true; ferme = veille[1]; }
    if (ouvert && auj && t.m >= 1050 && t.m < 1260) hh = 1260 - t.m;
    var el = $('etat'), txt = $('etat-txt'), hhTxt = $('etat-hh');
    el.classList.toggle('ouvert', ouvert);
    if (ouvert) txt.innerHTML = '<b>Ouvert</b> jusqu’à ' + hm(ferme);
    else {
      var p = null;
      for (var i = 0; i < 7 && !p; i++) { var j = (t.j + i) % 7; if (H[j] && (i > 0 || t.m < H[j][0])) p = { i: i, h: H[j][0], j: j }; }
      txt.innerHTML = p ? '<b>Fermé</b> · ouvre ' + (p.i === 0 ? 'ce soir' : p.i === 1 ? 'demain' : JOURS[p.j]) + ' à ' + hm(p.h) : '<b>Fermé</b>';
    }
    hhTxt.textContent = hh ? '· Happy hour encore ' + duree(hh) : '';
    var bar = $('happy-bar'), live = $('hh-live');
    bar.classList.toggle('en-cours', hh > 0);
    if (hh) live.lastChild.textContent = 'En cours : encore ' + duree(hh);
    var row = document.querySelector('.ht .hr[data-j~="' + t.j + '"]');
    document.querySelectorAll('.ht .hr').forEach(function (r) { r.classList.toggle('auj', r === row); });
  }
  etat(); setInterval(etat, 60000);

  // ===== Compteurs du hero =====
  function compte(el) {
    var cible = parseInt(el.getAttribute('data-target'), 10), debut = null, d = 1500, suffixe = el.getAttribute('data-suffix') || '';
    if (reduit) { el.textContent = cible + suffixe; return; }
    (function pas(t) {
      if (!debut) debut = t; var p = Math.min(1, (t - debut) / d), e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(cible * e) + suffixe; if (p < 1) requestAnimationFrame(pas);
    })(performance.now());
  }
  var cObs = new IntersectionObserver(function (e) { e.forEach(function (x) { if (x.isIntersecting) { setTimeout(function () { compte(x.target); }, html.classList.contains('avec-intro') ? 2600 - Math.min(2600, performance.now() - (window.yonkoT0 || 0)) : 0); cObs.unobserve(x.target); } }); }, { threshold: .5 });
  document.querySelectorAll('.stat-num[data-target]').forEach(function (el) { cObs.observe(el); });

  // ===== Note Google en direct =====
  fetch('/api/google-rating', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) {
    var n = Number(d && d.count), note = Number(d && d.rating);
    if (!Number.isInteger(n) || n < 1 || !Number.isFinite(note) || note <= 0 || note > 5) throw new Error('note invalide');
    $('hero-avis-num').textContent = n.toLocaleString('fr-FR');
    $('g-count').textContent = note.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' · ' + n.toLocaleString('fr-FR') + ' avis';
    var r = Math.round(note); $('g-stars').textContent = '★'.repeat(r) + '☆'.repeat(5 - r);
  }).catch(function () { /* on garde la dernière note connue affichée dans la page */ });

  // ===== Hero : la photo glisse, le contenu s'efface en douceur =====
  var hero = $('hero'), fond = hero.querySelector('.hero-bg'), contenu = hero.querySelector('.hero-c');
  if (!reduit) {
    var tHero = false;
    addEventListener('scroll', function () {
      if (tHero) return; tHero = true;
      requestAnimationFrame(function () {
        tHero = false; var y = scrollY, h = innerHeight; if (y > h * 1.3) return;
        fond.style.translate = '0 ' + (y * 0.3).toFixed(1) + 'px';
        contenu.style.translate = '0 ' + (y * -0.1).toFixed(1) + 'px';
        contenu.style.opacity = Math.max(0, 1 - y / (h * 0.8)).toFixed(3);
      });
    }, { passive: true });
  }

  // ===== Cave : la photo principale glisse doucement au défilement =====
  var caveImg = document.querySelector('.cave-main img');
  if (caveImg && !reduit) {
    var tCave = false;
    addEventListener('scroll', function () {
      if (tCave) return; tCave = true;
      requestAnimationFrame(function () {
        tCave = false; var r = caveImg.parentElement.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight) return;
        var p = (r.top + r.height / 2 - innerHeight / 2) / innerHeight;
        caveImg.style.translate = '0 ' + (p * -60).toFixed(1) + 'px';
      });
    }, { passive: true });
  }

  // ===== Braises qui montent dans le hero =====
  var cv = $('braises');
  if (cv && !reduit && cv.getContext) {
    var cx = cv.getContext('2d'), dpr = Math.min(2, devicePixelRatio || 1), W = 0, Hh = 0, parts = [], actif = true;
    var sprite = document.createElement('canvas'); sprite.width = sprite.height = 64;
    var sg = sprite.getContext('2d'), gr = sg.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,214,150,1)'); gr.addColorStop(.18, 'rgba(245,144,48,.9)'); gr.addColorStop(.5, 'rgba(224,112,16,.25)'); gr.addColorStop(1, 'rgba(224,80,0,0)');
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
      var v = e[0].isIntersecting;
      if (v && !actif) { actif = true; requestAnimationFrame(dessine); } else if (!v) actif = false;
    }).observe(hero);
    requestAnimationFrame(dessine);
  }

  // ===== Apparitions au défilement =====
  if (!reduit && 'IntersectionObserver' in window) {
    html.classList.add('anim');
    var obs = new IntersectionObserver(function (entrees) {
      entrees.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('vu'); obs.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });
    document.querySelectorAll('main .stitle').forEach(function (t) { t.innerHTML = '<span class="l"><span>' + t.innerHTML + '</span></span>'; obs.observe(t); });
    document.querySelectorAll('main .sdiv, main .case-w, main .sfx-tag').forEach(function (el) { obs.observe(el); });
    var groupe = function (sel, cls, pas) {
      document.querySelectorAll(sel).forEach(function (el) {
        var i = Array.prototype.indexOf.call(el.parentElement.children, el);
        el.classList.add(cls); el.style.setProperty('--d', Math.min(i, 6) * pas + 's'); obs.observe(el);
      });
    };
    groupe('main .stag, main .tav-text > p, main .pill, main .cf, main .priv-table, main .priv-note, main .happy-bar, main .mtabs, main .ev-intro, main .faq-item, main .rf, main .ht, main .ci, main .soc, main .cta-row, main .badges-avis, main .mentions-content, main .capa, main .cave-cta, main .menu-pdf', 'apparait', .07);
    groupe('main .ev, main .fbox', 'pop', .08);
  }

  // ===== Lien de suivi « source » vers la page Réserver (Google, Instagram…) =====
  var src = new URLSearchParams(location.search).get('source');
  if (src) document.querySelectorAll('a[href^="/reserver"]').forEach(function (a) {
    var h = a.getAttribute('href'); a.setAttribute('href', h + (h.indexOf('?') > -1 ? '&' : '?') + 'source=' + encodeURIComponent(src));
  });
  if (location.hash === '#reserver') location.replace('/reserver' + location.search);
})();
