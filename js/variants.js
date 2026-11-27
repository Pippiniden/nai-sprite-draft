import { buildPayload } from './api.js';
import { renderExpressions } from './expressions.js';
import { queue } from './queue.js';
import { QUALITY_TAGS, curChar, saveProject, state } from './state.js';
import { toast } from './ui.js';
import { $, esc, escapeRe, uid } from './util.js';

/* ================= Expression variants / suppression / template library =================
   Three related features live here.

   1. Variants  — an expression may hold several alternative prompts. The first one is
      the primary and is kept in sync with `ex.prompt`, so every pre-existing code path
      (bulk edit, backup, export) keeps working on it untouched. Which variant a given
      image uses is decided at queue time by `variantMode`: first / random / sequence.

   2. Suppression — tags that must not reach the API for this expression, even when the
      base or character prompt contains them. Unlike a negative prompt this physically
      removes the tag from the caption, which is what you want when the shared prompt
      says `smile` and this expression is supposed to be angry.

   3. Library  — expressions (and whole sets of them) saved in localStorage, so they are
      available from every project rather than being trapped in the one they were made in. */

export function ensureExprShape(ex){
  if(!ex)return ex;
  if(!Array.isArray(ex.variants)||!ex.variants.length){
    ex.variants=[{id:uid(),label:'',prompt:ex.prompt||''}];
  }else{
    for(const v of ex.variants){
      if(!v.id)v.id=uid();
      if(typeof v.prompt!=='string')v.prompt=String(v.prompt||'');
      if(typeof v.label!=='string')v.label='';
    }
    // `ex.prompt` is authoritative: bulk edit and older builds only know about it.
    if(ex.prompt!==undefined&&ex.variants[0].prompt!==ex.prompt)ex.variants[0].prompt=ex.prompt||'';
  }
  if(ex.prompt===undefined)ex.prompt=ex.variants[0].prompt;
  if(!ex.variantMode)ex.variantMode='first';
  if(typeof ex.varCursor!=='number')ex.varCursor=0;
  if(ex.suppress===undefined)ex.suppress='';
  if(ex.suppressOn===undefined)ex.suppressOn=!!String(ex.suppress||'').trim();
  if(!ex.suppressScope)ex.suppressScope='basechar';
  if(ex.suppressPartial===undefined)ex.suppressPartial=false;
  if(!ex.refConfig)ex.refConfig={};
  return ex;
}
export function ensureExprShapes(p){if(p&&Array.isArray(p.expressions))p.expressions.forEach(ensureExprShape);}
export function newExpr(name){return ensureExprShape({id:uid(),name:name||'新しい表情',prompt:'',neg:'',refConfig:{}});}

/* ---- tag arithmetic ---- */
/* Reduce a tag to something comparable: drop grouping braces and the two weight
   notations NovelAI accepts (`1.2::tag::` and `tag:1.2`). */
export function canonTag(t){
  let x=String(t||'').trim();
  for(let i=0;i<4;i++){
    x=x.replace(/^[{}\[\]()\s]+/,'').replace(/[{}\[\]()\s]+$/,'');
    x=x.replace(/^-?\d+(?:\.\d+)?\s*::/,'').replace(/::$/,'');
    x=x.replace(/:\s*-?\d+(?:\.\d+)?$/,'');
  }
  return x.trim().toLowerCase();
}
export function tokMatch(canon,tok){
  if(!canon||!tok)return false;
  if(tok.includes('*')){
    try{return new RegExp('^'+tok.split('*').map(escapeRe).join('.*')+'$').test(canon);}catch(_){return false;}
  }
  return canon===tok;
}
/* Remove every tag matching one of `toks`. With `partial`, a token that appears as a
   whole word inside a longer tag is cut out of that tag instead of dropping it. */
