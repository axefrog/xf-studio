import type {Run} from './driver.ts';
export function supply3(r:Run){
 return r.w.l2.all().filter(i=>i.st.source.by==='director').map(i=>{
  const st=i.st,perceived=st.receipts.some(rc=>rc.grade!=='ambient'),released=st.released||perceived,cast=st.entered.cast!==undefined||st.committed||released;
  return {id:i.id,decision:st.source.decision,template:st.template.id,closing:(st.document.growsFrom as {juncture?:string}|undefined)?.juncture==='@closing',cast,released,perceived,state:st.state,unfilled:Object.entries(st.roles).flatMap(([role,v])=>v.unfilled?[{role,reason:v.unfilled}]:[])};
 });
}
