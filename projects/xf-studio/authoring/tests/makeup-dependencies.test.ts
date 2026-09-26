import {expect,test} from "bun:test";
import {initialRecipe,raster,type Layer} from "../src/engines/layered-makeup/recipe";
import {defaultFlakes} from "../src/engines/layered-makeup/finish";
import {createFlakeCatalogue,defaultIrregularFlakes,FLAKE_MATERIAL,FLAKE_SUBSAMPLES,FLAKE_SUBSAMPLES_16,type FlakeNormalStudyMode,type IrregularFlakes} from "../src/engines/layered-makeup/flake-field";
import {maskAlphaKey,irregularCatalogueKey,irregularOpticalKey,irregularAlbedoKey,legacyOpticalKey,
  IRREGULAR_SAMPLING_VERSION,type CatalogueKey} from "../src/engines/layered-makeup/makeup-dependencies";

function reordered<T>(value:T):T {
  if(Array.isArray(value))return value.map(reordered) as T;
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).reverse().map(([k,v])=>[k,reordered(v)])) as T;
  return value;
}

test("alpha dependency excludes document identity, colour, finish and flake settings",()=>{
  const layer=initialRecipe().layers[0],before=structuredClone(layer),key=maskAlphaKey(layer,64),changed=structuredClone(layer);
  changed.id="new-id";changed.name="Renamed";changed.color="#00aa44";changed.finish="glitter";
  changed.flakes={cells:256,density:.8,tilt:.3,seed:43};changed.fields[0].id="another-field-id";
  expect(maskAlphaKey(changed,64)).toBe(key);expect(raster(changed,64)).toEqual(raster(layer,64));
  expect(maskAlphaKey(reordered(layer),64)).toBe(key);
  expect(layer).toEqual(before);
  expect(key).not.toContain(layer.name);expect(key).not.toContain(layer.id);
});

test("every mask calculation input invalidates alpha, retaining ordered paths and warps",()=>{
  const layer=initialRecipe().layers[0];
  layer.softness={mode:"boundary",blend:.00001};layer.points.forEach((p,i)=>p.feather=.001+i*.003);
  layer.fields.push({...layer.fields[0],id:"second",du:.01});
  const key=maskAlphaKey(layer,1024),change=(fn:(l:Layer)=>void)=>{const next=structuredClone(layer);fn(next);expect(maskAlphaKey(next,1024)).not.toBe(key);};
  for(const fn of [
    (l:Layer)=>{l.enabled=false;},(l:Layer)=>{l.opacity-=.1;},(l:Layer)=>{l.symmetry=false;},(l:Layer)=>{l.feather+=.001;},
    (l:Layer)=>{l.pathMode="catmull-rom";l.points=l.points.map(({handles,...p})=>p);},
    (l:Layer)=>{l.points[0].u+=.001;},(l:Layer)=>{l.points[0].v+=.001;},(l:Layer)=>{l.points[0].weight=.2;},
    (l:Layer)=>{l.points[0].feather=.002;},(l:Layer)=>{l.points.reverse();},
    (l:Layer)=>{l.points[0].handles!.mode="corner";},(l:Layer)=>{l.points[0].handles!.in.u+=.001;},
    (l:Layer)=>{l.points[0].handles!.in.v+=.001;},(l:Layer)=>{l.points[0].handles!.out.u+=.001;},
    (l:Layer)=>{l.points[0].handles!.out.v+=.001;},
    (l:Layer)=>{l.strength={mode:"legacy-nearest"};},(l:Layer)=>{l.strength={mode:"smooth-boundary",blend:.001};},
    (l:Layer)=>{l.softness={mode:"uniform"};},(l:Layer)=>{l.softness={mode:"boundary",blend:.0001};},
    (l:Layer)=>{l.fields[0].u+=.01;},(l:Layer)=>{l.fields[0].v+=.01;},(l:Layer)=>{l.fields[0].du+=.01;},
    (l:Layer)=>{l.fields[0].dv+=.01;},(l:Layer)=>{l.fields[0].radius+=.01;},(l:Layer)=>{l.fields.reverse();},
  ])change(fn);
  expect(maskAlphaKey(layer,2048)).not.toBe(key);
  expect(maskAlphaKey(layer,1024,"future-coverage-2")).not.toBe(key);
  const uniform=structuredClone(layer);uniform.softness={mode:"uniform"};
  const remembered=maskAlphaKey(uniform,1024);delete uniform.points[0].feather;
  expect(maskAlphaKey(uniform,1024)).not.toBe(remembered); // conservative dormant-input retention
});