export function stripTokens(text,toks,partial){
  const removed=[],out=[];
  for(const raw of String(text||'').split(',')){
    const t=raw.trim();
    if(!t)continue;
    const c=canonTag(t);
    if(toks.some(tk=>tokMatch(c,tk))){removed.push(t);continue;}
    if(partial){
      let cur=t,hit=false;
      for(const tk of toks){
        if(tk.includes('*'))continue;
        let re;try{re=new RegExp('(^|[^0-9A-Za-z_])'+escapeRe(tk)+'(?![0-9A-Za-z_])','gi');}catch(_){continue;}
        if(re.test(cur)){hit=true;cur=cur.replace(re,'$1');}
      }
      if(hit){
        cur=cur.replace(/\s{2,}/g,' ').trim();
        removed.push(t);
        if(canonTag(cur))out.push(cur);
        continue;
      }
    }
    out.push(t);
  }
  return{text:out.join(', '),removed};
}
export function supTokens(ex){
  if(!ex||ex.suppressOn===false)return[];
  return String(ex.suppress||'').split(',').map(canonTag).filter(Boolean);
}

/* ---- variant selection ---- */
export function variantLabel(ex,i){
  ensureExprShape(ex);
  const v=ex.variants[i];if(!v)return'';
  return (v.label||'').trim()||('#'+(i+1));
}
export function pickVariantIdx(ex,advance){
  ensureExprShape(ex);
  const n=ex.variants.length;
  if(n<=1)return 0;
  const m=ex.variantMode||'first';
  if(m==='random')return Math.floor(Math.random()*n);
  if(m==='sequence'){
    const c=((ex.varCursor|0)%n+n)%n;
    if(advance!==false){ex.varCursor=(c+1)%n;saveProject();}
    return c;
  }
  return 0;
}

/* ---- prompt composition (shared by buildPayload and the preview) ---- */
export function composeParts(project,expr,ch,vIdx){
  ensureExprShape(expr);
  const i=Math.max(0,Math.min(vIdx|0,expr.variants.length-1));
  let exprPrompt=expr.variants[i]?.prompt||'';
  let base=project.basePrompt||'',charPrompt=ch?.prompt||'';
  const toks=supTokens(expr);
  const removed=[];
  if(toks.length){
    const sc=expr.suppressScope||'basechar',part=!!expr.suppressPartial;
    if(sc==='basechar'||sc==='base'||sc==='all'){const r=stripTokens(base,toks,part);base=r.text;removed.push(...r.removed);}
    if(sc==='basechar'||sc==='char'||sc==='all'){const r=stripTokens(charPrompt,toks,part);charPrompt=r.text;removed.push(...r.removed);}
    if(sc==='all'){const r=stripTokens(exprPrompt,toks,part);exprPrompt=r.text;removed.push(...r.removed);}
  }
  return{base,charPrompt,exprPrompt,exprNeg:expr.neg||'',charNeg:ch?.neg||'',baseNeg:project.negPrompt||'',removed,variantIdx:i,variantLabel:variantLabel(expr,i)};
}

