import { deleteImage } from './images.js';
import { buildExportName, buildZipName } from './settings.js';
import { curChar, state } from './state.js';
import { toast } from './ui.js';
import { $, download, sleep } from './util.js';
import { makeZip } from './zip.js';

/* ---- Export / Cleanup ---- */
export async function exportZipByFilter(filter,label){
  const files=[];
  for(const ex of state.project.expressions){
    const imgs=state.images.filter(i=>i.exprId===ex.id&&filter(i)).sort((a,b)=>a.createdAt-b.createdAt);
    for(let k=0;k<imgs.length;k++){
      const suffix=imgs.length>1?`_${k+1}`:'';
      files.push({name:buildExportName(ex.name,suffix),data:new Uint8Array(await imgs[k].blob.arrayBuffer())});
    }
  }
  if(!files.length){toast(label+'に該当する画像がありません','err');return;}
  download(makeZip(files),buildZipName(label));
  toast(`${files.length} 枚を ZIP ファイルに書き出しました`,'ok');
}
$('#btnExportZip').onclick=()=>exportZipByFilter(i=>i.adopted,'採用');
$('#btnExportHeld').onclick=()=>exportZipByFilter(i=>i.held,'保留');
$('#btnExportAll').onclick=()=>exportZipByFilter(()=>true,'全画像');
$('#btnExportEach').onclick=async()=>{
  const list=[];for(const ex of state.project.expressions){const im=state.images.find(i=>i.exprId===ex.id&&i.adopted);if(im)list.push({ex,im});}
  if(!list.length){toast('採用済みの画像がありません','err');return;}
  for(const{ex,im}of list){download(im.blob,buildExportName(ex.name,''));await sleep(400);}
};
$('#btnPurge').onclick=async()=>{
  const targets=state.images.filter(i=>!i.adopted&&!i.held);
  if(!targets.length){toast('削除対象の画像はありません');return;}
  if(!confirm(`採用も保留もされていない画像 ${targets.length} 枚を削除します。よろしいですか？\n（採用済み・保留中の画像は残ります）`))return;
  for(const im of targets)await deleteImage(im.id);toast('削除しました','ok');
};
$('#btnPurgeAll').onclick=async()=>{
  const all=[...state.images];
  if(!all.length){toast('削除する画像はありません');return;}
  const adopted=all.filter(i=>i.adopted).length;
  const held=all.filter(i=>i.held).length;
  let msg=`⚠ キャラクター「${curChar(state.project).name}」の生成済み画像 ${all.length} 枚をすべて削除します。\n\n`;
  msg+=`・採用済み: ${adopted} 枚\n・保留中: ${held} 枚\n・未選択: ${all.length-adopted-held} 枚\n\n`;
  if(adopted||held)msg+='採用済み・保留中の画像も含めてすべて消えます。\n';
  msg+='書き出していない画像は復元できません。よろしいですか？';
  if(!confirm(msg))return;
  if(adopted||held){
    if(!confirm(`本当によろしいですか？\n\n採用済み ${adopted} 枚と保留中 ${held} 枚を含む ${all.length} 枚が完全に削除されます。\nこの操作は取り消せません。`))return;
  }
  for(const im of all)await deleteImage(im.id);
  toast(`${all.length} 枚の画像をすべて削除しました`,'ok');
};
