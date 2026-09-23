/** Count deterministic UV-cell candidates in the default Petal wash.
 * These are field candidates whose centres land in the painted mask, not
 * screen-visible sparks. The constants mirror the browser shader's three
 * explicitly versioned profiles and should be updated with that shader. */
import {initialRecipe,raster} from "../src/recipe";

const size=1024,seed=2077,density=.88,fineShare=.88;
const layer=initialRecipe().layers[0]!;
const alpha=raster(layer,size);
const at=(u:number,v:number)=>alpha[(Math.floor(v*size)*size+Math.floor(u*size))*4+3]??0;
const unit=(x:number,y:number,salt:number)=>{
  let h=(2166136261^salt^seed)>>>0;
  h=Math.imul(h^x,16777619)>>>0;
  h=Math.imul(h^y,16777619)>>>0;
  h^=h>>>16;h=Math.imul(h,2246822519)>>>0;h^=h>>>13;
  return (h&16777215)/16777216;
};
const smooth=(x:number)=>{const t=Math.min(1,Math.max(0,x));return t*t*(3-2*t);};
const cluster=(x:number,y:number)=>{
  const cx=Math.floor(x/18),cy=Math.floor(y/18);
  const tx=smooth(x/18-cx),ty=smooth(y/18-cy);
  const a=unit(cx,cy,29)*(1-tx)+unit(cx+1,cy,29)*tx;
  const b=unit(cx,cy+1,29)*(1-tx)+unit(cx+1,cy+1,29)*tx;
  return smooth(((a*(1-ty)+b*ty)-.22)/.5);
};
let maskPixels=0;
for(let i=3;i<alpha.length;i+=4)if(alpha[i]>127)maskPixels++;
const count=(grid:number,kind:"old"|"fine"|"large")=>{
  let centres=0,occupied=0,fine=0;
  for(let y=0;y<grid;y++)for(let x=0;x<grid;x++){
    const jitterX=kind==="large"?unit(x,y,31):unit(x,y,1);
    const jitterY=kind==="large"?unit(x,y,32):unit(x,y,2);
    const u=(x+.1+.8*jitterX)/grid,v=(y+.1+.8*jitterY)/grid;
    if(at(u,v)<=127)continue;
    centres++;
    const c=cluster(x,y);
    const occupancy=kind==="old"?density*(.07+.93*c)
      :kind==="fine"?density*(.48+.52*c):density*(.12+.30*c);
    if(unit(x,y,kind==="large"?44:14)>=occupancy)continue;
    occupied++;
    if(kind!=="large"&&unit(x,y,15)<fineShare)fine++;
  }
  return {grid,centres,occupied,fine:kind==="large"?undefined:fine,
    occupiedPerEye:Math.round(occupied/2)};
};
console.log(JSON.stringify({maskPixels,paintedFraction:maskPixels/(size*size),
  settings:{seed,density,fineShare},candidates:{
    oldCluster:count(1536,"old"),fine:count(2304,"fine"),large:count(768,"large")},
  caveat:"Centres within a >50% default mask at 1024; these are not visible glitter particles or screen pixels."},null,2));