/* ---- conversion helpers (clone / serialise / library) ---- */
export function copyExprData(e,name){
  ensureExprShape(e);
  return{id:uid(),name:name??e.name,prompt:e.prompt,
    variants:e.variants.map(v=>({id:uid(),label:v.label||'',prompt:v.prompt||''})),
    variantMode:e.variantMode||'first',varCursor:0,neg:e.neg||'',
    suppress:e.suppress||'',suppressOn:e.suppressOn!==false,suppressScope:e.suppressScope||'basechar',
    suppressPartial:!!e.suppressPartial,refConfig:e.refConfig?{...e.refConfig}:{}};
}
export function serializeExpr(e){
  ensureExprShape(e);
  return{name:e.name,prompt:e.prompt,
    variants:e.variants.map(v=>({label:v.label||'',prompt:v.prompt||''})),
    variantMode:e.variantMode||'first',neg:e.neg||'',
    suppress:e.suppress||'',suppressOn:e.suppressOn!==false,suppressScope:e.suppressScope||'basechar',
    suppressPartial:!!e.suppressPartial,refConfig:e.refConfig||{}};
}
export function deserializeExpr(x){
  const vs=(Array.isArray(x.variants)&&x.variants.length?x.variants:[{label:'',prompt:x.prompt||''}])
    .map(v=>({id:uid(),label:String(v.label||''),prompt:String(v.prompt||'')}));
  return{id:uid(),name:String(x.name||'新しい表情'),prompt:vs[0].prompt,variants:vs,
    variantMode:x.variantMode||'first',varCursor:0,neg:String(x.neg||''),
    suppress:String(x.suppress||''),suppressOn:x.suppressOn!==false,suppressScope:x.suppressScope||'basechar',
    suppressPartial:!!x.suppressPartial,refConfig:x.refConfig||{}};
}
/* ---- per-expression variant / suppression UI ---- */
export const exprOpen=new Set();
export function renderExprExtra(ex){
  const host=document.querySelector(`.expr-extra[data-xid="${ex.id}"]`);if(!host)return;
  ensureExprShape(ex);
  host.innerHTML='';
  const open=exprOpen.has(ex.id);
  const nv=ex.variants.length,ns=supTokens(ex).length;
  const bar=document.createElement('div');bar.className='ex-bar';
  const tog=document.createElement('button');tog.className='ex-toggle';
  tog.textContent=(open?'▾ ':'▸ ')+`バリエーション / 無効化`;
  tog.onclick=()=>{open?exprOpen.delete(ex.id):exprOpen.add(ex.id);renderExprExtra(ex);};
  bar.appendChild(tog);
  const vb=document.createElement('span');vb.className='ex-badge var';vb.textContent=`候補 ${nv}`;bar.appendChild(vb);
  if(nv>1){
    const w=document.createElement('span');w.className='mode-wrap';
    w.innerHTML=`<span>選択</span><select class="varmode">
      <option value="first">1番目</option><option value="random">ランダム</option><option value="sequence">順番</option></select>`;
    const sel=w.querySelector('select');sel.value=ex.variantMode||'first';
    sel.onchange=()=>{ex.variantMode=sel.value;if(sel.value==='sequence')ex.varCursor=0;saveProject();renderExprExtra(ex);};
    bar.appendChild(w);
    if((ex.variantMode||'first')==='sequence'){
      const n=document.createElement('span');n.className='ex-badge';
      n.textContent=`次: ${variantLabel(ex,((ex.varCursor|0)%nv+nv)%nv)}`;
      n.title='クリックで先頭に戻す';n.style.cursor='pointer';
      n.onclick=()=>{ex.varCursor=0;saveProject();renderExprExtra(ex);};
      bar.appendChild(n);
    }
  }
  if(ns){const sb=document.createElement('span');sb.className='ex-badge sup';sb.textContent=`無効化 ${ns}`;bar.appendChild(sb);}
  host.appendChild(bar);
  if(!open)return;

  const body=document.createElement('div');body.className='ex-body';
  const vh=document.createElement('h5');vh.textContent='プロンプトのバリエーション';body.appendChild(vh);
  const vwrap=document.createElement('div');body.appendChild(vwrap);
  const drawVars=()=>{
    vwrap.innerHTML='';
    ex.variants.forEach((v,i)=>{
      const r=document.createElement('div');r.className='var-row'+(i===0?' primary':'');r.dataset.vi=i;
      r.innerHTML=`<div class="vnum">${i+1}</div>
        <input type="text" class="vlabel-in" placeholder="ラベル" value="${esc(v.label||'')}">
        <textarea rows="2" placeholder="${i===0?'このプロンプトが 1 番目（上の欄と共通）':'プロンプト'}">${esc(v.prompt||'')}</textarea>
        <div class="vtools"><button class="vdup" title="複製">⧉</button><button class="vup" title="上へ">↑</button><button class="vdn" title="下へ">↓</button><button class="vrm danger" title="削除">✕</button></div>`;
      r.querySelector('.vlabel-in').addEventListener('input',e=>{v.label=e.target.value;saveProject();});
      r.querySelector('textarea').addEventListener('input',e=>{
        v.prompt=e.target.value;
        if(i===0){
          ex.prompt=e.target.value;
          const head=document.querySelector(`.expr[data-id="${ex.id}"] .expr-head textarea.prompt`);
          if(head)head.value=e.target.value;
        }
        saveProject();
      });
      r.querySelector('.vdup').onclick=()=>{ex.variants.splice(i+1,0,{id:uid(),label:(v.label||'')+' コピー',prompt:v.prompt});saveProject();drawVars();renderExprExtra(ex);};
      r.querySelector('.vup').onclick=()=>{if(i>0){ex.variants.splice(i,1);ex.variants.splice(i-1,0,v);syncPrimary(ex);saveProject();renderExpressions();}};
      r.querySelector('.vdn').onclick=()=>{if(i<ex.variants.length-1){ex.variants.splice(i,1);ex.variants.splice(i+1,0,v);syncPrimary(ex);saveProject();renderExpressions();}};
      r.querySelector('.vrm').onclick=()=>{
        if(ex.variants.length<=1){toast('バリエーションは最低 1 件必要です','err');return;}
        ex.variants.splice(i,1);syncPrimary(ex);saveProject();renderExpressions();
      };
      vwrap.appendChild(r);
    });
  };
  drawVars();
  const addRow=document.createElement('div');addRow.className='btnrow';addRow.style.margin='6px 0 2px';
  const addBtn=document.createElement('button');addBtn.textContent='＋ バリエーションを追加';
  addBtn.onclick=()=>{ex.variants.push({id:uid(),label:'',prompt:''});saveProject();renderExprExtra(ex);};
  addRow.appendChild(addBtn);
  const peekBtn=document.createElement('button');peekBtn.textContent='👁 送信プロンプトを確認';
  peekBtn.onclick=()=>openPeek(ex);
  addRow.appendChild(peekBtn);
  body.appendChild(addRow);

  const sup=document.createElement('div');sup.className='sup-block';
  sup.innerHTML=`<h5>この表情だけプロンプトを無効化</h5>
    <div class="row"><label>有効</label><input type="checkbox" class="sup-on"> <span class="unit">共通・キャラプロンプトから下のタグを取り除いて送信します（ネガティブではありません）</span></div>
    <textarea class="sup-txt" rows="2" placeholder="例: smile, happy, grin（カンマ区切り。* でワイルドカード）">${esc(ex.suppress||'')}</textarea>
    <div class="row"><label>対象</label>
      <select class="sup-scope" style="flex:1">
        <option value="basechar">基礎＋キャラプロンプト（既定）</option>
        <option value="base">基礎プロンプトのみ</option>
        <option value="char">キャラプロンプトのみ</option>
        <option value="all">表情プロンプトも含む</option>
      </select></div>
    <div class="row"><label>部分一致</label><input type="checkbox" class="sup-part"> <span class="unit">「open mouth smile」の中の smile も消します</span></div>
    <div class="sup-removed"></div>`;
  const supOn=sup.querySelector('.sup-on');supOn.checked=ex.suppressOn!==false;
  const supScope=sup.querySelector('.sup-scope');supScope.value=ex.suppressScope||'basechar';
  const supPart=sup.querySelector('.sup-part');supPart.checked=!!ex.suppressPartial;
  const supTxt=sup.querySelector('.sup-txt');
  const showRemoved=()=>{
    const el=sup.querySelector('.sup-removed');
    const p=state.project;if(!p){el.textContent='';return;}
    const parts=composeParts(p,ex,curChar(p),0);
    el.innerHTML=parts.removed.length
      ? `実際に削除されるタグ: <b>${esc([...new Set(parts.removed)].join(', '))}</b>`
      : (supTokens(ex).length?'一致するタグは現在のプロンプトにありません。':'');
  };
  supOn.onchange=()=>{ex.suppressOn=supOn.checked;saveProject();showRemoved();renderExprExtra(ex);};
  supScope.onchange=()=>{ex.suppressScope=supScope.value;saveProject();showRemoved();};
  supPart.onchange=()=>{ex.suppressPartial=supPart.checked;saveProject();showRemoved();};
  supTxt.addEventListener('input',()=>{
    const wasEmpty=!String(ex.suppress||'').trim();
    ex.suppress=supTxt.value;
    // Typing the first tag switches the feature on; otherwise nothing would happen and
    // it would look broken. Turning it off afterwards stays the user's decision.
    if(wasEmpty&&supTxt.value.trim()&&ex.suppressOn===false){ex.suppressOn=true;supOn.checked=true;}
    saveProject();showRemoved();
  });
  supTxt.addEventListener('change',()=>renderExprExtra(ex));
  body.appendChild(sup);
  host.appendChild(body);
  showRemoved();
}
export function syncPrimary(ex){ensureExprShape(ex);ex.prompt=ex.variants[0].prompt||'';}

