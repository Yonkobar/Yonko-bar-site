import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {parisClock, validateSubscription, summary, reservationKeys} from '../push-worker/core.js';
import worker, {PushState} from '../push-worker/worker.js';
import {buildPushPayload} from '../push-worker/vendor/web-push/main.js';
import {onRequest} from '../functions/api/push/[[path]].js';

const encode = x => Buffer.from(x).toString('base64url');
const decode = x => Buffer.from(x, 'base64url');
async function keys() {
  const client = await crypto.subtle.generateKey({name: 'ECDH', namedCurve: 'P-256'}, true, ['deriveBits']);
  const vapid = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', vapid.privateKey);
  return {client, vapid, sub: {endpoint: 'https://fcm.googleapis.com/fcm/send/test', keys: {
    p256dh: encode(await crypto.subtle.exportKey('raw', client.publicKey)), auth: encode(crypto.getRandomValues(new Uint8Array(16))),
  }}, env: {VAPID_PUBLIC_KEY: encode(await crypto.subtle.exportKey('raw', vapid.publicKey)), VAPID_PRIVATE_KEY: jwk.d, VAPID_SUBJECT: 'mailto:test@example.com'}};
}
function rig(env = {}) {
  const stored=new Map();
  const records = new Map();
  const kv = {list: async () => ({list_complete: true, keys: [...records.keys()].map(name => ({name}))}), get: async key => records.get(key) || null};
  const storage={get:async key=>structuredClone(stored.get(key)),put:async(key,value)=>{assert.ok(JSON.stringify(value).length<128*1024);stored.set(key,structuredClone(value));},delete:async key=>stored.delete(key),transaction:async fn=>fn(storage)};
  const obj = new PushState({storage}, {RESERVATIONS: kv, ...env});
  return {obj, records, state: () => {
    const meta=structuredClone(stored.get('state'));
    for(const name of ['subscriptions','seen','jobs']){meta[name]={};for(let i=0;i<(meta.chunks?.[name]||0);i++)Object.assign(meta[name],Object.fromEntries(structuredClone(stored.get(`${name}:${i}`))));}
    delete meta.chunks;return meta;
  }};
}
const req = (path, body, method = 'POST') => new Request(`https://internal/${path}`, {method, ...(body ? {body: JSON.stringify(body)} : {})});

