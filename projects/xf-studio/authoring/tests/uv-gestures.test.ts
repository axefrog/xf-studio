import { expect, test } from "bun:test";
import { initialRecipe, type Recipe } from "../src/recipe";
import { createUVEditor } from "../src/uv-editor";
import { applyAdapterProposal } from "./gesture-test-adapter";
import { defaultUVView, panUVView, parseUVView, pixelToUV, uvAspect, uvRegion, uvToPixel, zoomUVView } from "../src/uv-view";

test("UV navigation preserves anchor/aspect, round trips and stays inside persisted view bounds", () => {
  for (const mode of ["both", "single"] as const) for (const factor of [.8, 1.25, 3]) {
    const view = { ...defaultUVView(), mode }, anchor = { u: .38, v: .24 }, region = uvRegion(view);
    const before = uvToPixel(anchor, region, 720, 720 / uvAspect(mode)), zoomed = zoomUVView(view, anchor, factor);
    const after = uvToPixel(anchor, uvRegion(zoomed), 720, 720 / uvAspect(mode));
    expect(after.x).toBeCloseTo(before.x, 10); expect(after.y).toBeCloseTo(before.y, 10);
    expect(zoomed.span).toBeCloseTo(view.span / factor, 12);
    expect(zoomUVView(zoomed, anchor, 1 / factor).u).toBeCloseTo(view.u, 12);
    expect(parseUVView(zoomed)).toEqual(zoomed);
    const panned = panUVView(view, .12, -.03);
    expect(panned.u).toBeCloseTo(view.u + .12, 12); expect(panned.v).toBeCloseTo(view.v - .03, 12);
    expect(panned.span).toBe(view.span); expect(panned.mode).toBe(mode);
  }
  const original = defaultUVView();
  expect(zoomUVView(original, { u: 0, v: 0 }, NaN)).toEqual(original);
  expect(panUVView(original, Infinity, 0)).toEqual(original);
  for (const view of [zoomUVView(original, {u: -1, v: 2}, 1e-8), zoomUVView(original, {u: 0, v: 0}, 1e8), panUVView(original, 100, -100)])
    expect(parseUVView(view)).toEqual(view);
});

async function fixture(run: (f: ReturnType<typeof setup>) => void | Promise<void>) {
  const previous = { document: globalThis.document, window: globalThis.window, ResizeObserver: globalThis.ResizeObserver };
  let f: ReturnType<typeof setup> | undefined;
  try { f = setup(); await run(f); }
  finally { f?.listeners.blur?.({}); Object.assign(globalThis, previous); }
}
function setup() {
  const listeners: Record<string, (event: any) => void> = {}, canvasListeners: Record<string, (event: any) => void> = {};
  const context = new Proxy({}, { get: () => () => {} });
  let captured: number | undefined;
  const canvas: any = { width: 720, height: 310, getContext: () => context,
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 720, height: 310 }),
    setPointerCapture: (id: number) => { captured = id; }, hasPointerCapture: (id: number) => id === captured,
    releasePointerCapture: () => { captured = undefined; }, addEventListener: (kind: string, fn: (e: any) => void) => { canvasListeners[kind] = fn; } };
  Object.assign(globalThis, { document: { createElement: () => ({getContext: () => context}) },
    window: { addEventListener: (kind: string, fn: (e: any) => void) => { listeners[kind] = fn; } }, ResizeObserver: class { observe() {} } });
  let recipe = initialRecipe(), selected = 0, checkpoint: Recipe, begins = 0, cancels = 0, changes = 0, persists = 0;
  recipe.layers[0].points = [[.3,.2], [.45,.2], [.45,.35], [.3,.35]].map(([u,v]) => ({u,v,weight:1, handles:{in:{u:0,v:0},out:{u:0,v:0},mode:"corner"}}));
  recipe.layers[0].fields = [{id:"warp",u:.32,v:.22,du:.005,dv:.001,radius:.03}];
  const messages: string[] = [], element = () => ({setAttribute() {}, disabled:false, textContent:""}) as any;
  const editor = createUVEditor(canvas, {both:element(),single:element(),other:element(),fit:element(),note:element()}, {
    recipe:()=>recipe,layer:()=>recipe.layers[0],selected:()=>selected,canvases:()=>[],albedo:()=>undefined,
    select:index=>{selected=index;},selectedField:()=>undefined,selectField() {},
    begin:()=>{checkpoint=structuredClone(recipe);begins++;},
    apply:action=>{const changed=applyAdapterProposal(recipe.layers[0],action);if(changed)changes++;return changed;},
    cancel:()=>{recipe=structuredClone(checkpoint);cancels++;},
    persist:()=>{persists++;},message:text=>messages.push(text),
  },defaultUVView());
  editor.draw();
  const event = (x: number,y: number,extra: Record<string,unknown> = {}) => ({clientX:x,clientY:y,pointerId:3,button:0,shiftKey:false,defaultPrevented:false,
    preventDefault(){this.defaultPrevented=true;}, ...extra});
  const screen = (u: number,v: number) => { const p=uvToPixel({u,v},uvRegion(editor.snapshot()),720,310);return {x:p.x+10,y:p.y+20}; };
  const key = (key="Escape") => { const e={key,prevented:false,preventDefault(){this.prevented=true;},stopImmediatePropagation(){}};listeners.keydown(e);return e; };
  const wheel = (x: number,y: number,shiftKey=true,deltaY=-120) => { const e=event(x,y,{shiftKey,deltaY,deltaMode:0});canvasListeners.wheel(e);return e; };
  return {canvas,listeners,editor,event,screen,key,wheel,messages,get recipe(){return recipe;},set recipe(r:Recipe){recipe=r;},
    get counts(){return {begins,cancels,changes,persists};},get selected(){return selected;}};
}

