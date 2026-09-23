/** Read-only cache index. Format facts checked against WolvenKit ShaderCacheReader.
 * Never executes shaders or modifies the game. Compiled shader extracts stay local.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dir,'../../../..');
const source='F:/Games/Cyberpunk 2077/engine/shader_final.cache';
const bytes=readFileSync(source),footer=bytes.subarray(bytes.length-112);
if(footer.toString('ascii',104,108)!=='RDHS'||footer.readUInt32LE(108)!==10)throw Error('Unsupported shader cache footer');
const count=footer.readUInt32LE(0),extraCount=footer.readUInt32LE(4),paramCount=footer.readUInt32LE(8);
const offset=(n:number)=>{const v=Number(footer.readBigUInt64LE(n));if(!Number.isSafeInteger(v)||v<0||v>bytes.length-112)throw Error('Invalid cache offset');return v;};
const extrasStart=offset(72),paramsStart=offset(80),mappingStart=offset(88);
let at=0;
function take(n:number){if(n<0||at+n>bytes.length-112)throw Error('Cache read exceeds bounds');const v=bytes.subarray(at,at+n);at+=n;return v;}
const u8=()=>take(1)[0],u32=()=>take(4).readUInt32LE(),u64=()=>take(8).readBigUInt64LE().toString();
const shaders=new Map<string,{offset:number;size:number;params:string;chunks:string[];stage:string}>();
for(let i=0;i<count;i++){
  const guid=u64(),params=u64(),size=u32(),start=at,b=take(size);
  if(b.toString('ascii',0,4)!=='DXBC'||b.readUInt32LE(24)!==size)throw Error('Unsupported compiled shader container');
  let stage='unknown';
  const chunks=Array.from({length:b.readUInt32LE(28)},(_,n)=>{const p=b.readUInt32LE(32+n*4);if(p+8>b.length||p+8+b.readUInt32LE(p+4)>b.length)throw Error('Invalid DXBC chunk');const tag=b.toString('ascii',p,p+4);if(tag==='DXIL'&&b.readUInt32LE(p+4)>=4){const kind=b.readUInt32LE(p+8)>>>16;stage=({0:'pixel',1:'vertex',2:'geometry',3:'hull',4:'domain',5:'compute'} as Record<number,string>)[kind]??`kind-${kind}`;}return tag;});
  if(shaders.has(guid))throw Error('Duplicate shader GUID');shaders.set(guid,{offset:start,size,params,chunks,stage});
}
if(at!==extrasStart)throw Error('Shader region not consumed exactly');
at=paramsStart;const parameters=new Map<string,unknown>();
for(let i=0;i<paramCount;i++){
  const guid=u64(),flags=u32(),n=u32();if(n>65536)throw Error('Invalid parameter count');
  const params=Array.from({length:n},()=>({name:take(u8()&127).toString('utf8'),unknown1:u8(),unknown2:u8()}));
  parameters.set(guid,{flags,params});
}
if(at!==mappingStart)throw Error('Parameter region not consumed exactly');
at=extrasStart;const templates=new Map<string,number>(),selected:any[]=[];
for(let i=0;i<extraCount;i++){
  const start=u32(),end=u32(),a=u8(),b=u8(),info=take((a&191)|((b&1)<<6)).toString('utf8');
  if(u32()!==start)throw Error('Extra start mismatch');
  // Field labels in the reference reader disagree with observed DXIL stages.
  // Preserve storage order and classify each shader from its actual program header.
  const firstShader=u64(),secondShader=u64(),material=u64();if(u64()!==material)throw Error('Material GUID mismatch');
  const unknown=u64();if(u32()!==end)throw Error('Extra end mismatch');
  const flags=()=>{const n=u32();if(n>65536)throw Error('Invalid flags count');return Array.from({length:n},u64);};
  const flags1=flags(),flags2=flags(),template=info.split(' ')[0];templates.set(template,(templates.get(template)??0)+1);
  if(/glitter|mesh_decal/i.test(template))selected.push({template,info,firstShader,firstStage:shaders.get(firstShader)?.stage,secondShader,secondStage:shaders.get(secondShader)?.stage,material,unknown,flags1,flags2});
}
if(at!==paramsStart)throw Error('Compilation-info region not consumed exactly');
const output=resolve(root,'research/consumers/glitter/raw/shaders');mkdirSync(output,{recursive:true});
const extracted:any[]=[];
const extractCompilations = selected.filter(x=>/glitter/i.test(x.template) || (x.template==='mesh_decal' && x.info.includes("VF: MeshSkinned]") && x.info.includes("Pass 'renderstage_post_gbuffer'")));
for(const guid of new Set(extractCompilations.flatMap(x=>[x.firstShader,x.secondShader]))){
  const s=shaders.get(guid);if(!s)continue;const b=bytes.subarray(s.offset,s.offset+s.size),file=`${guid}.dxbc`;writeFileSync(resolve(output,file),b);
  extracted.push({guid,file,...s,parameters:parameters.get(s.params),sha256:createHash('sha256').update(b).digest('hex')});
}
const report={source,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,version:10,counts:{shaders:count,compilations:extraCount,parameterSets:paramCount,templates:templates.size},regionsExact:true,templates:Object.fromEntries([...templates].sort()),selected,extracted};
const target=resolve(root,'research/materials/evidence/shader-cache-index.json');mkdirSync(resolve(root,'research/materials/evidence'),{recursive:true});writeFileSync(target,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({counts:report.counts,selected:selected.length,glitterVariants:selected.filter(x=>/glitter/i.test(x.template)).length,extracted:extracted.length,stages:[...new Set(extracted.map(x=>x.stage))],report:target},null,2));
