/**
 * Reads a material template's (`.mt`) own parameter defaults. An instance chain sets only what it
 * overrides; everything else is the template's value (for example `hair.mt` leaves `Strand_ID` at
 * `base\materials\placeholder\grey.xbm` for the vanilla lashes). Pure over WolvenKit's JSON.
 */
import { asArray, cname, depotRef, depotText, HandleScope, isObject, type JsonObject, type MaterialParamValue } from "./red-json";

/** `CMaterialTemplate.parameters` → ordered `[name, value]` defaults, first declaration of a name winning. */
export function templateDefaults(root: JsonObject): [string, MaterialParamValue][] {
  const scope = new HandleScope(root);
  const stages = isObject(root.parameters) ? asArray(root.parameters.Elements) : asArray(root.parameters);
  const out: [string, MaterialParamValue][] = [];
  const seen = new Set<string>();
  for (const stage of stages) for (const item of asArray(stage)) {
    const data = scope.data(item);
    if (!data) continue;
    const name = cname(data.parameterName);
    if (!name || seen.has(name)) continue;
    let value: MaterialParamValue | null = null;
    switch (data.$type) {
      case "CMaterialParameterTexture": case "CMaterialParameterTextureArray": case "CMaterialParameterCube":
        value = { kind: "resource", type: "rRef:ITexture", ref: depotRef(data.texture), text: depotText(data.texture) }; break;
      case "CMaterialParameterHairParameters":
        value = { kind: "resource", type: "rRef:CHairProfile", ref: depotRef(data.hairProfile), text: depotText(data.hairProfile) }; break;
      case "CMaterialParameterSkinParameters":
        value = { kind: "resource", type: "rRef:CSkinProfile", ref: depotRef(data.skinProfile), text: depotText(data.skinProfile) }; break;
      case "CMaterialParameterGradient":
        value = { kind: "resource", type: "rRef:CGradient", ref: depotRef(data.gradient), text: depotText(data.gradient) }; break;
      case "CMaterialParameterScalar": value = { kind: "scalar", type: "Float", value: data.scalar ?? 0 }; break;
      case "CMaterialParameterColor": value = { kind: "scalar", type: "Color", value: data.color ?? null }; break;
      case "CMaterialParameterVector": value = { kind: "scalar", type: "Vector4", value: data.vector ?? null }; break;
    }
    if (!value) continue;
    seen.add(name);
    out.push([name, value]);
  }
  return out;
}
