import { idb } from './db.js';
import { renderExprStatus, renderExprThumbs, updateMissingBtn } from './expressions.js';
import { state } from './state.js';

/* ==== Image ops ==== */
export function imgURL(rec){if(!state.urlCache.has(rec.id))state.urlCache.set(rec.id,URL.createObjectURL(rec.blob));return state.urlCache.get(rec.id);}
export async function adoptImage(id){
  const rec=state.images.find(i=>i.id===id);if(!rec)return;
  // Pressing adopt on an already-adopted image cancels the adoption.
  const turningOff=rec.adopted;
  for(const im of state.images.filter(i=>i.exprId===rec.exprId)){
    const wantAdopt=turningOff?false:(im.id===id);
    let changed=false;
    if(im.adopted!==wantAdopt){im.adopted=wantAdopt;changed=true;}
    if(wantAdopt&&im.held){im.held=false;changed=true;} // adopting clears hold
    if(changed)await idb.put('images',im);
  }
  renderExprThumbs(rec.exprId);renderExprStatus(rec.exprId);
  return turningOff?'cleared':'adopted';
}
export async function holdImage(id){
  const rec=state.images.find(i=>i.id===id);if(!rec)return;
  rec.held=!rec.held;
  if(rec.held&&rec.adopted)rec.adopted=false; // hold clears adopt
  await idb.put('images',rec);
  renderExprThumbs(rec.exprId);renderExprStatus(rec.exprId);
}
export async function deleteImage(id){
  const rec=state.allImages.find(i=>i.id===id);if(!rec)return;
  await idb.del('images',id);
  state.allImages=state.allImages.filter(i=>i.id!==id);
  state.images=state.images.filter(i=>i.id!==id);
  const u=state.urlCache.get(id);if(u){URL.revokeObjectURL(u);state.urlCache.delete(id);}
  renderExprThumbs(rec.exprId);renderExprStatus(rec.exprId);updateMissingBtn();
}
