/** Browser-side helpers for the real-GPU probe pages (tests/webgl-*-page.ts). */
import type * as THREE from "three";

/** The two extensions that make half-float colour buffers renderable in WebGL 2. */
const HALF_FLOAT_RENDERING = ["EXT_color_buffer_float", "EXT_color_buffer_half_float"];

/**
 * Behave like a GPU that cannot render half float (PREV-59): contexts created afterwards neither offer nor enable either
 * extension, so a half-float framebuffer is incomplete, as it is on such a GPU. Call before any context exists.
 */
export function hideHalfFloatRendering() {
  const prototype = WebGL2RenderingContext.prototype;
  const getExtension = prototype.getExtension, supported = prototype.getSupportedExtensions;
  const get = getExtension as (this: WebGL2RenderingContext, name: string) => unknown;
  prototype.getExtension = function (this: WebGL2RenderingContext, name: string) {
    return HALF_FLOAT_RENDERING.includes(name) ? null : get.call(this, name);
  } as typeof prototype.getExtension;
  prototype.getSupportedExtensions = function (this: WebGL2RenderingContext) {
    return (supported.call(this) ?? []).filter(name => !HALF_FLOAT_RENDERING.includes(name));
  };
}

/** Read one mip level of a texture the renderer owns, as floats (half-float textures) or bytes (8-bit ones), rows bottom-up. */
export function readTextureLevel(renderer: THREE.WebGLRenderer, texture: THREE.Texture, size: { width: number; height: number },
  level: number, float: boolean): { width: number; height: number; data: Float32Array | Uint8Array } {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const handle = (renderer.properties.get(texture) as { __webglTexture?: WebGLTexture }).__webglTexture;
  if (!handle) throw Error(`${texture.name} has no GPU texture`);
  const width = Math.max(1, size.width >> level), height = Math.max(1, size.height >> level);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, handle, level);
  const data = float ? new Float32Array(width * height * 4) : new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, float ? gl.FLOAT : gl.UNSIGNED_BYTE, data);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(framebuffer);
  renderer.resetState();
  return { width, height, data };
}
