import { renderExpressions } from './expressions.js';
import { deleteImage } from './images.js';
import { saveProject, state } from './state.js';
import { toast } from './ui.js';
import { $, $$, download, esc, uid } from './util.js';
import { deserializeExpr, ensureExprShape } from './variants.js';

/* ================= Template library (localStorage, cross-project) ================= */
export const LIB_KEY='nai_expr_library_v1';
export const LIB_SEED={
  entries:[
    {name:'通常',variants:[{label:'標準',prompt:'neutral expression, closed mouth'},{label:'伏し目',prompt:'expressionless, closed mouth, looking down'}],
     suppress:'smile, happy, grin, open mouth'},
    {name:'笑顔',variants:[{label:'口を開けて',prompt:'smile, open mouth, happy'},{label:'微笑み',prompt:'smile, closed mouth, gentle smile'},{label:'満面',prompt:'grin, open mouth, happy, closed eyes'}],
     suppress:'expressionless, frown, angry, sad, neutral expression'},
    {name:'怒り',variants:[{label:'しかめ面',prompt:'angry, frown, v-shaped eyebrows'},{label:'叫び',prompt:'angry, shouting, open mouth, clenched teeth, v-shaped eyebrows'},{label:'冷たい',prompt:'annoyed, glaring, half-closed eyes, closed mouth'}],
     suppress:'smile, smiling, happy, grin, laughing, open mouth smile'},
    {name:'悲しみ',variants:[{label:'涙',prompt:'sad, tears, teary eyes'},{label:'うつむき',prompt:'sad, frown, looking down, closed mouth'}],
     suppress:'smile, happy, grin, laughing'},
    {name:'驚き',variants:[{label:'標準',prompt:'surprised, wide eyes, open mouth'},{label:'のけぞり',prompt:'shocked, wide eyes, open mouth, raised eyebrows'}],
     suppress:'closed eyes, closed mouth, calm'},
    {name:'照れ',variants:[{label:'標準',prompt:'blush, embarrassed, averting eyes'},{label:'笑顔混じり',prompt:'blush, smile, closed mouth, embarrassed'}],
     suppress:'angry, frown'}
  ],
  sets:[{name:'基本6表情',items:['通常','笑顔','怒り','悲しみ','驚き','照れ']}]
};
export function libNormEntry(x){
  const vs=(Array.isArray(x.variants)&&x.variants.length?x.variants:[{label:'',prompt:x.prompt||''}])
    .map(v=>({label:String(v.label||''),prompt:String(v.prompt||'')}));
  return{id:x.id||uid(),name:String(x.name||'無題'),variants:vs,variantMode:x.variantMode||'first',
    neg:String(x.neg||''),suppress:String(x.suppress||''),suppressOn:x.suppressOn!==false,
    suppressScope:x.suppressScope||'basechar',suppressPartial:!!x.suppressPartial};
}
export function libSeed(){
  const entries=LIB_SEED.entries.map(libNormEntry);
  const byName=n=>entries.find(e=>e.name===n);
  const sets=LIB_SEED.sets.map(s=>({id:uid(),name:s.name,items:s.items.map(byName).filter(Boolean).map(e=>libNormEntry(JSON.parse(JSON.stringify(e))))}));
  return{entries,sets};
}
export let lib=(function(){
  try{
    const j=JSON.parse(localStorage.getItem(LIB_KEY)||'null');
    if(j&&Array.isArray(j.entries))return{entries:j.entries.map(libNormEntry),
      sets:(Array.isArray(j.sets)?j.sets:[]).map(x=>({id:x.id||uid(),name:String(x.name||'無題'),items:(x.items||[]).map(libNormEntry)}))};
  }catch(_){}
  return libSeed();
})();
export function libSave(){try{localStorage.setItem(LIB_KEY,JSON.stringify(lib));}catch(e){toast('テンプレートの保存に失敗しました: '+e.message,'err');}renderSetPicker();}

/* ---- toolbar set picker ----
   Adds a saved set without opening the library dialog. The select snaps back to its
   placeholder after each pick, so the same set can be added again. */
