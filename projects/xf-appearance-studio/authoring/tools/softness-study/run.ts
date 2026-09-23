import {normalProbes} from "./normal-probes";
import {widthField, prepareCoverage, subdivide, strip, fixtures, type WidthMode, type SoftPoint} from "./fields";
import {coverage, curve, initialRecipe} from "../../src/recipe";
import {preparePigmentStrength} from "../../src/pigment-strength";

const blendValues = [.0000078125,.000015625,.00003125,.0000625,.000125,.00025,.0005,.001];
const modes: WidthMode[] = ["linear","log"];
const results: any = {date:"2026-09-23",runtime:Bun.version,notes:["Research only; no production mask or recipe changes.","Widths are full centered feather band distances in control UV, distinct from pigment strength.","Log mode interpolates log width on each edge; split widths must use geometric interpolation.","Timings are one-layer warm median of three, shared prepared evaluator; production raster allocation/worker overhead excluded."],edgeWidening:[],continuity:[],invariance:[],uniform:[],boundary:[],monotonic:[],timings:[]};
for(const gap of [.001,.004,.01,.04])for(const blend of blendValues)for(const mode of modes) {
 const polygon=strip(gap),field=widthField(polygon,blend,mode),alpha=prepareCoverage(polygon,field);
 const sharp=field(.5,.4),soft=field(.5,.4+gap);
 const root=(target:number,from:number,to:number)=>{let previous=alpha(.5,from);for(let i=1;i<=4000;i++){const y=from+(to-from)*i/4000,value=alpha(.5,y);if(previous<=target&&value>=target){let lo=y-(to-from)/4000,hi=y;for(let j=0;j<30;j++){const m=(lo+hi)/2;if(alpha(.5,m)>=target)hi=m;else lo=m}return (lo+hi)/2;}previous=value;}return null};
 const p10=root(.1,.4-.02,.4+gap/2),p90=root(.9,.4-.02,.4+gap/2);
 results.edgeWidening.push({gap,blend,mode,sharpWidth:sharp,sharpRatio:sharp/.001,softWidth:soft,softRatio:soft/.04,centerWidth:field(.5,.4+gap/2),centerAlpha:alpha(.5,.4+gap/2),transition10to90:p10!==null&&p90!==null?p90-p10:null});
}
for(const [name,polygon]of Object.entries(fixtures))for(const mode of modes) {
 const blend=.000125,field=widthField(polygon,blend,mode),smooth=prepareCoverage(polygon,field),nearest=prepareCoverage(polygon,null);
 const location=name==='thin'?{u:.5,v:.402}:name==='narrow'?{u:.5,v:.4005}:name==='crossing'?{u:.5,v:.5}:{u:.5,v:.5};
 for(const e of[1e-4,1e-6,1e-8])results.continuity.push({name,mode,e,nearestJump:Math.abs(nearest(location.u,location.v-e)-nearest(location.u,location.v+e)),smoothJump:Math.abs(smooth(location.u,location.v-e)-smooth(location.u,location.v+e))});
 const split=widthField(subdivide(polygon,mode),blend,mode),reverse=widthField([...polygon].reverse(),blend,mode);
 const angle=.437,c=Math.cos(angle),s=Math.sin(angle),rotate=(p:{u:number;v:number})=>({u:.5+(p.u-.5)*c-(p.v-.5)*s,v:.5+(p.u-.5)*s+(p.v-.5)*c});
 const rotated=widthField(polygon.map(p=>({...p,...rotate(p)})),blend,mode),reflected=widthField(polygon.map(p=>({...p,u:1-p.u})),blend,mode);
 let splitError=0,reverseError=0,rotateError=0,reflectError=0,min=Infinity,max=-Infinity,finite=true;
 for(let y=0;y<=30;y++)for(let x=0;x<=30;x++){const u=.15+x*.7/30,v=.2+y*.55/30,f=field(u,v),r=rotate({u,v});splitError=Math.max(splitError,Math.abs(f-split(u,v)));reverseError=Math.max(reverseError,Math.abs(f-reverse(u,v)));rotateError=Math.max(rotateError,Math.abs(f-rotated(r.u,r.v)));reflectError=Math.max(reflectError,Math.abs(f-reflected(1-u,v)));min=Math.min(min,f);max=Math.max(max,f);finite&&=Number.isFinite(f)&&Number.isFinite(smooth(u,v));}
 results.invariance.push({name,mode,splitError,reverseError,rotateError,reflectError,min,max,finite});
 const pigment=preparePigmentStrength(polygon,.0005);let boundaryError=0;
 for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length];for(let j=0;j<=20;j++){const u=a.u+(b.u-a.u)*j/20,v=a.v+(b.v-a.v)*j/20;boundaryError=Math.max(boundaryError,Math.abs(smooth(u,v)-.5*pigment(u,v)));}}
 results.boundary.push({name,mode,maxAlphaError:boundaryError});
}
for(const gap of[.001,.004,.04])for(const mode of modes)for(const blend of [.0000078125,.00003125,.000125,.0005])for(const edge of["sharp","soft"]){
 const polygon=strip(gap),alpha=prepareCoverage(polygon,widthField(polygon,blend,mode));const boundary=edge==="sharp"?.4:.4+gap,sign=edge==="sharp"?1:-1;
 let prior=alpha(.5,boundary-sign*.03),maxDrop=0,drops=0,peak=prior,totalPeakDrop=0,worstInward=0;
 for(let i=1;i<=4000;i++){const inward=-.03+(.03+gap/2)*i/4000,value=alpha(.5,boundary+sign*inward);if(value<prior-1e-10){maxDrop=Math.max(maxDrop,prior-value);drops++;}peak=Math.max(peak,value);if(peak-value>totalPeakDrop){totalPeakDrop=peak-value;worstInward=inward;}prior=value;}
 results.monotonic.push({gap,mode,blend,edge,drops,maxDrop,totalPeakDrop,worstInward});
}
// Direct parity with current coverage() for uniform widths and uniform pigment,
// using identical polygon/nearest-strength arithmetic as the current fast path.
for(const width of[.0005,.001,.012,.06])for(const mode of modes){const l=initialRecipe().layers[0];l.symmetry=false;l.fields=[];l.feather=width;const p=curve(l.points).map(p=>({...p,width}));const f=widthField(p,.000125,mode),a=prepareCoverage(p,f,l.opacity);let max=0,bytes=0;for(let y=180;y<290;y++)for(let x=280;x<460;x++){const u=(x+.5)/1024,v=(y+.5)/1024,r=coverage(u,v,l,p),s=a(u,v);max=Math.max(max,Math.abs(r-s));if(Math.round(r*255)!==Math.round(s*255))bytes++;}results.uniform.push({width,mode,max,byteDifferences:bytes});}
// Petal & 24-knot ellipse: smooth pigment plus width need two boundary integrals.
for(const count of[6,24])for(const mode of modes){let l=initialRecipe().layers[0];if(count===24){l.pathMode="catmull-rom";l.points=Array.from({length:24},(_,i)=>({u:.37+.068*Math.cos(i*Math.PI/12),v:.235+.025*Math.sin(i*Math.PI/12),weight:i/23}));}else l.points.forEach((p,i)=>p.weight=i/5);const p=curve(l.points).map(p=>({...p,width:.001+(.04-.001)*p.weight}));const alpha=prepareCoverage(p,widthField(p,.000125,mode));for(const size of[1024,2048]){let checksum=0;const run=()=>{for(let y=Math.floor(.16*size);y<Math.ceil(.31*size);y++)for(let x=Math.floor(.25*size);x<Math.ceil(.5*size);x++)checksum+=alpha((x+.5)/size,(y+.5)/size);};run();const times=[];for(let n=0;n<3;n++){const start=performance.now();run();times.push(performance.now()-start);}results.timings.push({count,mode,size,polygonPoints:p.length,medianMs:times.sort((a,b)=>a-b)[1],checksum});}}
results.edgeNormals=normalProbes();
await Bun.write(new URL("results.json",import.meta.url),JSON.stringify(results,null,2)+"\n");
console.log(JSON.stringify({rows:results.edgeWidening.length,examples:results.edgeWidening.filter((r:any)=>r.gap===.004&&[.000125,.0005].includes(r.blend)),continuity:results.continuity.filter((r:any)=>r.name==='thin'&&r.e===1e-8),maxSplitError:Math.max(...results.invariance.map((r:any)=>r.splitError)),uniform:results.uniform,monotonicFailures:results.monotonic.filter((r:any)=>r.drops),timings:results.timings},null,2));
