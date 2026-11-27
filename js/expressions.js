import { adoptImage, deleteImage, holdImage, imgURL } from './images.js';
import { exprToEntry, lib, libSave } from './library.js';
import { openLightbox } from './lightbox.js';
import { enqueue } from './queue.js';
import { addI2iFromBlob, addRefFromBlob } from './refs.js';
import { ensureRefArrays, saveProject, state } from './state.js';
import { openThumbMenu } from './thumbmenu.js';
import { toast } from './ui.js';
import { $, $$, download, esc, refImgURL, sanitize } from './util.js';
import { copyExprData, deserializeExpr, ensureExprShape, ensureExprShapes, newExpr, openPeek, renderExprExtra, serializeExpr } from './variants.js';

/* ---- Filter ---- */
$$('.filter-bar button').forEach(btn=>{
  btn.onclick=()=>{
    $$('.filter-bar button').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');state.filter=btn.dataset.filter;
    state.project?.expressions.forEach(ex=>renderExprThumbs(ex.id));
  };
});
/* ---- Thumbnail size ----
   A browser-wide preference rather than a project setting: it depends on the screen,
   not the sprites. Slider in the filter bar, or Ctrl+wheel over the thumbnails. */
const THUMB_KEY='nai_thumb_size',THUMB_MIN=80,THUMB_MAX=320,THUMB_STEP=16;
function setThumbSize(px){
  const v=Math.min(THUMB_MAX,Math.max(THUMB_MIN,Math.round(+px||132)));
  document.documentElement.style.setProperty('--thumb-w',v+'px');
  $('#thumbSize').value=v;$('#thumbSizeVal').textContent=v+'px';
  localStorage.setItem(THUMB_KEY,String(v));
}
setThumbSize(localStorage.getItem(THUMB_KEY)||132);
$('#thumbSize').addEventListener('input',e=>setThumbSize(e.target.value));
$('#exprList').addEventListener('wheel',e=>{
  if(!(e.ctrlKey||e.metaKey)||!e.target.closest('.thumbs'))return;
  e.preventDefault();   // otherwise the browser zooms the whole page
  setThumbSize(+$('#thumbSize').value+(e.deltaY<0?THUMB_STEP:-THUMB_STEP));
},{passive:false});
export function matchFilter(im){
  if(state.filter==='all')return true;
  if(state.filter==='adopted')return im.adopted;
  if(state.filter==='held')return im.held;
  if(state.filter==='none')return!im.adopted&&!im.held;
  return true;
}