test('14 h Paris en hiver, été et aux changements d’heure', () => {
  for (const [utc, date, hour] of [
    ['2026-01-20T13:00Z','2026-01-20',14], ['2026-07-20T12:00Z','2026-07-20',14],
    ['2026-03-29T12:00Z','2026-03-29',14], ['2026-10-25T13:00Z','2026-10-25',14],
    ['2026-07-20T11:59Z','2026-07-20',13], ['2026-07-20T22:10Z','2026-07-21',0],
  ]) assert.deepEqual(parisClock(Date.parse(utc)), {date, hour});
});
test('Récap exclut refus et autres dates et additionne les invités', () => {
  const result = summary([{date:'2026-07-20',status:'accepted',guests:'5'}, {date:'2026-07-20',status:'pending',guests:'2'}, {date:'2026-07-20',status:'declined',guests:'9'}, {date:'2026-07-21',status:'accepted',guests:'7'}], '2026-07-20');
  assert.match(result.body, /2 réservation.*1 acceptée.*1 en attente.*7 personne/);
  assert.match(summary([], '2026-07-20').body, /^0 réservation/);
});
test('Validation abonnement refuse endpoints privés, URL détournée et clés invalides', async () => {
  const {sub} = await keys();
  assert.equal(validateSubscription(sub), true);
  for (const endpoint of ['http://fcm.googleapis.com/test','https://localhost/test','https://127.0.0.1','https://fcm.googleapis.com.evil.example/a','https://user@fcm.googleapis.com/a','https://fcm.googleapis.com:8443/a']) assert.equal(validateSubscription({...sub, endpoint}), false);
  assert.equal(validateSubscription({...sub, keys: {auth:'x',p256dh:'x'}}), false);
});
test('Scan KV paginé ne dépend pas de res:index', async () => {
  let calls = 0;
  const list = await reservationKeys({list: async ({cursor}) => ++calls === 1 ? {keys:[{name:'res:index'},{name:'res:a'}],list_complete:false,cursor:'next'} : (assert.equal(cursor,'next'),{keys:[{name:'res:b'}],list_complete:true})});
  assert.deepEqual(list,['res:a','res:b']);
});
test('API Pages : authentification, origine, routes privées et absence de binding', async () => {
  const env = {DASHBOARD_KEY:'test'};
  const run = (path, headers={}) => onRequest({request:new Request(`https://preview.example/api/push/${path}`,{headers}),env,params:{path:[path]}});
  assert.equal((await run('config')).status,401);
  assert.equal((await run('config',{'x-dashboard-key':'test',Origin:'https://evil.example'})).status,403);
  assert.equal((await run('tick',{'x-dashboard-key':'test'})).status,404);
  assert.equal((await run('config',{'x-dashboard-key':'test'})).status,503);
  env.PUSH_SERVICE={fetch:async (url,opts)=>{assert.equal(url,'https://push.internal/config');assert.equal(opts.headers['x-app-origin'],'https://preview.example');return Response.json({ok:true});}};
  assert.equal((await run('config',{'x-dashboard-key':'test'})).status,200);
});
test('Pas de notification historique, nouvelle demande une fois, récap une fois et persistance', async () => {
  const {sub, env}=await keys(); const r=rig(env);
  r.records.set('res:old',JSON.stringify({id:'old',createdAt:1,date:'2026-07-20',status:'accepted',guests:5}));
  await r.obj.fetch(req('subscription',sub));
  assert.equal(Object.keys(r.state().jobs).length,0);
  r.obj.deliver=async ()=>{}; // Observe durable outbox, without sending to a real endpoint.
  r.records.set('res:new',JSON.stringify({id:'new',createdAt:Date.now()+1,date:'2026-07-20',status:'pending',guests:2}));
  await r.obj.fetch(req('tick',{time:Date.parse('2026-07-20T12:00Z')}));
  await r.obj.fetch(req('tick',{time:Date.parse('2026-07-20T12:01Z')}));
  assert.equal(Object.keys(r.state().jobs).length,2);
  assert.equal(r.state().lastDaily,'2026-07-20');
  assert.equal(Object.values(r.state().jobs).filter(j=>j.payload.tag.startsWith('new-')).length,1);
  await r.obj.fetch(req('subscription',sub,'DELETE'));
  assert.equal(Object.keys(r.state().jobs).length,0);
  assert.equal(Object.keys(r.state().subscriptions).length,0);
});
test('Erreur push réessayée et abonnement expiré supprimé', async () => {
  const original=globalThis.fetch;
  try {
    const {sub,env}=await keys(); const r=rig(env);
    await r.obj.fetch(req('subscription',sub));
    globalThis.fetch=async ()=>new Response('',{status:503});
    const response=await r.obj.fetch(req('test',{endpoint:sub.endpoint}));
    assert.equal((await response.json()).queued,true);
    const state=r.state(); const job=Object.values(state.jobs)[0]; assert.equal(job.attempts,1);job.next=0;
    globalThis.fetch=async ()=>new Response('',{status:410});
    await r.obj.deliver(state);
    assert.equal(Object.keys(r.state().subscriptions).length,0);
    assert.equal(Object.keys(r.state().jobs).length,0);
  } finally {globalThis.fetch=original;}
});
test('Événement direct, doublon et réconciliation produisent une seule alerte', async () => {
  const {sub,env}=await keys();const r=rig(env);
  await r.obj.fetch(req('subscription',sub));r.obj.deliver=async()=>{};
  const event={id:'new-booking',createdAt:Date.now()+1};
  await r.obj.fetch(req('event',event));await r.obj.fetch(req('event',event));
  r.records.set('res:new-booking',JSON.stringify(event));
  await r.obj.fetch(req('tick',{time:Date.parse('2026-07-20T10:00Z')}));
  assert.equal(Object.keys(r.state().jobs).length,1);
});
test('Historique de 5000 réservations stocké sans dépasser 128 Kio par valeur', async () => {
  const r=rig();const state=await r.obj.load();
  for(let i=0;i<5000;i++)state.seen[`res:${crypto.randomUUID()}`]=true;
  await r.obj.save(state);assert.equal(Object.keys((await r.obj.load()).seen).length,5000);
});
test('Un vrai payload RFC8291 est déchiffrable et sa signature VAPID valide', async () => {
  const {sub,env,client,vapid}=await keys();
  const data={title:'Yonko Bar',body:'Réservation test'};
  const payload=await buildPushPayload({data,options:{ttl:3600}},sub,{publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY,subject:env.VAPID_SUBJECT});
  assert.equal(payload.headers['content-encoding'],'aes128gcm');
  const body=Buffer.from(payload.body),salt=body.subarray(0,16),keyLength=body[20],serverKey=body.subarray(21,21+keyLength);
  const publicKey=await crypto.subtle.importKey('raw',serverKey,{name:'ECDH',namedCurve:'P-256'},false,[]);
  const shared=await crypto.subtle.deriveBits({name:'ECDH',public:publicKey},client.privateKey,256);
  async function hkdf(ikm,salt,info,length){const key=await crypto.subtle.importKey('raw',ikm,'HKDF',false,['deriveBits']);return crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info},key,length*8);}
  const ikm=await hkdf(shared,decode(sub.keys.auth),Buffer.concat([Buffer.from('WebPush: info\0'),decode(sub.keys.p256dh),serverKey]),32);
  const cek=await hkdf(ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16);
  const nonce=await hkdf(ikm,salt,Buffer.from('Content-Encoding: nonce\0'),12);
  const aes=await crypto.subtle.importKey('raw',cek,'AES-GCM',false,['decrypt']);
  const plain=Buffer.from(await crypto.subtle.decrypt({name:'AES-GCM',iv:nonce},aes,body.subarray(21+keyLength)));
  let end=plain.length-1;while(plain[end]===0)end--;
  assert.equal(plain[end],2);assert.deepEqual(JSON.parse(plain.subarray(0,end)),data);
  const auth=payload.headers.authorization || payload.headers.Authorization;
  const token=auth.match(/t=([^, ]+)/)?.[1] || auth.replace(/^WebPush /,'');
  const [head,claims,signature]=token.split('.');
  assert.equal(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},vapid.publicKey,decode(signature),Buffer.from(`${head}.${claims}`)),true);
  assert.equal(JSON.parse(decode(claims)).aud,'https://fcm.googleapis.com');
});
test('Service worker montre un push et ouvre uniquement le dashboard local', async () => {
  const listeners={},notifications=[],opened=[];
  const self={location:{origin:'https://preview.example'},addEventListener:(n,f)=>listeners[n]=f,registration:{showNotification:async(...args)=>notifications.push(args)},clients:{matchAll:async()=>[],openWindow:async u=>opened.push(u)}};
  vm.runInNewContext(await fs.readFile(new URL('../sw.js',import.meta.url),'utf8'),{self,URL});
  let pending;listeners.push({data:{json:()=>({title:'Test',body:'OK',url:'https://evil.example'})},waitUntil:p=>pending=p});await pending;
  assert.equal(notifications.length,1);assert.equal(notifications[0][1].data.url,'/dashboard');
  listeners.notificationclick({notification:{close(){}},waitUntil:p=>pending=p});await pending;assert.deepEqual(opened,['/dashboard']);
});
