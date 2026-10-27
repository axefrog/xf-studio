import type { AgentItem } from "../agent-types";
import type { Vec3 } from "../types";
import type { camera } from "./projection";
import type { FieldDetail } from "./field-detail";

/** Eight view-local raster surfaces at most. Refinement fades reuse field paint instead of restarting it. */
export function fieldCanvas(now:()=>number) {
  type Surface={key:string;canvas:HTMLCanvasElement;ctx:CanvasRenderingContext2D;cursor:number};
  const surfaces=new Map<AgentItem,Surface>();
  // Direct paints resume only while the owning canvas has not been cleared.
  const coarse=new Map<AgentItem,Surface>();
  const release=(surface:Surface)=>{surface.canvas.width=surface.canvas.height=0;};
  return {
    canvasCleared(){coarse.clear();},
    clear(){for(const surface of surfaces.values())release(surface);surfaces.clear();coarse.clear();},
    draw(item:AgentItem,detail:FieldDetail,C:ReturnType<typeof camera>,moving:boolean,colour:string,alpha:number,deadline:number,target:CanvasRenderingContext2D){
      const a=item.resolvedAnchor??item.anchor;if(!("grid" in a))return true;
      const g=a.grid,cols=moving?detail.cols:g.cols,rows=moving?detail.rows:g.rows,dpr=window.devicePixelRatio||1;
      const key=JSON.stringify([C.position,C.target,C.scale(C.target),C.width,C.height,moving,cols,rows,dpr,colour,alpha]);
      if(!moving)coarse.delete(item);
      let surface=moving?coarse.get(item):surfaces.get(item);
      if(moving&&(!surface||surface.key!==key||surface.ctx!==target)){
        surface={key,canvas:target.canvas,ctx:target,cursor:0};coarse.set(item,surface);
      }
      if(!surface){
        if(surfaces.size===8){const oldest=surfaces.keys().next().value!;release(surfaces.get(oldest)!);surfaces.delete(oldest);}
        const canvas=document.createElement("canvas");surface={key:"",canvas,ctx:canvas.getContext("2d")!,cursor:0};surfaces.set(item,surface);
      }
      // Touching a surface makes it recent, including incomplete paint resumed across fade revisions.
      if(!moving){surfaces.delete(item);surfaces.set(item,surface);}
      const ctx=surface.ctx;
      if(surface.key!==key){
        surface.key=key;surface.cursor=0;
        if(surface.canvas.width!==Math.round(C.width*dpr)||surface.canvas.height!==Math.round(C.height*dpr)){surface.canvas.width=Math.round(C.width*dpr);surface.canvas.height=Math.round(C.height*dpr);}
        ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,C.width,C.height);
      }
      ctx.fillStyle=ctx.strokeStyle=colour;ctx.lineWidth=1+(item.weight??.7)*2;ctx.globalAlpha=alpha;
      const scalars=moving?detail.scalars:item.value?.scalars,vectors=moving?detail.vectors:item.value?.vectors;
      const corners:[number,number,number][]=[[0,0,g.origin[2]],[0,0,g.origin[2]],[0,0,g.origin[2]],[0,0,g.origin[2]]],xy=new Float64Array(8),depths=new Float64Array(4);
      for(;surface.cursor<cols*rows;surface.cursor++){
        if(surface.cursor%16===0&&now()>deadline)return false;
        const n=surface.cursor,row=Math.floor(n/cols),col=n%cols;
        const x=g.origin[0]+Math.ceil(col*g.cols/cols)*g.cell,y=g.origin[1]+Math.ceil(row*g.rows/rows)*g.cell,z=g.origin[2];
        const right=g.origin[0]+Math.ceil((col+1)*g.cols/cols)*g.cell,top=g.origin[1]+Math.ceil((row+1)*g.rows/rows)*g.cell;
        if(scalars){
          corners[0][0]=corners[3][0]=x;corners[1][0]=corners[2][0]=right;
          corners[0][1]=corners[1][1]=y;corners[2][1]=corners[3][1]=top;
          ctx.globalAlpha=alpha*(.05+Math.abs(scalars[n])/detail.max*.4);
          if(C.projectInto(corners,xy,depths)){
            ctx.beginPath();ctx.moveTo(xy[0],xy[1]);for(let i=1;i<4;i++)ctx.lineTo(xy[i*2],xy[i*2+1]);ctx.closePath();ctx.fill();
          }else{
            // Most rejected cells are wholly outside one edge. Only crossings need clipping.
            if([0,1,2,3].every(i=>depths[i]<1)||[0,1,2,3].every(i=>depths[i]>=1)&&[0,1].some(axis=>[0,1,2,3].every(i=>xy[i*2+axis]<-32)||[0,1,2,3].every(i=>xy[i*2+axis]>(axis?C.height:C.width)+32)))continue;
            const ps=C.polygon(corners);if(ps.length){ctx.beginPath();ctx.moveTo(...ps[0]);for(let i=1;i<ps.length;i++)ctx.lineTo(...ps[i]);ctx.closePath();ctx.fill();}
          }
        }else if(vectors){
          const v=vectors[n],start:Vec3=[(x+right)/2,(y+top)/2,z],end:Vec3=[start[0]+v[0],start[1]+v[1],z];
          for(const run of C.line([start,end])){ctx.beginPath();ctx.moveTo(...run.points[0]);for(let i=1;i<run.points.length;i++)ctx.lineTo(...run.points[i]);ctx.stroke();}
          const pa=C.point(start),pb=C.point(end);if(pa&&pb){const angle=Math.atan2(pb[1]-pa[1],pb[0]-pa[0]);ctx.beginPath();for(const side of [-.45,.45]){ctx.moveTo(...pb);ctx.lineTo(pb[0]-7*Math.cos(angle+side),pb[1]-7*Math.sin(angle+side));}ctx.stroke();}
        }
      }
      if(!moving){target.globalAlpha=1;target.drawImage(surface.canvas,0,0,C.width,C.height);}
      target.globalAlpha=alpha;
      return true;
    },
  };
}
