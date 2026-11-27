import { callEncodeVibe } from './api.js';
import { renderAllExprRefToggles } from './expressions.js';
import { updateAnlasWarn } from './settings.js';
import { ensureRefArrays, saveProject, state } from './state.js';
import { openApiModal, toast } from './ui.js';
import { $, b64url, blobToBase64, download, fileToBase64, sleep, uid } from './util.js';

export function vibeEncodeKey(model,ie){return model+':'+ie.toFixed(2);}
export function vibeIsEncoded(vibe,model){
  if(!vibe.encoded)return false;
  return !!vibe.encoded[vibeEncodeKey(model,vibe.infoExtracted??0.6)];
}
export function vibeGetEncoded(vibe,model){
  if(!vibe.encoded)return null;
  return vibe.encoded[vibeEncodeKey(model,vibe.infoExtracted??0.6)]||null;
}
export async function encodeVibe(vibe,model){
  if(!state.apiKey)throw new Error('API キーが設定されていません');
  if(!vibe.encoded)vibe.encoded={};
  const key=vibeEncodeKey(model,vibe.infoExtracted??0.6);
  if(vibe.encoded[key])return vibe.encoded[key];
  const data=await callEncodeVibe(vibe.base64,model,vibe.infoExtracted??0.6);
  vibe.encoded[key]=data;
  saveProject();
  return data;
}
export async function encodeAllVibes(){
  if(!state.apiKey){openApiModal();toast('先に API キーを設定してください','err');return;}
  const p=state.project;if(!p)return;
  const model=p.settings.model;
  let encoded=0,skipped=0;
  for(const v of p.vibes){
    if(vibeIsEncoded(v,model)){skipped++;continue;}
    try{await encodeVibe(v,model);encoded++;renderRefCards();await sleep(1000);}
    catch(e){toast('エンコードに失敗しました: '+e.message,'err');return;}
  }
  toast(`エンコード完了: ${encoded}件（スキップ ${skipped}件）`,'ok');
  renderRefCards();
}
/* ---- Resize & pad a reference image for Precise Reference ----
   The API expects one of three fixed sizes, chosen by closest aspect
   ratio, with the image centred and the remainder padded in black. */
export const DIRECTOR_REF_SIZES=[[1024,1536],[1472,1472],[1536,1024]];
export function resizeAndPadBase64(base64){
  return new Promise((res,rej)=>{
    const img=new Image();
    img.onload=()=>{
      try{
        const ratio=img.width/img.height;
        let best=DIRECTOR_REF_SIZES[0],minDiff=Infinity;
        for(const sz of DIRECTOR_REF_SIZES){
          const d=Math.abs(ratio-sz[0]/sz[1]);
          if(d<minDiff){minDiff=d;best=sz;}
        }
        const[tw,th]=best;
        const cv=document.createElement('canvas');cv.width=tw;cv.height=th;
        const ctx=cv.getContext('2d');
        ctx.fillStyle='#000000';ctx.fillRect(0,0,tw,th);
        const scale=Math.min(tw/img.width,th/img.height);
        const w=Math.floor(img.width*scale),h=Math.floor(img.height*scale);
        ctx.drawImage(img,Math.floor((tw-w)/2),Math.floor((th-h)/2),w,h);
        res(cv.toDataURL('image/png').split(',')[1]);
      }catch(e){rej(e);}
    };
    img.onerror=()=>rej(new Error('画像の読み込みに失敗しました'));
    img.src=b64url(base64);
  });
}
/* Scale to cover w×h and centre-crop, returning PNG base64. Used for img2img, where a
   black border (as precise reference uses) would be painted into the result. */
