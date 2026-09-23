import { expect, test } from "bun:test";
import { initialRecipe } from "../src/recipe";
import { planCollection, type PresetCollection } from "../src/preset-collection";
const source = (): PresetCollection => ({schema:"xfas/collection-1",id:"11ea932b-7ce9-4d40-a284-47c307009137",name:"Collection",
  presets:["193f4397-e313-4409-b842-a333307dece3","6bf9f1e3-a9fa-4882-a87c-fbdc346464ea"].map((id,i)=>({id,name:`Look ${i}`,revision:1,recipe:initialRecipe()}))});
test("collection identities and resource paths survive renaming, revisions and reordering",()=>{
  const input=source(),before=planCollection(input);
  input.name="Renamed collection";input.presets.reverse();input.presets[0]!.name="Renamed look";input.presets[0]!.revision=2;
  const after=planCollection(input);
  expect(after.app).toBe(before.app);expect(after.selector).toBe(before.selector);
  for(const p of before.presets) {
    const next=after.presets.find(x=>x.id===p.id)!;
    expect(next.appAppearance).toBe(p.appAppearance);expect(next.textures).toEqual(p.textures);
    expect(next.index).not.toBe(p.index);
  }
  const other=source();other.id="02ce932b-7ce9-4d40-a284-47c307009137";
  expect(planCollection(other).app).not.toBe(before.app);
});
test("collection parsing rejects duplicate or path-like IDs and isolates recipe input",()=>{
  const input=source(),plan=planCollection(input);
  plan.presets[0]!.recipe.layers[0]!.color="#ffffff";
  expect(input.presets[0]!.recipe.layers[0]!.color).not.toBe("#ffffff");
  input.presets[1]!.id=input.presets[0]!.id;expect(()=>planCollection(input)).toThrow();
  input.id="../outside";expect(()=>planCollection(input)).toThrow();
});
