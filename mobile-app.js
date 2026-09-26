(() => {
  const VERSION='2026.09.26.2';
  let installPrompt, registration, busy=false, enabled=false, refreshing=false, lastRefresh=Date.now(), lastVersionCheck=0;
  const buttons=[...document.querySelectorAll('.install-app')], note=document.getElementById('connectionNote');
  const dialog=document.createElement('dialog');dialog.id='mobileSettings';
  dialog.innerHTML=`<div class="panel-title"><div><div class="eyebrow">Votre téléphone</div><h2>Application & notifications</h2></div><button class="btn-ghost" id="closeMobileSettings" aria-label="Fermer">×</button></div><p id="pushState" role="status">Vérification…</p><p class="mobile-explanation">Recevez une alerte pour les nouvelles demandes du site, même quand l’application est fermée. Les imports Privateaser sont signalés après synchronisation. Un récapitulatif est prévu chaque jour à 14 h (Paris).</p><div class="mobile-actions"><button class="btn-primary" id="enablePush">Activer les notifications</button><button class="btn-ghost" id="testPush" hidden>Envoyer un test</button><button class="btn-ghost" id="disablePush" hidden>Désactiver sur ce téléphone</button></div><p class="mobile-explanation">Les noms et coordonnées des clients ne sont jamais inclus dans l’alerte. WhatsApp reste actif comme avant.</p><hr><button class="btn-ghost" id="installFromSettings">Installer l’application</button><p id="installGuide" class="mobile-explanation">Android : menu ⋮ de Chrome → Installer l’application ou Ajouter à l’écran d’accueil. iPhone : Partager → Sur l’écran d’accueil.</p><p class="app-release">Version ${VERSION}</p>`;
  document.body.append(dialog);
  const byId=id=>document.getElementById(id);
  const supportsPush=()=>window.isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
  const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  const iOS=()=>/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  function state(message){byId('pushState').textContent=message;}
  function connection(){note.hidden=navigator.onLine; if(!navigator.onLine)note.textContent='Connexion perdue. Les données affichées peuvent ne plus être à jour. Les actions nécessitent Internet.';controls();}
  connection();addEventListener('offline',connection);addEventListener('online',()=>{connection();refreshReservations();});
  function controls(){
    byId('enablePush').hidden=enabled;byId('disablePush').hidden=!enabled;byId('testPush').hidden=!enabled;
    for(const id of ['enablePush','disablePush','testPush'])byId(id).disabled=busy||!navigator.onLine||!supportsPush();
    byId('installFromSettings').hidden=standalone();byId('installGuide').hidden=standalone();
  }
  async function pushAPI(action,extra={}){
    const accessKey=key();if(!accessKey)throw new Error('Connectez-vous pour gérer les notifications.');
    if(!navigator.onLine)throw new Error('Connexion Internet nécessaire.');
    // Keep the existing Pages -> private Worker contract and durable retry queue.
    async function request(path,method='GET',body){
      const response=await fetch('/api/push/'+path,{method,cache:'no-store',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json','x-dashboard-key':accessKey},...(body?{body:JSON.stringify(body)}:{})});
      let data;try{data=await response.json();}catch{throw new Error('Les notifications ne sont pas encore disponibles sur cette version du serveur.');}
      if(!response.ok)throw new Error(response.status===401?'Votre accès a expiré. Reconnectez-vous.':data.error||'Notification indisponible.');
      return data;
    }
    if(action==='enroll')return request('config');
    if(action==='status'){
      await request('config');
      const sub=await (await worker()).pushManager.getSubscription();
      if(!sub)return {enabled:false};
      await request('subscription','POST',sub.toJSON());return {enabled:true};
    }
    if(action==='subscribe')return request('subscription','POST',extra.subscription);
    if(action==='unsubscribe'){
      const sub=await (await worker()).pushManager.getSubscription();
      return sub?request('subscription','DELETE',sub.toJSON()):{ok:true};
    }
    if(action==='test')return request('test','POST',{endpoint:extra.endpoint});
  }
  const workerReady=('serviceWorker' in navigator&&window.isSecureContext)?navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).then(r=>{registration=r;return navigator.serviceWorker.ready}):Promise.resolve(null);
  workerReady.catch(()=>{});
  async function worker(){const r=await Promise.race([workerReady,new Promise((_,reject)=>setTimeout(()=>reject(new Error('L’application mobile se prépare. Réessayez dans quelques secondes.')),10000))]);if(!r)throw new Error('Ce navigateur ne prend pas en charge l’application.');return r;}
  async function inspectPush(){
    enabled=false;
    if(!supportsPush()){state('Notifications indisponibles ici. Essayez Chrome sur Android, ou l’application installée sur iPhone.');controls();return;}
    if(iOS()&&!standalone()){state('Sur iPhone, installez d’abord l’application sur l’écran d’accueil.');controls();return;}
    if(Notification.permission==='denied'){state('Notifications bloquées. Autorisez-les dans les réglages du navigateur ou du téléphone.');controls();return;}
    try{await pushAPI('enroll');const r=await worker(),sub=await r.pushManager.getSubscription();enabled=!!sub&&(await pushAPI('status',{endpoint:sub.endpoint})).enabled;state(enabled?'Notifications activées sur ce téléphone.':'Service prêt. Notifications désactivées sur ce téléphone.');}
    catch(e){state(e.message);}controls();
  }
  window.openMobileSettings=async()=>{if(!key())return;if(!dialog.open)dialog.showModal();await inspectPush();};
  byId('closeMobileSettings').onclick=()=>dialog.close();
  function applicationServerKey(value){return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}
  byId('enablePush').onclick=async()=>{
    if(busy)return;
    let permissionTimer;
    const permission=Notification.permission==='default'?Promise.race([Notification.requestPermission(),new Promise((_,reject)=>{permissionTimer=setTimeout(()=>reject(new Error('Confirmez l’autorisation dans votre navigateur. Si aucune demande n’apparaît, ouvrez l’application dans Chrome sur Android.')),45000);})]):Promise.resolve(Notification.permission);
    busy=true;controls();state('Activation en cours…');
    try{
      if(await permission!=='granted')throw new Error('Permission non accordée. Vous pourrez réessayer depuis les réglages du navigateur.');
      const r=await worker();let sub=await r.pushManager.getSubscription();
      if(sub&&(await pushAPI('status',{endpoint:sub.endpoint})).enabled){enabled=true;state('Notifications déjà activées.');return;}
      if(sub)await sub.unsubscribe();
      const enrollment=await pushAPI('enroll');
      sub=await r.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:applicationServerKey(enrollment.publicKey)});
      try{await pushAPI('subscribe',{endpoint:sub.endpoint,subscription:sub.toJSON(),ticket:enrollment.ticket});}
      catch(e){await sub.unsubscribe().catch(()=>{});throw e;}
      enabled=true;state('Notifications activées. Envoyez un test pour vérifier la réception sur votre téléphone.');
    }catch(e){state(e.message);}finally{clearTimeout(permissionTimer);busy=false;controls();}
  };
  async function disablePush(){
    const r=await worker(),sub=await r.pushManager.getSubscription();
    if(sub){let failure;try{await pushAPI('unsubscribe',{endpoint:sub.endpoint});}catch(e){failure=e;}const removed=await sub.unsubscribe();if(!removed&&await r.pushManager.getSubscription())throw new Error('Désactivation impossible. Bloquez les notifications dans les réglages du téléphone.');if(failure)state('Notifications désactivées sur ce téléphone. Nettoyage serveur en attente.');}
    enabled=false;state('Notifications désactivées sur ce téléphone.');controls();
  }
  byId('disablePush').onclick=async()=>{if(busy)return;busy=true;controls();try{await disablePush();}catch(e){state(e.message);}finally{busy=false;controls();}};
  byId('testPush').onclick=async()=>{if(busy)return;busy=true;controls();try{const sub=await (await worker()).pushManager.getSubscription();if(!sub)throw new Error('Réactivez les notifications.');const result=await pushAPI('test',{endpoint:sub.endpoint});state(result.queued?'Test en attente. Le serveur réessaiera automatiquement.':'Test accepté par le service d’envoi. Vérifiez la notification sur votre téléphone.');}catch(e){state(e.message);}finally{busy=false;controls();}};
  window.mobileBeforeLogout=async()=>{
    dialog.close();if(!supportsPush()||Notification.permission!=='granted')return;
    try{await disablePush();}catch{toast('Déconnexion effectuée. Si les alertes persistent, désactivez les notifications dans les réglages du téléphone.','error');}
  };
  async function install(){
    if(!installPrompt){byId('installGuide').hidden=false;return;}
    try{await installPrompt.prompt();await installPrompt.userChoice;}catch{toast('Utilisez le menu du navigateur pour installer l’application.','error');}
    finally{installPrompt=null;buttons.forEach(b=>b.hidden=true);}
  }
  addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;buttons.forEach(b=>b.hidden=false);});
  buttons.forEach(b=>b.onclick=install);byId('installFromSettings').onclick=install;
  addEventListener('appinstalled',()=>{installPrompt=null;buttons.forEach(b=>b.hidden=true);controls();});
  function unsaved(){return byId('form').classList.contains('open')||byId('quotePanel').style.display!=='none'||dialog.open;}
  async function refreshReservations(){
    if(refreshing||!loaded||!key()||document.hidden||!navigator.onLine||unsaved()||Date.now()-lastRefresh<30000)return;
    refreshing=true;const startedKey=key();
    try{const fresh=await api('');if(key()!==startedKey||!key())return;entries=fresh;loadFailed=false;byId('loadError').hidden=true;lastRefresh=Date.now();render();byId('updateTime').textContent='Actualisé à '+new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});}
    catch{if(key())byId('updateTime').textContent='Actualisation indisponible · utilisez Outils → Actualiser';}
    finally{refreshing=false;}
  }
  async function checkVersion(){
    if(document.hidden||!navigator.onLine||Date.now()-lastVersionCheck<300000)return;lastVersionCheck=Date.now();
    try{const r=await fetch('/app-version.json',{cache:'no-store'});if(!r.ok)return;const v=await r.json();if(typeof v.version==='string'&&v.version!==VERSION){byId('appUpdate').hidden=false;}}
    catch{}if(registration)registration.update().catch(()=>{});
  }
  addEventListener('focus',()=>{refreshReservations();checkVersion();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){refreshReservations();checkVersion();}});
  setInterval(()=>{refreshReservations();checkVersion();},60000);
  navigator.serviceWorker?.addEventListener('message',event=>{
    if(event.data?.type==='yonko-reservations-changed'){lastRefresh=0;refreshReservations();}
    if(event.data?.type==='OPEN_RESERVATIONS'){lastRefresh=0;filter='all';timeScope='upcoming';clearSearch();setView('list');refreshReservations();}
  });
  addEventListener('yonko-auth',()=>{if(new URLSearchParams(location.search).get('view')==='list'){filter='all';timeScope='upcoming';setView('list');}checkVersion();});
  if(loaded&&key())dispatchEvent(new Event('yonko-auth'));
})();