/* ---- Expression panel ---- */
export function renderExpressions(){
  const list=$('#exprList');list.innerHTML='';
  const p=state.project;if(!p)return;
  ensureExprShapes(p);
  // drop selections for expressions that no longer exist
  for(const id of [...state.selectedExprs])if(!p.expressions.find(e=>e.id===id))state.selectedExprs.delete(id);
  p.expressions.forEach((ex,idx)=>{
    const div=document.createElement('div');div.className='expr'+(state.selectedExprs.has(ex.id)?' selected':'');div.dataset.id=ex.id;
    div.innerHTML=`
      <div class="expr-head">
        <div class="expr-check"><input type="checkbox" class="sel" ${state.selectedExprs.has(ex.id)?'checked':''} title="この表情を選択" aria-label="この表情を選択"></div>
        <input type="text" class="name" value="${esc(ex.name)}" aria-label="表情名">
        <textarea class="prompt" rows="2" aria-label="表情プロンプト">${esc(ex.prompt)}</textarea>
        <div class="expr-actions">
          <button class="gen primary" title="この表情だけを生成">生成</button>
          <button class="peek" title="送信プロンプトを確認">👁</button>
          <button class="tolib" title="テンプレートとして保存">📚</button>
          <button class="insert" title="この下に新しい表情を追加">＋</button>
          <button class="dup" title="この表情を複製">⧉</button>
          <button class="up" title="ひとつ上へ移動">↑</button>
          <button class="down" title="ひとつ下へ移動">↓</button>
          <button class="del danger" title="この表情を削除">✕</button>
        </div>
      </div>
      <div class="expr-neg"><span title="この表情だけのネガティブ">NEG</span><textarea class="negprompt" rows="1" placeholder="この表情だけのネガティブ（例: closed eyes）" aria-label="表情ネガティブ">${esc(ex.neg||'')}</textarea></div>
      <div class="expr-extra" data-xid="${ex.id}"></div>
      <div class="expr-refs" data-rid="${ex.id}"></div>
      <div class="expr-status" data-sid="${ex.id}"></div>
      <div class="thumbs"></div>`;
    div.querySelector('.sel').addEventListener('change',e=>{
      if(e.target.checked)state.selectedExprs.add(ex.id);else state.selectedExprs.delete(ex.id);
      div.classList.toggle('selected',e.target.checked);
      updateSelBar();
    });
    div.querySelector('.name').addEventListener('input',e=>{ex.name=e.target.value;saveProject();});
    div.querySelector('.prompt').addEventListener('input',e=>{
      ex.prompt=e.target.value;
      ensureExprShape(ex);ex.variants[0].prompt=e.target.value;
      const vt=div.querySelector('.var-row[data-vi="0"] textarea');
      if(vt&&vt!==e.target)vt.value=e.target.value;
      saveProject();
    });
    div.querySelector('.peek').onclick=()=>openPeek(ex);
    div.querySelector('.tolib').onclick=()=>{
      lib.entries.push(exprToEntry(ex));libSave();
      toast(`「${ex.name}」をテンプレートに保存しました`,'ok');
    };
    div.querySelector('.negprompt').addEventListener('input',e=>{ex.neg=e.target.value;saveProject();});
    // Ctrl+Enter (⌘+Enter) in any field of this card queues just this expression, so a
    // prompt tweak can be tried without leaving the keyboard for the 生成 button.
    div.addEventListener('keydown',e=>{
      if(e.key!=='Enter'||!(e.ctrlKey||e.metaKey)||e.isComposing)return;
      if(!e.target.matches('textarea,input[type=text]'))return;
      e.preventDefault();
      toast(`「${ex.name}」を生成します`);
      enqueue([ex.id]);
    });
    div.querySelector('.gen').onclick=()=>enqueue([ex.id]);
    div.querySelector('.insert').onclick=()=>{
      const ne=newExpr();
      p.expressions.splice(idx+1,0,ne);saveProject();renderExpressions();
      const card=document.querySelector(`.expr[data-id="${ne.id}"]`);
      card?.querySelector('.name')?.focus();
    };
    div.querySelector('.dup').onclick=()=>{
      const dup=copyExprData(ex,ex.name+'のコピー');
      p.expressions.splice(idx+1,0,dup);saveProject();renderExpressions();
      toast(`「${ex.name}」を複製しました`,'ok');
    };
    div.querySelector('.up').onclick=()=>{if(idx>0){p.expressions.splice(idx,1);p.expressions.splice(idx-1,0,ex);saveProject();renderExpressions();}};
    div.querySelector('.down').onclick=()=>{if(idx<p.expressions.length-1){p.expressions.splice(idx,1);p.expressions.splice(idx+1,0,ex);saveProject();renderExpressions();}};
    div.querySelector('.del').onclick=async()=>{
      // expressions are shared by every character, so their images must all go
      const owned=state.allImages.filter(i=>i.exprId===ex.id);
      if(!confirm(`表情「${ex.name}」を削除します。よろしいですか？`+(owned.length?`\n生成済みの画像 ${owned.length} 枚（全キャラクター分）もあわせて削除されます。`:'')))return;
      for(const im of owned)await deleteImage(im.id);
      p.expressions=p.expressions.filter(e=>e.id!==ex.id);
      state.selectedExprs.delete(ex.id);
      saveProject();renderExpressions();
      toast(`表情「${ex.name}」を削除しました`,'ok');
    };
    list.appendChild(div);
    renderExprExtra(ex);renderExprRefToggles(ex);renderExprThumbs(ex.id);renderExprStatus(ex.id);
  });
  if(!p.expressions.length)list.innerHTML='<p class="hint" style="font-size:13px">表情がまだ登録されていません。「＋ 表情を追加」から作成してください。</p>';
  updateSelBar();
}
/* ---- Selection ---- */
export function updateSelBar(){
  const p=state.project;const n=state.selectedExprs.size;
  $('#selBar').classList.toggle('hidden',n===0);
  $('#selCount').textContent=`${n} 件を選択中`;
  $('#btnSelDel').disabled=n===0;
  $('#btnSelDelImgs').disabled=n===0;
  $('#btnGenSelTop').disabled=n===0;
  const has=!!p&&p.expressions.length>0;
  $('#btnSelAll').disabled=!has;
  $('#btnSelNone').disabled=n===0;
  $('#btnSelInvert').disabled=!has;
  updateMissingBtn();
}
export function updateMissingBtn(){
  const p=state.project;const btn=$('#btnGenMissing');if(!btn)return;
  const missing=p?p.expressions.filter(e=>!state.images.some(i=>i.exprId===e.id)).length:0;
  btn.textContent=missing?`▶ 未生成の表情のみ (${missing})`:'▶ 未生成の表情のみ';
  btn.disabled=missing===0;
}
export function setAllSelection(on){
  const p=state.project;if(!p)return;
  state.selectedExprs.clear();
  if(on)p.expressions.forEach(e=>state.selectedExprs.add(e.id));
  refreshSelectionUI();
}
export function refreshSelectionUI(){
  document.querySelectorAll('.expr').forEach(div=>{
    const on=state.selectedExprs.has(div.dataset.id);
    const cb=div.querySelector('.sel');if(cb)cb.checked=on;
    div.classList.toggle('selected',on);
  });
  updateSelBar();
}
$('#btnSelAll').onclick=()=>setAllSelection(true);
$('#btnSelNone').onclick=()=>setAllSelection(false);
$('#btnSelInvert').onclick=()=>{
  const p=state.project;if(!p)return;
  const next=new Set();
  p.expressions.forEach(e=>{if(!state.selectedExprs.has(e.id))next.add(e.id);});
  state.selectedExprs=next;refreshSelectionUI();
};
$('#btnSelDelImgs').onclick=async()=>{
  const p=state.project;if(!p)return;
  const ids=[...state.selectedExprs];
  if(!ids.length){toast('表情が選択されていません','err');return;}
  const targets=state.images.filter(i=>ids.includes(i.exprId));
  if(!targets.length){toast('選択した表情には生成済みの画像がありません');return;}
  const adopted=targets.filter(i=>i.adopted).length;
  const held=targets.filter(i=>i.held).length;
  const names=p.expressions.filter(e=>ids.includes(e.id)).slice(0,5).map(e=>'・'+e.name).join('\n');
  const extra=p.expressions.filter(e=>ids.includes(e.id)).length>5?`\n…ほか ${p.expressions.filter(e=>ids.includes(e.id)).length-5} 件`:'';
  let msg=`次の表情の生成済み画像 ${targets.length} 枚をすべて削除します。よろしいですか？\n\n${names}${extra}`;
  if(adopted||held)msg+=`\n\n⚠ このうち採用済み ${adopted} 枚、保留中 ${held} 枚も削除されます。`;
  msg+='\n\nこの操作は取り消せません。';
  if(!confirm(msg))return;
  for(const im of targets)await deleteImage(im.id);
  toast(`${targets.length} 枚の画像を削除しました`,'ok');
};
$('#btnSelDel').onclick=async()=>{
  const p=state.project;if(!p)return;
  const ids=[...state.selectedExprs];
  if(!ids.length){toast('表情が選択されていません','err');return;}
  const targets=p.expressions.filter(e=>ids.includes(e.id));
  const doomed=state.allImages.filter(i=>ids.includes(i.exprId));
  const names=targets.slice(0,5).map(e=>'・'+e.name).join('\n')+(targets.length>5?`\n…ほか ${targets.length-5} 件`:'');
  if(!confirm(`次の ${targets.length} 件の表情を削除します。よろしいですか？\n\n${names}`+(doomed.length?`\n\n生成済みの画像 ${doomed.length} 枚（全キャラクター分）もあわせて削除されます。`:'')))return;
  for(const im of doomed)await deleteImage(im.id);
  p.expressions=p.expressions.filter(e=>!ids.includes(e.id));
  state.selectedExprs.clear();
  saveProject();renderExpressions();
  toast(`${targets.length} 件の表情を削除しました`,'ok');
};
export function renderExprRefToggles(ex){
  const row=document.querySelector(`.expr-refs[data-rid="${ex.id}"]`);if(!row)return;
  row.innerHTML='';
  const p=state.project;if(!p)return;ensureRefArrays(p);
  if(!ex.refConfig)ex.refConfig={};
  const allRefs=[];
  p.vibes.forEach((v,i)=>allRefs.push({ref:v,type:'vibe',label:'V'+(i+1)}));
  p.preciseRefs.forEach((r,i)=>allRefs.push({ref:r,type:'precise',label:'P'+(i+1)}));
  if(p.i2iImages)p.i2iImages.forEach((r,i)=>allRefs.push({ref:r,type:'i2i',label:'I'+(i+1)}));
  if(!allRefs.length){row.innerHTML='<span class="expr-refs-empty">参照画像は登録されていません</span>';return;}
  const lbl=document.createElement('span');lbl.className='ref-label';lbl.textContent='参照:';row.appendChild(lbl);
  for(const{ref,type,label}of allRefs){
    const enabled=ex.refConfig[ref.id]!==false;
    const btn=document.createElement('button');
    btn.className=`expr-ref-toggle ${type} ${enabled?'on':'off'}`;
    btn.title=`${type==='vibe'?'バイブス':type==='precise'?'精密参照':'img2img'} ${label}（クリックで切替）`;
    btn.innerHTML=`<img src="${refImgURL(ref)}" alt="">${label}`;
    btn.onclick=()=>{
      ex.refConfig[ref.id]=!enabled;saveProject();renderExprRefToggles(ex);
    };
    row.appendChild(btn);
  }
}
export function renderAllExprRefToggles(){
  const p=state.project;if(!p)return;
  p.expressions.forEach(ex=>renderExprRefToggles(ex));
}
/* Turn a whole category of references on or off for every expression at once. */
export function bulkSetRefs(kind,on){
  const p=state.project;if(!p)return;ensureRefArrays(p);
  const list=kind==='vibe'?p.vibes:kind==='precise'?p.preciseRefs:p.i2iImages;
  const labels={vibe:'バイブス',precise:'精密参照',i2i:'img2img'};
  if(!list.length){toast(`${labels[kind]}が登録されていません`,'err');return;}
  if(!p.expressions.length){toast('表情がありません','err');return;}
  for(const ex of p.expressions){
    if(!ex.refConfig)ex.refConfig={};
    for(const r of list)ex.refConfig[r.id]=on;
  }
  saveProject();renderAllExprRefToggles();
  toast(`${labels[kind]} ${list.length} 件を全 ${p.expressions.length} 表情で${on?'オン':'オフ'}にしました`,'ok');
}
document.querySelectorAll('.bulk-ref').forEach(btn=>{
  btn.onclick=()=>bulkSetRefs(btn.dataset.kind,btn.dataset.on==='1');
});
export function renderExprStatus(exprId){
  const el=document.querySelector(`.expr-status[data-sid="${exprId}"]`);if(!el)return;
  const imgs=state.images.filter(i=>i.exprId===exprId);
  const adopted=imgs.filter(i=>i.adopted).length;
  const held=imgs.filter(i=>i.held).length;
  const parts=[];
  parts.push(`候補 ${imgs.length} 枚`);
  if(adopted)parts.push(`<span class="st-adopt">★ 採用済み</span>`);
  if(held)parts.push(`<span class="st-hold">◆ 保留 ${held}</span>`);
  el.innerHTML=parts.join(' / ');
}
export function renderExprThumbs(exprId){
  const wrap=document.querySelector(`.expr[data-id="${exprId}"] .thumbs`);if(!wrap)return;
  const all=state.images.filter(i=>i.exprId===exprId).sort((a,b)=>a.createdAt-b.createdAt);
  const imgs=all.filter(matchFilter);
  wrap.innerHTML='';
  if(!all.length){wrap.innerHTML='<span class="empty">まだ候補がありません。「生成」を押してください</span>';return;}
  if(!imgs.length){wrap.innerHTML=`<span class="empty">フィルター条件に一致する画像はありません（全 ${all.length} 枚）</span>`;return;}
  for(const im of imgs){
    const d=document.createElement('div');
    const cls=['thumb'];if(im.adopted)cls.push('adopted');else if(im.held)cls.push('held');
    d.className=cls.join(' ');d.dataset.iid=im.id;
    let badge='';if(im.adopted)badge='<span class="badge b-adopt">採用</span>';else if(im.held)badge='<span class="badge b-hold">保留</span>';
    const vlab=im.variantLabel||(im.variantIdx>0?'#'+(im.variantIdx+1):'');
    const vchip=vlab?`<span class="vlabel" title="使用したバリエーション">${esc(vlab)}</span>`:'';
    d.innerHTML=`${badge}${vchip}<span class="seed" title="クリックでコピー">${im.seed}</span><img src="${imgURL(im)}" alt="" loading="lazy" decoding="async"><div class="tools"><button class="adopt" title="${im.adopted?'採用を取り消す':'採用する'}">★</button><button class="hold" title="${im.held?'保留を解除':'保留にする'}">◆</button><button class="use-ref" title="📌 精密参照に登録">📌</button><button class="use-i2i" title="🖼 i2i元画像に登録">🖼</button><button class="rm danger" title="削除">🗑</button></div>`;
    d.querySelector('img').onclick=()=>openLightbox(im.id);
    d.querySelector('.seed').onclick=e=>{e.stopPropagation();navigator.clipboard?.writeText(String(im.seed));toast('シード値をコピーしました: '+im.seed,'ok');};
    d.querySelector('.adopt').onclick=async()=>{const r=await adoptImage(im.id);if(r==='cleared')toast('採用を取り消しました');};
    d.querySelector('.hold').onclick=()=>holdImage(im.id);
    d.querySelector('.use-ref').onclick=()=>addRefFromBlob(im.blob,'precise');
    d.querySelector('.use-i2i').onclick=()=>addI2iFromBlob(im.blob);
    d.querySelector('.rm').onclick=()=>{if(confirm('この候補を削除します。よろしいですか？'))deleteImage(im.id);};
    // the whole menu opens at the cursor, instead of aiming at the small hover buttons
    d.addEventListener('contextmenu',e=>{e.preventDefault();openThumbMenu(im,e.clientX,e.clientY);});
    wrap.appendChild(d);
  }
}
/* ---- Expression set ---- */
export function addExpressions(count,scrollToNew){
  const p=state.project;if(!p)return;
  const n=Math.min(20,Math.max(1,count|0));
  const created=[];
  for(let i=0;i<n;i++){const ne=newExpr();p.expressions.push(ne);created.push(ne);}
  saveProject();renderExpressions();
  if(scrollToNew&&created.length){
    const first=document.querySelector(`.expr[data-id="${created[0].id}"]`);
    first?.scrollIntoView({block:'center',behavior:'smooth'});
    first?.querySelector('.name')?.focus();
  }
  toast(n>1?`${n} 件の表情を追加しました`:'表情を追加しました','ok');
}
// Toolbar button: stays in place so you can click it repeatedly
$('#btnAddExpr').onclick=()=>addExpressions(+$('#inpAddCount').value||1,false);
// Bottom button: scrolls to the new entry and focuses it
$('#btnAddExprBottom').onclick=()=>addExpressions(+$('#inpAddCount').value||1,true);
$('#btnGenSelTop').onclick=()=>{
  const ids=[...state.selectedExprs];
  if(!ids.length){toast('表情が選択されていません','err');return;}
  enqueue(ids);
};
$('#btnGenMissing').onclick=()=>{
  const p=state.project;if(!p)return;
  const missing=p.expressions.filter(e=>!state.images.some(i=>i.exprId===e.id));
  if(!missing.length){toast('すべての表情に画像があります','ok');return;}
  enqueue(missing.map(e=>e.id));
  toast(`未生成の表情 ${missing.length} 件を生成します`,'ok');
};
$('#btnGenAll').onclick=()=>enqueue(state.project.expressions.map(e=>e.id));
$('#btnExportSet').onclick=()=>{const p=state.project;download(new Blob([JSON.stringify({type:'nai-sprite-expressions',name:p.name,expressions:p.expressions.map(serializeExpr)},null,2)],{type:'application/json'}),sanitize(p.name)+'_expressions.json');};
$('#btnImportSet').onclick=()=>$('#importFile').click();
$('#importFile').addEventListener('change',async e=>{
  const f=e.target.files[0];e.target.value='';if(!f)return;
  try{const j=JSON.parse(await f.text());const list=Array.isArray(j)?j:j.expressions;if(!Array.isArray(list))throw new Error('ファイルの形式が正しくありません');const items=list.filter(x=>x&&typeof x.name==='string').map(deserializeExpr);if(!items.length)throw new Error('表情データが含まれていません');state.project.expressions.push(...items);saveProject();renderExpressions();toast(`${items.length} 件の表情を追加しました`,'ok');}catch(err){toast('読み込みに失敗しました: '+err.message,'err');}
});
$('#btnCopySet').onclick=()=>{
  const others=state.projects.filter(p=>p.id!==state.project.id);
  if(!others.length){toast('コピー元となる他のプロジェクトがありません','err');return;}
  const menu=others.map((p,i)=>`${i+1}: ${p.name}`).join('\n');const ans=prompt('コピー元のプロジェクト番号を入力してください:\n'+menu);if(ans===null)return;
  const src=others[(+ans)-1];if(!src){toast('入力された番号が正しくありません','err');return;}
  const items=src.expressions.map(e=>copyExprData(e));
  state.project.expressions.push(...items);saveProject();renderExpressions();toast(`「${src.name}」から ${items.length} 件の表情を複製しました`,'ok');
};