test("UV whole-shape translation waits for movement, reflects the grabbed eye, rejects limits and cancels exactly", () => fixture(f => {
  const original=structuredClone(f.recipe), layer=f.recipe.layers[0], p=f.screen(.62,.29);
  f.canvas.onpointerdown(f.event(p.x,p.y));
  expect(f.editor.diagnostics().gesture).toBe("translate");
  f.canvas.onpointermove(f.event(p.x+2,p.y+1)); expect(f.counts.begins).toBe(0);expect(f.recipe).toEqual(original);
  f.canvas.onpointermove(f.event(p.x+24,p.y+12));
  expect(f.recipe.layers[0]).toBe(layer);expect(f.counts.begins).toBe(1);
  for(let i=0;i<4;i++) {
    expect(layer.points[i].u).toBeCloseTo(original.layers[0].points[i].u-24/720*.5,12);
    expect(layer.points[i].v).toBeCloseTo(original.layers[0].points[i].v+12/720*.5,12);
    expect(layer.points[i].handles).toEqual(original.layers[0].points[i].handles);
  }
  expect(layer.fields[0].u).toBeCloseTo(original.layers[0].fields[0].u-24/720*.5,12);
  const accepted=structuredClone(layer);
  f.canvas.onpointermove(f.event(p.x+2500,p.y));expect(layer).toEqual(accepted);expect(f.messages.length).toBe(1);
  f.canvas.onpointermove(f.event(p.x+36,p.y));expect(layer.points[0].u).toBeCloseTo(.3-36/720*.5,12);
  expect(f.counts.begins).toBe(1);f.key();expect(f.recipe).toEqual(original);expect(f.counts.cancels).toBe(1);
}));

test("Shift drag over another knot rotates around the active knot, preserves selection and rejects stale targets", () => fixture(f => {
  const original=structuredClone(f.recipe), start=f.screen(.45,.2), end=f.screen(.3,.35);
  f.canvas.onpointerdown(f.event(start.x,start.y,{shiftKey:true}));expect(f.editor.diagnostics().gesture).toBe("rotate");
  const radial=f.screen(.47,.2);f.canvas.onpointermove(f.event(radial.x,radial.y,{shiftKey:true}));
  expect(f.counts.begins).toBe(0);expect(f.recipe).toEqual(original);
  f.canvas.onpointermove(f.event(end.x,end.y,{shiftKey:true}));
  expect(f.selected).toBe(0);expect(f.recipe.layers[0].points[0]).toEqual(original.layers[0].points[0]);
  expect(f.recipe.layers[0].points[1].u).toBeCloseTo(.3,12);expect(f.recipe.layers[0].points[1].v).toBeCloseTo(.35,12);
  expect(f.recipe.layers[0].fields[0].du).toBeCloseTo(-.001,12);expect(f.recipe.layers[0].fields[0].dv).toBeCloseTo(.005,12);
  f.key();expect(f.recipe).toEqual(original);
  f.canvas.onpointerdown(f.event(start.x,start.y,{shiftKey:true}));
  f.recipe=structuredClone(original); const replacement=f.recipe;
  f.canvas.onpointermove(f.event(end.x,end.y,{shiftKey:true}));expect(f.recipe).toBe(replacement);expect(f.recipe).toEqual(original);
  expect(f.editor.diagnostics().gesture).toBeNull();expect(f.counts.cancels).toBe(1);
}));

