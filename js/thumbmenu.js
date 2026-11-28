import { adoptImage, deleteImage, holdImage } from './images.js';
import { openLightbox } from './lightbox.js';
import { addI2iFromBlob, addRefFromBlob, editFromBlob } from './refs.js';
import { toast } from './ui.js';

/* ---- Thumbnail context menu ----
   Right-click a thumbnail and every action opens right at the cursor: no travel to the
   small hover buttons, which are the hardest targets on the page. */
let menu=null;
export function closeThumbMenu(){menu?.remove();menu=null;}
export function openThumbMenu(im,x,y){
  closeThumbMenu();
  const items=[
    ['open','🔍 拡大表示'],
    ['adopt',im.adopted?'★ 採用を取り消す':'★ 採用'],
    ['hold',im.held?'◆ 保留を解除':'◆ 保留'],
    null,
    ['ref','📌 精密参照に登録'],
    ['i2i','🖼 i2i の元画像に登録'],
    ['paint','🎨 描き込んで i2i'],
    ['inpaint','🩹 インペイント（マスクを描く）'],
    ['seed','シード値をコピー'],
    null,
    ['del','🗑 削除','danger'],
  ];
  const m=document.createElement('div');m.className='ctx-menu';m.setAttribute('role','menu');
  for(const it of items){
    if(!it){m.appendChild(document.createElement('hr'));continue;}
    const[act,label,cls]=it;
    const b=document.createElement('button');b.type='button';b.setAttribute('role','menuitem');
    b.dataset.act=act;b.textContent=label;if(cls)b.className=cls;
    m.appendChild(b);
  }
  m.addEventListener('click',async e=>{
    const act=e.target.closest('button')?.dataset.act;if(!act)return;
    closeThumbMenu();
    switch(act){
      case 'open':openLightbox(im.id);break;
      case 'adopt':{const r=await adoptImage(im.id);if(r==='cleared')toast('採用を取り消しました');break;}
      case 'hold':await holdImage(im.id);break;
      case 'ref':addRefFromBlob(im.blob,'precise');break;
      case 'i2i':addI2iFromBlob(im.blob,false,im.exprId);break;
      case 'paint':editFromBlob(im.blob,'paint',im.exprId);break;
      case 'inpaint':editFromBlob(im.blob,'mask',im.exprId);break;
      case 'seed':navigator.clipboard?.writeText(String(im.seed));toast('シード値をコピーしました: '+im.seed,'ok');break;
      case 'del':if(confirm('この候補を削除します。よろしいですか？'))deleteImage(im.id);break;
    }
  });
  m.addEventListener('keydown',e=>{
    const btns=[...m.querySelectorAll('button')];const i=btns.indexOf(document.activeElement);
    if(e.key==='ArrowDown'){e.preventDefault();btns[(i+1)%btns.length].focus();}
    else if(e.key==='ArrowUp'){e.preventDefault();btns[(i-1+btns.length)%btns.length].focus();}
  });
  document.body.appendChild(m);menu=m;
  // keep it on screen: flip left / up when the cursor is near the right / bottom edge
  const r=m.getBoundingClientRect();
  m.style.left=Math.max(4,x+r.width>innerWidth-4?x-r.width:x)+'px';
  m.style.top=Math.max(4,y+r.height>innerHeight-4?y-r.height:y)+'px';
  m.querySelector('button').focus({preventScroll:true});
}
document.addEventListener('mousedown',e=>{if(menu&&!menu.contains(e.target))closeThumbMenu();},true);
document.addEventListener('keydown',e=>{if(menu&&e.key==='Escape'){e.stopPropagation();closeThumbMenu();}},true);
window.addEventListener('scroll',()=>closeThumbMenu(),true);
window.addEventListener('resize',()=>closeThumbMenu());
window.addEventListener('blur',()=>closeThumbMenu());
