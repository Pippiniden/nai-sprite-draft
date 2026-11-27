/* ---- ZIP read (NAI response) ---- */
export async function zipFirstEntry(buf){
  const dv=new DataView(buf);
  for(let i=buf.byteLength-22;i>=0;i--){
    if(dv.getUint32(i,true)!==0x06054b50)continue;
    const cd=dv.getUint32(i+16,true);if(dv.getUint32(cd,true)!==0x02014b50)break;
    const method=dv.getUint16(cd+10,true),compSize=dv.getUint32(cd+20,true),lho=dv.getUint32(cd+42,true);
    const nameLen=dv.getUint16(lho+26,true),extraLen=dv.getUint16(lho+28,true);
    const start=lho+30+nameLen+extraLen,data=buf.slice(start,start+compSize);
    if(method===0)return new Blob([data],{type:'image/png'});
    const ds=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Blob([await new Response(ds).arrayBuffer()],{type:'image/png'});
  }
  throw new Error('画像データの読み取りに失敗しました');
}
/* ---- ZIP write ---- */
export const CRC_TABLE=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c;}return t})();
export function crc32(u8){let c=0xFFFFFFFF;for(let i=0;i<u8.length;i++)c=CRC_TABLE[(c^u8[i])&0xFF]^(c>>>8);return(c^0xFFFFFFFF)>>>0}
export function makeZip(files){
  const enc=new TextEncoder(),chunks=[],central=[];let offset=0;
  for(const f of files){const name=enc.encode(f.name),crc=crc32(f.data),sz=f.data.length;const lh=new DataView(new ArrayBuffer(30));lh.setUint32(0,0x04034b50,true);lh.setUint16(4,20,true);lh.setUint16(6,0x0800,true);lh.setUint16(8,0,true);lh.setUint32(14,crc,true);lh.setUint32(18,sz,true);lh.setUint32(22,sz,true);lh.setUint16(26,name.length,true);chunks.push(new Uint8Array(lh.buffer),name,f.data);const ch=new DataView(new ArrayBuffer(46));ch.setUint32(0,0x02014b50,true);ch.setUint16(4,20,true);ch.setUint16(6,20,true);ch.setUint16(8,0x0800,true);ch.setUint16(10,0,true);ch.setUint32(16,crc,true);ch.setUint32(20,sz,true);ch.setUint32(24,sz,true);ch.setUint16(28,name.length,true);ch.setUint32(42,offset,true);central.push(new Uint8Array(ch.buffer),name);offset+=30+name.length+sz;}
  let cdSize=0;for(const c of central)cdSize+=c.length;const eocd=new DataView(new ArrayBuffer(22));eocd.setUint32(0,0x06054b50,true);eocd.setUint16(8,files.length,true);eocd.setUint16(10,files.length,true);eocd.setUint32(12,cdSize,true);eocd.setUint32(16,offset,true);
  return new Blob([...chunks,...central,new Uint8Array(eocd.buffer)],{type:'application/zip'});
}
