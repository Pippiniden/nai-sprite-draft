import { deleteProjectData, idb, writeProject } from './db.js';
import { renderExpressions } from './expressions.js';
import { deleteImage } from './images.js';
import { refreshPreciseRefPadding, renderRefCards } from './refs.js';
import { renderSettings, updateNamingPreview } from './settings.js';
import { curChar, ensureCharacters, ensureExprNeg, ensureRefArrays, ensureSettings, newProject, refreshImageScope, saveProject, state } from './state.js';
import { toast } from './ui.js';
import { $, download, esc, sanitize, uid } from './util.js';
import { copyExprData, deserializeExpr, ensureExprShapes, serializeExpr } from './variants.js';

/* ==== Render ==== */
export function renderProjectSelect(){
  const sel=$('#projectSelect');
  sel.innerHTML=state.projects.sort((a,b)=>b.updatedAt-a.updatedAt).map(p=>`<option value="${p.id}" ${state.project&&p.id===state.project.id?'selected':''}>${esc(p.name)}</option>`).join('');
}
/* ---- Character management ---- */
export function renderCharSelect(){
  const p=state.project;if(!p)return;ensureCharacters(p);
  const sel=$('#selChar');
  sel.innerHTML=p.characters.map(c=>`<option value="${c.id}" ${c.id===p.currentCharId?'selected':''}>${esc(c.name)}</option>`).join('');
  const ch=curChar(p);
  $('#txtChar').value=ch.prompt||'';
  $('#txtCharNeg').value=ch.neg||'';
  $('#inpCharExportName').value=ch.exportName||'';
  const showExport=p.settings.namingEnabled;
  $('#charExportNameRow').style.display=showExport?'':'none';
}
$('#selChar').addEventListener('change',e=>{
  state.project.currentCharId=e.target.value;saveProject();
  refreshImageScope();
  renderCharSelect();updateNamingPreview();renderExpressions();
});
$('#btnAddChar').onclick=()=>{
  const name=prompt('新しいキャラクターの名前を入力してください','キャラ'+(state.project.characters.length+1));if(name===null)return;
  const ch={id:uid(),name:name.trim()||'新キャラ',prompt:'',exportName:'',neg:''};
  state.project.characters.push(ch);state.project.currentCharId=ch.id;
  refreshImageScope();
  saveProject();renderCharSelect();updateNamingPreview();renderExpressions();toast(`キャラクター「${ch.name}」を追加しました`,'ok');
};
$('#btnRenameChar').onclick=()=>{
  const ch=curChar(state.project);
  const name=prompt('キャラクターの名前を入力してください',ch.name);if(name===null)return;
  ch.name=name.trim()||ch.name;saveProject();renderCharSelect();
};
$('#btnDupChar').onclick=()=>{
  const src=curChar(state.project);
  const ch={id:uid(),name:src.name+' (コピー)',prompt:src.prompt,exportName:src.exportName,neg:src.neg||''};
  state.project.characters.push(ch);state.project.currentCharId=ch.id;
  refreshImageScope();
  saveProject();renderCharSelect();updateNamingPreview();renderExpressions();toast('キャラクターを複製しました（生成済みの画像は引き継がれません）','ok');
};
$('#btnDelChar').onclick=async()=>{
  const p=state.project;if(p.characters.length<=1){toast('キャラクターは最低 1 件必要なため、削除できません','err');return;}
  const ch=curChar(p);
  const owned=state.allImages.filter(i=>i.charId===ch.id);
  let msg=`キャラクター「${ch.name}」を削除します。よろしいですか？`;
  if(owned.length){
    const adopted=owned.filter(i=>i.adopted).length,held=owned.filter(i=>i.held).length;
    msg+=`\n\nこのキャラクターの生成済み画像 ${owned.length} 枚もあわせて削除されます。`;
    if(adopted||held)msg+=`\n（採用済み ${adopted} 枚、保留中 ${held} 枚を含みます）`;
    msg+='\n書き出していない画像は復元できません。';
  }
  if(!confirm(msg))return;
  for(const im of owned)await deleteImage(im.id);
  p.characters=p.characters.filter(c=>c.id!==ch.id);
  p.currentCharId=p.characters[0].id;
  refreshImageScope();
  saveProject();renderCharSelect();updateNamingPreview();renderExpressions();toast('削除しました','ok');
};

