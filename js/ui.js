import { state } from './state.js';
import { $, $$ } from './util.js';

export function toast(msg,type){const el=document.createElement('div');el.className='toast'+(type?' '+type:'');el.textContent=msg;$('#toasts').appendChild(el);setTimeout(()=>el.remove(),5500);}
/* Generic choice modal. Resolves with the value of the button pressed, or null if
   dismissed. Buttons: [{value, label, cls}] — the last one is the default focus. */
export function askChoice(title,bodyHTML,buttons){
  return new Promise(res=>{
    const back=$('#confirmModal');
    $('#cfmTitle').textContent=title;
    $('#cfmBody').innerHTML=bodyHTML;
    const row=$('#cfmButtons');row.innerHTML='';
    let done=false;
    const finish=v=>{if(done)return;done=true;back.classList.remove('show');document.removeEventListener('keydown',onKey,true);back.onclick=null;res(v);};
    const onKey=e=>{if(e.key==='Escape'){e.stopPropagation();finish(null);}};
    for(const b of buttons){
      const el=document.createElement('button');
      el.textContent=b.label;if(b.cls)el.className=b.cls;
      el.onclick=()=>finish(b.value);
      row.appendChild(el);
    }
    back.onclick=e=>{if(e.target===back)finish(null);};
    document.addEventListener('keydown',onKey,true);
    back.classList.add('show');
    row.lastChild?.focus();
  });
}
/* ---- Modals ---- */
export function openApiModal(){$('#inpApiKey').value=state.apiKey;$('#apiModal').classList.add('show');$('#inpApiKey').focus();}
$('#btnApiKey').onclick=openApiModal;
$('#btnApiCancel').onclick=()=>$('#apiModal').classList.remove('show');
$('#btnApiSave').onclick=()=>{state.apiKey=$('#inpApiKey').value.trim();localStorage.setItem('nai_api_key',state.apiKey);$('#apiModal').classList.remove('show');toast(state.apiKey?'API キーを保存しました':'API キーを削除しました','ok');};
$('#btnHelp').onclick=()=>$('#helpModal').classList.add('show');
$('#btnHelpClose').onclick=()=>$('#helpModal').classList.remove('show');
$$('.modal-backdrop').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)m.classList.remove('show');}));
