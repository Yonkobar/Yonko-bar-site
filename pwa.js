(() => {
  const root = document.querySelector('.ledger-inner');
  if (!root) return;
  const panel = document.createElement('section');
  panel.className = 'push-panel';
  panel.setAttribute('aria-label', 'Application mobile et notifications');
  panel.innerHTML = `<div><strong>Yonko Bar sur votre téléphone</strong><p id="pushStatus" role="status" aria-live="polite">Vérification des notifications…</p><small>Nouvelles réservations et récap quotidien à 14 h (Paris). Les acceptations de devis ne sont pas encore détectables.</small></div><div class="push-actions"><button type="button" id="pushEnable">Activer les notifications</button><button type="button" id="pushTest" hidden>Tester</button><button type="button" id="pushDisable" hidden>Désactiver</button><button type="button" id="pwaInstall" hidden>Installer l’application</button></div>`;
  root.querySelector('#stats').before(panel);
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/pwa.css'; document.head.append(css);
  const status = document.getElementById('pushStatus');
  const enable = document.getElementById('pushEnable');
  const test = document.getElementById('pushTest');
  const disable = document.getElementById('pushDisable');
  const supported = isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  let registration, config, installPrompt;
  async function api(path, method = 'GET', body) {
    const key = localStorage.getItem('dashboardKey');
    if (!key) throw new Error('Connectez-vous au tableau de bord pour gérer les notifications.');
    const r = await fetch(`/api/push/${path}`, {method, cache: 'no-store', headers: {'Content-Type': 'application/json', 'x-dashboard-key': key}, ...(body ? {body: JSON.stringify(body)} : {})});
    let result;
    try { result = await r.json(); } catch { throw new Error('Le service de notifications n’est pas encore disponible.'); }
    if (!r.ok) throw new Error(result.error || 'Service de notifications indisponible.');
    return result;
  }
  function showActive(active) {
    enable.hidden = active; test.hidden = !active; disable.hidden = !active;
  }
  async function register() {
    if (!('serviceWorker' in navigator)) return;
    await navigator.serviceWorker.register('/sw.js', {scope: '/', updateViaCache: 'none'});
    registration = await navigator.serviceWorker.ready;
  }
  const registered = register();
  registered.catch(() => { status.textContent = 'L’application mobile n’a pas pu être initialisée. Rechargez la page.'; });
  async function refresh() {
    if (!supported) { enable.disabled = true; status.textContent = 'Ouvrez cette page avec Chrome sur Android pour activer les notifications.'; return; }
    try {
      await registered;
      const sub = await registration.pushManager.getSubscription();
      // Keep unsubscribe available even when the server is unavailable.
      showActive(!!sub);
      config = await api('config');
      if (sub) {
        await api('subscription', 'POST', sub.toJSON());
        status.textContent = 'Notifications activées sur cet appareil, même lorsque l’application est fermée.';
      } else if (Notification.permission === 'denied') {
        status.textContent = 'Notifications bloquées : autorisez-les dans les paramètres du site de votre navigateur.';
      } else { status.textContent = 'Recevez les nouvelles demandes et le récap de 14 h, même application fermée.'; }
    } catch (e) { status.textContent = e.message; }
  }
  async function busy(action) {
    for (const b of [enable, test, disable]) b.disabled = true;
    try { await action(); } catch (e) { status.textContent = e.message; }
    finally { for (const b of [enable, test, disable]) b.disabled = false; }
  }
  enable.addEventListener('click', () => {
    // Permission request is issued directly from the click, never on page load.
    if (!supported) return;
    if (!config) { status.textContent = 'Le serveur doit être configuré avant l’activation. Rechargez la page après sa configuration.'; return; }
    const permission = Notification.requestPermission();
    busy(async () => {
      if (await permission !== 'granted') throw new Error('Notifications non autorisées. Vous pouvez changer ce choix dans les paramètres du site.');
      await registered;
      const applicationServerKey = Uint8Array.from(atob(config.publicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
      const sub = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey});
      showActive(true);
      await api('subscription', 'POST', sub.toJSON());
      status.textContent = 'Notifications activées. Utilisez « Tester » pour vérifier la réception.';
    });
  });
  test.addEventListener('click', () => busy(async () => {
    const sub = await registration.pushManager.getSubscription();
    if (!sub) throw new Error('Activez les notifications avant de lancer le test.');
    const result = await api('test', 'POST', {endpoint: sub.endpoint});
    status.textContent = result.queued ? 'Test en attente : le serveur réessaiera automatiquement.' : 'Test envoyé par le serveur. Vérifiez les notifications de votre téléphone.';
  }));
  async function unsubscribe() {
    await registered;
    const sub = await registration?.pushManager.getSubscription();
    if (sub) {
      let failed = false;
      try { await api('subscription', 'DELETE', sub.toJSON()); } catch { failed = true; }
      const removed = await sub.unsubscribe();
      if (!removed && await registration.pushManager.getSubscription()) throw new Error('Désactivation impossible. Bloquez les notifications dans les paramètres du site.');
      if (failed) console.warn('Subscription removed locally; server cleanup will follow when push service returns 410.');
    }
    showActive(false); status.textContent = 'Notifications désactivées sur cet appareil.';
  }
  window.yonkoPush = {unsubscribe};
  disable.addEventListener('click', () => busy(unsubscribe));
  window.addEventListener('yonko-authenticated', refresh);
  window.addEventListener('storage', e => { if (e.key === 'dashboardKey' && !e.newValue) unsubscribe().catch(() => {}); });
  navigator.serviceWorker?.addEventListener('message', e => { if (e.data?.type === 'yonko-reservations-changed' && localStorage.getItem('dashboardKey') && typeof init === 'function') init(); });
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; document.getElementById('pwaInstall').hidden = false; });
  document.getElementById('pwaInstall').addEventListener('click', async () => { if (installPrompt) { await installPrompt.prompt(); installPrompt = null; document.getElementById('pwaInstall').hidden = true; } });
  window.addEventListener('appinstalled', () => { document.getElementById('pwaInstall').hidden = true; });
  refresh();
})();
