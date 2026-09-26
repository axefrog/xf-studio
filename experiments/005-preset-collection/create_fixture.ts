import { writeFileSync } from "node:fs";
import { initialRecipe } from "../../projects/xf-studio/authoring/src/features/eye-makeup/region";

const violet=initialRecipe(),copper=initialRecipe();
violet.layers[0]!.finish="regular";violet.layers[0]!.opacity=.68;violet.layers[1]!.enabled=true;
copper.layers[0]!.color="#b96632";copper.layers[0]!.finish="metallic";copper.layers[0]!.opacity=.74;
copper.layers[1]!.enabled=true;copper.layers[1]!.color="#342329";copper.layers[1]!.opacity=.93;
writeFileSync(new URL('collection.json',import.meta.url),JSON.stringify({schema:"xfas/collection-1",
  id:"11ea932b-7ce9-4d40-a284-47c307009137",name:"XFAS preset proof",
  presets:[{id:"193f4397-e313-4409-b842-a333307dece3",name:"Violet ink",revision:1,recipe:violet},
           {id:"6bf9f1e3-a9fa-4882-a87c-fbdc346464ea",name:"Copper edge",revision:1,recipe:copper}]},null,2)+'\n');
