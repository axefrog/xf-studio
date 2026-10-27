import { expect, test } from "bun:test";
import { actorCaption, createPlateObstacles, gameSpan, itemTitle, labelContext, labelPriority, layerCounts, placeLabels, type AgentLabel, type PlateObstacle } from "../src/features/holotable/view/agent-labels";
import { agentInRange } from "../src/features/holotable/view/agent-bounds";
import { camera, fitOrbit, ORBITS } from "../src/features/holotable/view/projection";
import type { AgentItem } from "../src/features/holotable/agent-types";
import type { Vec3 } from "../src/features/holotable/types";

const item = (key: string, kind = "point"): AgentItem => ({ id: key, key, kind, anchor: { at: [0,0,0] } });
const label = (key: string, priority: number, x = 20, y = 30): AgentLabel => ({ key, text: key, priority, x, y, colour: "signal", alpha: 1 });
const measure = (s: string) => s.length * 7;

test("selected name and caption choose right, left, above, below, then fall back right as one block",()=>{
  const selected={...label("selected",-1),text:"Fixer",selected:true,plate:{x:150,y:120,radius:11}},caption={...label("selected",1.5),text:"Independent",caption:true};
  const blockers=[{key:"count-right",x:210,y:122,radius:12},{key:"plate-left",x:70,y:122,radius:12},{key:"plate-above",x:150,y:85,radius:10},{key:"plate-below",x:150,y:150,radius:10}];
  const expected=[[165,116],[58,116],[111.5,86],[111.5,150],[165,116]];
  for(let n=0;n<=4;n++){
    const obstacles=createPlateObstacles();for(const plate of blockers.slice(0,n))obstacles.add(plate);
    let probes=0;const placed=placeLabels([selected,caption],measure,300,250,40,[],{add:p=>obstacles.add(p),overlaps:(...args)=>{probes++;return obstacles.overlaps(...args);}});
    expect(placed.map(p=>p.text)).toEqual(["Fixer","Independent"]);expect([placed[0].x,placed[0].y]).toEqual(expected[n]);
    expect(placed[1].x).toBe(placed[0].x);expect(placed[1].y-placed[0].y).toBe(17);expect(probes).toBeLessThanOrEqual(8);
  }
  // A clear name is insufficient if only its second line would cover a neighbour.
  const placed=placeLabels([selected,caption],measure,300,250,40,[],[{key:"caption-neighbour",x:210,y:140,radius:8}]);
  expect(placed[0].x).toBe(58);expect(placed[1].x).toBe(58);
});

test("neighbouring plates cull ordinary labels, own plates do not, and selection always wins",()=>{
  const plates=[{key:"one",x:20,y:30,radius:10},{key:"two",x:70,y:30,radius:10}];
  const one=label("one",1,40,30),two=label("two",1,90,30);
  expect(placeLabels([one,two],measure,300,200,40,[],plates).map(l=>l.key)).toEqual(["two"]);
  expect(placeLabels([one],measure,300,200,40,[],plates.slice(0,1)).map(l=>l.key)).toEqual(["one"]);
  const selected={...one,selected:true};
  const placed=placeLabels([label("hovered",-2,40,30),two,selected],measure,300,200,40,[{x:40,y:30,width:100}],plates);
  expect(placed.map(l=>l.key)).toEqual(["one"]);
});

test("dense plate layout indexes obstacles once rather than testing every plate for every culled label",()=>{
  let inspected=0;
  const plates:PlateObstacle[]=Array.from({length:5000},(_,i)=>({key:String(i),get x(){inspected++;return 20;},y:30,radius:10}));
  const candidates=Array.from({length:5000},(_,i)=>label(String(i),1,200,30));
  const placed=placeLabels(candidates,measure,460,300,40,[{x:200,y:30,width:200}],plates);
  expect(placed).toHaveLength(0);expect(inspected).toBeLessThanOrEqual(5000*2);
});

test("overlapping labels yield to selection, relation ends, actors, points, then relation text; markers remain outside text layout", () => {
  const actor = item("actor", "actor"), target = item("target", "target"), edge = { ...item("edge", "relation"), links: { from: "actor", to: "target" } };
  const context = labelContext([actor, target, edge], "edge", null);
  expect([...context].sort()).toEqual(["actor", "edge", "target"]);
  expect(labelPriority(target, context)).toBe(0);
  const ordinary = new Set<string>();
  const candidates = [item("other", "zone"), edge, target, actor].map(i => label(i.key, labelPriority(i, ordinary)));
  expect(placeLabels(candidates, measure, 800, 500).map(l => l.key)).toEqual(["actor"]);
  expect(placeLabels([...candidates, label("hovered", -2)], measure, 800, 500).map(l => l.key)).toEqual(["hovered"]);
});

test("captions yield to names, are one muted value line, and the text budget is forty", () => {
  const candidates = [label("actor", 1), { ...label("actor", 1, 20, 47), text: "waiting", caption: true }, label("point", 2, 20, 47)];
  expect(placeLabels(candidates, measure, 800, 500).map(l => l.text)).toEqual(["actor", "waiting"]);
  expect(actorCaption("waiting\nfor a courier")).toBe("waiting for a courier");
  expect(actorCaption("A full line of dialogue that is longer than the caption")).toHaveLength(28);
  expect(actorCaption("A full line of dialogue that is longer than the caption")).toEndWith("…");
  expect(placeLabels(Array.from({ length: 70 }, (_, i) => label(String(i), 1, i % 10 * 60, 20 + Math.floor(i / 10) * 25)), measure, 800, 500)).toHaveLength(40);
  const long = placeLabels([{ ...label("selected", -1), text: "x".repeat(160) }], measure, 300, 500);
  expect(long).toHaveLength(1); expect(long[0].width).toBeLessThanOrEqual(292); expect(long[0].text).toEndWith("…");
});

