import { queue } from './queue.js';
import { state } from './state.js';
import { toast } from './ui.js';
import { $, sleep } from './util.js';

/* ================= Background keep-alive =================
   Chrome and Edge throttle timers in hidden tabs: setTimeout gets a 1s floor, and
   after ~5 minutes hidden the tab enters "intensive throttling" where timers fire
   about once a minute. A queue that waits 3s between images then crawls at 60s per
   image, which looks like generation has stopped. fetch() itself is not throttled,
   so the requests still work — it is the waiting that breaks.

   Three defences, none of which is individually sufficient:
     1. Worker timers      — a dedicated worker is throttled less aggressively than
                             the page, and survives some of the budget throttling.
     2. Deadline arithmetic— we wait until an absolute timestamp instead of trusting
                             the timer, so a late wake-up resumes immediately rather
                             than adding its own delay on top.
     3. Silent audio       — a page that is playing audio is exempt from intensive
                             throttling and from tab freezing. This is the part that
                             actually keeps long queues alive; it needs a user
                             gesture to start, which the generate button provides. */
export const bg={worker:null,seq:0,waiters:new Map(),ctx:null,osc:null,gain:null,lock:null,lockRelease:null,wake:null,warned:false};

export function bgWorker(){
  if(bg.worker!==null)return bg.worker;
  try{
    const src="let t={};onmessage=e=>{const d=e.data;if(d.cmd==='set'){t[d.id]=setTimeout(()=>{delete t[d.id];postMessage(d.id)},d.ms)}else if(d.cmd==='clear'){clearTimeout(t[d.id]);delete t[d.id]}}";
    const w=new Worker(URL.createObjectURL(new Blob([src],{type:'text/javascript'})));
    w.onmessage=e=>{const r=bg.waiters.get(e.data);if(r){bg.waiters.delete(e.data);r();}};
    bg.worker=w;
  }catch(_){bg.worker=false;}
  return bg.worker;
}
export function bgTimeout(ms){
  const w=bgWorker();
  if(!w)return sleep(ms);
  return new Promise(res=>{
    const id=++bg.seq;
    bg.waiters.set(id,res);
    w.postMessage({cmd:'set',id,ms});
  });
}
/* Wait until an absolute deadline. Timers may fire late or early; we re-check the
   clock each time and never sleep past the deadline in one hop, so a throttled tab
   catches up the moment it is allowed to run. */
export async function bgSleep(ms,shouldStop){
  if(ms<=0)return;
  const deadline=Date.now()+ms;
  let overshoot=0;
  for(;;){
    const left=deadline-Date.now();
    if(left<=0||shouldStop?.())break;   // hops are ≤1s, so a stop request lands within a second
    const before=Date.now();
    await Promise.race([bgTimeout(Math.min(left,1000)),sleep(Math.min(left,1000))]);
    overshoot=Math.max(overshoot,(Date.now()-before)-Math.min(left,1000));
  }
  // A single hop that ran >5s late means the browser is throttling us hard.
  if(overshoot>5000&&!bg.warned&&queue.running){
    bg.warned=true;
    toast('ブラウザがタブを大幅に抑制しています。ウィンドウを表示状態にすると速度が戻ります','err');
  }
}
export function keepAliveOn(){
  const s=state.project?.settings;
  if(s&&s.bgKeepAlive===false)return;
  // silent-ish tone: inaudible in practice, but enough to mark the page as playing audio
  if(!bg.ctx){
    try{
      const Ctx=window.AudioContext||window.webkitAudioContext;
      if(Ctx){
        bg.ctx=new Ctx();
        bg.gain=bg.ctx.createGain();bg.gain.gain.value=0.0015;
        bg.osc=bg.ctx.createOscillator();bg.osc.type='sine';bg.osc.frequency.value=40;
        bg.osc.connect(bg.gain).connect(bg.ctx.destination);bg.osc.start();
      }
    }catch(_){}
  }
  bg.ctx?.resume?.().catch(()=>{});
  // A held Web Lock discourages the browser from freezing or discarding the tab.
  if(!bg.lock&&navigator.locks?.request){
    bg.lock=true;
    navigator.locks.request('nai-sprite-queue',()=>new Promise(rel=>{bg.lockRelease=rel;})).catch(()=>{bg.lock=false;});
  }
  requestWakeLock();
}
export function keepAliveOff(){
  try{bg.osc?.stop();}catch(_){}
  try{bg.ctx?.close();}catch(_){}
  bg.osc=bg.gain=null;bg.ctx=null;
  if(bg.lockRelease){bg.lockRelease();bg.lockRelease=null;}
  bg.lock=false;bg.warned=false;
  try{bg.wake?.release();}catch(_){}
  bg.wake=null;
}
export async function requestWakeLock(){
  // Keeps the screen (and on laptops, often the tab) awake. Only grantable while visible.
  if(!navigator.wakeLock?.request||document.visibilityState!=='visible')return;
  try{bg.wake=await navigator.wakeLock.request('screen');bg.wake.addEventListener('release',()=>{bg.wake=null;});}
  catch(_){}
}
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'){
    stopTitleFlash();
    if(queue.running){bg.ctx?.resume?.().catch(()=>{});requestWakeLock();}
  }
});
/* Let the user know when a queue they walked away from has finished.
   file:// pages have no real origin, so Notification permission can never
   stick there. Flash the tab title and play a short chime instead — both
   work without any permission prompt. */
export const BASE_TITLE=document.title;
export let titleFlash=null;
export function stopTitleFlash(){
  if(titleFlash){clearInterval(titleFlash);titleFlash=null;}
  document.title=BASE_TITLE;
}
export function notifyDone(n){
  if(document.visibilityState==='visible')return;
  stopTitleFlash();
  let on=false;
  titleFlash=setInterval(()=>{on=!on;document.title=on?`✅ ${n} 枚 完了 — ${BASE_TITLE}`:BASE_TITLE;},1000);
  doneChime();
}
export function doneChime(){
  if(state.project?.settings?.doneChime===false)return;
  try{
    const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return;
    const ctx=new Ctx();
    const g=ctx.createGain();g.gain.value=0.0001;g.connect(ctx.destination);
    const t=ctx.currentTime;
    g.gain.exponentialRampToValueAtTime(0.12,t+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001,t+0.85);
    [880,1320].forEach((f,i)=>{
      const o=ctx.createOscillator();o.type='sine';o.frequency.value=f;
      o.connect(g);o.start(t+i*0.16);o.stop(t+0.85);
    });
    setTimeout(()=>{try{ctx.close();}catch(_){}} ,1500);
  }catch(_){}
}
