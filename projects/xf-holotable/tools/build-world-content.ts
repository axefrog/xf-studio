// Opt-in installed-game reader. Prints coverage and elapsed time only; all payload stays private.
import { resolve } from "node:path";
import { LocalSettingsStore } from "../../xf-studio/authoring/src/setup/host/local-settings-store";
import { loadWorldPack } from "../src/world.ts";
import { buildWorldContent } from "../src/world-content-source.ts";

const args=process.argv.slice(2),options=new Map<string,string>();
for(let i=0;i<args.length;i+=2) {
  if(!["--slice","--pack","--out","--game"].includes(args[i])||!args[i+1])throw Error("Usage: bun tools/build-world-content.ts --slice kabuki [--pack file] [--out directory] [--game directory]");
  options.set(args[i],args[i+1]);
}
const slice=options.get("--slice");if(!slice)throw Error("--slice is required.");
const local=resolve(import.meta.dir,"../../../local/holotable"),pack=loadWorldPack(options.get("--pack")??resolve(local,"world-pack.json"));
if(!pack)throw Error("Build the world pack first, or provide --pack.");
const root=options.get("--game")??process.env.XFS_TEST_GAME_ROOT??new LocalSettingsStore().load().settings.gameRoot;
if(!root)throw Error("Configure the installed game or provide --game.");
const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(Error("World-content build exceeded five minutes.")),300_000);
const stop=()=>ctl.abort(Error("World-content build cancelled."));process.once("SIGINT",stop);
try {
  const start=performance.now(),{content,cached}=await buildWorldContent({root,pack,slice,directory:options.get("--out")??resolve(local,"world"),signal:ctl.signal});
  console.log(JSON.stringify({cached,ms:Math.round(performance.now()-start),counts:content.counts},null,2));
}finally{clearTimeout(timer);process.removeListener("SIGINT",stop);}
