import { renderAllExprRefToggles } from './expressions.js';
import { renderRefCards } from './refs.js';
import { updateAnlasWarn } from './settings.js';
import { saveProject, state } from './state.js';
import { toast } from './ui.js';
import { $, b64url, refImgURL, uid } from './util.js';

/* ---- Image editor for an img2img source ----
   Two modes over the same image:
     paint : draw colour on paint layers above the image (e.g. light blue for tears).
             Layers are saved apart from the source image (ref.paintLayers) and only
             flattened when a request is built, so they stay editable, can be hidden,
             and the original is never touched.
     mask  : mark what an inpaint should redraw. Kept at the source image's own
             resolution and cropped / snapped to the generation size only when a
             request is built (see fitMaskToSizeBase64).
   Every canvas is at the image's natural size. Stacking order in the stage:
   image, paint layers (bottom → top, with the stroke buffer right above the active
   one, so a stroke at partial opacity does not darken where it overlaps itself), mask. */
const TINT='rgb(255,64,110)';
const UNDO_MAX=30;
const SWATCHES=['#9fd8ff','#5aaeea','#ffffff','#ffb3c1','#ff6f91','#ffe08a','#3a2a2a','#000000'];
const ed={ref:null,opts:{},mode:'paint',tool:'brush',size:{paint:16,mask:48},color:'#9fd8ff',alpha:0.7,soft:0.3,
  layers:[],active:0,undo:[],drawing:false,last:null,erasing:false,changed:false};
const stage=$('#maskStage'),img=$('#maskImage'),cursor=$('#maskCursor');
const strokeCv=$('#strokeCanvas'),sctx=strokeCv.getContext('2d');
const cv=$('#maskCanvas'),ctx=cv.getContext('2d',{willReadFrequently:true});
const W=()=>cv.width,H=()=>cv.height;
const activeLayer=()=>ed.layers[ed.active];

export function openMaskEditor(ref,opts={}){
  ed.ref=ref;ed.opts=opts;ed.undo=[];ed.changed=false;
  for(const l of ed.layers)l.canvas.remove();
  ed.layers=[];ed.active=0;
  img.onload=async()=>{
    const w=img.naturalWidth,h=img.naturalHeight;
    for(const c of [strokeCv,cv]){c.width=w;c.height=h;}
    ctx.clearRect(0,0,w,h);
    const short=Math.min(w,h);
    ed.size={paint:Math.max(4,Math.round(short/48)),mask:Math.max(8,Math.round(short/16))};
    for(const l of ref.paintLayers||[]){
      const layer=makeLayer(l);
      if(l.base64)await new Promise(res=>{const i=new Image();i.onload=()=>{layer.ctx.drawImage(i,0,0,w,h);res();};i.onerror=res;i.src=b64url(l.base64);});
    }
    if(!ed.layers.length)makeLayer();
    ed.active=ed.layers.length-1;
    restack();renderLayers();
    setMode(opts.mode||'paint');
    if(ref.mask){
      const m=new Image();
      m.onload=()=>{ctx.drawImage(m,0,0,w,h);tintMask();};
      m.src=b64url(ref.mask);
    }
  };
  img.src=refImgURL(ref);
  $('#paintToMask').checked=!!opts.paintToMask;
  setTool('brush');
  $('#maskModal').classList.add('show');
}
function closeEditor(result){
  $('#maskModal').classList.remove('show');
  cursor.style.display='none';
  const ref=ed.ref;ed.ref=null;
  // an image registered just to edit it is dropped again if nothing came of it
  if(ed.opts.discardIfEmpty&&!result){
    const list=state.project?.i2iImages;const i=list?list.indexOf(ref):-1;
    if(i>=0){list.splice(i,1);saveProject();renderRefCards();updateAnlasWarn();renderAllExprRefToggles();}
  }else if(result){
    toast(result,'ok');
  }
}

