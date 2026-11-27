import { matchFilter } from './expressions.js';
import { adoptImage, deleteImage, holdImage, imgURL } from './images.js';
import { addI2iFromBlob, addRefFromBlob } from './refs.js';
import { state } from './state.js';
import { askChoice, toast } from './ui.js';
import { $ } from './util.js';

/* ---- Lightbox ---- */
export const lb={list:[],idx:0,exprId:null};
export function lbBuildList(exprId){
  return state.images.filter(i=>i.exprId===exprId).filter(matchFilter)
    .sort((a,b)=>a.createdAt-b.createdAt).map(i=>i.id);
}
export function openLightbox(imageId){
  const rec=state.images.find(i=>i.id===imageId);if(!rec)return;
  lb.exprId=rec.exprId;
  lb.list=lbBuildList(rec.exprId);
  lb.idx=lb.list.indexOf(imageId);if(lb.idx<0)lb.idx=0;
  $('#lightbox').classList.add('show');renderLightbox();
}
/* Jump to the previous / next expression that has images under the current filter. */
export function lbGoExpr(dir){
  const p=state.project;if(!p)return;
  const exprs=p.expressions;
  if(exprs.length<=1){showWrap('ほかに表情がありません');return;}
  const cur=exprs.findIndex(e=>e.id===lb.exprId);
  if(cur<0)return;
  for(let step=1;step<=exprs.length;step++){
    const i=(cur+dir*step+exprs.length*step)%exprs.length;
    const ex=exprs[i];
    const list=lbBuildList(ex.id);
    if(!list.length)continue;                     // skip expressions with nothing to show
    const wrapped=dir>0?i<=cur:i>=cur;
    lb.exprId=ex.id;lb.list=list;lb.idx=0;
    renderLightbox();
    const pos=`${i+1}/${exprs.length}`;
    showWrap((wrapped?'↻ ':'')+`${ex.name}（${pos}・${list.length} 枚）`);
    return;
  }
  showWrap('ほかに表示できる表情がありません');
}
export function renderLightbox(){
  const id=lb.list[lb.idx];const rec=state.images.find(i=>i.id===id);
  if(!rec){closeLightbox();return;}
  const ex=state.project.expressions.find(e=>e.id===rec.exprId);
  const exIdx=state.project.expressions.findIndex(e=>e.id===rec.exprId);
  const exTotal=state.project.expressions.length;
  $('#lbImg').src=imgURL(rec);
  const frame=$('#lbFrame');
  frame.classList.toggle('adopted',!!rec.adopted);
  frame.classList.toggle('held',!!rec.held&&!rec.adopted);
  $('#lbState').textContent=rec.adopted?'★ 採用':(rec.held?'◆ 保留':'');
  let status='';if(rec.adopted)status=' ★採用';else if(rec.held)status=' ◆保留';
  const exLabel=exIdx>=0?`${ex.name}（表情 ${exIdx+1}/${exTotal}）`:(ex?ex.name:'?');
  const vtxt=rec.variantLabel?`　[${rec.variantLabel}]`:'';
  $('#lbMeta').textContent=`${exLabel}　画像 ${lb.idx+1}/${lb.list.length}　${rec.width}×${rec.height}${vtxt}${status}`;
  $('#lbAdopt').innerHTML=(rec.adopted?'★ 採用を取り消す':'★ 採用')+' <kbd>A</kbd>';
  $('#lbAdopt').classList.toggle('primary',!rec.adopted);
  $('#lbHold').innerHTML=(rec.held?'◆ 保留を解除':'◆ 保留')+' <kbd>S</kbd>';
}
export function closeLightbox(){$('#lightbox').classList.remove('show');}
$('#lbClose').onclick=closeLightbox;
export function showWrap(msg){
  const el=$('#lbWrap'),stage=document.querySelector('#lightbox .stage');
  el.textContent=msg;
  el.classList.remove('show');stage.classList.remove('wrapped');
  void el.offsetWidth; // restart the animation
  el.classList.add('show');stage.classList.add('wrapped');
  clearTimeout(showWrap._t);
  showWrap._t=setTimeout(()=>{el.classList.remove('show');stage.classList.remove('wrapped');},760);
}
export function lbGo(dir){
  if(lb.list.length<=1){
    if(lb.list.length===1)showWrap('この表情の候補は 1 枚だけです');
    return;
  }
  const next=(lb.idx+dir+lb.list.length)%lb.list.length;
  if(dir>0&&next===0)showWrap('↻ 最初の画像に戻りました');
  else if(dir<0&&next===lb.list.length-1)showWrap('↻ 最後の画像に移動しました');
  lb.idx=next;renderLightbox();
}
$('#lbPrev').onclick=()=>lbGo(-1);
$('#lbNext').onclick=()=>lbGo(1);
$('#lbExprPrev').onclick=()=>lbGoExpr(-1);
$('#lbExprNext').onclick=()=>lbGoExpr(1);
$('#lbAdopt').onclick=async()=>{const r=await adoptImage(lb.list[lb.idx]);renderLightbox();if(r==='cleared')toast('採用を取り消しました');};
$('#lbHold').onclick=async()=>{await holdImage(lb.list[lb.idx]);renderLightbox();};
$('#lbSeedCopy').onclick=()=>{const rec=state.images.find(i=>i.id===lb.list[lb.idx]);if(rec){navigator.clipboard?.writeText(String(rec.seed));toast('シード値をコピーしました: '+rec.seed,'ok');}};
$('#lbUseRef').onclick=()=>{const rec=state.images.find(i=>i.id===lb.list[lb.idx]);if(rec)addRefFromBlob(rec.blob,'precise');};
$('#lbUseI2i').onclick=()=>{const rec=state.images.find(i=>i.id===lb.list[lb.idx]);if(rec)addI2iFromBlob(rec.blob);};
$('#lbDelete').onclick=async()=>{
  const id=lb.list[lb.idx];
  const rec=state.images.find(i=>i.id===id);if(!rec)return;
  // Deletion is permanent, so ask first. Focus lands on 削除, so D → Enter stays quick.
  const mark=rec.adopted?'（採用済みの画像です）':rec.held?'（保留中の画像です）':'';
  const ok=await askChoice('画像を削除',`<p>この画像を削除します${mark}。削除した画像は元に戻せません。</p>`,[
    {value:null,label:'キャンセル'},
    {value:'del',label:'削除',cls:'danger'}
  ]);
  if(ok!=='del'||lb.list[lb.idx]!==id)return;
  await deleteImage(id);lb.list.splice(lb.idx,1);
  if(!lb.list.length){
    // this expression is now empty — carry on with the next one if there is one
    const others=state.project.expressions.some(e=>e.id!==lb.exprId&&lbBuildList(e.id).length);
    if(others)lbGoExpr(1); else closeLightbox();
    return;
  }
  lb.idx=Math.min(lb.idx,lb.list.length-1);renderLightbox();
};
document.addEventListener('keydown',e=>{
  if(!$('#lightbox').classList.contains('show'))return;
  // a dialog on top (e.g. the delete confirmation) owns the keyboard
  if(document.querySelector('.modal-backdrop.show'))return;
  if(e.ctrlKey||e.metaKey||e.altKey)return;
  const k=e.key.toLowerCase();
  const hit=k=>{e.preventDefault();};
  switch(k){
    case 'escape': closeLightbox(); break;
    case 'arrowleft': hit(); $('#lbPrev').click(); break;
    case 'arrowright': hit(); $('#lbNext').click(); break;
    case 'arrowup': case 'q': hit(); lbGoExpr(-1); break;   // 前の表情へ
    case 'arrowdown': case 'e': hit(); lbGoExpr(1); break;  // 次の表情へ
    case 'a': case 'enter': case ' ':
      hit(); $('#lbAdopt').click(); break;          // 採用
    case 's': case 'h':
      hit(); $('#lbHold').click(); break;           // 保留
    case 'd': case 'delete':                          // Backspace is too easy to hit by mistake
      hit(); $('#lbDelete').click(); break;         // 削除
    case 'c':
      hit(); $('#lbSeedCopy').click(); break;       // シードをコピー
  }
});
$('#lightbox').addEventListener('click',e=>{if(e.target.id==='lightbox'||e.target.classList.contains('stage'))closeLightbox();});
