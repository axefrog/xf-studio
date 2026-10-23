/**
 * The single-output rule (experiment 043 §12, §13): every program writes one output, into a target with one colour attachment. What a
 * recording of a WebGL 2 context's calls shows against it: the fragment shaders it was given, its framebuffer attachments and its
 * draw-buffer lists. Shared by the recording renderer's gate (tests/single-output-programs.test.ts) and the GPU probe of a whole runtime's
 * life (tests/webgl-scene-runtimes-probe-page.ts), which records the same calls on a real context.
 */
export const COLOR_ATTACHMENT0 = 0x8ce0;
export type RecordedShader = { stage: "vertex" | "fragment"; source: string };
/** A framebuffer attachment made: `attachment` is the GL enum (COLOR_ATTACHMENT0 + n for a colour attachment). */
export type RecordedAttachment = { call: string; attachment: number };

/** GLSL without its comments, for the scans. */
export const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
/** An output declared past location 0, wherever the declaration's lines break (`layout(\n location = 1\n) out`). */
export const LATER_OUTPUT = /layout\s*\(\s*location\s*=\s*[1-9]\d*\s*\)/;
export const LATER_FRAG_DATA = /gl_FragData\s*\[\s*[1-9]/;
/** A fragment shader's output declarations at global scope (after a statement or a line start, never a function parameter). */
const OUTPUT_DECLARATION = /(?:^|[;}\n])\s*(?:layout\s*\(([^)]*)\)\s*)?out\s+(?:(?:highp|mediump|lowp)\s+)?\w+\s+\w+/g;

/** What a recording shows of programs that write several outputs, and of targets with several colour attachments. */
export function multipleOutputs(shaders: readonly RecordedShader[], attachments: readonly RecordedAttachment[], drawBuffers: readonly number[][]): string[] {
  const found: string[] = [];
  for (const shader of shaders) {
    if (shader.stage !== "fragment") continue;
    const text = stripComments(shader.source), name = /#define SHADER_NAME (\S+)/.exec(shader.source)?.[1] ?? text.slice(0, 40).trim();
    const outputs = [...text.matchAll(OUTPUT_DECLARATION)];
    if (outputs.length > 1) found.push(`${name}: ${outputs.length} outputs`);
    if (LATER_OUTPUT.test(text) || LATER_FRAG_DATA.test(text)) found.push(`${name}: an output past location 0`);
  }
  const colour = (attachment: number) => attachment >= COLOR_ATTACHMENT0 && attachment < COLOR_ATTACHMENT0 + 32;
  for (const { call, attachment } of attachments)
    if (colour(attachment) && attachment !== COLOR_ATTACHMENT0) found.push(`${call}: colour attachment ${attachment - COLOR_ATTACHMENT0}`);
  for (const list of drawBuffers) if (list.filter(buffer => buffer !== 0).length > 1) found.push(`drawBuffers: ${list.length} buffers`);
  return found;
}

