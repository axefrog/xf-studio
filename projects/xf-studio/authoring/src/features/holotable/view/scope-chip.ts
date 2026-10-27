/** Approved composition of library parts; replace with the UI track's dismissible chip when available. */
import { iconButton } from "../../../studio-ui/components";
import { h } from "../../../studio-ui/dom";
/** Six mixed-case letters plus an ellipsis and the compact clear button. */
export const SCOPE_MIN_WIDTH=68;
export function scopeChip(title:string,onClear:()=>void):HTMLElement {
  const hint=`Stepping through ${title} only. Clear to step through all visible layers`;
  const text=h("span",{class:"note muted",text:title,style:"min-width:0;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"});
  const clear=iconButton({label:`Stop stepping through ${title} only`,title:hint,icon:"close",small:true,onClick:onClear});clear.style.flex="0 0 auto";
  const glyph=clear.querySelector("svg")!;glyph.style.width="12px";glyph.style.height="12px";
  return h("span",{title:hint,"data-step-scope":"",style:`display:inline-flex;align-items:center;gap:var(--sp-1);min-width:${SCOPE_MIN_WIDTH}px;max-width:100%`},text,clear);
}
