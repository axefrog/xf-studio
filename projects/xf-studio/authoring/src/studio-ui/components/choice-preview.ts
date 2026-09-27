import { h, setAttr } from "../dom";
import { icon, type IconName } from "../icons";
import { previewColourMatrix, type PreviewTokens } from "../../choice-preview";

/**
 * Choice preview tile (style guide "Choice preview"; choice-previews-design.md §3): a picture of a choice drawn in the UI's own palette,
 * inside a choice item (components/choice-list.ts `choiceItem`), for rows whose choices differ in shape. Not for colour-only rows (use a
 * swatch) and never a substitute for the 3D view.
 *
 * - **Anatomy.** A frame on the flat preview ground (`--pv-ground`), the picture, and the label under it (hidden visually at size S, where
 *   it stays the accessible name and tooltip). The tile has its final size from the first paint.
 * - **States.** `waiting`: the frame with a faint glyph for the kind (never a spinner: the corner mark already says the choice is being
 *   prepared); `ready`: the picture fades in (at once under reduced motion); `none`: no picture is possible, the glyph stays and the tile
 *   shows no error. Selected, focused and hovered come from the choice item.
 * - **Theming.** Pictures are theme-free channel images; one SVG colour matrix (`installPreviewFilter`) colours every tile from the
 *   tokens `--pv-subject`, `--pv-ink` and `--pv-shade`, rebuilt when the theme changes. Forced colours drop it (the raw channels still
 *   read as shapes).
 */
export type PreviewTileState = "waiting" | "ready" | "none";
export type PreviewTile = { readonly element: HTMLElement; set(url: string | null, none?: boolean): void };

/** A preview tile for a choice item's content: the frame with its glyph, and the label. */
export function previewTile(options: { label: string; glyph: IconName }): PreviewTile {
  installPreviewFilter();
  const image = h("img", { class: "pv-image", alt: "", draggable: "false", decoding: "async", hidden: true });
  const element = h("span", { class: "choice-content pv-tile", "data-state": "waiting" },
    h("span", { class: "pv-frame", "aria-hidden": "true" }, h("span", { class: "pv-glyph" }, icon(options.glyph)), image),
    h("span", { class: "choice-label pv-label", text: options.label }));
  let shown: string | null = null;
  image.addEventListener("load", () => { if (image.getAttribute("src") === shown) { image.hidden = false; setAttr(element, "data-state", "ready"); } });
  image.addEventListener("error", () => { image.hidden = true; setAttr(element, "data-state", "none"); });
  return {
    element,
    set(url, none = false) {
      if (url === shown && (url || element.dataset.state === (none ? "none" : "waiting"))) return;
      shown = url;
      if (url) { image.src = url; return; }
      image.hidden = true;
      image.removeAttribute("src");
      setAttr(element, "data-state", none ? "none" : "waiting");
    },
  };
}

/** The SVG filters the tiles' pictures use (studio.css `.pv-image`): one per theme, so a pane with its own colour scheme is right too. */
export const PREVIEW_FILTER_IDS = { light: "xfs-pv-light", dark: "xfs-pv-dark" } as const;
let installed: { matrices: Record<"light" | "dark", SVGFEColorMatrixElement>; key: string } | null = null;

/** Read a CSS colour as sRGB 0–1 (any syntax the browser knows, `oklch()` included), through a 1 × 1 canvas. */
function srgb(colour: string, context: CanvasRenderingContext2D): [number, number, number] {
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = "#000";
  context.fillStyle = colour;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return [r! / 255, g! / 255, b! / 255];
}
/**
 * The preview tokens of a colour scheme. The colours are `light-dark()` values, which only an element resolves (by its colour scheme),
 * so each is read as a probe element's used colour; the shade is the scheme's own token.
 */
export function previewTokens(scheme: "light" | "dark"): PreviewTokens {
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  const probe = h("span", { "aria-hidden": "true", style: `position:absolute;width:0;height:0;overflow:hidden;color-scheme:${scheme}` });
  document.body.append(probe);
  try {
    const colour = (name: string, fallback: string) => { probe.style.color = `var(${name}, ${fallback})`; return srgb(getComputedStyle(probe).color, context); };
    const shade = Number.parseFloat(getComputedStyle(probe).getPropertyValue(`--pv-shade-${scheme}`));
    return { subject: colour("--pv-subject", "#c8c9cc"), ink: colour("--pv-ink", "#35383e"), shade: Number.isFinite(shade) ? shade : scheme === "dark" ? .62 : .72 };
  } finally { probe.remove(); }
}
/** Install the page's preview filters (idempotent), and rebuild them if the tokens change (the root's theme or style attributes). */
export function installPreviewFilter(): void {
  if (installed || typeof document === "undefined" || typeof getComputedStyle !== "function" || !document.body) return;
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
  svg.setAttribute("aria-hidden", "true"); svg.setAttribute("width", "0"); svg.setAttribute("height", "0");
  svg.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden");
  const matrix = (scheme: "light" | "dark") => {
    const filter = document.createElementNS(ns, "filter"), element = document.createElementNS(ns, "feColorMatrix");
    filter.id = PREVIEW_FILTER_IDS[scheme];
    filter.setAttribute("color-interpolation-filters", "sRGB");
    element.setAttribute("type", "matrix");
    filter.append(element); svg.append(filter);
    return element;
  };
  installed = { matrices: { light: matrix("light"), dark: matrix("dark") }, key: "" };
  document.body.append(svg);
  const refresh = () => {
    try {
      const values = (["light", "dark"] as const).map(scheme => previewColourMatrix(previewTokens(scheme)).map(value => Number(value.toFixed(5))).join(" "));
      if (values.join("|") === installed!.key) return;
      installed!.key = values.join("|");
      installed!.matrices.light.setAttribute("values", values[0]!);
      installed!.matrices.dark.setAttribute("values", values[1]!);
    } catch { /* Without tokens the pictures show their raw channels, still recognisable as shapes. */ }
  };
  refresh();
  new MutationObserver(refresh).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
}
