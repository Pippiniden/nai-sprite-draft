import { renderExpressions } from './expressions.js';
import { saveProject, state } from './state.js';
import { toast } from './ui.js';
import { $, esc, escapeRe } from './util.js';
import { ensureExprShape } from './variants.js';

/* ---- Bulk prompt editing ----
   Insert or remove a string across many expressions at once. Removal can work on
   whole comma-separated tags (so deleting `smile` leaves `smiling` alone) or on raw
   substrings. Every path runs through bulkTransform, so the preview shown to the
   user is produced by exactly the same code that performs the edit. */
export function tidyCommas(s){
  return s.replace(/[^\S\n]{2,}/g,' ')
          .replace(/,[^\S\n]*(?:,[^\S\n]*)+/g,', ')
          .replace(/[^\S\n]+,/g,',')
          .replace(/^[\s,]+/,'')
          .replace(/[\s,]+$/,'');
}
export const splitTags=s=>String(s||'').split(',').map(t=>t.trim()).filter(Boolean);
export function bulkContains(src,ins,cfg){
  const norm=t=>cfg.ci?t.toLowerCase():t;
  if(cfg.tagMode){
    const have=new Set(splitTags(src).map(norm));
    const want=splitTags(ins);
    return want.length>0&&want.every(t=>have.has(norm(t)));
  }
  return norm(src).includes(norm(ins));
}
export function bulkTransform(cur,cfg){
  const src=String(cur||''),ins=cfg.text;
  if(!ins.trim())return src;
  if(cfg.op==='remove'){
    if(cfg.tagMode){
      const norm=t=>cfg.ci?t.toLowerCase():t;
      const drop=new Set(splitTags(ins).map(norm));
      const kept=splitTags(src).filter(t=>!drop.has(norm(t)));
      return kept.join(', ');
    }
    const re=new RegExp(escapeRe(ins),cfg.ci?'gi':'g');
    return tidyCommas(src.replace(re,''));
  }
  if(cfg.skipDup&&bulkContains(src,ins,cfg))return src;
  const body=src.trim();
  if(!body)return ins.trim();
  // With a comma separator the spacing is ours to normalise; without one the user is
  // concatenating deliberately (`:1.2`, `very `), so their whitespace is left alone.
  const add=cfg.comma?ins.trim():ins;
  const sep=cfg.comma?', ':'';
  return cfg.op==='prepend'?add+sep+body:body+sep+add;
}
export let bulkUndo=null;
export function bulkCfg(){
  return{
    scope:$('#bulkScope').value,
    field:$('#bulkField').value,
    op:$('#bulkOp').value,
    text:$('#bulkText').value,
    comma:$('#bulkComma').checked,
    skipDup:$('#bulkSkip').checked,
    tagMode:$('#bulkTagMode').checked,
    ci:$('#bulkCase').checked
  };
}
export function bulkTargets(cfg){
  const p=state.project;if(!p)return[];
  return cfg.scope==='sel'?p.expressions.filter(e=>state.selectedExprs.has(e.id)):p.expressions;
}
export function renderBulkPreview(){
  const cfg=bulkCfg(),isIns=cfg.op!=='remove';
  $('#bulkTextLabel').textContent=isIns?'挿入する文字列':'削除する文字列';
  $('#bulkText').placeholder=isIns?'例: blush, looking at viewer':'例: smile';
  $('#bulkCommaRow').style.display=isIns?'':'none';
  $('#bulkSkipRow').style.display=isIns?'':'none';
  $('#bulkCommaHint').textContent=cfg.op==='prepend'
    ?'挿入する文字列の後ろに「, 」を付けます'
    :'挿入する文字列の前に「, 」を付けます';
  const targets=bulkTargets(cfg);
  const wrap=$('#bulkPreview');wrap.innerHTML='';
  if(!targets.length){wrap.innerHTML='<p class="bp-empty">対象の表情がありません。</p>';$('#bulkCount').textContent='';return;}
  if(!cfg.text.trim()){wrap.innerHTML='<p class="bp-empty">文字列を入力するとプレビューが表示されます。</p>';$('#bulkCount').textContent='';return;}
  const changed=[];
  for(const e of targets){
    const before=e[cfg.field]||'';
    const after=bulkTransform(before,cfg);
    if(after!==before)changed.push({e,before,after});
  }
  $('#bulkCount').textContent=`— ${targets.length} 件中 ${changed.length} 件が変更されます`;
  if(!changed.length){wrap.innerHTML='<p class="bp-empty">変更される表情はありません。</p>';return;}
  for(const c of changed.slice(0,12)){
    const d=document.createElement('div');d.className='bp-row';
    d.innerHTML=`<div class="bp-name">${esc(c.e.name)}</div>`
      +`<div class="bp-before">${esc(c.before||'（空）')}</div>`
      +`<div class="bp-after">${esc(c.after||'（空）')}</div>`;
    wrap.appendChild(d);
  }
  if(changed.length>12){
    const d=document.createElement('div');d.className='bp-row bp-empty';
    d.textContent=`…ほか ${changed.length-12} 件`;wrap.appendChild(d);
  }
}
export function openBulkModal(){
  const p=state.project;if(!p)return;
  const sel=state.selectedExprs.size;
  $('#bulkScope').innerHTML=
    `<option value="sel"${sel?' selected':''}>選択した表情（${sel} 件）</option>`
    +`<option value="all"${sel?'':' selected'}>すべての表情（${p.expressions.length} 件）</option>`;
  if(!sel)$('#bulkScope').value='all';
  $('#btnBulkUndo').disabled=!bulkUndo;
  renderBulkPreview();
  $('#bulkModal').classList.add('show');
  $('#bulkText').focus();
}
$('#btnBulkPrompt').onclick=openBulkModal;
$('#btnBulkCancel').onclick=()=>$('#bulkModal').classList.remove('show');
['#bulkScope','#bulkField','#bulkOp','#bulkText','#bulkComma','#bulkSkip','#bulkTagMode','#bulkCase']
  .forEach(s=>{const el=$(s);el.addEventListener('input',renderBulkPreview);el.addEventListener('change',renderBulkPreview);});
