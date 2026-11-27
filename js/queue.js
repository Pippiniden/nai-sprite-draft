import { apiGenerate, buildPayload, prepareI2i } from './api.js';
import { idb } from './db.js';
import { renderAllExprRefToggles, renderExprStatus, renderExprThumbs, updateMissingBtn } from './expressions.js';
import { bgSleep, keepAliveOff, keepAliveOn, notifyDone } from './keepalive.js';
import { encodeVibe, renderRefCards, vibeIsEncoded } from './refs.js';
import { curChar, saveProject, state } from './state.js';
import { askChoice, openApiModal, toast } from './ui.js';
import { $, b64url, esc, sleep, uid } from './util.js';
import { pickVariantIdx, variantLabel } from './variants.js';

/* ==== Queue ==== */
export const queue={jobs:[],running:false,cancel:false,total:0,done:0};
/* Consecutive 429s before the queue gives up. Waits grow 15s → 30s → 60s (capped). */
const RATE_LIMIT_MAX_RETRIES=6;

/* Vibes have to be encoded for the model + Info Extracted combination actually in use.
   An unencoded one makes the API reject the whole request, so check before spending
   time on a long queue rather than discovering it on the first job. */
export function unencodedVibesFor(p,exprIds){
  const model=p.settings.model;
  const out=[];
  for(const v of (p.vibes||[])){
    if(vibeIsEncoded(v,model))continue;
    const usedBy=p.expressions.filter(e=>exprIds.includes(e.id)&&(e.refConfig||{})[v.id]!==false);
    if(usedBy.length)out.push({vibe:v,exprs:usedBy});
  }
  return out;
}
export async function preflightVibes(p,exprIds){
  const bad=unencodedVibesFor(p,exprIds);
  if(!bad.length)return true;
  const model=p.settings.model;
  const modelLabel=model.endsWith('curated')?'V4.5 Curated':'V4.5 Full';
  const rows=bad.map(({vibe,exprs})=>{
    const ie=(vibe.infoExtracted??0.6).toFixed(2);
    const names=exprs.slice(0,4).map(e=>esc(e.name)).join('、')+(exprs.length>4?` ほか${exprs.length-4}件`:'');
    return `<li><img src="${b64url(vibe.base64)}" style="width:34px;height:34px;object-fit:cover;border-radius:4px;vertical-align:middle;margin-right:8px">
      Info Extracted <code>${ie}</code> — 対象 ${exprs.length} 表情（${names}）</li>`;
  }).join('');
  const cost=bad.length*2;
  const body=`<p>未エンコードのバイブスが <b>${bad.length} 件</b>あり、これから生成する表情で使われる設定になっています。このままだと API がリクエストを拒否し、キュー全体が失敗します。</p>
    <ul style="list-style:none;padding:0;margin:10px 0;display:flex;flex-direction:column;gap:8px">${rows}</ul>
    <p>現在のモデルは <b>${modelLabel}</b> です。エンコードは「モデル × Info Extracted」の組み合わせごとに必要で、いずれかを変更すると再エンコードになります。今すぐエンコードすると <b>${cost} Anlas</b> かかります。</p>`;
  const ans=await askChoice('未エンコードのバイブスがあります',body,[
    {value:null,label:'キャンセル'},
    {value:'skip',label:'このバイブスを外して生成'},
    {value:'encode',label:'エンコードしてから生成',cls:'primary'}
  ]);
  if(ans===null)return false;
  if(ans==='skip'){
    // turn the offending vibes off for the expressions in this run only
    for(const{vibe,exprs}of bad)for(const e of exprs){e.refConfig=e.refConfig||{};e.refConfig[vibe.id]=false;}
    saveProject();renderAllExprRefToggles();
    toast(`未エンコードのバイブス ${bad.length} 件を対象表情から外しました`);
    return true;
  }
  for(const{vibe}of bad){
    try{toast('バイブスをエンコードしています…');await encodeVibe(vibe,model);renderRefCards();await sleep(1000);}
    catch(e){toast('エンコードに失敗したため生成を中止しました: '+e.message,'err');renderRefCards();return false;}
  }
  toast(`バイブス ${bad.length} 件のエンコードが完了しました`,'ok');
  renderRefCards();
  return true;
}
export async function enqueue(exprIds){
  if(!state.apiKey){openApiModal();toast('先に API キーを設定してください','err');return;}
  const p=state.project;if(!p)return;
  if(!await preflightVibes(p,exprIds.filter(id=>p.expressions.some(e=>e.id===id))))return;
  const count=Math.max(1,p.settings.count|0);
  const valid=exprIds.filter(id=>p.expressions.some(e=>e.id===id));
  const jobs=[];
  if(p.settings.order==='roundrobin'){
    // one image per expression, repeated until every expression has `count`
    for(let i=0;i<count;i++)for(const id of valid)jobs.push({exprId:id});
  }else{
    for(const id of valid)for(let i=0;i<count;i++)jobs.push({exprId:id});
  }
  if(!jobs.length)return;
  // Bind each job to the character that was active when it was queued, so switching
  // characters mid-run neither retargets the prompt nor misfiles the results.
  // Likewise bind them to the project, so opening another project mid-run does not
  // silently drop the rest of the queue.
  const cid=curChar(p).id;
  for(const j of jobs){j.charId=cid;j.projectId=p.id;}
  if(!queue.running){queue.total=0;queue.done=0;}
  queue.jobs.push(...jobs);queue.total+=jobs.length;
  runQueue();
}
export async function runQueue(){
  if(queue.running)return;
  queue.running=true;queue.cancel=false;updateQueueBar();
  keepAliveOn();
  const startedAt=queue.done;
  let rateLimited=0;
  const stopRequested=()=>queue.cancel;
  while(queue.jobs.length&&!queue.cancel){
    const job=queue.jobs[0];
    // Jobs queued before v21 have no projectId; they belong to whatever is open.
    const proj=job.projectId?state.projects.find(p=>p.id===job.projectId):state.project;
    const ex=proj?.expressions.find(e=>e.id===job.exprId);
    if(!ex){queue.jobs.shift();queue.done++;updateQueueBar();continue;}
    const isCur=proj===state.project;
    const label=isCur?ex.name:`${ex.name}（${proj.name}）`;
    updateQueueBar(label);
    try{
      const seed=Math.floor(Math.random()*0xFFFFFFFF);
      const ch=proj.characters.find(c=>c.id===job.charId)||curChar(proj);
      const vIdx=pickVariantIdx(ex);
      const payload=buildPayload(proj,ex,seed,ch,vIdx,await prepareI2i(proj,ex));
      const blob=await apiGenerate(payload);
      const rec={id:uid(),projectId:proj.id,charId:ch.id,exprId:ex.id,blob,seed,prompt:payload.input,width:proj.settings.width,height:proj.settings.height,model:proj.settings.model,adopted:false,held:false,createdAt:Date.now(),variantIdx:vIdx,variantLabel:ex.variants&&ex.variants.length>1?variantLabel(ex,vIdx):''};
      await idb.put('images',rec);
      if(proj===state.project){
        state.allImages.push(rec);
        // only surface it immediately if the user is still looking at that character
        if(rec.charId===proj.currentCharId){state.images.push(rec);renderExprThumbs(ex.id);renderExprStatus(ex.id);}
        updateMissingBtn();
      }else{
        // saveProject() only writes the open project; persist the variant cursor here
        idb.put('projects',proj).catch(()=>{});
      }
      queue.jobs.shift();queue.done++;rateLimited=0;
    }catch(e){
      if(e.status===429){
        rateLimited++;
        if(rateLimited>RATE_LIMIT_MAX_RETRIES){
          toast(`レート制限が ${RATE_LIMIT_MAX_RETRIES} 回続いたため生成を中止しました。しばらく待ってから再開してください（「未生成のみ」で続きから再開できます）`,'err');
          queue.jobs.length=0;break;
        }
        const base=15000*Math.min(4,2**(rateLimited-1));const s=proj.settings;
        let jitter=0;
        if(s.jitter){const lo=(s.jitterMin??0)*1000,hi=(s.jitterMax??10)*1000;jitter=lo+Math.random()*Math.max(0,hi-lo);}
        const wait=Math.max(base,e.retryAfter||0)+jitter;
        toast(`レート制限中です。${(wait/1000).toFixed(2)} 秒後に再試行します（${rateLimited}/${RATE_LIMIT_MAX_RETRIES}）`);
        updateQueueBar(label+' (待機中)');await bgSleep(wait,stopRequested);continue;
      }
      if(e.status===401){toast('APIキーが正しくありません。設定を確認してください','err');queue.jobs.length=0;break;}
      if(e.status===402){toast('Anlas が不足しています','err');queue.jobs.length=0;break;}
      toast('生成に失敗しました: '+e.message,'err');queue.jobs.shift();queue.done++;
    }
    updateQueueBar();
    if(queue.jobs.length&&!queue.cancel){
      const ss=proj.settings;let delay=Math.max(0,(ss.delaySec||0)*1000);
      if(ss.jitter){const lo=(ss.jitterMin??0)*1000,hi=(ss.jitterMax??10)*1000;delay+=lo+Math.random()*Math.max(0,hi-lo);}
      await bgSleep(delay,stopRequested);
    }
  }
  if(queue.cancel)queue.jobs.length=0;
  const made=queue.done-startedAt;
  queue.running=false;updateQueueBar();keepAliveOff();
  if(made>0&&!queue.cancel)notifyDone(made);
}
export function updateQueueBar(current){const bar=$('#queueBar');const active=queue.running||queue.jobs.length;bar.classList.toggle('show',!!active);if(!active)return;$('#queueText').textContent=`生成中 ${queue.done}/${queue.total}`+(current?' — '+current:'');$('#queueFill').style.width=(queue.total?(queue.done/queue.total*100):0)+'%';}
$('#btnCancelQueue').onclick=()=>{queue.cancel=true;toast('生成を中止しました');};
window.addEventListener('beforeunload',e=>{if(queue.running){e.preventDefault();e.returnValue='';}});