export function fitToSizeBase64(base64,w,h){
  return new Promise((res,rej)=>{
    const img=new Image();
    img.onload=()=>{
      try{
        if(img.width===w&&img.height===h){res(base64);return;}
        const cv=document.createElement('canvas');cv.width=w;cv.height=h;
        const ctx=cv.getContext('2d');ctx.imageSmoothingQuality='high';
        const scale=Math.max(w/img.width,h/img.height);
        const dw=img.width*scale,dh=img.height*scale;
        ctx.drawImage(img,(w-dw)/2,(h-dh)/2,dw,dh);
        res(cv.toDataURL('image/png').split(',')[1]);
      }catch(e){rej(e);}
    };
    img.onerror=()=>rej(new Error('画像の読み込みに失敗しました'));
    img.src=b64url(base64);
  });
}
export async function refreshPreciseRefPadding(showToast){
  const p=state.project;if(!p)return;ensureRefArrays(p);
  if(!p.preciseRefs.length)return;
  let updated=0;
  for(const r of p.preciseRefs){
    if(r.paddedBase64)continue;
    try{r.paddedBase64=await resizeAndPadBase64(r.base64);updated++;}
    catch(e){console.error(e);}
  }
  if(updated){saveProject();if(showToast)toast(`精密参照 ${updated} 件を変換しました`,'ok');}
}
/* ---- Ref cards ---- */
export function renderRefCards(){const p=state.project;if(!p)return;ensureRefArrays(p);renderRefCardSet('vibeCards',p.vibes,'vibe');renderRefCardSet('preciseCards',p.preciseRefs,'precise');renderI2iCards();}
export function renderRefCardSet(cid,list,type){
  const c=document.getElementById(cid);c.innerHTML='';
  const model=state.project?.settings?.model||'nai-diffusion-4-5-full';
  for(let i=0;i<list.length;i++){
    const ref=list[i],isVibe=type==='vibe',ie=isVibe?(ref.infoExtracted??0.6):1;
    const st=isVibe?(ref.strength??0.6):(ref.strength??1);
    const fid=ref.fidelity??0.5;
    const card=document.createElement('div');card.className='ref-card '+type;
    // encode status for vibes
    let badgeHtml='';
    if(isVibe){
      const enc=vibeIsEncoded(ref,model);
      const hasAny=ref.encoded&&Object.keys(ref.encoded).length>0;
      if(enc)badgeHtml='<span class="encode-badge encoded">Encoded</span>';
      else if(hasAny)badgeHtml='<span class="encode-badge stale">要再エンコード</span>';
      else badgeHtml='<span class="encode-badge none">未エンコード</span>';
    }
    const vibeCtl=isVibe?`<label>Info Extracted <span>${ie.toFixed(2)}</span></label><input type="range" min="0" max="1" step="0.05" value="${ie}" data-field="infoExtracted">`:'';
    const preciseCtl=isVibe?'':`<label>Fidelity <span>${fid.toFixed(2)}</span></label><input type="range" min="0" max="1" step="0.05" value="${fid}" data-field="fidelity"><label style="margin-top:5px;cursor:pointer"><span style="color:var(--muted)">画風も参照</span><input type="checkbox" class="style-aware" ${ref.styleAware?'checked':''} style="width:13px;height:13px;accent-color:var(--precise)"></label>`;
    card.innerHTML=`<img src="${b64url(ref.base64)}" alt="参照"><button class="ref-rm" title="削除">✕</button>${badgeHtml}<div class="ref-info">${vibeCtl}<label>Strength <span>${st.toFixed(2)}</span></label><input type="range" min="0" max="1" step="0.05" value="${st}" data-field="strength">${preciseCtl}${isVibe?'<div class="ref-tools"><button class="enc-btn">⚡ エンコード</button><button class="exp-btn">💾 書き出し</button></div>':''}</div>`;
    card.querySelector('.ref-rm').onclick=()=>{list.splice(i,1);saveProject();renderRefCards();updateAnlasWarn();renderAllExprRefToggles();};
    card.querySelectorAll('input[type=range]').forEach(sl=>{
      sl.addEventListener('input',()=>{ref[sl.dataset.field]=parseFloat(sl.value);sl.previousElementSibling.querySelector('span').textContent=ref[sl.dataset.field].toFixed(2);saveProject();});
      // IE change → re-render to update encode badge
      if(isVibe&&sl.dataset.field==='infoExtracted')sl.addEventListener('change',()=>renderRefCards());
    });
    const sa=card.querySelector('.style-aware');
    if(sa)sa.addEventListener('change',()=>{ref.styleAware=sa.checked;saveProject();});
    if(isVibe){
      card.querySelector('.enc-btn').onclick=async()=>{
        if(!state.apiKey){openApiModal();return;}
        try{toast('エンコードしています…');await encodeVibe(ref,model);renderRefCards();toast('エンコードが完了しました','ok');}
        catch(e){toast('エンコードに失敗しました: '+e.message,'err');}
      };
      card.querySelector('.exp-btn').onclick=()=>exportVibeFile(ref);
    }
    c.appendChild(card);
  }
  const addBtn=document.createElement('div');addBtn.className='ref-add';addBtn.textContent='＋ 画像を追加';
  addBtn.onclick=()=>pickRefImage(type);
  addBtn.addEventListener('dragover',e=>{e.preventDefault();addBtn.style.borderColor='var(--accent)';});
  addBtn.addEventListener('dragleave',()=>{addBtn.style.borderColor='';});
  addBtn.addEventListener('drop',async e=>{e.preventDefault();addBtn.style.borderColor='';const f=e.dataTransfer.files[0];if(f&&f.type.startsWith('image/'))await addRefFromFile(f,type);});
  c.appendChild(addBtn);
}
export let pendingRefType=null;
export function pickRefImage(type){pendingRefType=type;const inp=$('#refFileInput');inp.value='';inp.click();}
$('#refFileInput').addEventListener('change',async e=>{const f=e.target.files[0];e.target.value='';if(!f||!pendingRefType)return;if(pendingRefType==='i2i')await addI2iFromFile(f);else await addRefFromFile(f,pendingRefType);});
export async function addRefFromFile(file,type){
  const p=state.project;if(!p)return;ensureRefArrays(p);
  if(p.vibes.length+p.preciseRefs.length>=6){toast('参照画像は合計 6 枚までです','err');return;}
  try{const b64=await fileToBase64(file);const entry={id:uid(),base64:b64,strength:0.6};if(type==='vibe'){entry.infoExtracted=0.6;p.vibes.push(entry);}else{entry.strength=1;entry.fidelity=0.5;entry.styleAware=false;p.preciseRefs.push(entry);await refreshPreciseRefPadding();}saveProject();renderRefCards();updateAnlasWarn();renderAllExprRefToggles();toast((type==='vibe'?'バイブス':'精密参照')+'に追加しました','ok');}catch(err){toast('読み込みに失敗しました: '+err.message,'err');}
}
export async function addRefFromBlob(blob,type){
  const p=state.project;if(!p)return;ensureRefArrays(p);
  if(p.vibes.length+p.preciseRefs.length>=6){toast('参照画像は合計 6 枚までです','err');return;}
  const b64=await blobToBase64(blob);const entry={id:uid(),base64:b64,strength:0.6};
  if(type==='vibe'){entry.infoExtracted=0.6;p.vibes.push(entry);}else{entry.strength=1;entry.fidelity=0.5;entry.styleAware=false;p.preciseRefs.push(entry);await refreshPreciseRefPadding();}
  saveProject();renderRefCards();updateAnlasWarn();renderAllExprRefToggles();toast('精密参照に登録しました','ok');
}

