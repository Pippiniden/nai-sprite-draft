import { writeProject } from './db.js';
import { toast } from './ui.js';
import { uid } from './util.js';

export const QUALITY_TAGS={'nai-diffusion-4-5-full':', very aesthetic, masterpiece, no text','nai-diffusion-4-5-curated':', rating:general, amazing quality, very aesthetic, absurdres'};
export const DEFAULT_NEG='blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page';
export const DEFAULT_BASE='1girl, standing, full body, looking at viewer, simple background, white background';
export const DEFAULT_EXPRS=[['基本',''],['通常','neutral expression, closed mouth'],['笑顔','smile, open mouth, happy'],['怒り','angry, frown, v-shaped eyebrows'],['悲しみ','sad, tears, teary eyes'],['驚き','surprised, wide eyes, open mouth'],['照れ','blush, embarrassed, averting eyes']];
export function ensureRefArrays(p){
  if(!p.vibes)p.vibes=[];if(!p.preciseRefs)p.preciseRefs=[];if(!p.i2iImages)p.i2iImages=[];
  // Older builds padded to the generation resolution; those caches are invalid now.
  for(const r of p.preciseRefs){
    if(r.paddedW!==undefined||r.paddedH!==undefined){delete r.paddedBase64;delete r.paddedW;delete r.paddedH;}
    if(r.fidelity===undefined)r.fidelity=0.5;
    if(r.strength===undefined)r.strength=1;
  }
  /* Backups made before v21 dropped reference ids, so restored references all shared
     the id `undefined` and every per-expression toggle hit all of them at once.
     Give each one its own id; the stale `undefined` toggles are meaningless, so drop them. */
  let repaired=false;
  for(const r of [...p.vibes,...p.preciseRefs,...p.i2iImages])if(!r.id){r.id=uid();repaired=true;}
  if(repaired)for(const e of (p.expressions||[]))if(e.refConfig)delete e.refConfig.undefined;
}
export function ensureSettings(p){
  if(!p.settings)p.settings={};
  const d={model:'nai-diffusion-4-5-full',sizePreset:'832x1216',width:832,height:1216,steps:28,scale:5,cfgRescale:0,sampler:'k_euler_ancestral',noiseSchedule:'karras',count:4,delaySec:3,quality:true,jitter:false,jitterMin:0,jitterMax:10,namingEnabled:false,namingSeparator:'_',order:'grouped',charSlot:true,bgKeepAlive:true};
  for(const[k,v]of Object.entries(d))if(p.settings[k]===undefined)p.settings[k]=v;
}
export function ensureCharacters(p){
  if(!p.characters||!p.characters.length){
    // migrate from old charPrompt field
    const oldPrompt=p.charPrompt||'';
    const oldExportName=p.settings?.namingCharName||'';
    p.characters=[{id:uid(),name:'キャラ1',prompt:oldPrompt,exportName:oldExportName}];
    p.currentCharId=p.characters[0].id;
    delete p.charPrompt;delete p.settings?.namingCharName;
  }
  if(!p.currentCharId||!p.characters.find(c=>c.id===p.currentCharId))p.currentCharId=p.characters[0].id;
  for(const c of p.characters)if(c.neg===undefined)c.neg='';
}
/* v15 introduced per-expression negatives. Projects saved by the interim build had a
   single project-wide field; fan it out so nothing the user typed is silently dropped. */
export function ensureExprNeg(p){
  if(!p.expressions)return;
  const shared=(p.exprNeg||'').trim();
  for(const e of p.expressions){
    if(e.neg===undefined)e.neg=shared;
    else if(shared&&!e.neg.includes(shared))e.neg=[e.neg,shared].filter(Boolean).join(', ');
  }
  delete p.exprNeg;
}
export function curChar(p){ensureCharacters(p);return p.characters.find(c=>c.id===p.currentCharId)||p.characters[0];}
/* Images belong to a character, not merely to a project. state.allImages holds every
   image in the loaded project; state.images is the slice for the character currently
   selected, and that is what the whole UI renders from. Switching characters just
   recomputes the slice, so each character keeps its own candidate history. */
export function refreshImageScope(){
  const cid=state.project?.currentCharId;
  state.images=state.allImages.filter(i=>i.charId===cid);
}
/* ---- state ---- */
export const state={apiKey:localStorage.getItem('nai_api_key')||'',projects:[],project:null,allImages:[],images:[],urlCache:new Map(),filter:'all',selectedExprs:new Set()};
export function newProject(name){
  const charId=uid();
  return{id:uid(),name:name||'新規プロジェクト',createdAt:Date.now(),updatedAt:Date.now(),
    basePrompt:DEFAULT_BASE,negPrompt:DEFAULT_NEG,
    characters:[{id:charId,name:'キャラ1',prompt:'',exportName:'',neg:''}],currentCharId:charId,
    settings:{model:'nai-diffusion-4-5-full',sizePreset:'832x1216',width:832,height:1216,steps:28,scale:5,cfgRescale:0,sampler:'k_euler_ancestral',noiseSchedule:'karras',count:4,delaySec:3,quality:true,jitter:false,jitterMin:0,jitterMax:10,namingEnabled:false,namingSeparator:'_',order:'grouped',charSlot:true,bgKeepAlive:true},
    vibes:[],preciseRefs:[],i2iImages:[],
    expressions:DEFAULT_EXPRS.map(([n,p])=>({id:uid(),name:n,prompt:p,neg:'',variants:[{id:uid(),label:'',prompt:p}],variantMode:'first',varCursor:0,suppress:'',suppressOn:false,suppressScope:'basechar',suppressPartial:false,refConfig:{}}))};
}
export let saveTimer;
export function saveProject(){if(!state.project)return;state.project.updatedAt=Date.now();clearTimeout(saveTimer);saveTimer=setTimeout(()=>writeProject(state.project).catch(e=>toast('保存に失敗しました: '+e,'err')),350);}