test("irregular catalogue depends only on physical field settings, with exact canonical strings",()=>{
  const settings={...defaultIrregularFlakes(),count:16},before=structuredClone(settings),key=irregularCatalogueKey(settings);
  const colourChanged={...settings,color:"#aa22bb"};
  expect(irregularCatalogueKey(colourChanged)).toBe(key);
  expect(createFlakeCatalogue(colourChanged).flakes).toEqual(createFlakeCatalogue(settings).flakes);
  expect(irregularCatalogueKey(reordered(settings))).toBe(key);
  expect(JSON.parse(key)).toEqual(["xfs/makeup-dependencies-1","catalogue","irregular-planar-1",16,.0012,.7,.35,2077]);
  for(const [field,value] of [["count",17],["radius",.0013],["spread",.5],["tilt",.4],["seed",2078]] as const)
    expect(irregularCatalogueKey({...settings,[field]:value})).not.toBe(key);
  expect(settings).toEqual(before);
});

test("dependency hierarchy separates shape, field, quality and independent colours",()=>{
  const layer=initialRecipe().layers[0],flakes=defaultIrregularFlakes(),catalogue=irregularCatalogueKey(flakes),
    optics=irregularOpticalKey(catalogue,1024),alpha=maskAlphaKey(layer,1024),albedo=irregularAlbedoKey(optics,alpha,layer.color,flakes.color);
  const moved=structuredClone(layer);moved.points[0].u+=.002;
  const movedAlpha=maskAlphaKey(moved,1024);
  expect(movedAlpha).not.toBe(alpha);
  expect(irregularOpticalKey(catalogue,1024)).toBe(optics);
  expect(irregularAlbedoKey(optics,movedAlpha,layer.color,flakes.color)).not.toBe(albedo);
  const changedColour={...flakes,color:"#abcdef"};
  expect(irregularCatalogueKey(changedColour)).toBe(catalogue);
  expect(irregularOpticalKey(irregularCatalogueKey(changedColour),1024)).toBe(optics);
  expect(irregularAlbedoKey(optics,alpha,layer.color,changedColour.color)).not.toBe(albedo);
  expect(irregularAlbedoKey(optics,alpha,"#102030",flakes.color)).not.toBe(albedo);
  expect(irregularAlbedoKey(optics,alpha,layer.color.toUpperCase(),flakes.color.toUpperCase())).toBe(albedo);
  expect(irregularAlbedoKey(optics,alpha,layer.color,flakes.color,"new-composition-2")).not.toBe(albedo);
  expect(irregularOpticalKey(catalogue,2048)).not.toBe(optics);
  expect(irregularOpticalKey(catalogue,1024,4)).not.toBe(optics);
  expect(irregularOpticalKey(catalogue,1024,2,"new-sampling-2")).not.toBe(optics);
  const newOptics=irregularOpticalKey(irregularCatalogueKey({...flakes,seed:123}),1024);
  expect(newOptics).not.toBe(optics);expect(irregularAlbedoKey(newOptics,alpha,layer.color,flakes.color)).not.toBe(albedo);
});

test("legacy absence preserves defaults and legacy/irregular optical identities cannot alias",()=>{
  const legacy=legacyOpticalKey(1024,"glitter");
  expect(legacyOpticalKey(1024,"glitter",defaultFlakes())).toBe(legacy);
  expect(legacyOpticalKey(1024,"glitter",reordered(defaultFlakes()))).toBe(legacy);
  expect(legacyOpticalKey(1024,"shimmer")).not.toBe(legacy);
  expect(legacyOpticalKey(2048,"glitter")).not.toBe(legacy);
  for(const [field,value] of [["cells",64],["density",.4],["tilt",.2],["seed",8]] as const)
    expect(legacyOpticalKey(1024,"glitter",{...defaultFlakes(),[field]:value})).not.toBe(legacy);
  expect(irregularOpticalKey(irregularCatalogueKey(defaultIrregularFlakes()),1024)).not.toBe(legacy);
});