/* ---- Vibe file export/import (NovelAI .naiv4vibe compatible) ---- */
export async function sha256hex(str){
  try{
    const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
  }catch(_){
    // fallback if crypto.subtle is unavailable
    let h1=0x811c9dc5,h2=0x01000193;
    for(let i=0;i<str.length;i++){h1=(h1^str.charCodeAt(i))>>>0;h1=Math.imul(h1,16777619)>>>0;h2=(h2+h1)>>>0;}
    return (h1.toString(16)+h2.toString(16)).padStart(16,'0').repeat(4).slice(0,64);
  }
}
export function vibeBucketName(model){
  if(model.startsWith('nai-diffusion-4-5'))return model.endsWith('full')?'v4-5full':'v4-5curated';
  return model.endsWith('full')?'v4full':'v4curated';
}
export function makeThumbnail(base64){
  return new Promise(res=>{
    const img=new Image();
    img.onload=()=>{
      try{
        const scale=256/Math.max(img.width,img.height);
        const w=Math.max(1,Math.floor(img.width*scale)),h=Math.max(1,Math.floor(img.height*scale));
        const cv=document.createElement('canvas');cv.width=w;cv.height=h;
        cv.getContext('2d').drawImage(img,0,0,w,h);
        res(cv.toDataURL('image/jpeg',0.8));
      }catch(_){res('');}
    };
    img.onerror=()=>res('');
    img.src=b64url(base64);
  });
}
export async function exportVibeFile(vibe){
  const ie=vibe.infoExtracted??0.6;
  const id=await sha256hex(vibe.base64);
  const data={
    identifier:'novelai-vibe-transfer',version:1,type:'image',
    image:vibe.base64,id,
    encodings:{},
    name:id.slice(0,6)+'-'+id.slice(-6),
    thumbnail:await makeThumbnail(vibe.base64),
    createdAt:Math.round(Date.now()/1000),
    importInfo:{model:state.project.settings.model,information_extracted:ie,strength:vibe.strength??0.6}
  };
  // carry over every cached encoding, grouped by model bucket
  for(const[key,enc]of Object.entries(vibe.encoded||{})){
    const[model,ieStr]=key.split(':');
    const bucket=vibeBucketName(model);
    if(!data.encodings[bucket])data.encodings[bucket]={};
    data.encodings[bucket][await sha256hex(enc)]={encoding:enc,params:{information_extracted:parseFloat(ieStr)}};
  }
  download(new Blob([JSON.stringify(data)],{type:'application/json'}),data.name+'.naiv4vibe');
  toast('バイブスを書き出しました','ok');
}
$('#btnVibeImport').onclick=()=>$('#vibeImportFile').click();
$('#vibeImportFile').addEventListener('change',async e=>{
  const f=e.target.files[0];e.target.value='';if(!f)return;
  const p=state.project;if(!p)return;ensureRefArrays(p);
  try{
    const j=JSON.parse(await f.text());
    const image=j.image;
    if(!image)throw new Error('画像データが含まれていません');
    const encoded={};
    // NovelAI format: encodings[bucket][hash] = {encoding, params:{information_extracted}}
    if(j.encodings&&typeof j.encodings==='object'){
      for(const[bucket,entries]of Object.entries(j.encodings)){
        const model=bucket.includes('4-5')
          ? (bucket.includes('curated')?'nai-diffusion-4-5-curated':'nai-diffusion-4-5-full')
          : (bucket.includes('curated')?'nai-diffusion-4-curated':'nai-diffusion-4-full');
        for(const rec of Object.values(entries||{})){
          if(!rec||!rec.encoding)continue;
          const ie=rec.params?.information_extracted??0.6;
          encoded[vibeEncodeKey(model,ie)]=rec.encoding;
        }
      }
    }
    // our own older export format
    if(j.encoded&&typeof j.encoded==='object')Object.assign(encoded,j.encoded);
    const ie=j.importInfo?.information_extracted??j.importInfo?.infomation_extracted??j.infoExtracted??0.6;
    const entry={id:uid(),base64:image,strength:j.importInfo?.strength??j.strength??0.6,infoExtracted:ie,encoded};
    p.vibes.push(entry);
    saveProject();renderRefCards();updateAnlasWarn();renderAllExprRefToggles();
    const n=Object.keys(encoded).length;
    toast(`バイブスを読み込みました${n?`（エンコード済みデータ ${n} 件つき）`:''}`,'ok');
  }catch(err){toast('読み込みに失敗しました: '+err.message,'err');}
});
$('#btnVibeEncodeAll').onclick=()=>encodeAllVibes();