export function renderSetPicker(){
  const sel=$('#selSetPick');if(!sel)return;
  sel.innerHTML='<option value="">📚 セットから追加…</option>'+(lib.sets.length
    ?lib.sets.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}（${s.items.length}）</option>`).join('')
    :'<option value="" disabled>保存されたセットはありません</option>');
  sel.value='';
}
$('#selSetPick').addEventListener('change',e=>{
  const set=lib.sets.find(s=>s.id===e.target.value);e.target.value='';
  if(set)libApplyEntries(set.items);
});
export function entryToExpr(en){return deserializeExpr(en);}
export function exprToEntry(ex){ensureExprShape(ex);return libNormEntry({name:ex.name,variants:ex.variants.map(v=>({label:v.label,prompt:v.prompt})),variantMode:ex.variantMode,neg:ex.neg,suppress:ex.suppress,suppressOn:ex.suppressOn,suppressScope:ex.suppressScope,suppressPartial:ex.suppressPartial});}

renderSetPicker();

/* ---- library UI ---- */
export let libTab='entry',libEditing=null;
export function openLibrary(){renderLib();$('#libModal').classList.add('show');}
$('#btnLibrary').onclick=openLibrary;
$('#btnLibClose').onclick=()=>{$('#libModal').classList.remove('show');libEditing=null;};
$$('#libTabs button').forEach(b=>{b.onclick=()=>{libTab=b.dataset.tab;libEditing=null;$$('#libTabs button').forEach(x=>x.classList.toggle('active',x===b));renderLib();};});
export function entryMeta(en){
  return en.variants.map((v,i)=>`${i+1}${v.label?'（'+v.label+'）':''}: ${v.prompt||'（空）'}`).join('\n');
}
export function renderLib(){
  const host=$('#libList');host.innerHTML='';
  $('#btnLibFromSel').textContent=libTab==='entry'?'現在の表情から保存':'現在の表情をセットとして保存';
  const list=libTab==='entry'?lib.entries:lib.sets;
  if(!list.length){host.innerHTML='<p class="lib-empty">まだ保存されていません。「＋ 新規」または「現在の表情から保存」で登録してください。</p>';renderLibEditor();return;}
  list.forEach((it,idx)=>{
    const d=document.createElement('div');d.className='lib-item';
    if(libTab==='entry'){
      d.innerHTML=`<div class="li-head"><span class="li-name">${esc(it.name)}</span>
        <span class="ex-badge var">バリエーション ${it.variants.length}</span>
        ${String(it.suppress||'').trim()?'<span class="ex-badge sup">無効化あり</span>':''}
        <span class="li-actions">
          <button class="li-add primary">＋ この表情を追加</button>
          <button class="li-edit">編集</button>
          <button class="li-dup">複製</button>
          <button class="li-up">↑</button><button class="li-down">↓</button>
          <button class="li-del danger">✕</button>
        </span></div>
        <div class="li-meta">${esc(entryMeta(it))}</div>
        ${String(it.suppress||'').trim()?`<div class="li-sup">無効化: ${esc(it.suppress)}${it.suppressOn===false?'（オフ）':''}</div>`:''}`;
      d.querySelector('.li-add').onclick=()=>libApplyEntries([it]);
      d.querySelector('.li-edit').onclick=()=>{libEditing={kind:'entry',idx};renderLibEditor();};
    }else{
      d.innerHTML=`<div class="li-head"><span class="li-name">${esc(it.name)}</span>
        <span class="ex-badge var">${it.items.length} 表情</span>
        <span class="li-actions">
          <button class="li-add primary">＋ セットを追加</button>
          <button class="li-replace">置き換え</button>
          <button class="li-edit">編集</button>
          <button class="li-dup">複製</button>
          <button class="li-up">↑</button><button class="li-down">↓</button>
          <button class="li-del danger">✕</button>
        </span></div>
        <div class="li-meta">${esc(it.items.map(e=>e.name).join(' / ')||'（空）')}</div>`;
      d.querySelector('.li-add').onclick=()=>libApplyEntries(it.items);
      d.querySelector('.li-replace').onclick=()=>libReplaceWithSet(it);
      d.querySelector('.li-edit').onclick=()=>{libEditing={kind:'set',idx};renderLibEditor();};
    }
    d.querySelector('.li-dup').onclick=()=>{
      const c=JSON.parse(JSON.stringify(it));c.id=uid();c.name=it.name+' のコピー';
      list.splice(idx+1,0,c);libSave();renderLib();
    };
    d.querySelector('.li-up').onclick=()=>{if(idx>0){list.splice(idx,1);list.splice(idx-1,0,it);libSave();renderLib();}};
    d.querySelector('.li-down').onclick=()=>{if(idx<list.length-1){list.splice(idx,1);list.splice(idx+1,0,it);libSave();renderLib();}};
    d.querySelector('.li-del').onclick=()=>{
      if(!confirm(`「${it.name}」をライブラリから削除します。よろしいですか？`))return;
      list.splice(idx,1);libEditing=null;libSave();renderLib();
    };
    host.appendChild(d);
  });
  renderLibEditor();
}
export function libApplyEntries(entries){
  const p=state.project;if(!p)return;
  if(!entries.length){toast('追加する表情がありません','err');return;}
  const added=entries.map(entryToExpr);
  p.expressions.push(...added);
  saveProject();renderExpressions();
  $('#libModal').classList.remove('show');
  const first=document.querySelector(`.expr[data-id="${added[0].id}"]`);
  first?.scrollIntoView?.({block:'center',behavior:'smooth'});
  toast(`${added.length} 件の表情を追加しました`,'ok');
}
export async function libReplaceWithSet(set){
  const p=state.project;if(!p)return;
  const doomed=state.allImages.length;
  if(!confirm(`現在の表情 ${p.expressions.length} 件をすべて削除し、セット「${set.name}」の ${set.items.length} 件に置き換えます。よろしいですか？`
    +(doomed?`\n\n生成済みの画像 ${doomed} 枚（全キャラクター分）もあわせて削除されます。`:'')))return;
  for(const im of[...state.allImages])await deleteImage(im.id);
  p.expressions=set.items.map(entryToExpr);
  state.selectedExprs.clear();
  saveProject();renderExpressions();
  $('#libModal').classList.remove('show');
  toast(`セット「${set.name}」で置き換えました`,'ok');
}
$('#btnLibNew').onclick=()=>{
  if(libTab==='entry'){
    lib.entries.push(libNormEntry({name:'新しいテンプレート',variants:[{label:'',prompt:''}]}));
    libEditing={kind:'entry',idx:lib.entries.length-1};
  }else{
    lib.sets.push({id:uid(),name:'新しいセット',items:[]});
    libEditing={kind:'set',idx:lib.sets.length-1};
  }
  libSave();renderLib();
};
$('#btnLibFromSel').onclick=()=>{
  const p=state.project;if(!p)return;
  const sel=p.expressions.filter(e=>state.selectedExprs.has(e.id));
  const src=sel.length?sel:p.expressions;
  if(!src.length){toast('保存する表情がありません','err');return;}
  if(libTab==='entry'){
    const made=src.map(exprToEntry);
    lib.entries.push(...made);libSave();renderLib();
    toast(`${made.length} 件をテンプレートに保存しました${sel.length?'':'（選択がないため全表情）'}`,'ok');
  }else{
    const name=prompt('セット名を入力してください',state.project.name+' のセット');if(name===null)return;
    lib.sets.push({id:uid(),name:name.trim()||'新しいセット',items:src.map(exprToEntry)});
    libSave();renderLib();
    toast(`${src.length} 件をセットとして保存しました`,'ok');
  }
};
$('#btnLibExport').onclick=()=>{
  download(new Blob([JSON.stringify({type:'nai-sprite-library',version:1,entries:lib.entries,sets:lib.sets},null,2)],{type:'application/json'}),'expression_library.json');
  toast('ライブラリを書き出しました','ok');
};
$('#btnLibImport').onclick=()=>$('#libImportFile').click();
$('#libImportFile').addEventListener('change',async e=>{
  const f=e.target.files[0];e.target.value='';if(!f)return;
  try{
    const j=JSON.parse(await f.text());
    const entries=(Array.isArray(j.entries)?j.entries:Array.isArray(j.expressions)?j.expressions:[]).map(libNormEntry);
    const sets=(Array.isArray(j.sets)?j.sets:[]).map(x=>({id:uid(),name:String(x.name||'無題'),items:(x.items||[]).map(libNormEntry)}));
    if(!entries.length&&!sets.length)throw new Error('テンプレートが含まれていません');
    lib.entries.push(...entries);lib.sets.push(...sets);
    libSave();renderLib();
    toast(`テンプレート ${entries.length} 件 / セット ${sets.length} 件を読み込みました`,'ok');
  }catch(err){toast('読み込みに失敗しました: '+err.message,'err');}
});
export function renderLibEditor(){
  const box=$('#libEditor');
  if(!libEditing){box.style.display='none';box.innerHTML='';return;}
  const list=libEditing.kind==='entry'?lib.entries:lib.sets;
  const it=list[libEditing.idx];
  if(!it){libEditing=null;box.style.display='none';box.innerHTML='';return;}
  box.style.display='';
  if(libEditing.kind==='entry'){
    box.innerHTML=`<h3>テンプレートを編集</h3>
      <div class="field"><label>名前</label><input type="text" class="le-name" style="width:100%" value="${esc(it.name)}"></div>
      <h5 style="margin:10px 0 6px;font-size:11px;letter-spacing:.14em;color:var(--accent)">バリエーション</h5>
      <div class="le-vars"></div>
      <div class="btnrow" style="justify-content:flex-start;margin:6px 0 10px"><button class="le-addvar">＋ バリエーションを追加</button></div>
      <div class="row"><label style="min-width:96px">選択方法</label>
        <select class="le-mode" style="flex:1">
          <option value="first">1番目を使う（既定）</option>
          <option value="random">ランダム</option>
          <option value="sequence">順番に使う</option>
        </select></div>
      <div class="field"><label>NEG（この表情だけのネガティブ）</label><textarea class="le-neg" rows="2">${esc(it.neg||'')}</textarea></div>
      <div class="field"><label>無効化タグ（送信プロンプトから削除）</label><textarea class="le-sup" rows="2" placeholder="例: smile, happy">${esc(it.suppress||'')}</textarea></div>
      <div class="row"><label style="min-width:96px">無効化の対象</label>
        <select class="le-scope" style="flex:1">
          <option value="basechar">基礎＋キャラ（既定）</option>
          <option value="base">基礎プロンプトのみ</option>
          <option value="char">キャラプロンプトのみ</option>
          <option value="all">表情プロンプトも含む</option>
        </select></div>
      <div class="row"><label style="min-width:96px">部分一致</label><input type="checkbox" class="le-part"> <span class="unit">タグの中の語も消します</span></div>
      <div class="btnrow"><button class="le-cancel">閉じる</button><button class="le-save primary">保存</button></div>`;
    box.querySelector('.le-mode').value=it.variantMode||'first';
    box.querySelector('.le-scope').value=it.suppressScope||'basechar';
    box.querySelector('.le-part').checked=!!it.suppressPartial;
    const vwrap=box.querySelector('.le-vars');
    const drawVars=()=>{
      vwrap.innerHTML='';
      it.variants.forEach((v,i)=>{
        const r=document.createElement('div');r.className='var-row'+(i===0?' primary':'');
        r.innerHTML=`<div class="vnum">${i+1}</div>
          <input type="text" class="vlabel-in" placeholder="ラベル" value="${esc(v.label||'')}">
          <textarea rows="2" placeholder="プロンプト">${esc(v.prompt||'')}</textarea>
          <div class="vtools"><button class="vup">↑</button><button class="vdn">↓</button><button class="vrm danger">✕</button></div>`;
        r.querySelector('.vlabel-in').addEventListener('input',e=>{v.label=e.target.value;});
        r.querySelector('textarea').addEventListener('input',e=>{v.prompt=e.target.value;});
        r.querySelector('.vup').onclick=()=>{if(i>0){it.variants.splice(i,1);it.variants.splice(i-1,0,v);drawVars();}};
        r.querySelector('.vdn').onclick=()=>{if(i<it.variants.length-1){it.variants.splice(i,1);it.variants.splice(i+1,0,v);drawVars();}};
        r.querySelector('.vrm').onclick=()=>{if(it.variants.length<=1){toast('バリエーションは最低 1 件必要です','err');return;}it.variants.splice(i,1);drawVars();};
        vwrap.appendChild(r);
      });
    };
    drawVars();
    box.querySelector('.le-addvar').onclick=()=>{it.variants.push({label:'',prompt:''});drawVars();};
    box.querySelector('.le-cancel').onclick=()=>{libEditing=null;renderLib();};
    box.querySelector('.le-save').onclick=()=>{
      it.name=box.querySelector('.le-name').value.trim()||it.name;
      it.variantMode=box.querySelector('.le-mode').value;
      it.neg=box.querySelector('.le-neg').value;
      it.suppress=box.querySelector('.le-sup').value;
      it.suppressScope=box.querySelector('.le-scope').value;
      it.suppressPartial=box.querySelector('.le-part').checked;
      it.suppressOn=!!it.suppress.trim();
      libEditing=null;libSave();renderLib();toast('テンプレートを保存しました','ok');
    };
  }else{
    box.innerHTML=`<h3>セットを編集</h3>
      <div class="field"><label>セット名</label><input type="text" class="le-name" style="width:100%" value="${esc(it.name)}"></div>
      <div class="le-items"></div>
      <div class="field"><label>テンプレートから追加</label>
        <div class="row"><select class="le-pick" style="flex:1">${lib.entries.map((e,i)=>`<option value="${i}">${esc(e.name)}</option>`).join('')}</select>
        <button class="le-additem">＋ 追加</button></div></div>
      <div class="btnrow"><button class="le-cancel">閉じる</button><button class="le-save primary">保存</button></div>`;
    const iwrap=box.querySelector('.le-items');
    const drawItems=()=>{
      iwrap.innerHTML='';
      if(!it.items.length){iwrap.innerHTML='<p class="lib-empty">このセットは空です。</p>';return;}
      it.items.forEach((en,i)=>{
        const r=document.createElement('div');r.className='lib-item';
        r.innerHTML=`<div class="li-head"><span class="li-name">${i+1}. ${esc(en.name)}</span>
          <span class="li-actions"><button class="iu">↑</button><button class="idn">↓</button><button class="irm danger">✕</button></span></div>`;
        r.querySelector('.iu').onclick=()=>{if(i>0){it.items.splice(i,1);it.items.splice(i-1,0,en);drawItems();}};
        r.querySelector('.idn').onclick=()=>{if(i<it.items.length-1){it.items.splice(i,1);it.items.splice(i+1,0,en);drawItems();}};
        r.querySelector('.irm').onclick=()=>{it.items.splice(i,1);drawItems();};
        iwrap.appendChild(r);
      });
    };
    drawItems();
    box.querySelector('.le-additem').onclick=()=>{
      const i=+box.querySelector('.le-pick').value;
      const en=lib.entries[i];if(!en){toast('テンプレートがありません','err');return;}
      it.items.push(libNormEntry(JSON.parse(JSON.stringify(en))));drawItems();
    };
    box.querySelector('.le-cancel').onclick=()=>{libEditing=null;renderLib();};
    box.querySelector('.le-save').onclick=()=>{
      it.name=box.querySelector('.le-name').value.trim()||it.name;
      libEditing=null;libSave();renderLib();toast('セットを保存しました','ok');
    };
  }
}
