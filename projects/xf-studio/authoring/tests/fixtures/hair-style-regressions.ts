import { defaultGroom, seedAnatomicalDensity, surfaceBounds } from "../../src/features/hair-lab/groom";
import { constant } from "../../src/features/hair-lab/fields";
import type { Field, HeadSurface } from "../../src/features/hair-lab/types";
export function regressionGrooms(head: HeadSurface) {
const bounds=surfaceBounds(head), base=defaultGroom(head);
const styles=[structuredClone(base),structuredClone(base),structuredClone(base),structuredClone(base),structuredClone(base)];
styles[0].name='Long loose waves';
styles[1].name='Side part and swept bangs';styles[1].flow={...base.flow!,part:-.55,foreheadDirection:[1.8,-.5,-.08]};
const u:Field={op:'ramp',chart:'scalp',unit:'ratio',axis:'u',from:0,to:1};
const frontMask:Field={op:'multiply',chart:'scalp',unit:'ratio',a:{op:'smoothstep',chart:'scalp',unit:'ratio',input:u,low:.32,high:.40},b:{op:'blend',chart:'scalp',unit:'ratio',a:constant(1,'ratio'),b:constant(0,'ratio'),mask:{op:'smoothstep',chart:'scalp',unit:'ratio',input:u,low:.60,high:.68}}};
styles[1].fields.length={op:'blend',chart:'scalp',unit:'m',a:constant(.55,'m'),b:constant(.20,'m'),mask:frontMask};
styles[2].name='Shoulder bob';styles[2].fields.length=constant(.55,'m');styles[2].cut={normal:[0,1,0],offsetMetres:bounds.min[1]+.005};styles[2].fields.waves=constant(.001,'m');styles[2].fields.tipCurl=constant(.75,'rad');
styles[3].name='High ponytail';styles[3].fields.length=constant(.70,'m');styles[3].fields.waves=constant(.004,'m');styles[3].fields.spread=constant(.006,'m');styles[3].flow={...base.flow!,foreheadSweep:0,rearPreference:0};
for(const node of Object.values(styles[3].graph.nodes))if(node.kind==='volume'&&node.clump)node.next='tie';styles[3].graph.nodes.tie={kind:'convergence',next:'end',tie:{position:[bounds.centre[0],bounds.centre[1]+bounds.size[1]*.43,bounds.centre[2]-(head.front?.[2]??-1)*bounds.size[2]*.48],radiusMetres:.012}};
styles[4].name='Side shave';styles[4].flow={...base.flow!,part:-.35};styles[4].scalp.density=base.scalp.density!.map((v,i)=>head.positions[i*3]<bounds.centre[0]-.018?0:v);
return styles;
}