/* ---- i2i card rendering ---- */
export function renderI2iCards(){
  const p=state.project;if(!p)return;ensureRefArrays(p);
  const c=document.getElementById('i2iCards');c.innerHTML='';
  for(let i=0;i<p.i2iImages.length;i++){
    const ref=p.i2iImages[i];const st=ref.strength??0.5;const ns=ref.noise??0;
    const card=document.createElement('div');card.className='ref-card i2i';
    card.innerHTML=`<img src="${b64url(ref.base64)}" alt="i2i元画像"><button class="ref-rm" title="削除">✕</button><div class="ref-info"><label>Strength <span>${st.toFixed(2)}</span></label><input type="range" min="0" max="1" step="0.05" value="${st}" data-field="strength"><label>Noise <span>${ns.toFixed(2)}</span></label><input type="range" min="0" max="1" step="0.05" value="${ns}" data-field="noise"></div>`;
    card.querySelector('.ref-rm').onclick=()=>{p.i2iImages.splice(i,1);saveProject();renderRefCards();updateAnlasWarn();renderAllExprRefToggles();};
    card.querySelectorAll('input[type=range]').forEach(sl=>{sl.addEventListener('input',()=>{ref[sl.dataset.field]=parseFloat(sl.value);sl.previousElementSibling.querySelector('span').textContent=ref[sl.dataset.field].toFixed(2);saveProject();});});
    c.appendChild(card);
  }
  const addBtn=document.createElement('div');addBtn.className='ref-add';addBtn.textContent='＋ i2i元画像を追加';
  addBtn.onclick=()=>pickRefImage('i2i');
  addBtn.addEventListener('dragover',e=>{e.preventDefault();addBtn.style.borderColor='var(--accent)';});
  addBtn.addEventListener('dragleave',()=>{addBtn.style.borderColor='';});
  addBtn.addEventListener('drop',async e=>{e.preventDefault();addBtn.style.borderColor='';const f=e.dataTransfer.files[0];if(f&&f.type.startsWith('image/'))await addI2iFromFile(f);});
  c.appendChild(addBtn);
}
export async function addI2iFromFile(file){
  const p=state.project;if(!p)return;ensureRefArrays(p);
  try{const b64=await fileToBase64(file);p.i2iImages.push({id:uid(),base64:b64,strength:0.5,noise:0});saveProject();renderRefCards();updateAnlasWarn();renderAllExprRefToggles();toast('img2img の元画像を追加しました','ok');}catch(err){toast('読み込みに失敗しました: '+err.message,'err');}
}
export async function addI2iFromBlob(blob){
  const p=state.project;if(!p)return;ensureRefArrays(p);
  const b64=await blobToBase64(blob);p.i2iImages.push({id:uid(),base64:b64,strength:0.5,noise:0});
  saveProject();renderRefCards();updateAnlasWarn();renderAllExprRefToggles();toast('img2img の元画像に登録しました','ok');
}
