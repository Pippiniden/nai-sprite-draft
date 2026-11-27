import { compositeLayersBase64, fitMaskToSizeBase64, fitToSizeBase64, vibeGetEncoded } from './refs.js';
import { QUALITY_TAGS, curChar, ensureCharacters, ensureRefArrays, state } from './state.js';
import { composeParts } from './variants.js';
import { zipFirstEntry } from './zip.js';

export const API_URL='https://image.novelai.net/ai/generate-image';
export const ENCODE_URL='https://image.novelai.net/ai/encode-vibe';

/* ---- Vibe encode ---- */
export async function callEncodeVibe(imageBase64, model, infoExtracted){
  const res=await fetch(ENCODE_URL,{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+state.apiKey},
    body:JSON.stringify({image:imageBase64,information_extracted:infoExtracted,model})
  });
  if(!res.ok){let msg='Encode HTTP '+res.status;try{const j=await res.json();if(j.message)msg+=': '+j.message}catch(_){}throw new Error(msg);}
  const buf=await res.arrayBuffer();
  // convert binary to base64
  const bytes=new Uint8Array(buf);
  let bin='';for(let i=0;i<bytes.length;i+=8192){bin+=String.fromCharCode(...bytes.slice(i,i+8192));}
  return btoa(bin);
}
/* ==== NovelAI API ==== */
/* The first img2img source enabled for this expression, or null. */
export function activeI2i(project,expr){
  const rc=expr?.refConfig||{};
  return (project.i2iImages||[]).find(im=>rc[im.id]!==false)||null;
}
/* img2img needs the source at exactly the generation size, or the API rejects it.
   Uploaded files rarely match, so scale-and-crop once per source × size and keep it in
   memory (not in the project, which would bloat every save). Visible paint layers are
   merged onto the source first. An inpaint mask gets the
   same crop so it stays aligned with the image. Returns {image, mask|null} or null. */
