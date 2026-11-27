/* ---- IndexedDB ----
   Stores
     projects : project settings, prompts and expressions. Reference images are kept
                here only as metadata (strength, toggles…) — see `refdata`.
     refdata  : the heavy part of each reference image (base64, padded copy, vibe
                encodings, inpaint mask, paint layers), keyed `projectId:refId`. Split out in v3 because the project
                record is rewritten on every keystroke, and dragging several MB of images
                along with each save made typing in a prompt stall.
     images   : generated images. */
export let db;
export function dbOpen(){return new Promise((res,rej)=>{
  const req=indexedDB.open('nai-sprite-draft',3);
  req.onupgradeneeded=e=>{
    const d=e.target.result;
    if(!d.objectStoreNames.contains('projects'))d.createObjectStore('projects',{keyPath:'id'});
    if(!d.objectStoreNames.contains('images')){const im=d.createObjectStore('images',{keyPath:'id'});im.createIndex('projectId','projectId',{unique:false});}
    if(!d.objectStoreNames.contains('refdata')){const rd=d.createObjectStore('refdata',{keyPath:'key'});rd.createIndex('projectId','projectId',{unique:false});}
  };
  req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error);
})}
export const idb={
  put:(s,v)=>new Promise((res,rej)=>{const t=db.transaction(s,'readwrite');t.objectStore(s).put(v);t.oncomplete=res;t.onerror=()=>rej(t.error)}),
  del:(s,k)=>new Promise((res,rej)=>{const t=db.transaction(s,'readwrite');t.objectStore(s).delete(k);t.oncomplete=res;t.onerror=()=>rej(t.error)}),
  all:s=>new Promise((res,rej)=>{const r=db.transaction(s).objectStore(s).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)}),
  byProject:pid=>new Promise((res,rej)=>{const r=db.transaction('images').objectStore('images').index('projectId').getAll(pid);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})
};
export async function dbInit(){db=await dbOpen();return db;}

/* ---- project persistence with reference images split out ---- */
const REF_LISTS=['vibes','preciseRefs','i2iImages'];
const HEAVY=['base64','paddedBase64','encoded','mask','paintLayers'];
/* What was last written to `refdata`, so a save only rewrites references that changed. */
const refSig=new Map();
const refKey=(pid,rid)=>pid+':'+rid;
const sigOf=r=>`${r.base64?.length||0}|${r.paddedBase64?.length||0}|${Object.keys(r.encoded||{}).sort().join(',')}|${r.mask?.length||0}:${r.maskRev||0}:${r.imgRev||0}:${r.paintRev||0}`;
const refsOf=p=>REF_LISTS.flatMap(k=>p[k]||[]);

/* Write a project: the lean record always, and only the reference data that changed
   (plus deletions for references that are gone), all in one transaction. */
export function writeProject(p){
  return new Promise((res,rej)=>{
    const lean={...p,refsExternal:true};
    for(const k of REF_LISTS)lean[k]=(p[k]||[]).map(r=>{const o={...r};for(const h of HEAVY)delete o[h];return o;});
    const t=db.transaction(['projects','refdata'],'readwrite');
    const rd=t.objectStore('refdata');
    const live=new Set();
    for(const r of refsOf(p)){
      const key=refKey(p.id,r.id);live.add(key);
      const sig=sigOf(r);
      if(refSig.get(key)===sig)continue;
      const rec={key,projectId:p.id};for(const h of HEAVY)if(r[h]!==undefined)rec[h]=r[h];
      rd.put(rec);refSig.set(key,sig);
    }
    for(const key of [...refSig.keys()])if(key.startsWith(p.id+':')&&!live.has(key)){rd.delete(key);refSig.delete(key);}
    t.objectStore('projects').put(lean);
    t.oncomplete=()=>res();
    // forget what we thought was written, so the next save retries it
    t.onerror=t.onabort=()=>{for(const key of live)refSig.delete(key);rej(t.error);};
  });
}

/* Read every project and put its reference data back onto the in-memory objects.
   Projects saved before v3 still carry it inline; their first save moves it out. */
export async function loadAllProjects(){
  const[projects,refdata]=await Promise.all([idb.all('projects'),idb.all('refdata')]);
  const byKey=new Map(refdata.map(d=>[d.key,d]));
  for(const p of projects){
    if(!p.refsExternal)continue;
    for(const k of REF_LISTS){
      if(!Array.isArray(p[k]))continue;
      p[k]=p[k].filter(r=>{
        const d=byKey.get(refKey(p.id,r.id));
        if(!d){console.warn('reference data missing, dropping',p.id,r.id);return false;}
        for(const h of HEAVY)if(d[h]!==undefined)r[h]=d[h];
        refSig.set(refKey(p.id,r.id),sigOf(r));
        return true;
      });
    }
  }
  return projects;
}

/* Delete a project record and its reference data (generated images are separate). */
export function deleteProjectData(pid){
  return new Promise((res,rej)=>{
    const t=db.transaction(['projects','refdata'],'readwrite');
    t.objectStore('projects').delete(pid);
    const rd=t.objectStore('refdata');
    rd.index('projectId').getAllKeys(pid).onsuccess=e=>{for(const key of e.target.result)rd.delete(key);};
    for(const key of [...refSig.keys()])if(key.startsWith(pid+':'))refSig.delete(key);
    t.oncomplete=()=>res();t.onerror=()=>rej(t.error);
  });
}
