import { keepAliveOff, keepAliveOn } from './keepalive.js';
import { renderCharSelect, renderProjectSelect } from './project.js';
import { queue } from './queue.js';
import { renderRefCards } from './refs.js';
import { curChar, ensureCharacters, ensureSettings, saveProject, state } from './state.js';
import { $, sanitize } from './util.js';

export function renderSettings(){
  const p=state.project;if(!p)return;const s=p.settings;ensureSettings(p);
  $('#inpProjectName').value=p.name;$('#selModel').value=s.model;$('#selSize').value=s.sizePreset;
  $('#rowCustomSize').style.display=s.sizePreset==='custom'?'':'none';
  $('#inpWidth').value=s.width;$('#inpHeight').value=s.height;
  $('#inpSteps').value=s.steps;$('#inpScale').value=s.scale;
  $('#selSampler').value=s.sampler;$('#selNoise').value=s.noiseSchedule;
  $('#inpRescale').value=s.cfgRescale;$('#inpCount').value=s.count;$('#inpDelay').value=s.delaySec;
  $('#selOrder').value=s.order||'grouped';updateOrderHint();
  $('#chkQuality').checked=!!s.quality;$('#chkJitter').checked=!!s.jitter;
  $('#chkBgKeep').checked=s.bgKeepAlive!==false;updateBgKeepHint();
  $('#inpJitterMin').value=s.jitterMin??0;$('#inpJitterMax').value=s.jitterMax??10;
  $('#jitterRange').classList.toggle('off',!s.jitter);
  $('#chkNaming').checked=!!s.namingEnabled;
  $('#inpSeparator').value=s.namingSeparator??'_';
  $('#namingBlock').classList.toggle('off',!s.namingEnabled);
  updateNamingPreview();
  $('#txtBase').value=p.basePrompt;$('#txtNeg').value=p.negPrompt;
  $('#chkCharSlot').checked=!!s.charSlot;updateCharSlotHint();
  renderCharSelect();
  updateAnlasWarn();renderRefCards();
}
export function refWarnText(){
  const p=state.project;const pr=p.preciseRefs?.length||0;
  let t='⚠ 参照画像を使う生成は Opus の無料枠の対象外となり、Anlas を消費します。';
  if(pr)t+=`（精密参照 ${pr} 件で 1 枚あたり +${pr*5} Anlas）`;
  return t;
}
export function updateAnlasWarn(){
  const s=state.project?.settings;if(!s)return;
  const hasRefs=(state.project.vibes?.length||0)+(state.project.preciseRefs?.length||0)+(state.project.i2iImages?.length||0)>0;
  const over=(s.width*s.height>1216*832)||s.steps>28||hasRefs;
  $('#anlasWarn').textContent=hasRefs?refWarnText():'⚠ この画像サイズ・ステップ数は Opus の無料枠を超えるため、Anlas を消費する可能性があります。';
  $('#anlasWarn').classList.toggle('show',over);
}
/* ---- Settings handlers ---- */
export function bind(id,fn){$(id).addEventListener('input',e=>{fn(e.target);saveProject();});}
bind('#inpProjectName',t=>{state.project.name=t.value;renderProjectSelect();});
// Vibe encodings are per model, so the Encoded / 要再エンコード badges must follow it.
bind('#selModel',t=>{state.project.settings.model=t.value;renderRefCards();});
$('#selSize').addEventListener('change',e=>{const s=state.project.settings;s.sizePreset=e.target.value;if(s.sizePreset!=='custom'){const[w,h]=s.sizePreset.split('x').map(Number);s.width=w;s.height=h;}renderSettings();saveProject();});
export function clamp64(v){v=Math.round((+v||64)/64)*64;return Math.min(2048,Math.max(64,v));}
$('#inpWidth').addEventListener('change',e=>{state.project.settings.width=clamp64(e.target.value);renderSettings();saveProject();});
$('#inpHeight').addEventListener('change',e=>{state.project.settings.height=clamp64(e.target.value);renderSettings();saveProject();});
bind('#inpSteps',t=>{state.project.settings.steps=Math.min(50,Math.max(1,+t.value||28));updateAnlasWarn();});
bind('#inpScale',t=>state.project.settings.scale=Math.min(10,Math.max(0,+t.value||5)));
bind('#selSampler',t=>state.project.settings.sampler=t.value);
bind('#selNoise',t=>state.project.settings.noiseSchedule=t.value);
bind('#inpRescale',t=>state.project.settings.cfgRescale=Math.min(1,Math.max(0,+t.value||0)));
bind('#inpCount',t=>state.project.settings.count=Math.min(50,Math.max(1,+t.value||4)));
bind('#inpDelay',t=>state.project.settings.delaySec=Math.min(60,Math.max(0,+t.value||0)));
bind('#selOrder',t=>{state.project.settings.order=t.value;updateOrderHint();});
export function updateOrderHint(){
  const s=state.project?.settings;const el=$('#orderHint');if(!s||!el)return;
  el.textContent=s.order==='roundrobin'
    ? '全表情を 1 枚ずつ一巡し、それを規定枚数ぶん繰り返します。途中で止めても各表情が均等に埋まります。'
    : 'ひとつの表情を規定枚数ぶん作ってから次の表情へ進みます。';
}
bind('#chkQuality',t=>state.project.settings.quality=t.checked);
bind('#chkBgKeep',t=>{
  state.project.settings.bgKeepAlive=t.checked;updateBgKeepHint();
  if(queue.running){t.checked?keepAliveOn():keepAliveOff();}
});
export function updateBgKeepHint(){
  const s=state.project?.settings;const el=$('#bgKeepHint');if(!s||!el)return;
  el.textContent=s.bgKeepAlive
    ? '生成中だけ、無音に近い音声を再生してタブの抑制を回避します。Chrome / Edge はタブに音量アイコンを表示しますが、音は聞こえません。'
    : 'オフの場合、タブを裏に回すと待機時間が最大 1 分程度まで伸びることがあります。';
}
bind('#chkJitter',t=>{state.project.settings.jitter=t.checked;$('#jitterRange').classList.toggle('off',!t.checked);});
bind('#inpJitterMin',t=>{state.project.settings.jitterMin=Math.max(0,parseFloat((+t.value).toFixed(2))||0);});
bind('#inpJitterMax',t=>{state.project.settings.jitterMax=Math.max(0,parseFloat((+t.value).toFixed(2))||0);});
bind('#chkNaming',t=>{state.project.settings.namingEnabled=t.checked;$('#namingBlock').classList.toggle('off',!t.checked);updateNamingPreview();});
bind('#inpSeparator',t=>{state.project.settings.namingSeparator=t.value;updateNamingPreview();});
export function updateNamingPreview(){
  const s=state.project?.settings;if(!s)return;
  const el=$('#namingPreview');if(!el)return;
  const exName=state.project.expressions[0]?.name||'smile';
  $('#charExportNameRow').style.display=s.namingEnabled?'':'none';
  el.textContent=buildExportName(exName,'');
}
export function buildZipName(label){
  ensureCharacters(state.project);
  const ch=curChar(state.project);
  const charLabel=(ch.exportName||'').trim()||ch.name||'';
  const parts=[sanitize(state.project.name)];
  if(charLabel.trim())parts.push(sanitize(charLabel));
  parts.push(label);
  return parts.join('_')+'.zip';
}
/* Image filenames are built from the character, not the project.
   Custom naming lets you pick the separator and an alternate (e.g. romanised) name. */