$('#btnBulkApply').onclick=()=>{
  const cfg=bulkCfg();
  if(!cfg.text.trim()){toast('文字列を入力してください','err');return;}
  const targets=bulkTargets(cfg);
  if(!targets.length){toast('対象の表情がありません','err');return;}
  const snapshot=[];
  for(const e of targets){
    const before=e[cfg.field]||'';
    const after=bulkTransform(before,cfg);
    if(after!==before){snapshot.push({id:e.id,before});e[cfg.field]=after;}
  }
  if(!snapshot.length){toast('変更される表情はありませんでした');return;}
  bulkUndo={field:cfg.field,items:snapshot};
  if(cfg.field==='prompt')for(const e of targets){ensureExprShape(e);e.variants[0].prompt=e.prompt||'';}
  saveProject();renderExpressions();
  $('#bulkModal').classList.remove('show');
  toast(`${snapshot.length} 件の表情を更新しました`,'ok');
};
$('#btnBulkUndo').onclick=()=>{
  if(!bulkUndo)return;
  const p=state.project;if(!p)return;
  let n=0;
  for(const it of bulkUndo.items){
    const e=p.expressions.find(x=>x.id===it.id);
    if(e){e[bulkUndo.field]=it.before;n++;}
  }
  bulkUndo=null;$('#btnBulkUndo').disabled=true;
  p.expressions.forEach(e=>{ensureExprShape(e);e.variants[0].prompt=e.prompt||'';});
  saveProject();renderExpressions();renderBulkPreview();
  $('#bulkModal').classList.remove('show');
  toast(`${n} 件を元に戻しました`,'ok');
};
