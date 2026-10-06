import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {normalizePushEnv} from '../push-worker/worker.js';
import {onRequestPost} from '../functions/api/reservations/index.js';
const git='C:/Users/yasta/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git/cmd/git.exe';
const baseline=execFileSync(git,['show','101218916d54cda1e11e55527ef66fef5169cb15:dashboard.html'],{encoding:'utf8'});
const current=fs.readFileSync(new URL('../dashboard.html',import.meta.url),'utf8');
function harness(html){
 const elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,style:{display:'none'},classList:{contains:()=>false,remove(){},add(){}},setAttribute(){},focus(){},appendChild(){},addEventListener(){},checkValidity:()=>true});return elements.get(id);};
 const context=vm.createContext({document:{getElementById:element,querySelector:()=>element('query'),querySelectorAll:()=>[],addEventListener(){},createElement:()=>element('new')},window:{},localStorage:{getItem:()=>null,removeItem(){}},console,Date,URL,URLSearchParams,Event,setTimeout:()=>0,clearTimeout(){},dispatchEvent(){},navigator:{},confirm:()=>true,prompt:()=>null});
 for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(match[1].trim())vm.runInContext(match[1],context);
 return {context,element};
}
test('Tous les traitements métier du dashboard sont identiques à la production',()=>{
 const before=harness(baseline),after=harness(current);
 for(const name of ['submitForm','toggleManualDeposit','makeStripeLink','setStatus','syncPrivateaser','deleteEntry','sendQuote','openQuote','renderQuoteBody','copyMessage','cardHTML','matchesSearch','renderList','renderPlanning','renderStatsView'])
  assert.equal(vm.runInContext(name+'.toString()',after.context).replace(/\r\n/g,'\n'),vm.runInContext(name+'.toString()',before.context).replace(/\r\n/g,'\n'),name);
});
test('Création manuelle conserve espace et génération du lien de caution Stripe',async()=>{
 const {context,element}=harness(current);
 for(const [id,value] of Object.entries({'f-name':'Test fictif','f-date':'2026-10-10','f-email':'test@example.com','f-contact':'test','f-guests':'8','f-type':'Taverne','f-source':'Manuel','f-deposit':'yes','f-deposit-amount':'50'}))element(id).value=value;
 context.calls=[];
 vm.runInContext("api=async(path,opts={})=>{calls.push({path,opts});if(opts.method==='POST'&&path==='')return {id:'fictif'};if(path.includes('deposit-link'))return {emailResult:{sent:true}};return []};render=()=>{};toast=()=>{};",context);
 await vm.runInContext('submitForm()',context);
 const creation=JSON.parse(context.calls[0].opts.body);assert.equal(creation.type,'Taverne');assert.equal(creation.manual,true);
 assert.equal(context.calls[1].path,'/fictif/deposit-link');assert.equal(JSON.parse(context.calls[1].opts.body).amount,50);
});
test('API conserve la réservation même si le push est indisponible',async()=>{
 const data=new Map();let pushCalls=0;
 const env={DASHBOARD_KEY:'test',RESERVATIONS:{get:async k=>data.get(k),put:async(k,v)=>data.set(k,v)},PUSH_SERVICE:{fetch:async()=>{pushCalls++;throw new Error('offline')}}};
 const response=await onRequestPost({request:new Request('https://yonkobar.com/api/reservations',{method:'POST',body:JSON.stringify({name:'Fictif',date:'2026-10-10',type:'Taverne',manual:true})}),env});
 assert.equal(response.status,201);const result=await response.json();assert.equal(JSON.parse(data.get('res:'+result.id)).type,'Taverne');assert.equal(pushCalls,1);
});
test('Normalisation conserve les correctifs du Worker actuellement fonctionnel',()=>{
 const env=normalizePushEnv({VAPID_PUBLIC_KEY:' " a+b/c== " ',VAPID_PRIVATE_KEY:" ' d+e/f= ' ",VAPID_SUBJECT:' "mailto:test@example.com" '});
 assert.equal(env.VAPID_PUBLIC_KEY,'a-b_c');assert.equal(env.VAPID_PRIVATE_KEY,'d-e_f');assert.equal(env.VAPID_SUBJECT,'mailto:test@example.com');
});