export function charFileLabel(){
  ensureCharacters(state.project);
  const ch=curChar(state.project);
  return ((ch.exportName||'').trim()||(ch.name||'').trim());
}
export function buildExportName(exName,suffix){
  const s=state.project.settings;
  const cn=charFileLabel();
  const sep=s.namingEnabled?s.namingSeparator:'_';
  const base=cn?sanitize(cn):sanitize(state.project.name); // fall back only if the character is unnamed
  return base+sep+sanitize(exName)+suffix+'.png';
}
bind('#txtBase',t=>state.project.basePrompt=t.value);
bind('#txtChar',t=>{const c=curChar(state.project);c.prompt=t.value;});
bind('#txtCharNeg',t=>{const c=curChar(state.project);c.neg=t.value;});
bind('#txtNeg',t=>state.project.negPrompt=t.value);
bind('#chkCharSlot',t=>{state.project.settings.charSlot=t.checked;updateCharSlotHint();});
export function updateCharSlotHint(){
  const s=state.project?.settings;const el=$('#charSlotHint');if(!s||!el)return;
  el.textContent=s.charSlot
    ? '送信内容: 基礎＝「基礎プロンプト」／基礎ネガティブ、キャラ枠＝「キャラクター＋表情」／「キャラ共通ネガティブ＋表情ネガティブ」。キャラ別の除外指定が使え、メタデータにも分かれて記録されます。'
    : '送信内容: すべてを 1 本に連結（基礎 → キャラクター → 表情 / ネガティブも同様）。キャラ共通・表情ネガティブは基礎ネガティブに合流します。';
}
bind('#inpCharExportName',t=>{const c=curChar(state.project);c.exportName=t.value;updateNamingPreview();});
