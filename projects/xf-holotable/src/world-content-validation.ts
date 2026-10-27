import { NativeBudgetError, NativeMalformedError } from "../../xf-studio/authoring/src/native/native-errors";
import { ContentBudget, array, shape, string, optionalString, finiteTuple, integer, stringList, stringBytes } from "./world-content-budget.ts";
import { CONTENT_CAP, WORLD_CONTENT_READER, checkCounts, type WorldContent, type Coverage } from "./world-content.ts";

/** Validate cached JSON before any consumer sees it, and bound the serialized expansion of shared arrays. */
export function validateContent(value: unknown, key: string): asserts value is WorldContent {
  shape(value,"world content");shape(value.source,"content source");shape(value.slice,"content slice");
  if(value.schema!=="xfh/world-content-1"||value.source.key!==key||value.source.reader!==WORLD_CONTENT_READER)throw new NativeMalformedError("Invalid world-content identity.");
  for(const field of ["game","archives","reader","built","key"])string(value.source[field],`source ${field}`);
  string(value.slice.id,"slice id");string(value.slice.title,"slice title");
  const budget=new ContentBudget();stringList(value.slice.places,"slice places",budget);
  let total=0;
  for(const field of ["communities","spots","spawners","pois"]) {array(value[field],field);total+=value[field].length;}
  if(total>CONTENT_CAP)throw new NativeBudgetError("Slice exceeds 50,000 records; use a smaller slice.");
  shape(value.counts,"content counts");
  for(const field of ["read","kept","dropped","reasons"])shape(value.counts[field],`counts ${field}`);
  const counts=value.counts as unknown as Coverage,keys=Object.keys(counts.read);
  for(const field of ["kept","dropped","reasons"] as const)if(Object.keys(counts[field]).length!==keys.length)throw new NativeMalformedError("Content count keys disagree.");
  for(const channel of keys) {
    budget.charge({bytes:128+4*stringBytes(channel)});
    for(const field of ["read","kept","dropped"] as const)integer(counts[field][channel],0,Number.MAX_SAFE_INTEGER,"count");
    shape(counts.reasons[channel],"count reasons");
    for(const [reason,n] of Object.entries(counts.reasons[channel])) {integer(n,0,Number.MAX_SAFE_INTEGER,"reason count");budget.charge({bytes:32+stringBytes(reason)});}
  }
  checkCounts(counts);
  for(const collection of ["communities","spots","spawners","pois"] as const) {
    const rows=value[collection] as unknown[];
    if(counts.kept[collection]!==rows.length)throw new NativeMalformedError("World-content collection count disagrees.");
    const ids=new Set<string>();
    for(const row of rows) {
      shape(row,collection);string(row.id,"record id");string(row.place,"record place");
      if(ids.has(row.id))throw new NativeMalformedError("Duplicate content id.");
      budget.charge({records:1,bytes:256+stringBytes(row.id)+stringBytes(row.place)});ids.add(row.id);
      for(const field of ["name","record","title","journal"]) {optionalString(row[field],field);budget.charge({bytes:stringBytes(row[field] as string|undefined)});}
      if(collection==="communities") {
        array(row.entries,"community entries");
        for(const e of row.entries) {
          shape(e,"community entry");string(e.name,"entry name");optionalString(e.record,"entry record");array(e.phases,"entry phases");
          budget.charge({nested:1,bytes:64+stringBytes(e.name)+stringBytes(e.record as string|undefined)});
          for(const phase of e.phases) {
            shape(phase,"community phase");string(phase.name,"phase name");
            if(phase.time!==undefined)finiteTuple(phase.time,2,"phase time");
            budget.charge({nested:1,bytes:64+stringBytes(phase.name)});stringList(phase.spots,"phase spots",budget);
          }
        }
      } else {
        finiteTuple(row.at,3,"record position");
        if(collection==="pois") {string(row.kind,"pin kind");budget.charge({bytes:stringBytes(row.kind)});}
        else {
          if(typeof row.yaw!=="number"||!Number.isFinite(row.yaw))throw new NativeMalformedError("Invalid record yaw.");
          if(collection==="spawners") {
            string(row.record,"spawner record");if(row.onStart!==undefined&&typeof row.onStart!=="boolean")throw new NativeMalformedError("Invalid spawn flag.");
          } else {
            stringList(row.communities,"spot communities",budget);
            if(row.workspot!==undefined) {
              shape(row.workspot,"spot workspot");string(row.workspot.path,"workspot path");optionalString(row.workspot.activity,"workspot activity");
              budget.charge({nested:1,bytes:64+stringBytes(row.workspot.path)+stringBytes(row.workspot.activity as string|undefined)});
              stringList(row.workspot.tags,"workspot tags",budget);
            }
          }
        }
      }
    }
  }
}