/* ---- layers ---- */
function makeLayer(src={}){
  const canvas=document.createElement('canvas');canvas.width=W()||img.naturalWidth;canvas.height=H()||img.naturalHeight;
  canvas.className='paint-layer-cv';
  const layer={id:src.id||uid(),name:src.name||`レイヤー${ed.layers.length+1}`,visible:src.visible!==false,opacity:src.opacity??1,
    canvas,ctx:canvas.getContext('2d',{willReadFrequently:true})};
  ed.layers.push(layer);
  return layer;
}
/* Put the layer canvases in order, the stroke buffer just above the active one. */
function restack(){
  for(const l of ed.layers){
    stage.insertBefore(l.canvas,cv);
    l.canvas.style.display=l.visible?'':'none';
    l.canvas.style.opacity=l.opacity;
  }
  const a=activeLayer();
  stage.insertBefore(strokeCv,a?a.canvas.nextSibling:cv);
}
function renderLayers(){
  const list=$('#layerList');list.innerHTML='';
  // top layer first, like most paint tools
  [...ed.layers].reverse().forEach(l=>{
    const i=ed.layers.indexOf(l);
    const b=document.createElement('button');b.type='button';
    b.className='layer'+(i===ed.active?' on':'')+(l.visible?'':' hidden-layer');
    b.innerHTML=`<span class="eye" title="表示／非表示（非表示のレイヤーは送信されません）">${l.visible?'👁':'◌'}</span><span class="nm"></span>`;
    b.querySelector('.nm').textContent=l.name;
    b.title='クリックで選択／ダブルクリックで名前を変更';
    b.onclick=e=>{
      if(e.target.classList.contains('eye')){l.visible=!l.visible;ed.changed=true;}
      else{ed.active=i;setMode('paint');}
      restack();renderLayers();
    };
    b.ondblclick=e=>{if(e.target.classList.contains('eye'))return;const n=prompt('レイヤー名',l.name);if(n&&n.trim()){l.name=n.trim();ed.changed=true;renderLayers();}};
    list.appendChild(b);
  });
  const a=activeLayer();
  const pct=Math.round((a?.opacity??1)*100);
  $('#layerOpacity').value=pct;$('#layerOpacityVal').textContent=pct+'%';
  $('#layerDel').disabled=ed.layers.length<=1&&layerIsEmpty(a.ctx);
}
function addLayer(){
  const l=makeLayer();ed.layers.pop();
  ed.layers.splice(ed.active+1,0,l);ed.active++;
  // undo snapshots refer to layers by id, so they stay valid
  ed.changed=true;setMode('paint');restack();renderLayers();
}
function deleteLayer(){
  const a=activeLayer();if(!a)return;
  if(!layerIsEmpty(a.ctx)&&!confirm(`「${a.name}」を削除します。よろしいですか？`))return;
  a.canvas.remove();ed.layers.splice(ed.active,1);
  if(!ed.layers.length)makeLayer();
  ed.active=Math.min(ed.active,ed.layers.length-1);
  ed.changed=true;restack();renderLayers();
}

