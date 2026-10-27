import type { AgentItem } from "../agent-types";

// Every field remains present. Mean aggregation preserves its footprint and average signal.
export const MOTION_FIELD_EDGE = 8;
export type FieldDetail = { cols:number; rows:number; scalars?:number[]; vectors?:[number,number][]; max:number };
export function fieldDetails() {
  const cache = new WeakMap<AgentItem, FieldDetail>();
  return function* prepare(item:AgentItem):Generator<void,FieldDetail|undefined> {
    const anchor=item.resolvedAnchor??item.anchor;if(!("grid" in anchor))return;
    const cached=cache.get(item);if(cached)return cached;
    const g=anchor.grid,cols=Math.min(MOTION_FIELD_EDGE,g.cols),rows=Math.min(MOTION_FIELD_EDGE,g.rows);
    const scalars=item.value?.scalars,vectors=item.value?.vectors;
    const result:FieldDetail={cols,rows,max:1e-9,scalars:scalars?Array(cols*rows).fill(0):undefined,vectors:vectors?Array.from({length:cols*rows},()=>[0,0]):undefined};
    const counts=new Uint32Array(cols*rows);
    for(let n=0;n<g.rows*g.cols;n++){
      if(n%64===0)yield;
      const col=Math.floor(n%g.cols*cols/g.cols),row=Math.floor(Math.floor(n/g.cols)*rows/g.rows),i=row*cols+col;
      counts[i]++;
      if(scalars){const value=scalars[n];result.scalars![i]+=value;result.max=Math.max(result.max,Math.abs(value));}
      if(vectors){result.vectors![i][0]+=vectors[n][0];result.vectors![i][1]+=vectors[n][1];}
    }
    for(let i=0;i<counts.length;i++){
      if(i%64===0)yield;
      if(scalars)result.scalars![i]/=counts[i];
      if(vectors){result.vectors![i][0]/=counts[i];result.vectors![i][1]/=counts[i];}
    }
    cache.set(item,result);return result;
  };
}
