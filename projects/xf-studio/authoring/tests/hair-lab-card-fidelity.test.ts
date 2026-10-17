import { expect, test } from "bun:test";
import { contactAt, contactDistance, type DistanceGrid } from "../src/features/hair-lab/contact";
import { generateCards } from "../src/features/hair-lab/cards";
import type { Volumes } from "../src/features/hair-lab/volumes";
import type { Root } from "../src/features/hair-lab/types";

test("distance-only queries agree with full contacts across bounds and overlapping domains", () => {
  const n = 7, make = (offset: number): DistanceGrid => ({ min: [-1,-1,-1], max: [1,1,1], cell: [1/3,1/3,1/3], resolution: n,
    values: Float32Array.from({length:n**3}, (_,i) => Math.hypot(i%n-3,Math.floor(i/n)%n-3,Math.floor(i/n/n)-3)/3-.6+offset) });
  const grid = make(0), other = make(-.1); grid.active = {min:[-.8,-1,-1],max:[1,1,1]}; other.exclude={min:[-.5,-.5,-.5],max:[.5,.5,.5]}; grid.others=[other];
  for(let z=-5;z<=5;z++)for(let y=-5;y<=5;y++)for(let x=-5;x<=5;x++) {
    const p:[number,number,number]=[x*.24,y*.24,z*.24];expect(contactDistance(grid,p)).toBe(contactAt(grid,p).distance);
  }
});
test("cupped cards bury narrow roots and finish natural tips without a rectangular end", () => {
  const root = { id:"fibre", index:1, normal:[0,0,1], uv:[.5,.5], phase:0 } as unknown as Root;
  const frames = Array.from({length:9},(_,i)=>({centre:[0,-i*.05,0] as [number,number,number],tangent:[0,-1,0] as [number,number,number],width:[1,0,0] as [number,number,number],normal:[0,0,1] as [number,number,number],radii:[.01,.01] as const,covariance:[.0001,0,.0001] as const}));
  const source:Volumes={logicalPopulation:1,sampledPopulation:1,volumes:[{id:"clump",section:"section",next:"end",frames,members:[{root,coordinates:frames.map(()=>[0,0,0]),startMetres:0,endMetres:.4,intrinsicMetres:.4,layerThicknessMetres:.015,clumpRatio:.4}]}]};
  const out=generateCards(source),card=out.cards[0],p=(j:number)=>out.positions.slice(j*3,j*3+3),width=(j:number)=>Math.hypot(...p(j+card.columns-1).map((v,k)=>v-p(j)[k]));
  const middle=card.start+4*card.columns, tip=card.start+card.count-card.columns;
  expect(width(card.start)).toBeLessThan(width(middle)*.5);
  expect(width(tip)).toBeLessThan(width(middle)*.08);
  expect(Math.abs(p(middle+1)[2]-(p(middle)[2]+p(middle+2)[2])*.5)).toBeGreaterThan(.001);
});