test("relation titles, count plurals and game-clock spans use readable meaning", () => {
  const kai = { ...item("kai", "actor"), value: { name: "Synthetic Kai" } }, edge = { ...item("edge", "relation"), value: { type: "owes", mutual: false }, links: { from: "mira", to: "kai" } };
  expect(itemTitle(edge, [kai, edge])).toBe("owes → Synthetic Kai");
  expect(itemTitle({ ...edge, value: { ...edge.value, mutual: true } }, [kai])).toBe("owes ↔ Synthetic Kai");
  expect(layerCounts({ id: "l", title: "L", producer: "p", layer: "l", items: [kai], refused: 1, reason: "", notPlaced: ["a"], otherBranches: ["b"] })).toBe("1 item · 1 refused · 1 not placed · 1 on other branches");
  expect(gameSpan(604800)).toBe("7 days"); expect(gameSpan(273600)).toBe("3 days 4 h");
  expect(gameSpan(86400)).toBe("1 day"); expect(gameSpan(3600)).toBe("1 h"); expect(gameSpan(60)).toBe("<1 h");
});

test("standalone first-fit keeps the whole extent inside both narrow and wide viewports", () => {
  const bounds = { min: [-900,-300,0] as Vec3, max: [800,600,100] as Vec3 }, center = bounds.min.map((n, i) => (n + bounds.max[i]) / 2) as unknown as Vec3;
  for (const width of [300, 780]) for (const preset of Object.values(ORBITS)) {
    const fitted = fitOrbit(bounds, preset, width, 500), C = camera(center, fitted, width, 500);
    expect(fitted.distance).toBeGreaterThan(preset.distance);
    for (let n = 0; n < 8; n++) {
      const p = C.point(bounds.min.map((v, axis) => n & (1 << axis) ? bounds.max[axis] : v) as unknown as Vec3)!;
      expect(p[0]).toBeGreaterThanOrEqual(79.99); expect(p[0]).toBeLessThanOrEqual(width - 79.99);
      expect(p[1]).toBeGreaterThanOrEqual(59.99); expect(p[1]).toBeLessThanOrEqual(440.01);
    }
  }
});

const mira = { ...item("mira", "actor"), value: { name: "Synthetic Mira" } };
const kai = { ...item("kai", "actor"), value: { name: "Synthetic Kai" } };
test("an actor's outgoing relation names the destination", () => {
  const edge = { ...item("edge", "relation"), value: { type: "owes" }, links: { from: "mira", to: "kai" } };
  expect(itemTitle(edge, [mira, kai], "mira")).toBe("owes → Synthetic Kai");
});
test("an actor's incoming relation names the source before its type", () => {
  const edge = { ...item("edge", "relation"), value: { type: "hunting" }, links: { from: "kai", to: "mira" } };
  expect(itemTitle(edge, [mira, kai], "mira")).toBe("Synthetic Kai → hunting");
});
test("a mutual relation names the far end from either actor", () => {
  const edge = { ...item("edge", "relation"), value: { type: "loyal to", mutual: true }, links: { from: "kai", to: "mira" } };
  expect(itemTitle(edge, [mira, kai], "mira")).toBe("loyal to ↔ Synthetic Kai");
  expect(itemTitle(edge, [mira, kai], "kai")).toBe("loyal to ↔ Synthetic Mira");
});


test("bounds culling retains paths, areas, fields and relations crossing the 350 m view circle",()=>{
 const target:Vec3=[0,0,0],base=item("crossing");
 const examples:AgentItem[]=[
  {...base,kind:"path",anchor:{path:[[1000,0,0],[-1000,0,0]]},place:[1000,0,0]},
  {...base,kind:"zone",anchor:{box:{min:[-1000,-1000,0],max:[1000,1000,20]}},place:[1000,0,0]},
  {...base,kind:"zone",anchor:{zone:{poly:[[-1000,-1000],[1000,-1000],[1000,1000],[-1000,1000]],zlo:0,zhi:20}},place:[1000,0,0]},
  {...base,kind:"field",anchor:{grid:{origin:[-1000,-1000,0],cell:20,cols:100,rows:100}},place:[-1000,-1000,0]},
  {...base,kind:"relation",place:[1000,0,0],to:[-1000,0,0]},
 ];
 for(const example of examples)expect(agentInRange(example,target,350)).toBe(true);
 expect(agentInRange({...base,place:[351,0,0]},target,350)).toBe(false);
 expect(agentInRange({...base,kind:"path",anchor:{path:[[1000,1000,0],[2000,2000,0]]},place:[1000,1000,0]},target,350)).toBe(false);
});


test("community labels keep the largest at a collision, respect plates even when selected, and show at most twelve",()=>{
 const community=(key:string,n:number,x=20,y=30):AgentLabel=>({...label(key,4,x,y),text:`Community · ${n} ${n===1?"spot":"spots"}`,communitySpots:n});
 const large=community("large",20),small=community("small",1);
 expect(placeLabels([small,large],measure,1100,400).map(l=>l.key)).toEqual(["large"]);
 expect(placeLabels([{...large,selected:true,plate:{x:20,y:30,radius:9}}],measure,1100,400,40,[],[{key:"poi",x:60,y:30,radius:9}])).toEqual([]);
 const many=Array.from({length:20},(_,i)=>community(String(i),20-i,20+(i%5)*210,30+Math.floor(i/5)*50));
 const placed=placeLabels(many.reverse(),measure,1100,400);
 expect(placed).toHaveLength(12);expect(placed.map(l=>l.communitySpots)).toEqual(Array.from({length:12},(_,i)=>20-i));
});
