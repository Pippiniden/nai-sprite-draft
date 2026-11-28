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
const RECENT_KEY='nsd.paintRecent',RECENT_MAX=10;
const ZOOM_MIN=0.05,ZOOM_MAX=16;
const ed={ref:null,opts:{},mode:'paint',tool:'brush',size:{paint:16,mask:48},color:'#9fd8ff',alpha:0.7,soft:0.3,
  layers:[],active:0,undo:[],redo:[],drawing:false,last:null,lastEnd:{},erasing:false,changed:false,lasso:null,picking:false,
  recent:loadRecent(),
  // view: the stage is laid out at the image's natural size and placed with translate + scale
  zoom:1,tx:0,ty:0,fit:true,pan:null,space:false};
const view=$('#maskView'),stage=$('#maskStage'),img=$('#maskImage'),cursor=$('#maskCursor');
const strokeCv=$('#strokeCanvas'),sctx=strokeCv.getContext('2d');
const cv=$('#maskCanvas'),ctx=cv.getContext('2d',{willReadFrequently:true});
const W=()=>cv.width,H=()=>cv.height;
const activeLayer=()=>ed.layers[ed.active];

export function openMaskEditor(ref,opts={}){
  // drawing does not move focus, so drop it here or a field behind the dialog keeps the shortcuts
  document.activeElement?.blur?.();
  ed.ref=ref;ed.opts=opts;ed.undo=[];ed.redo=[];ed.changed=false;ed.lastEnd={};ed.lasso=null;
  for(const l of ed.layers)l.canvas.remove();
  ed.layers=[];ed.active=0;
  img.onload=async()=>{
    const w=img.naturalWidth,h=img.naturalHeight;
    for(const c of [strokeCv,cv]){c.width=w;c.height=h;}
    stage.style.width=w+'px';stage.style.height=h+'px';
    requestAnimationFrame(fitView);
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
  cursor.style.display='none';ed.space=false;ed.pan=null;view.classList.remove('can-pan','panning');
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
  if(m!=='paint'&&ed.tool==='picker')setTool('brush');
  $('#maskModeHint').textContent=m==='paint'
    ?'選択中のレイヤーに色を描き込みます（元画像は変わりません）。スポイト（I）か Alt+クリックで色を拾えます。そのまま img2img に使うか、マスクと組み合わせてインペイントできます。'
    :'描き直したい部分を塗ってください。塗った部分だけが新しく生成され、残りは元画像のまま残ります。送信時は 8px 単位に丸められます。';
  syncSize();
}
function setTool(t){
  if(t==='picker'&&ed.mode!=='paint')return;
  ed.tool=t;
  $('#maskBrush').classList.toggle('on',t==='brush');
  $('#maskEraser').classList.toggle('on',t==='eraser');
  $('#maskLasso').classList.toggle('on',t==='lasso');
  $('#paintPicker').classList.toggle('on',t==='picker');
}
function syncSize(){
  const s=ed.size[ed.mode]=Math.max(1,Math.min(512,Math.round(ed.size[ed.mode])));
  $('#maskSize').value=s;$('#maskSizeVal').textContent=s+'px';
}
function setColor(c){
  ed.color=c;$('#paintColor').value=c;
  for(const b of document.querySelectorAll('#paintSwatches button,#paintRecent button'))b.classList.toggle('on',b.dataset.c===c);
}
const snapshot=l=>({lid:l.id,p:l.ctx.getImageData(0,0,W(),H()),m:ctx.getImageData(0,0,W(),H())});
function pushUndo(){
  ed.undo.push(snapshot(activeLayer()));
  if(ed.undo.length>UNDO_MAX)ed.undo.shift();
  ed.redo=[];
}
/* Restore a snapshot from one stack, saving the current state of the same layer on the other. */
function swapHistory(from,to){
  const d=from.pop();if(!d)return;
  const l=ed.layers.find(x=>x.id===d.lid);
  to.push(l?snapshot(l):{lid:d.lid,p:d.p,m:ctx.getImageData(0,0,W(),H())});
  if(l){l.ctx.putImageData(d.p,0,0);ed.changed=true;}
  ctx.putImageData(d.m,0,0);
  renderLayers();
}
const undo=()=>swapHistory(ed.undo,ed.redo);
const redo=()=>swapHistory(ed.redo,ed.undo);
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

/* ---- view (zoom & pan) ---- */
function applyView(){
  stage.style.transform=`translate(${ed.tx}px,${ed.ty}px) scale(${ed.zoom})`;
  stage.classList.toggle('pixel',ed.zoom>=2);
  $('#zoomVal').textContent=Math.round(ed.zoom*100)+'%';
}
/* Fit the whole image in the view (small images are enlarged, up to 400%). */
function fitView(){
  const vw=view.clientWidth,vh=view.clientHeight,w=W(),h=H();
  if(!vw||!vh||!w||!h)return;
  ed.zoom=Math.min(vw/w,vh/h,4)*0.98;
  ed.tx=(vw-w*ed.zoom)/2;ed.ty=(vh-h*ed.zoom)/2;ed.fit=true;
  applyView();
}
/* Zoom to z keeping the view point (vx,vy) — default: the view centre — over the same image pixel. */
function zoomTo(z,vx,vy){
  z=Math.max(ZOOM_MIN,Math.min(ZOOM_MAX,z));
  if(vx===undefined){vx=view.clientWidth/2;vy=view.clientHeight/2;}
  ed.tx=vx-(vx-ed.tx)*z/ed.zoom;ed.ty=vy-(vy-ed.ty)*z/ed.zoom;ed.zoom=z;ed.fit=false;
  clampPan();applyView();
}
// zoom steps that land on round numbers (…, 50%, 100%, 200%, …)
const ZOOM_STEPS=[0.05,0.0625,0.083,0.1,0.125,0.167,0.25,0.333,0.5,0.667,0.75,1,1.5,2,3,4,6,8,12,16];
function zoomStep(dir,vx,vy){
  const z=ed.zoom;
  const next=dir>0?ZOOM_STEPS.find(s=>s>z*1.01):[...ZOOM_STEPS].reverse().find(s=>s<z/1.01);
  zoomTo(next??z,vx,vy);
}
/* Keep at least a strip of the image on screen. */
function clampPan(){
  const vw=view.clientWidth,vh=view.clientHeight,w=W()*ed.zoom,h=H()*ed.zoom,m=48;
  ed.tx=Math.min(vw-m,Math.max(m-w,ed.tx));ed.ty=Math.min(vh-m,Math.max(m-h,ed.ty));
}
const viewPoint=e=>{const r=view.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};
function startPan(e){
  e.preventDefault();e.stopPropagation();
  ed.pan={x:e.clientX,y:e.clientY,tx:ed.tx,ty:ed.ty,id:e.pointerId};
  try{view.setPointerCapture(e.pointerId);}catch{}
  view.classList.add('panning');cursor.style.display='none';
}
view.addEventListener('pointerdown',e=>{
  // middle button, Space + drag, or a drag on the empty area around the image pans the view
  if(e.button===1||(e.button===0&&ed.space)||(e.target===view&&(e.button===0||e.button===2)))startPan(e);
},true);
view.addEventListener('pointermove',e=>{
  if(!ed.pan||e.pointerId!==ed.pan.id)return;
  ed.tx=ed.pan.tx+e.clientX-ed.pan.x;ed.ty=ed.pan.ty+e.clientY-ed.pan.y;ed.fit=false;
  clampPan();applyView();
});
const endPan=e=>{if(!ed.pan||e.pointerId!==ed.pan.id)return;ed.pan=null;view.classList.remove('panning');};
view.addEventListener('pointerup',endPan);
view.addEventListener('pointercancel',endPan);
view.addEventListener('auxclick',e=>{if(e.button===1)e.preventDefault();});
view.addEventListener('contextmenu',e=>e.preventDefault());
view.addEventListener('wheel',e=>{
  e.preventDefault();
  if(e.ctrlKey||e.altKey){ed.size[ed.mode]*=e.deltaY<0?1.15:1/1.15;syncSize();if(e.target===cv)moveCursor(e);return;}
  const p=viewPoint(e);
  // trackpads send many small deltas: zoom smoothly; a mouse wheel notch steps
  if(Math.abs(e.deltaY)<40&&e.deltaMode===0)zoomTo(ed.zoom*Math.exp(-e.deltaY*0.01),p.x,p.y);
  else zoomStep(e.deltaY<0?1:-1,p.x,p.y);
  if(e.target===cv)moveCursor(e);
},{passive:false});
window.addEventListener('resize',()=>{if(!$('#maskModal').classList.contains('show'))return;if(ed.fit)fitView();else{clampPan();applyView();}});
$('#zoomIn').onclick=()=>zoomStep(1);
$('#zoomOut').onclick=()=>zoomStep(-1);
$('#zoomVal').onclick=fitView;

/* ---- drawing ---- */
const scaleOf=()=>1/ed.zoom;
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
  addRecent(ed.color);
  if($('#paintToMask').checked){
    // mask the stroke plus a margin, so the inpaint can blend the edge
    ctx.save();ctx.filter=`blur(${Math.max(2,blur)}px)`;ctx.drawImage(strokeCv,0,0);ctx.restore();tintMask();
  }
  sctx.clearRect(0,0,W(),H());
  strokeCv.style.opacity='';strokeCv.style.filter='';
}
/* ---- colours ---- */
function loadRecent(){try{const a=JSON.parse(localStorage.getItem(RECENT_KEY)||'[]');return Array.isArray(a)?a.slice(0,RECENT_MAX):[];}catch{return[];}}
function addRecent(c){
  ed.recent=[c,...ed.recent.filter(x=>x!==c)].slice(0,RECENT_MAX);
  try{localStorage.setItem(RECENT_KEY,JSON.stringify(ed.recent));}catch{}
  renderRecent();
}
function renderRecent(){
  const box=$('#paintRecent');box.innerHTML='';
  for(const c of ed.recent){const b=document.createElement('button');b.type='button';b.dataset.c=c;b.style.background=c;b.title='最近使った色 '+c;b.onclick=()=>setColor(c);box.appendChild(b);}
  box.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.c===ed.color));
}
function pickColor(e){
  const p=toImage(e);
  if(p.x<0||p.y<0||p.x>=W()||p.y>=H())return;
  const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d');
  const dx=-Math.floor(p.x),dy=-Math.floor(p.y);
  x.drawImage(img,dx,dy);
  for(const l of ed.layers)if(l.visible){x.globalAlpha=l.opacity;x.drawImage(l.canvas,dx,dy);}
  const[r,g,b]=x.getImageData(0,0,1,1).data;
  setColor('#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join(''));
}
/* Lasso: the outline is previewed on the stroke buffer, then filled on release. */
function drawLassoPreview(){
  const pts=ed.lasso.pts;
  sctx.clearRect(0,0,W(),H());
  sctx.save();
  sctx.beginPath();pts.forEach((p,i)=>i?sctx.lineTo(p.x,p.y):sctx.moveTo(p.x,p.y));sctx.closePath();
  sctx.fillStyle=ed.erasing?'rgba(255,255,255,.18)':(ed.mode==='mask'?TINT:ed.color);
  sctx.globalAlpha=ed.erasing?1:0.35;sctx.fill();sctx.globalAlpha=1;
  const lw=1.5*scaleOf();
  sctx.lineWidth=lw;sctx.setLineDash([6*lw,4*lw]);sctx.strokeStyle='#fff';sctx.stroke();
  sctx.lineDashOffset=6*lw;sctx.strokeStyle='#000';sctx.stroke();
  sctx.restore();
}
function fillPoly(c2d,pts,color){
  c2d.fillStyle=color;c2d.beginPath();pts.forEach((p,i)=>i?c2d.lineTo(p.x,p.y):c2d.moveTo(p.x,p.y));c2d.closePath();c2d.fill();
}
function commitLasso(){
  const{pts}=ed.lasso;ed.lasso=null;
  sctx.clearRect(0,0,W(),H());strokeCv.style.opacity='';strokeCv.style.filter='';
  if(pts.length<3){ed.undo.pop();return;}
  if(ed.mode==='mask'){
    ctx.save();ctx.globalCompositeOperation=ed.erasing?'destination-out':'source-over';fillPoly(ctx,pts,TINT);ctx.restore();
  }else if(ed.erasing){
    const p=activeLayer().ctx;
    p.save();p.globalCompositeOperation='destination-out';fillPoly(p,pts,'#000');p.restore();
    if($('#paintToMask').checked){ctx.save();ctx.globalCompositeOperation='destination-out';fillPoly(ctx,pts,'#000');ctx.restore();}
  }else{
    fillPoly(sctx,pts,ed.color);
    commitStroke();
  }
}
function moveCursor(e){
  const vp=viewPoint(e);
  const lasso=ed.tool==='lasso',pick=ed.mode==='paint'&&(ed.tool==='picker'||e.altKey);
  const d=lasso||pick?14:ed.size[ed.mode]*ed.zoom;
  cursor.style.display=ed.pan||ed.space?'none':'block';
  cursor.style.width=cursor.style.height=d+'px';
  cursor.style.left=(vp.x-d/2)+'px';
  cursor.style.top=(vp.y-d/2)+'px';
  const erase=ed.tool==='eraser'||ed.erasing;
  cursor.classList.toggle('erase',erase);
  cursor.classList.toggle('lasso',lasso&&!pick);
  cursor.style.background=ed.mode==='paint'&&!erase&&!lasso&&!pick?ed.color+'66':'';
  cursor.classList.toggle('pick',pick);
}
cv.addEventListener('pointerdown',e=>{
  if(e.button!==0&&e.button!==2)return;
  e.preventDefault();
  if(ed.mode==='paint'&&e.button===0&&(e.altKey||ed.tool==='picker')){
    pickColor(e);ed.picking=true;cv.setPointerCapture(e.pointerId);return;
  }
  if(ed.mode==='paint'&&!activeLayer().visible){toast('非表示のレイヤーには描けません。👁 で表示してください','err');return;}
  cv.setPointerCapture(e.pointerId);
  pushUndo();
  ed.erasing=e.button===2||ed.tool==='eraser';
  if(ed.mode==='paint')ed.changed=true;
  const p=toImage(e);
  if(ed.tool==='lasso'){
    ed.lasso={pts:[p]};ed.drawing=true;
    strokeCv.style.opacity='';strokeCv.style.filter='';
    drawLassoPreview();moveCursor(e);return;
  }
  if(ed.mode==='paint'&&!ed.erasing){
    // preview the stroke the way it will land: layer opacity × brush opacity
    // (the stage is laid out at image size, so the blur is in image pixels)
    strokeCv.style.opacity=ed.alpha*activeLayer().opacity;
    const blur=ed.soft*ed.size.paint*0.35;strokeCv.style.filter=blur>0.5?`blur(${blur}px)`:'';
  }
  // Shift+click: a straight line from where the previous stroke ended
  const from=e.shiftKey&&ed.lastEnd[ed.mode]?ed.lastEnd[ed.mode]:p;
  ed.drawing=true;strokeSeg(from,p);ed.last=p;moveCursor(e);
});
cv.addEventListener('pointermove',e=>{
  moveCursor(e);
  if(ed.picking){pickColor(e);return;}
  if(!ed.drawing)return;
  const p=toImage(e);
  if(ed.lasso){
    const q=ed.lasso.pts.at(-1);
    if(Math.hypot(p.x-q.x,p.y-q.y)*ed.zoom>=2){ed.lasso.pts.push(p);drawLassoPreview();}
    return;
  }
  strokeSeg(ed.last,p);ed.last=p;
});
const endStroke=()=>{
  if(ed.picking){ed.picking=false;if(ed.tool==='picker')setTool('brush');return;}
  if(!ed.drawing)return;
  if(ed.lasso)commitLasso();
  else{commitStroke();ed.lastEnd[ed.mode]=ed.last;}
  ed.drawing=false;ed.erasing=false;renderLayers();
};
cv.addEventListener('pointerup',endStroke);
cv.addEventListener('pointercancel',endStroke);
cv.addEventListener('pointerleave',()=>{if(!ed.drawing)cursor.style.display='none';});
cv.addEventListener('contextmenu',e=>e.preventDefault());

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
$('#maskLasso').onclick=()=>setTool('lasso');
$('#paintPicker').onclick=()=>setTool(ed.tool==='picker'?'brush':'picker');
$('#maskRedo').onclick=redo;
$('#maskSize').addEventListener('input',e=>{ed.size[ed.mode]=+e.target.value;syncSize();});
$('#maskUndo').onclick=undo;
$('#maskInvert').onclick=invert;
$('#maskClear').onclick=clearLayer;
$('#maskSave').onclick=save;
$('#maskCancel').onclick=()=>closeEditor('');
setColor(ed.color);
renderRecent();

// The editor owns the keyboard while it is open (capture phase, so the lightbox and
// the page-wide shortcuts never see these keys).
document.addEventListener('keydown',e=>{
  if(!$('#maskModal').classList.contains('show'))return;
  if(e.target.closest?.('input,textarea')&&e.target.type!=='range'&&e.target.type!=='checkbox')return;
  const k=e.key.toLowerCase(),mod=e.ctrlKey||e.metaKey;
  let used=true;
  if(k===' '){
    if(!ed.space){ed.space=true;view.classList.add('can-pan');cursor.style.display='none';}
  }
  else if(mod&&k==='z'&&e.shiftKey)redo();
  else if(mod&&k==='y')redo();
  else if(mod&&k==='z')undo();
  else if(mod&&k==='enter')save();
  else if(mod)used=false;
  else if(k==='escape')closeEditor('');
  else if(k==='b')setTool('brush');
  else if(k==='e')setTool('eraser');
  else if(k==='l')setTool('lasso');
  else if(k==='i'&&ed.mode==='paint')setTool(ed.tool==='picker'?'brush':'picker');
  else if(k==='+'||k===';'||k==='=')zoomStep(1);
  else if(k==='-')zoomStep(-1);
  else if(k==='0')fitView();
  else if(k==='1')zoomTo(1);
  else if(k==='p')setMode('paint');
  else if(k==='m')setMode('mask');
  else if(k==='[')ed.size[ed.mode]/=1.2,syncSize();
  else if(k===']')ed.size[ed.mode]*=1.2,syncSize();
  else if(k==='i'&&ed.mode==='mask')invert();
  else used=false;
  if(used){e.preventDefault();e.stopPropagation();}
},true);
document.addEventListener('keyup',e=>{
  if(e.key===' '&&ed.space){ed.space=false;view.classList.remove('can-pan');}
},true);
window.addEventListener('blur',()=>{ed.space=false;view.classList.remove('can-pan');});
