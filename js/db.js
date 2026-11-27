/* ---- IndexedDB ---- */
export let db;
export function dbOpen(){return new Promise((res,rej)=>{const req=indexedDB.open('nai-sprite-draft',2);req.onupgradeneeded=e=>{const d=e.target.result;if(!d.objectStoreNames.contains('projects'))d.createObjectStore('projects',{keyPath:'id'});if(!d.objectStoreNames.contains('images')){const im=d.createObjectStore('images',{keyPath:'id'});im.createIndex('projectId','projectId',{unique:false});}};req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error);})}
export const idb={
  put:(s,v)=>new Promise((res,rej)=>{const t=db.transaction(s,'readwrite');t.objectStore(s).put(v);t.oncomplete=res;t.onerror=()=>rej(t.error)}),
  del:(s,k)=>new Promise((res,rej)=>{const t=db.transaction(s,'readwrite');t.objectStore(s).delete(k);t.oncomplete=res;t.onerror=()=>rej(t.error)}),
  all:s=>new Promise((res,rej)=>{const r=db.transaction(s).objectStore(s).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)}),
  byProject:pid=>new Promise((res,rej)=>{const r=db.transaction('images').objectStore('images').index('projectId').getAll(pid);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})
};
export async function dbInit(){db=await dbOpen();return db;}