test("UV right pan works without layers, persists, cancels separately and ordinary wheel anchors its pixel", () => fixture(f => {
  f.recipe.layers=[];const original=f.editor.snapshot();
  f.canvas.onpointerdown(f.event(300,200,{button:2}));expect(f.editor.diagnostics().gesture).toBe("pan");
  f.canvas.onpointermove(f.event(372,231,{button:2}));
  expect(f.editor.snapshot().u).toBeCloseTo(original.u-.05,12);
  expect(f.editor.snapshot().v).toBeCloseTo(original.v-31/720*.5,12);
  expect(f.counts.begins).toBe(0);expect(f.counts.persists).toBeGreaterThan(0);
  f.key();expect(f.editor.snapshot()).toEqual(original);expect(f.counts.cancels).toBe(0);
  const anchor=pixelToUV({x:280,y:130},uvRegion(original),720,310);
  const e=f.wheel(290,150,false);expect(e.defaultPrevented).toBe(true);
  const pixel=uvToPixel(anchor,uvRegion(f.editor.snapshot()),720,310);
  expect(pixel.x).toBeCloseTo(280,10);expect(pixel.y).toBeCloseTo(130,10);expect(f.counts.begins).toBe(0);
  f.canvas.onpointerdown(f.event(300,200,{button:2}));const zoom=f.editor.snapshot();
  f.canvas.onpointermove(f.event(320,220,{button:2}));f.listeners.blur({});expect(f.editor.snapshot()).toEqual(zoom);
}));

test("Shift-wheel groups one cancellable scale burst, closes on context changes and cannot interleave a pointer drag", () => fixture(f => {
  const original=structuredClone(f.recipe), p=f.screen(.38,.29);
  expect(f.wheel(p.x,p.y,true,0).defaultPrevented).toBe(true);expect(f.counts.begins).toBe(0);
  f.wheel(p.x,p.y);f.wheel(p.x,p.y);
  expect(f.counts.begins).toBe(1);expect(f.editor.diagnostics().gesture).toBe("scale");
  expect(f.recipe.layers[0].points[0]).toEqual(original.layers[0].points[0]);
  expect(f.recipe.layers[0].points[1].u).toBeCloseTo(.3+.15*1.02**2,12);
  expect(f.recipe.layers[0].feather).toBeCloseTo(original.layers[0].feather*1.02**2,12);
  expect(f.key().prevented).toBe(true);expect(f.recipe).toEqual(original);
  f.wheel(p.x,p.y);f.recipe=structuredClone(original);expect(f.key().prevented).toBe(false);expect(f.recipe).toEqual(original);
  expect(f.counts.cancels).toBe(1);
  f.wheel(p.x,p.y);f.recipe.layers[1].name="Unrelated edit";const changed=structuredClone(f.recipe);
  expect(f.key().prevented).toBe(false);expect(f.recipe).toEqual(changed);
  f.recipe=structuredClone(original);
  f.canvas.onpointerdown(f.event(p.x,p.y));const view=f.editor.snapshot();
  expect(f.wheel(p.x,p.y).defaultPrevented).toBe(true);expect(f.recipe).toEqual(original);
  f.wheel(p.x,p.y,false);expect(f.editor.snapshot()).toEqual(view);f.canvas.onpointerup(f.event(p.x,p.y));
}));

test("Wheel burst timeout extends from the latest event and a later burst opens a new Undo entry", () => fixture(async f => {
  f.wheel(300,180);await new Promise(resolve=>setTimeout(resolve,160));
  f.wheel(300,180);await new Promise(resolve=>setTimeout(resolve,160));
  expect(f.editor.diagnostics().gesture).toBe("scale");expect(f.counts.begins).toBe(1);
  await new Promise(resolve=>setTimeout(resolve,120));expect(f.editor.diagnostics().gesture).toBeNull();
  f.wheel(300,180);expect(f.counts.begins).toBe(2);
}));
