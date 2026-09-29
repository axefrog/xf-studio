/** Page instrumentation for click → pixels measurements (measure-finish-change.ts, measure-hairstyle-switch.ts). */
/**
 * WebGL instrumentation run before the page's own scripts: each program's link (its shader name and XF defines) and how long the main
 * thread first waited on it (Three's first use asks for its info log or status, which waits for the driver's compile), and each
 * texture upload's time and size. Read as `window.xfsGl`.
 */
export const GL_PROBE = `(() => {
  const gl = window.xfsGl = { programs: [], uploads: [] }, meta = new WeakMap();
  const proto = WebGL2RenderingContext.prototype;
  const link = proto.linkProgram;
  proto.linkProgram = function(program) {
    const t = performance.now();
    let name = "?", defines = [];
    try { for (const shader of this.getAttachedShaders(program) ?? []) { const source = this.getShaderSource(shader) ?? "";
      name = /#define SHADER_NAME (.+)/.exec(source)?.[1] ?? /#define SHADER_TYPE (.+)/.exec(source)?.[1] ?? name;
      if (/#define DOUBLE_SIDED/.test(source) && !defines.includes("DOUBLE_SIDED")) defines.push("DOUBLE_SIDED");
      if (/#define FLIP_SIDED/.test(source) && !defines.includes("FLIP_SIDED")) defines.push("FLIP_SIDED");
      for (const m of source.matchAll(/#define (XFS_[A-Z_0-9]+)/g)) if (!defines.includes(m[1])) defines.push(m[1]); } } catch {}
    const entry = { name, defines, linkAt: t, waited: null };
    meta.set(program, entry); gl.programs.push(entry);
    return link.call(this, program);
  };
  for (const method of ["getProgramInfoLog", "getProgramParameter"]) {
    const original = proto[method];
    proto[method] = function(program, ...rest) {
      const entry = meta.get(program), t = performance.now();
      const result = original.call(this, program, ...rest);
      if (entry && entry.waited === null && !(method === "getProgramParameter" && rest[0] === 0x91B1)) { entry.waited = performance.now() - t; entry.usedAt = t; }
      return result;
    };
  }
  for (const method of ["texImage2D", "texSubImage2D", "texImage3D", "texSubImage3D", "compressedTexImage2D", "compressedTexSubImage2D", "texStorage2D"]) {
    const original = proto[method];
    proto[method] = function(...args) {
      const t = performance.now(); const result = original.apply(this, args); const d = performance.now() - t;
      if (d > 1) {
        const source = args.find(a => a && typeof a === "object" && "width" in a && !ArrayBuffer.isView(a));
        const at = method === "texSubImage2D" ? 4 : 3;
        gl.uploads.push({ method, at: t, ms: d, w: source ? source.width : args[at], h: source ? source.height : args[at + 1],
          kind: source ? source.constructor.name : "data" });
      }
      return result;
    };
  }
})();`;
/** An expression summarising the probe's programs and uploads since `since` (an expression in the page's clock). */
export const glSummary = (since: string) => `(() => { const g = window.xfsGl; if (!g) return null;
  return { programs: g.programs.filter(p => p.linkAt >= ${since} - 1).map(p => [p.name + (p.defines.length ? "[" + p.defines.join(",") + "]" : ""), Math.round(p.linkAt - ${since}), p.waited === null ? null : Math.round(p.waited)]),
    uploads: g.uploads.filter(u => u.at >= ${since} - 1).map(u => [u.method, Math.round(u.at - ${since}), Math.round(u.ms), u.w + "x" + u.h + " " + u.kind]) }; })()`;