/* ---- mask helpers ---- */
function tintMask(){
  const d=ctx.getImageData(0,0,W(),H()),a=d.data;
  for(let i=0;i<a.length;i+=4)if(a[i+3]){a[i]=255;a[i+1]=64;a[i+2]=110;a[i+3]=255;}
  ctx.putImageData(d,0,0);
}
function layerIsEmpty(c2d){
  const a=c2d.getImageData(0,0,c2d.canvas.width,c2d.canvas.height).data;
  for(let i=3;i<a.length;i+=4)if(a[i])return false;
  return true;
}
function exportMask(){
  const out=document.createElement('canvas');out.width=W();out.height=H();
  const d=ctx.getImageData(0,0,W(),H()),a=d.data;
  for(let i=0;i<a.length;i+=4){if(a[i+3]>16){a[i]=a[i+1]=a[i+2]=a[i+3]=255;}else{a[i]=a[i+1]=a[i+2]=a[i+3]=0;}}
  out.getContext('2d').putImageData(d,0,0);
  return out.toDataURL('image/png').split(',')[1];
}
function save(){
  const ref=ed.ref;if(!ref)return;
  const before=(ref.paintLayers||[]).length;
  const kept=ed.layers.filter(l=>!layerIsEmpty(l.ctx));
  const layersChanged=ed.changed||kept.length!==before;
  if(layersChanged){
    if(kept.length)ref.paintLayers=kept.map(l=>({id:l.id,name:l.name,visible:l.visible,opacity:l.opacity,base64:l.canvas.toDataURL('image/png').split(',')[1]}));
    else delete ref.paintLayers;
    ref.paintRev=(ref.paintRev||0)+1;
  }
  const hadMask=!!ref.mask;
  if(layerIsEmpty(ctx))delete ref.mask;
  else{ref.mask=exportMask();if(ref.inpaintStrength===undefined)ref.inpaintStrength=1;}
  ref.maskRev=(ref.maskRev||0)+1;
  saveProject();renderRefCards();renderAllExprRefToggles();
  const painted=!!ref.paintLayers?.length;
  let msg='';
  if(ref.mask)msg=painted?'ペイントとマスクを保存しました（インペイントで生成されます）':'マスクを保存しました（インペイントで生成されます）';
  else if(painted)msg='ペイントを保存しました（img2img の元画像に重ねて送信されます）';
  else if(hadMask)msg='マスクが空なので解除しました（通常の img2img に戻ります）';
  else if(layersChanged&&before)msg='ペイントレイヤーをすべて外しました';
  closeEditor(msg);
}

/* ---- modes & tools ---- */
function setMode(m){
  ed.mode=m;
  $('#modePaint').classList.toggle('on',m==='paint');
  $('#modeMask').classList.toggle('on',m==='mask');
  stage.dataset.mode=m;
  $('#paintTools').hidden=m!=='paint';
  $('#layerBar').hidden=m!=='paint';
  $('#maskOnlyTools').hidden=m!=='mask';
  $('#maskModeHint').textContent=m==='paint'
    ?'選択中のレイヤーに色を描き込みます（元画像は変わりません）。Alt+クリックで色を拾えます。そのまま img2img に使うか、マスクと組み合わせてインペイントできます。'
    :'描き直したい部分を塗ってください。塗った部分だけが新しく生成され、残りは元画像のまま残ります。送信時は 8px 単位に丸められます。';
  syncSize();
}
function setTool(t){
  ed.tool=t;
  $('#maskBrush').classList.toggle('on',t==='brush');
  $('#maskEraser').classList.toggle('on',t==='eraser');
}
function syncSize(){
  const s=ed.size[ed.mode]=Math.max(1,Math.min(512,Math.round(ed.size[ed.mode])));
  $('#maskSize').value=s;$('#maskSizeVal').textContent=s+'px';
}
function setColor(c){
  ed.color=c;$('#paintColor').value=c;
  for(const b of document.querySelectorAll('#paintSwatches button'))b.classList.toggle('on',b.dataset.c===c);
}
function pushUndo(){
  const a=activeLayer();
  ed.undo.push({lid:a.id,p:a.ctx.getImageData(0,0,W(),H()),m:ctx.getImageData(0,0,W(),H())});
  if(ed.undo.length>UNDO_MAX)ed.undo.shift();
}
function undo(){
  const d=ed.undo.pop();if(!d)return;
  const l=ed.layers.find(x=>x.id===d.lid);
  if(l)l.ctx.putImageData(d.p,0,0);
  ctx.putImageData(d.m,0,0);
  renderLayers();
}
function invert(){
  pushUndo();
  const d=ctx.getImageData(0,0,W(),H()),a=d.data;
  for(let i=0;i<a.length;i+=4){const on=a[i+3]>16;a[i]=255;a[i+1]=64;a[i+2]=110;a[i+3]=on?0:255;}
  ctx.putImageData(d,0,0);
}
function clearLayer(){
  pushUndo();
  if(ed.mode==='paint'){activeLayer().ctx.clearRect(0,0,W(),H());ed.changed=true;renderLayers();}
  else ctx.clearRect(0,0,W(),H());
}

