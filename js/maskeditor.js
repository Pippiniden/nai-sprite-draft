import { renderAllExprRefToggles } from './expressions.js';
import { renderRefCards } from './refs.js';
import { updateAnlasWarn } from './settings.js';
import { saveProject, state } from './state.js';
import { toast } from './ui.js';
import { $, refImgURL } from './util.js';

/* ---- Inpaint mask editor ----
   Paint over an img2img source to mark what should be redrawn. The mask canvas is kept
   at the source image's own resolution; it is cropped and snapped to the generation
   size only when a request is built (see fitMaskToSizeBase64).
   Painted pixels are drawn in a tint colour for display and turned into opaque white
   on save; everything else stays transparent. */
const TINT='rgb(255,64,110)';
const UNDO_MAX=30;
const ed={ref:null,opts:{},tool:'brush',size:48,undo:[],drawing:false,last:null,erasing:false};
const cv=$('#maskCanvas'),ctx=cv.getContext('2d',{willReadFrequently:true});
const img=$('#maskImage'),cursor=$('#maskCursor'),stage=$('#maskStage');

export function openMaskEditor(ref,opts={}){
  ed.ref=ref;ed.opts=opts;ed.undo=[];
  img.onload=()=>{
    cv.width=img.naturalWidth;cv.height=img.naturalHeight;
    ctx.clearRect(0,0,cv.width,cv.height);
    // default brush ≈ 1/16 of the short side, which is about one facial feature
    ed.size=Math.max(8,Math.round(Math.min(cv.width,cv.height)/16));
    syncSize();
    if(ref.mask){
      const m=new Image();
      m.onload=()=>{ctx.drawImage(m,0,0,cv.width,cv.height);tintMask();};
      m.src='data:image/png;base64,'+ref.mask;
    }
  };
  img.src=refImgURL(ref);
  setTool('brush');
  $('#maskModal').classList.add('show');
}
function closeEditor(saved){
  $('#maskModal').classList.remove('show');
  cursor.style.display='none';
  const ref=ed.ref;ed.ref=null;
  // an image registered just to inpaint it is dropped again if no mask came of it
  if(ed.opts.discardIfEmpty&&!ref.mask){
    const list=state.project?.i2iImages;const i=list?list.indexOf(ref):-1;
    if(i>=0){list.splice(i,1);saveProject();renderRefCards();updateAnlasWarn();renderAllExprRefToggles();}
  }else if(saved){
    toast('マスクを保存しました。この元画像を使う表情はインペイントで生成されます','ok');
  }
}
/* Recolour every painted pixel to the tint (loaded masks are white). */
function tintMask(){
  const d=ctx.getImageData(0,0,cv.width,cv.height),a=d.data;
  for(let i=0;i<a.length;i+=4)if(a[i+3]){a[i]=255;a[i+1]=64;a[i+2]=110;a[i+3]=255;}
  ctx.putImageData(d,0,0);
}
function maskIsEmpty(){
  const a=ctx.getImageData(0,0,cv.width,cv.height).data;
  for(let i=3;i<a.length;i+=4)if(a[i])return false;
  return true;
}
function exportMask(){
  const out=document.createElement('canvas');out.width=cv.width;out.height=cv.height;
  const o=out.getContext('2d');
  const d=ctx.getImageData(0,0,cv.width,cv.height),a=d.data;
  for(let i=0;i<a.length;i+=4){if(a[i+3]>16){a[i]=a[i+1]=a[i+2]=a[i+3]=255;}else{a[i]=a[i+1]=a[i+2]=a[i+3]=0;}}
  o.putImageData(d,0,0);
  return out.toDataURL('image/png').split(',')[1];
}
function save(){
  const ref=ed.ref;if(!ref)return;
  if(maskIsEmpty()){
    if(ref.mask){delete ref.mask;toast('マスクが空なので解除しました（通常の img2img に戻ります）');}
  }else{
    ref.mask=exportMask();
    if(ref.inpaintStrength===undefined)ref.inpaintStrength=1;
  }
  ref.maskRev=(ref.maskRev||0)+1;
  saveProject();renderRefCards();renderAllExprRefToggles();
  closeEditor(!!ref.mask);
}

