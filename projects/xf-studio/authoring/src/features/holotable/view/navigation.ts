/** Bounded viewpoint history and time-injected 300 ms transitions; each view owns one. */
import type { Vec3 } from "../types";
import type { Orbit } from "./projection";
export interface Viewpoint { center:Vec3; orbit:Orbit }
const copy=(v:Viewpoint):Viewpoint=>({center:[...v.center],orbit:{...v.orbit,pan:v.orbit.pan?[...v.orbit.pan]:undefined}});
export function navigation(now:()=>number) {
  const stack:Viewpoint[]=[];let motion:{from:Viewpoint;to:Viewpoint;at:number}|undefined;
  function move(from:Viewpoint,to:Viewpoint,reduced:boolean) { motion=reduced?undefined:{from:copy(from),to:copy(to),at:now()};return copy(to); }
  return {
    get depth(){return stack.length;},get moving(){return !!motion;},
    reset(){stack.length=0;motion=undefined;},cancel(){motion=undefined;},
    focus(from:Viewpoint,to:Viewpoint,reduced:boolean){stack.push(copy(from));if(stack.length>8)stack.shift();return move(from,to,reduced);},
    back(from:Viewpoint,reduced:boolean){const to=stack.pop();return to?move(from,to,reduced):undefined;},
    frame(fallback:Viewpoint):Viewpoint {
      if(!motion)return fallback;
      const t=Math.min(1,Math.max(0,(now()-motion.at)/300)),k=1-(1-t)**3,{from,to}=motion;
      if(t===1){motion=undefined;return copy(to);}
      const lerp=(a:number,b:number)=>a+(b-a)*k;
      return {center:from.center.map((n,i)=>lerp(n,to.center[i])) as unknown as Vec3,orbit:{yaw:lerp(from.orbit.yaw,to.orbit.yaw),pitch:lerp(from.orbit.pitch,to.orbit.pitch),distance:lerp(from.orbit.distance,to.orbit.distance),fov:lerp(from.orbit.fov,to.orbit.fov),pan:[lerp(from.orbit.pan?.[0]??0,to.orbit.pan?.[0]??0),lerp(from.orbit.pan?.[1]??0,to.orbit.pan?.[1]??0)]}};
    },
  };
}