/* ---- drawing ---- */
const scaleOf=()=>cv.width/cv.getBoundingClientRect().width;
function toImage(e){
  const r=cv.getBoundingClientRect(),s=cv.width/r.width;
  return{x:(e.clientX-r.left)*s,y:(e.clientY-r.top)*s};
}
function line(c2d,a,b,size,color){
  c2d.strokeStyle=color;c2d.fillStyle=color;c2d.lineWidth=size;c2d.lineCap='round';c2d.lineJoin='round';
  if(a.x===b.x&&a.y===b.y){c2d.beginPath();c2d.arc(a.x,a.y,size/2,0,Math.PI*2);c2d.fill();}
  else{c2d.beginPath();c2d.moveTo(a.x,a.y);c2d.lineTo(b.x,b.y);c2d.stroke();}
}
function strokeSeg(a,b){
  const size=ed.size[ed.mode];
  if(ed.mode==='mask'){
    ctx.save();ctx.globalCompositeOperation=ed.erasing?'destination-out':'source-over';
    line(ctx,a,b,size,TINT);ctx.restore();
  }else if(ed.erasing){
    const p=activeLayer().ctx;
    p.save();p.globalCompositeOperation='destination-out';line(p,a,b,size,'#000');p.restore();
    if($('#paintToMask').checked){ctx.save();ctx.globalCompositeOperation='destination-out';line(ctx,a,b,size,'#000');ctx.restore();}
  }else{
    // full opacity into the stroke buffer; opacity and softness apply once on release
    line(sctx,a,b,size,ed.color);
  }
}
function commitStroke(){
  if(ed.mode!=='paint'||ed.erasing)return;
  const blur=ed.soft*ed.size.paint*0.35;
  const p=activeLayer().ctx;
  p.save();p.globalAlpha=ed.alpha;if(blur>0.5)p.filter=`blur(${blur}px)`;
  p.drawImage(strokeCv,0,0);p.restore();
  if($('#paintToMask').checked){
    // mask the stroke plus a margin, so the inpaint can blend the edge
    ctx.save();ctx.filter=`blur(${Math.max(2,blur)}px)`;ctx.drawImage(strokeCv,0,0);ctx.restore();tintMask();
  }
  sctx.clearRect(0,0,W(),H());
  strokeCv.style.opacity='';strokeCv.style.filter='';
}
function pickColor(e){
  const p=toImage(e);
  const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d');
  const dx=-Math.floor(p.x),dy=-Math.floor(p.y);
  x.drawImage(img,dx,dy);
  for(const l of ed.layers)if(l.visible){x.globalAlpha=l.opacity;x.drawImage(l.canvas,dx,dy);}
  const[r,g,b]=x.getImageData(0,0,1,1).data;
  setColor('#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join(''));
}
function moveCursor(e){
  const sr=stage.getBoundingClientRect();
  const d=ed.size[ed.mode]/scaleOf();
  cursor.style.display='block';
  cursor.style.width=cursor.style.height=d+'px';
  cursor.style.left=(e.clientX-sr.left-d/2)+'px';
  cursor.style.top=(e.clientY-sr.top-d/2)+'px';
  const erase=ed.tool==='eraser'||ed.erasing;
  cursor.classList.toggle('erase',erase);
  cursor.style.background=ed.mode==='paint'&&!erase?ed.color+'66':'';
  cursor.classList.toggle('pick',e.altKey&&ed.mode==='paint');
}
cv.addEventListener('pointerdown',e=>{
  if(e.button!==0&&e.button!==2)return;
  e.preventDefault();
  if(e.altKey&&ed.mode==='paint'&&e.button===0){pickColor(e);return;}
  if(ed.mode==='paint'&&!activeLayer().visible){toast('非表示のレイヤーには描けません。👁 で表示してください','err');return;}
  cv.setPointerCapture(e.pointerId);
  pushUndo();
  ed.erasing=e.button===2||ed.tool==='eraser';
  if(ed.mode==='paint'){
    ed.changed=true;
    if(!ed.erasing){
      // preview the stroke the way it will land: layer opacity × brush opacity
      strokeCv.style.opacity=ed.alpha*activeLayer().opacity;
      const blur=ed.soft*ed.size.paint*0.35/scaleOf();strokeCv.style.filter=blur>0.5?`blur(${blur}px)`:'';
    }
  }
  ed.drawing=true;ed.last=toImage(e);strokeSeg(ed.last,ed.last);moveCursor(e);
});
cv.addEventListener('pointermove',e=>{
  moveCursor(e);
  if(!ed.drawing)return;
  const p=toImage(e);strokeSeg(ed.last,p);ed.last=p;
});
const endStroke=()=>{if(!ed.drawing)return;commitStroke();ed.drawing=false;ed.erasing=false;renderLayers();};
cv.addEventListener('pointerup',endStroke);
cv.addEventListener('pointercancel',endStroke);
cv.addEventListener('pointerleave',()=>{if(!ed.drawing)cursor.style.display='none';});
cv.addEventListener('contextmenu',e=>e.preventDefault());
cv.addEventListener('wheel',e=>{
  if(!e.ctrlKey&&!e.altKey)return;  // plain wheel keeps scrolling the dialog
  e.preventDefault();ed.size[ed.mode]*=e.deltaY<0?1.15:1/1.15;syncSize();moveCursor(e);
},{passive:false});

/* ---- controls ---- */
const sw=$('#paintSwatches');
for(const c of SWATCHES){const b=document.createElement('button');b.type='button';b.dataset.c=c;b.style.background=c;b.title=c;b.onclick=()=>setColor(c);sw.appendChild(b);}
$('#paintColor').addEventListener('input',e=>setColor(e.target.value));
$('#paintAlpha').addEventListener('input',e=>{ed.alpha=+e.target.value/100;$('#paintAlphaVal').textContent=e.target.value+'%';});
$('#paintSoft').addEventListener('input',e=>{ed.soft=+e.target.value/100;$('#paintSoftVal').textContent=e.target.value+'%';});
$('#layerOpacity').addEventListener('input',e=>{const a=activeLayer();a.opacity=+e.target.value/100;a.canvas.style.opacity=a.opacity;$('#layerOpacityVal').textContent=e.target.value+'%';ed.changed=true;});
$('#layerAdd').onclick=addLayer;
$('#layerDel').onclick=deleteLayer;
$('#modePaint').onclick=()=>setMode('paint');
$('#modeMask').onclick=()=>setMode('mask');
$('#maskBrush').onclick=()=>setTool('brush');
$('#maskEraser').onclick=()=>setTool('eraser');
$('#maskSize').addEventListener('input',e=>{ed.size[ed.mode]=+e.target.value;syncSize();});
$('#maskUndo').onclick=undo;
$('#maskInvert').onclick=invert;
$('#maskClear').onclick=clearLayer;
$('#maskSave').onclick=save;
$('#maskCancel').onclick=()=>closeEditor('');
setColor(ed.color);

// The editor owns the keyboard while it is open (capture phase, so the lightbox and
// the page-wide shortcuts never see these keys).
document.addEventListener('keydown',e=>{
  if(!$('#maskModal').classList.contains('show'))return;
  if(e.target.closest?.('input,textarea')&&e.target.type!=='range'&&e.target.type!=='checkbox')return;
  const k=e.key.toLowerCase(),mod=e.ctrlKey||e.metaKey;
  let used=true;
  if(mod&&k==='z')undo();
  else if(mod&&k==='enter')save();
  else if(mod)used=false;
  else if(k==='escape')closeEditor('');
  else if(k==='b')setTool('brush');
  else if(k==='e')setTool('eraser');
  else if(k==='p')setMode('paint');
  else if(k==='m')setMode('mask');
  else if(k==='[')ed.size[ed.mode]/=1.2,syncSize();
  else if(k===']')ed.size[ed.mode]*=1.2,syncSize();
  else if(k==='i'&&ed.mode==='mask')invert();
  else used=false;
  if(used){e.preventDefault();e.stopPropagation();}
},true);