/* ---- prompt preview ---- */
export function openPeek(ex){
  const p=state.project;if(!p)return;
  ensureExprShape(ex);
  const ch=curChar(p);
  $('#peekTitle').textContent=`送信プロンプトの確認 — ${ex.name}`;
  $('#peekLead').textContent=p.settings.charSlot
    ? '「キャラ枠で送信」がオンのため、基礎とキャラ枠に分かれて送信されます。'
    : '「キャラ枠で送信」がオフのため、すべて 1 本に連結して送信されます。';
  const host=$('#peekBody');host.innerHTML='';
  const join=(...a)=>a.map(t=>(t||'').trim()).filter(Boolean).join(', ');
  ex.variants.forEach((v,i)=>{
    const c=composeParts(p,ex,ch,i);
    const d=document.createElement('div');d.className='peek-block';
    let rows='';
    if(p.settings.charSlot){
      let base=join(c.base);if(p.settings.quality)base+=(QUALITY_TAGS[p.settings.model]||'');
      rows+=`<div class="pk-row"><div class="pk-key">基礎</div><div class="pk-val">${esc(base||'（空）')}</div></div>`;
      rows+=`<div class="pk-row"><div class="pk-key">キャラ枠</div><div class="pk-val">${esc(join(c.charPrompt,c.exprPrompt)||'（空）')}</div></div>`;
      rows+=`<div class="pk-row"><div class="pk-key">基礎ネガティブ</div><div class="pk-val neg">${esc(join(c.baseNeg)||'（空）')}</div></div>`;
      rows+=`<div class="pk-row"><div class="pk-key">キャラ枠ネガティブ</div><div class="pk-val neg">${esc(join(c.charNeg,c.exprNeg)||'（空）')}</div></div>`;
    }else{
      let all=join(c.base,c.charPrompt,c.exprPrompt);if(p.settings.quality)all+=(QUALITY_TAGS[p.settings.model]||'');
      rows+=`<div class="pk-row"><div class="pk-key">プロンプト</div><div class="pk-val">${esc(all||'（空）')}</div></div>`;
      rows+=`<div class="pk-row"><div class="pk-key">ネガティブ</div><div class="pk-val neg">${esc(join(c.baseNeg,c.charNeg,c.exprNeg)||'（空）')}</div></div>`;
    }
    if(c.removed.length)rows+=`<div class="pk-cut">無効化で削除: ${esc([...new Set(c.removed)].join(', '))}</div>`;
    d.innerHTML=`<h4>${i+1}. ${esc(variantLabel(ex,i))}${i===0?'（既定）':''}</h4>${rows}`;
    host.appendChild(d);
  });
  const mode=ex.variantMode||'first';
  const note=document.createElement('p');note.className='hint';
  note.textContent=ex.variants.length<=1?'バリエーションは 1 件です。'
    :(mode==='random'?'複数回生成すると、毎回ランダムに 1 件が選ばれます。'
    :mode==='sequence'?'複数回生成すると、上から順番に使われます。'
    :'常に 1 番目が使われます（選択方法で変更できます）。');
  host.appendChild(note);
  $('#peekModal').classList.add('show');
}
$('#btnPeekClose').onclick=()=>$('#peekModal').classList.remove('show');