/* ---- tools ---- */
function setTool(t){
  ed.tool=t;
  $('#maskBrush').classList.toggle('on',t==='brush');
  $('#maskEraser').classList.toggle('on',t==='eraser');
}
function syncSize(){
  ed.size=Math.max(2,Math.min(512,Math.round(ed.size)));
  $('#maskSize').value=ed.size;$('#maskSizeVal').textContent=ed.size+'px';
}
function pushUndo(){
  ed.undo.push(ctx.getImageData(0,0,cv.width,cv.height));
  if(ed.undo.length>UNDO_MAX)ed.undo.shift();
}
function undo(){const d=ed.undo.pop();if(d)ctx.putImageData(d,0,0);}
function invert(){
  pushUndo();
  const d=ctx.getImageData(0,0,cv.width,cv.height),a=d.data;
  for(let i=0;i<a.length;i+=4){const on=a[i+3]>16;a[i]=255;a[i+1]=64;a[i+2]=110;a[i+3]=on?0:255;}
  ctx.putImageData(d,0,0);
}
function clearAll(){pushUndo();ctx.clearRect(0,0,cv.width,cv.height);}

/* ---- painting ---- */
const scaleOf=()=>cv.width/cv.getBoundingClientRect().width;
function toImage(e){
  const r=cv.getBoundingClientRect(),s=cv.width/r.width;
  return{x:(e.clientX-r.left)*s,y:(e.clientY-r.top)*s};
}
function stroke(a,b){
  ctx.save();
  ctx.globalCompositeOperation=ed.erasing?'destination-out':'source-over';
  ctx.strokeStyle=TINT;ctx.fillStyle=TINT;ctx.lineWidth=ed.size;ctx.lineCap='round';ctx.lineJoin='round';
  if(a.x===b.x&&a.y===b.y){ctx.beginPath();ctx.arc(a.x,a.y,ed.size/2,0,Math.PI*2);ctx.fill();}
  else{ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
  ctx.restore();
}
function moveCursor(e){
  const sr=stage.getBoundingClientRect();
  const d=ed.size/scaleOf();
  cursor.style.display='block';
  cursor.style.width=cursor.style.height=d+'px';
  cursor.style.left=(e.clientX-sr.left-d/2)+'px';
  cursor.style.top=(e.clientY-sr.top-d/2)+'px';
  cursor.classList.toggle('erase',ed.tool==='eraser'||ed.erasing);
}
cv.addEventListener('pointerdown',e=>{
  if(e.button!==0&&e.button!==2)return;
  e.preventDefault();cv.setPointerCapture(e.pointerId);
  pushUndo();
  // right-drag erases without switching tools
  ed.erasing=e.button===2||ed.tool==='eraser';
  ed.drawing=true;ed.last=toImage(e);stroke(ed.last,ed.last);moveCursor(e);
});
cv.addEventListener('pointermove',e=>{
  moveCursor(e);
  if(!ed.drawing)return;
  const p=toImage(e);stroke(ed.last,p);ed.last=p;
});
const endStroke=()=>{ed.drawing=false;ed.erasing=false;};
cv.addEventListener('pointerup',endStroke);
cv.addEventListener('pointercancel',endStroke);
cv.addEventListener('pointerleave',()=>{if(!ed.drawing)cursor.style.display='none';});
cv.addEventListener('contextmenu',e=>e.preventDefault());
cv.addEventListener('wheel',e=>{
  if(!e.ctrlKey&&!e.altKey)return;  // plain wheel keeps scrolling the dialog
  e.preventDefault();ed.size*=e.deltaY<0?1.15:1/1.15;syncSize();moveCursor(e);
},{passive:false});

$('#maskBrush').onclick=()=>setTool('brush');
$('#maskEraser').onclick=()=>setTool('eraser');
$('#maskSize').addEventListener('input',e=>{ed.size=+e.target.value;syncSize();});
$('#maskUndo').onclick=undo;
$('#maskInvert').onclick=invert;
$('#maskClear').onclick=clearAll;
$('#maskSave').onclick=save;
$('#maskCancel').onclick=()=>closeEditor(false);

// The editor owns the keyboard while it is open (capture phase, so the lightbox and
// the page-wide shortcuts never see these keys).
document.addEventListener('keydown',e=>{
  if(!$('#maskModal').classList.contains('show'))return;
  if(e.target.closest?.('input,textarea')&&e.target.type!=='range')return;
  const k=e.key.toLowerCase(),mod=e.ctrlKey||e.metaKey;
  let used=true;
  if(mod&&k==='z')undo();
  else if(mod&&k==='enter')save();
  else if(mod)used=false;
  else if(k==='escape')closeEditor(false);
  else if(k==='b')setTool('brush');
  else if(k==='e')setTool('eraser');
  else if(k==='[')ed.size/=1.2,syncSize();
  else if(k===']')ed.size*=1.2,syncSize();
  else if(k==='i')invert();
  else used=false;
  if(used){e.preventDefault();e.stopPropagation();}
},true);
