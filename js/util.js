export const $=s=>document.querySelector(s);
export const $$=s=>[...document.querySelectorAll(s)];
export const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
export const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const sanitize=s=>String(s||'noname').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').trim()||'noname';
export async function fileToBase64(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(',')[1]);r.onerror=()=>rej(new Error('読み込み失敗'));r.readAsDataURL(file);})}
export async function blobToBase64(blob){return fileToBase64(blob)}
export function b64url(b64){return'data:image/png;base64,'+b64}
export function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),20000);}
export function escapeRe(s){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
