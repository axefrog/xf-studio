import * as THREE from "three";

/** No draws; a fence reports completion only after fifteen 60-Hz frames. Uploads cost 1 ms of page time, not real GPU time. */
export function slowUploadRenderer(options: { stuckAfterOpening?: boolean; uploadMs?: number } = {}) {
  let frames = 0, clock = 0, acknowledged = 0, peak = 0, busyUntil = 15;
  const sends: { frame: number; texels: number }[] = [];
  const fences: { frame: number; end: number; deleted: boolean }[] = [];
  const properties = new WeakMap<object, { __version?: number }>();
  const entry = (object: object) => properties.get(object) ?? properties.set(object, {}).get(object)!;
  const send = (texels: number) => {
    if (frames < busyUntil) throw Error("An upload was sent behind the preceding busy GPU work.");
    sends.push({ frame: frames, texels }); clock += options.uploadMs ?? 1;
    peak = Math.max(peak, sends.slice(acknowledged).reduce((sum, sent) => sum + sent.texels, 0));
  };
  const gl = { isContextLost: () => false, UNSIGNALED: 0, SIGNALED: 1, SYNC_STATUS: 2, SYNC_GPU_COMMANDS_COMPLETE: 3,
    fenceSync() { const fence = { frame: frames, end: sends.length, deleted: false }; fences.push(fence); return fence; },
    getSyncParameter(fence: typeof fences[number]) {
      if (frames - fence.frame < 15 || options.stuckAfterOpening && fence.end > 0) return 0;
      acknowledged = Math.max(acknowledged, fence.end);
      return 1;
    }, deleteSync(fence: typeof fences[number]) { fence.deleted = true; }, flush() {} };
  const renderer = { capabilities: { getMaxAnisotropy: () => 8, maxTextureSize: 16384 }, extensions: { has: () => true },
    getContext: () => gl, properties: { get: entry },
    render() { busyUntil = frames + 15; },
    initTexture(texture: THREE.Texture) {
      entry(texture).__version = texture.version;
      const image = texture.image as { width: number; height: number };
      if (texture.source.dataReady) send(image.width * image.height);
    },
    copyTextureToTexture(_source: THREE.Texture, _target: THREE.Texture, region: THREE.Box2) { send(region.getSize(new THREE.Vector2()).x * (region.max.y - region.min.y)); },
  } as unknown as THREE.WebGLRenderer;
  return { renderer, sends, fences, peak: () => peak, now: () => clock, frames: () => frames,
    async frame() { if (++frames > 200) throw Error("The slow-fence preparation did not finish."); clock += 16; },
  };
}

/** Large decoded maps without allocating pixel buffers. Each has eight real uploadStep bands. */
export function uploadMaps() {
  return Array.from({ length: 3 }, () => {
    const texture = new THREE.Texture({ width: 4096, height: 4096 });
    texture.needsUpdate = true;
    return texture;
  });
}