test("normal study modes cannot collide while surface-average preserves exact existing optical keys",()=>{
  const flakes=defaultIrregularFlakes(),catalogue=irregularCatalogueKey(flakes),layer=initialRecipe().layers[0],alpha=maskAlphaKey(layer,1024);
  for(const axis of [2,4] as const){
    const oldKey=JSON.stringify(["xfs/makeup-dependencies-1","optical","irregular",catalogue,1024,IRREGULAR_SAMPLING_VERSION,axis,
      axis===2?FLAKE_SUBSAMPLES:FLAKE_SUBSAMPLES_16,
      [FLAKE_MATERIAL.baseRoughness,FLAKE_MATERIAL.flakeRoughness,FLAKE_MATERIAL.baseMetalness,FLAKE_MATERIAL.flakeMetalness]]);
    const implicit=irregularOpticalKey(catalogue,1024,axis),explicit=irregularOpticalKey(catalogue,1024,axis,undefined,"surface-average"),
      covered=irregularOpticalKey(catalogue,1024,axis,undefined,"covered-average");
    expect(String(implicit)).toBe(oldKey);expect(String(explicit)).toBe(oldKey);expect(covered).not.toBe(implicit);
    expect(JSON.parse(covered).at(-1)).toEqual(["normal-mode","covered-average"]);
    expect(irregularAlbedoKey(covered,alpha,layer.color,flakes.color)).not.toBe(irregularAlbedoKey(implicit,alpha,layer.color,flakes.color));
    expect(irregularOpticalKey(catalogue,1024,axis,"future-sampling-2","covered-average")).not.toBe(covered);
  }
  expect(irregularOpticalKey(catalogue,1024,2,undefined,"covered-average")).not.toBe(irregularOpticalKey(catalogue,1024,4,undefined,"covered-average"));
  for(const mode of ["unknown","",null,0,{}])
    expect(()=>irregularOpticalKey(catalogue,1024,2,undefined,mode as FlakeNormalStudyMode)).toThrow("Invalid flake normal study mode");
});

test("keys reject JSON non-finite collisions, invalid sizes and invalid optical settings",()=>{
  const layer=initialRecipe().layers[0],settings=defaultIrregularFlakes(),catalogue=irregularCatalogueKey(settings);
  for(const number of [NaN,Infinity,-Infinity]){
    const broken=structuredClone(layer);broken.points[0].u=number;expect(()=>maskAlphaKey(broken,1024)).toThrow();
    expect(()=>irregularCatalogueKey({...settings,tilt:number})).toThrow();
    expect(()=>legacyOpticalKey(1024,"glitter",{...defaultFlakes(),density:number})).toThrow();
  }
  for(const size of [0,-1,1024.5,4097,NaN,Infinity])expect(()=>maskAlphaKey(layer,size)).toThrow();
  expect(()=>maskAlphaKey(layer,1)).not.toThrow();
  expect(()=>irregularOpticalKey(catalogue,1)).toThrow();expect(()=>legacyOpticalKey(1,"glitter")).toThrow();
  expect(()=>irregularOpticalKey(catalogue,1024,3 as 2)).toThrow();
  expect(()=>irregularOpticalKey(catalogue,1024,2,"")).toThrow();
  expect(()=>irregularCatalogueKey({...settings,model:"unknown"} as unknown as IrregularFlakes)).toThrow();
  expect(()=>irregularCatalogueKey({...settings,count:32769})).toThrow();
  expect(()=>irregularCatalogueKey({...settings,radius:0})).toThrow();
  expect(()=>legacyOpticalKey(1024,"glitter",{...defaultFlakes(),cells:0})).toThrow();
  expect(()=>irregularOpticalKey(undefined as unknown as CatalogueKey,1024)).toThrow();
  const optics=irregularOpticalKey(catalogue,1024),alpha=maskAlphaKey(layer,1024);
  for(const colour of ["red","#fff","#fffffff","#gggggg"])
    expect(()=>irregularAlbedoKey(optics,alpha,colour,settings.color)).toThrow();
});