const i2iSized=new Map();
export async function prepareI2i(project,expr){
  const src=activeI2i(project,expr);if(!src)return null;
  const{width:w,height:h}=project.settings;
  const key=`${src.id}:${w}x${h}:${src.base64.length}:${src.imgRev||0}:${src.paintRev||0}:${src.mask?.length||0}:${src.maskRev||0}`;
  if(!i2iSized.has(key))i2iSized.set(key,{
    // paint layers stay separate in the project; only what is sent is flattened
    image:await fitToSizeBase64(await compositeLayersBase64(src),w,h),
    mask:src.mask?await fitMaskToSizeBase64(src.mask,w,h):null,
  });
  return i2iSized.get(key);
}
/* Inpainting runs on a separate model; V4/V4.5 each have one named `<model>-inpainting`. */
export const inpaintModel=model=>model+'-inpainting';
export function buildPayload(project,expr,seed,forChar,variantIdx,i2iPrep){
  const exprRefConfig=expr?.refConfig||{};
  const s=project.settings;ensureRefArrays(project);ensureCharacters(project);
  const ch=forChar||curChar(project);
  /* Variant choice and tag suppression both happen here, in composeParts, so the
     preview modal and the real request can never drift apart. */
  const parts=composeParts(project,expr,ch,variantIdx|0);
  const exprPrompt=parts.exprPrompt,exprNeg=parts.exprNeg;
  const basePrompt=parts.base,charPrompt=parts.charPrompt;
  const join=(...a)=>a.map(t=>(t||'').trim()).filter(Boolean).join(', ');
  /* Two layouts.
     charSlot on : base / base-uc go in the caption, character + expression go in a
                   character slot that carries its own uc. One character only — this
                   tool makes expression sheets, not group shots.
     charSlot off: everything is flattened into one caption (the pre-v15 behaviour). */
  let prompt,neg,charCaps=[],charUcCaps=[],characterPrompts=[];
  if(s.charSlot){
    prompt=join(basePrompt);
    neg=join(project.negPrompt);
    const charPos=join(charPrompt,exprPrompt);
    const charUc=join(ch.neg,exprNeg);
    if(charPos||charUc){
      const center={x:0.5,y:0.5};
      charCaps=[{char_caption:charPos,centers:[center]}];
      charUcCaps=[{char_caption:charUc,centers:[center]}];
      characterPrompts=[{prompt:charPos,uc:charUc,center,enabled:true}];
    }
  }else{
    prompt=join(basePrompt,charPrompt,exprPrompt);
    neg=join(project.negPrompt,ch.neg,exprNeg);
  }
  if(s.quality)prompt+=(QUALITY_TAGS[s.model]||'');
  const refImages=[],refInfo=[],refStr=[];
  const rc=exprRefConfig||{};
  for(const v of project.vibes){if(rc[v.id]===false)continue;const enc=vibeGetEncoded(v,s.model);refImages.push(enc||v.base64);refInfo.push(v.infoExtracted??0.6);refStr.push(v.strength??0.6);}
  const params={params_version:3,width:s.width,height:s.height,scale:s.scale,sampler:s.sampler,steps:s.steps,n_samples:1,ucPreset:0,qualityToggle:!!s.quality,dynamic_thresholding:false,controlnet_strength:1,legacy:false,add_original_image:true,cfg_rescale:s.cfgRescale,noise_schedule:s.noiseSchedule,legacy_v3_extend:false,skip_cfg_above_sigma:null,use_coords:false,seed,characterPrompts,v4_prompt:{caption:{base_caption:prompt,char_captions:charCaps},use_coords:false,use_order:true},v4_negative_prompt:{caption:{base_caption:neg,char_captions:charUcCaps},use_coords:false,use_order:false,legacy_uc:false},negative_prompt:neg,deliberate_euler_ancestral_bug:false,prefer_brownian:true};
  if(refImages.length){params.reference_image_multiple=refImages;params.reference_information_extracted_multiple=refInfo;params.reference_strength_multiple=refStr;}
  // Precise Reference (Character Reference) — uses its own director_reference_* parameters
  const prActive=(project.preciseRefs||[]).filter(r=>rc[r.id]!==false);
  if(prActive.length){
    params.director_reference_images=prActive.map(r=>r.paddedBase64||r.base64);
    params.director_reference_descriptions=prActive.map(r=>({caption:{base_caption:r.styleAware?'character&style':'character',char_captions:[]},legacy_uc:false}));
    params.director_reference_strength_values=prActive.map(r=>r.strength??1);
    params.director_reference_secondary_strength_values=prActive.map(r=>1-(r.fidelity??0.5));
    params.director_reference_information_extracted=prActive.map(()=>1);
  }
  // i2i: find the first enabled i2i image for this expression
  let action='generate',model=s.model;
  const i2iSrc=activeI2i(project,expr);
  if(i2iSrc&&i2iSrc.mask){
    /* Inpaint: white in the mask is repainted, the rest is kept. Below 1.0 the masked
       area is only partly denoised, which the official client sends as an extra
       img2img block alongside inpaintImg2ImgStrength. */
    action='infill';model=inpaintModel(s.model);
    const st=i2iSrc.inpaintStrength??1;
    params.image=i2iPrep?.image||i2iSrc.base64;
    params.mask=i2iPrep?.mask||i2iSrc.mask;
    params.strength=st;
    params.inpaintImg2ImgStrength=st;
    if(st<1)params.img2img={strength:st,color_correct:true};
    params.noise=i2iSrc.noise??0;
    params.extra_noise_seed=seed;
  }else if(i2iSrc){
    action='img2img';
    params.image=i2iPrep?.image||i2iSrc.base64;
    params.strength=i2iSrc.strength??0.5;
    params.noise=i2iSrc.noise??0;
    params.extra_noise_seed=seed;
  }
  return{input:prompt,model,action,parameters:params};
}
export async function apiGenerate(payload){
  const res=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+state.apiKey},body:JSON.stringify(payload)});
  if(!res.ok){let msg='HTTP '+res.status;try{const j=await res.json();if(j.message)msg+=': '+j.message}catch(_){}const e=new Error(msg);e.status=res.status;
    // seconds form only; the header is often not exposed to the page, so it may be absent
    const ra=parseFloat(res.headers.get('Retry-After'));if(ra>0)e.retryAfter=ra*1000;
    throw e;}
  return zipFirstEntry(await res.arrayBuffer());
}
