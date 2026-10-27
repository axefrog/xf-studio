import {join} from "node:path";
import {writeFileSync,statSync} from "node:fs";
import {updateWorldIndex} from "../../src/world-content-index";
import {coverage,WORLD_CONTENT_READER,type WorldContent} from "../../src/world-content";
const [directory,id]=process.argv.slice(2),root={id:"Districts.Test",name:"Test",kind:"district" as const,poly:[[0,0],[1,0],[1,1]] as [number,number][],zlo:0,zhi:1};
const c:WorldContent={schema:"xfh/world-content-1",slice:{id,title:id,places:[root.id]},source:{game:"test",archives:"stamp",reader:WORLD_CONTENT_READER,key:"key",built:"test"},records:{},communities:[],spots:[],pois:[],spawners:[],counts:coverage()};
const file=join(directory,`${id}.content.json`);writeFileSync(file,JSON.stringify(c));writeFileSync(join(directory,`${id}.ready`),"");
await updateWorldIndex(directory,c,{roots:[root]},AbortSignal.timeout(4000),{fingerprint:"shared",bytes:statSync(file).size});
