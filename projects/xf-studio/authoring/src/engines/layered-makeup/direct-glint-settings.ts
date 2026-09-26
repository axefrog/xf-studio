/** Separately versioned browser-only recipe model. Its fixed 960-cell grid
 * and radius populations are intentionally independent of recipe-7 counts. */
export type DirectGlintFlakes = {model:"uv-cell-direct-1" | "uv-cell-direct-2" | "uv-cell-direct-3"; density:number; fineShare:number;
  strength:number; seed:number; color:string};
export const defaultDirectGlintFlakes=():DirectGlintFlakes=>({model:"uv-cell-direct-1",
  density:.9,fineShare:.75,strength:10,seed:2077,color:"#eac8ae"});
/** An explicitly opt-in visual revision; saved direct-1 looks are unchanged. */
export const defaultClusteredGlintFlakes=():DirectGlintFlakes=>({model:"uv-cell-direct-2",
  density:.72,fineShare:.85,strength:9,seed:2077,color:"#eac8ae"});
/** Denser, smaller browser speckles. Kept separate from saved recipe-9 looks. */
export const defaultFineSpeckleFlakes=():DirectGlintFlakes=>({model:"uv-cell-direct-3",
  density:.88,fineShare:.88,strength:6,seed:2077,color:"#eac8ae"});
export function isDirectGlint(value:unknown):value is DirectGlintFlakes{
  if(!value || typeof value!=="object" || Array.isArray(value))return false;
  const f=value as DirectGlintFlakes;
  return Object.keys(f).sort().join()==="color,density,fineShare,model,seed,strength" &&
    (f.model==="uv-cell-direct-1" || f.model==="uv-cell-direct-2" || f.model==="uv-cell-direct-3") && Number.isFinite(f.density) && f.density>=0 && f.density<=1 &&
    Number.isFinite(f.fineShare) && f.fineShare>=0 && f.fineShare<=1 &&
    Number.isFinite(f.strength) && f.strength>=0 && f.strength<=32 &&
    Number.isInteger(f.seed) && f.seed>=0 && f.seed<=65535 &&
    typeof f.color==="string" && /^#[0-9a-f]{6}$/i.test(f.color);
}
