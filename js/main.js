import { dbInit, loadAllProjects, writeProject } from './db.js';
import { loadProject } from './project.js';
import { ensureCharacters, ensureRefArrays, ensureSettings, newProject, state } from './state.js';
import { openApiModal, toast } from './ui.js';
import { ensureExprShapes } from './variants.js';

// Feature modules register their DOM event handlers when evaluated.
import './keepalive.js';
import './queue.js';
import './refs.js';
import './expressions.js';
import './lightbox.js';
import './settings.js';
import './project.js';
import './bulk.js';
import './variants.js';
import './library.js';
import './export.js';
import './ui.js';

/* ---- Init ---- */
(async function init(){
  try{navigator.storage?.persist?.();}catch(_){}
  await dbInit();state.projects=await loadAllProjects();
  for(const p of state.projects){ensureRefArrays(p);ensureSettings(p);ensureCharacters(p);ensureExprShapes(p);}
  if(!state.projects.length){const p=newProject('サンプルプロジェクト');state.projects.push(p);await writeProject(p);}
  const last=localStorage.getItem('nai_last_project');
  await loadProject(state.projects.find(p=>p.id===last)?.id||state.projects[0].id);
  if(!state.apiKey)openApiModal();
})().catch(e=>{console.error(e);toast('起動に失敗しました: '+e.message,'err');});