/* ---- Project ops ---- */
export async function loadProject(id){
  const p=state.projects.find(x=>x.id===id);if(!p)return;
  ensureRefArrays(p);ensureSettings(p);ensureCharacters(p);ensureExprNeg(p);ensureExprShapes(p);state.project=p;
  localStorage.setItem('nai_last_project',id);
  // release object URLs from the previous project before loading the new one
  for(const u of state.urlCache.values())URL.revokeObjectURL(u);
  state.urlCache.clear();
  state.allImages=await idb.byProject(id);
  // migrate old images missing held flag / character ownership
  const orphans=[];
  for(const im of state.allImages){
    if(im.held===undefined)im.held=false;
    if(!im.charId||!p.characters.some(c=>c.id===im.charId)){im.charId=p.characters[0].id;orphans.push(im);}
  }
  if(orphans.length)await Promise.all(orphans.map(im=>idb.put('images',im)));
  refreshImageScope();
  renderProjectSelect();renderSettings();renderExpressions();
  refreshPreciseRefPadding().then(()=>renderRefCards());
}
$('#projectSelect').addEventListener('change',e=>loadProject(e.target.value));
$('#btnNewProject').onclick=async()=>{const name=prompt('新しいプロジェクトの名前を入力してください','新規プロジェクト');if(name===null)return;const p=newProject(name.trim()||'新規プロジェクト');state.projects.push(p);await writeProject(p);await loadProject(p.id);};
$('#btnDupProject').onclick=async()=>{
  if(!state.project)return;const src=state.project;
  const p=JSON.parse(JSON.stringify(src));
  p.id=uid();p.name=src.name+' のコピー';p.createdAt=p.updatedAt=Date.now();
  p.expressions=src.expressions.map(e=>copyExprData(e));
  state.projects.push(p);await writeProject(p);await loadProject(p.id);
  toast('プロジェクトを複製しました（生成済みの画像はコピーされません）','ok');
};
$('#btnDelProject').onclick=async()=>{
  if(!state.project)return;const p=state.project;
  if(!confirm(`プロジェクト「${p.name}」を削除します。よろしいですか？\n\n生成済みの画像 ${state.allImages.length} 枚（全キャラクター分）もあわせて削除されます。この操作は取り消せません。`))return;
  for(const im of[...state.allImages])await idb.del('images',im.id);
  await deleteProjectData(p.id);state.projects=state.projects.filter(x=>x.id!==p.id);
  if(!state.projects.length){const np=newProject('新規プロジェクト');state.projects.push(np);await writeProject(np);}
  await loadProject(state.projects[0].id);toast('削除しました','ok');
};

/* ---- Backup / Restore ---- */
$('#btnBackup').onclick=()=>{
  if(!state.project)return;const p=state.project;
  ensureCharacters(p);
  const data={type:'nai-sprite-backup',version:4,name:p.name,basePrompt:p.basePrompt,negPrompt:p.negPrompt,characters:p.characters.map(c=>({name:c.name,prompt:c.prompt,exportName:c.exportName||'',neg:c.neg||''})),settings:p.settings,vibes:p.vibes.map(v=>({id:v.id,base64:v.base64,infoExtracted:v.infoExtracted,strength:v.strength,encoded:v.encoded||{}})),preciseRefs:p.preciseRefs.map(r=>({id:r.id,base64:r.base64,strength:r.strength,fidelity:r.fidelity,styleAware:!!r.styleAware})),i2iImages:p.i2iImages||[],expressions:p.expressions.map(serializeExpr)};
  download(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),sanitize(p.name)+'_backup.json');
  toast('バックアップを書き出しました','ok');
};
$('#btnRestore').onclick=()=>$('#restoreFile').click();
$('#restoreFile').addEventListener('change',async e=>{
  const f=e.target.files[0];e.target.value='';if(!f)return;
  try{
    const j=JSON.parse(await f.text());
    const p=newProject(j.name||'復元プロジェクト');
    if(j.basePrompt!==undefined)p.basePrompt=j.basePrompt;
    if(j.negPrompt!==undefined)p.negPrompt=j.negPrompt;
    if(Array.isArray(j.characters)&&j.characters.length){
      p.characters=j.characters.map(c=>({id:uid(),name:c.name||'',prompt:c.prompt||'',exportName:c.exportName||'',neg:c.neg||''}));
      p.currentCharId=p.characters[0].id;
    }else if(j.charPrompt!==undefined){
      p.characters=[{id:uid(),name:'キャラ1',prompt:j.charPrompt,exportName:'',neg:''}];p.currentCharId=p.characters[0].id;
    }
    if(j.settings)Object.assign(p.settings,j.settings);
    // Every reference needs its own id: per-expression on/off toggles are keyed by it.
    // Backups older than v21 carry none, so mint fresh ones for those.
    const withIds=list=>Array.isArray(list)?list.map(r=>({...r,id:r.id||uid()})):[];
    if(j.vibes)p.vibes=withIds(j.vibes);
    if(j.preciseRefs)p.preciseRefs=withIds(j.preciseRefs);
    if(j.i2iImages)p.i2iImages=withIds(j.i2iImages);
    if(Array.isArray(j.expressions)){
      p.expressions=j.expressions.map(deserializeExpr);
      // keep only toggles that still point at a restored reference
      const known=new Set([...p.vibes,...p.preciseRefs,...p.i2iImages].map(r=>r.id));
      for(const ex of p.expressions)for(const k of Object.keys(ex.refConfig||{}))if(!known.has(k))delete ex.refConfig[k];
    }
    state.projects.push(p);await writeProject(p);await loadProject(p.id);
    toast('バックアップから復元しました','ok');
  }catch(err){toast('復元に失敗しました: '+err.message,'err');}
});
