import {join} from "node:path";
import {writeFileSync,existsSync} from "node:fs";
import {prepareWorldContent,publishWorldContent} from "../../src/world-content-publication";
import {coverage,WORLD_CONTENT_READER,type WorldContent} from "../../src/world-content";
const [directory,id,generation=id,wait="",fingerprint="shared"]=process.argv.slice(2),root={id:"Districts.Test",name:"Test",kind:"district" as const,poly:[[0,0],[1,0],[1,1]] as [number,number][],zlo:0,zhi:generation==="B"?2:1};
const counts=coverage();for(const k of ["communities","spots","spawners","pois"]){counts.read[k]=counts.kept[k]=counts.dropped[k]=0;counts.reasons[k]={};}
const c:WorldContent={schema:"xfh/world-content-1",slice:{id,title:id,places:[root.id]},source:{game:"test",archives:"stamp",reader:WORLD_CONTENT_READER,key:generation,built:generation},records:generation==="B"?{"123":{kind:"other"}}:{},communities:[],spots:[],pois:[],spawners:[],counts};
const file=join(directory,`${id}.content.json`),signal=AbortSignal.timeout(4000),prepared=await prepareWorldContent(file,c.source.key,async()=>c,signal,fingerprint);
writeFileSync(join(directory,`${generation}.ready`),"");
if(wait){const deadline=performance.now()+3000;while(!existsSync(join(directory,`${generation}.go`))){signal.throwIfAborted();if(performance.now()>deadline)throw Error("Publisher gate deadline.");await Bun.sleep(5);}}
const result=await publishWorldContent(file,prepared,signal,{fingerprint,slice:{roots:[root]}});
writeFileSync(join(directory,`${generation}.result.json`),JSON.stringify({cached:result.cached,built:result.content.source.built,key:result.content.source.key,bytes:result.bytes,superseded:result.superseded}));
