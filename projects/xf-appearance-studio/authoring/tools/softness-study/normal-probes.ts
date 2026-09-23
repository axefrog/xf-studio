import {fixtures,widthField,prepareCoverage} from "./fields";

export function normalProbes() {
 const result=[];
 for(const name of["corner","concave"]){const polygon=fixtures[name].map(p=>({...p,weight:1}));
  for(const mode of["linear","log"]as const)for(const blend of[.0000078125,.00003125,.000125])for(let i=0;i<polygon.length;i++){
   const a=polygon[i],b=polygon[(i+1)%polygon.length],du=b.u-a.u,dv=b.v-a.v,length=Math.hypot(du,dv),u=(a.u+b.u)/2,v=(a.v+b.v)/2;
   const nu=-dv/length,nv=du/length,alpha=prepareCoverage(polygon,widthField(polygon,blend,mode));
   let previous=alpha(u-.02*nu,v-.02*nv),peak=previous,maxStepDrop=0,totalPeakDrop=0;
   for(let j=1;j<=2000;j++){const d=-.02+.03*j/2000,value=alpha(u+d*nu,v+d*nv);maxStepDrop=Math.max(maxStepDrop,previous-value);peak=Math.max(peak,value);totalPeakDrop=Math.max(totalPeakDrop,peak-value);previous=value;}
   result.push({name,mode,blend,segment:i,maxStepDrop,totalPeakDrop});
  }
 }
 return result;
}

if(import.meta.main){const path=new URL("results.json",import.meta.url),results=await Bun.file(path).json();results.edgeNormals=normalProbes();await Bun.write(path,JSON.stringify(results,null,2)+"\n");console.log(JSON.stringify({count:results.edgeNormals.length,failures:results.edgeNormals.filter((r:any)=>r.totalPeakDrop>1e-7)},null,2));}
