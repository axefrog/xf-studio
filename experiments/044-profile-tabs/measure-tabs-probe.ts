/** G4 page instrumentation, installed before the application. No production hooks are added. */
export const TAB_PROBE = String.raw`(() => {
  const g = window.__g4 = { long: [], rasters: [], draws: [], creates: [], live: {}, active: false };
  const observer = new PerformanceObserver(list => g.long.push(...list.getEntries().map(e => [e.startTime, e.duration])));
  observer.observe({ type: 'longtask', buffered: true });
  const proto = WebGL2RenderingContext.prototype, alive = new WeakSet();
  for (const [kind, make, drop] of [['texture','createTexture','deleteTexture'], ['buffer','createBuffer','deleteBuffer'],
    ['framebuffer','createFramebuffer','deleteFramebuffer'], ['renderbuffer','createRenderbuffer','deleteRenderbuffer'],
    ['program','createProgram','deleteProgram'], ['vertexArray','createVertexArray','deleteVertexArray'],
    ['sampler','createSampler','deleteSampler'], ['shader','createShader','deleteShader']]) {
    g.live[kind] = 0;
    const made = proto[make], removed = proto[drop];
    proto[make] = function(...args) { const o = made.apply(this,args); if(o) { alive.add(o); g.live[kind]++; if(kind==='program') g.creates.push(performance.now()); } return o; };
    proto[drop] = function(o) { if(o && alive.has(o)) { alive.delete(o); g.live[kind]--; } return removed.call(this,o); };
  }
  // Track only draws to the presented drawing buffer, excluding hidden preparation's render targets.
  const targets = new WeakMap(), bind = proto.bindFramebuffer;
  proto.bindFramebuffer = function(target, fb) { if(target === this.FRAMEBUFFER || target === this.DRAW_FRAMEBUFFER) targets.set(this,fb); return bind.call(this,target,fb); };
  for(const method of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']) {
    const original = proto[method];
    proto[method] = function(...args) {
      const answer = original.apply(this,args);
      if(g.active && !targets.get(this)) {
        const h = window.xfStudioPresentation?.viewport.snapshot().head;
        g.draws.push({ at: performance.now(), view: h?.onCanvas ?? null });
      }
      return answer;
    };
  }
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function(message,...rest) {
    if(message?.layer && Number.isInteger(message.i) && Number.isInteger(message.version) && message.region)
      g.rasters.push({at:performance.now(),slot:message.i,version:message.version,size:message.size});
    return post.call(this,message,...rest);
  };
  const visible = e => !!e && !e.hidden && !e.closest('[hidden]') && !!e.getClientRects().length;
  let hashCanvas;
  const hash = () => {
    const source = document.querySelector('#device-head canvas');
    if(!source?.width) return null;
    hashCanvas ??= Object.assign(document.createElement('canvas'), {width:32,height:32});
    const ctx = hashCanvas.getContext('2d',{willReadFrequently:true}); ctx.drawImage(source,0,0,32,32);
    let value = 2166136261;
    for(const byte of ctx.getImageData(0,0,32,32).data) { value ^= byte; value = Math.imul(value,16777619); }
    return value >>> 0;
  };
  g.sample = (watchHash = false) => {
    const p = window.xfStudioPresentation, h = p.viewport.snapshot().head, e = window.xfStudioSceneEvidence?.();
    const resident = e?.residency.residents.find(r => r.state === 'shown');
    const lines = [...document.querySelectorAll('.viewport-detail-status[data-tone="preparing"],.viewport-detail-status[data-tone="progress"],.viewport-state[data-tone="progress"]')].filter(visible).map(e=>e.innerText.trim()).filter(Boolean);
    const canvas = document.querySelector('#device-head canvas');
    return { at:performance.now(), tab:p.tabs.snapshot().shown, drawn:h.drawn ?? null, onCanvas:h.onCanvas ?? null,
      phase:h.phase, frames:e?.frames.frames ?? null, detailComponents:e?.characterDetails.components.length ?? 0,
      key:resident?.key ?? null, scene:resident?.scene ?? null,
      preparation:e?.residency.preparation ?? h.preparation ?? null, residents:e?.residency.residents ?? [],
      progress:lines.join(' | '), canvasVisible:visible(canvas), hash:watchHash ? hash() : null };
  };
  g.act = action => {
    const answer = window.xfStudioShell.runtime.dispatch(action);
    if(answer?.ok === false) throw Error(JSON.stringify(answer));
    return answer;
  };
  g.click = tab => {
    const button = document.getElementById('layout-tab-'+tab);
    if(!button) throw Error('Missing tab control '+tab);
    button.click();
  };
  // Clicks and the clock are in the page, avoiding a CDP round trip inside the measured interval.
  g.run = async (steps, target, noGame, tail, timeout, watchHash = false) => {
    const before = g.sample(watchHash), ticks = [before], sent = [], errors = [];
    const starts = { long:g.long.length, rasters:g.rasters.length, draws:g.draws.length };
    const t0 = performance.now(); g.active = true;
    const timers = steps.map(([at,tab,close],i) => setTimeout(() => {
      sent.push({tab,at:performance.now()});
      try { if(close) g.act({kind:'tabs.close',tab}); else g.click(tab); } catch(e) { errors.push(String(e)); }
    },at));
    let shown = null, presented = null, settled = null;
    try {
      for(;;) {
        await new Promise(r=>requestAnimationFrame(r));
        const s = g.sample(watchHash); ticks.push(s);
        const all = sent.length === steps.length;
        const ready = all && s.tab === target.tab && (noGame || (s.onCanvas === target.view && s.phase === 'ready' && !s.preparation && s.frames !== null &&
          (target.unchanged || s.key !== before.key || s.frames > before.frames || g.draws.length > starts.draws)));
        if(shown === null && ready) shown = s.at;
        // One further rAF bounds presentation, like G3; this is a browser proxy, not a compositor trace.
        else if(shown !== null && presented === null) presented = s.at;
        if(presented !== null && !s.preparation) settled ??= s.at;
        if(settled !== null && s.at-settled >= tail) break;
        if(s.at-t0 >= timeout) break;
      }
    } finally { timers.forEach(clearTimeout); g.active = false; }
    // Long Tasks observer delivery can follow the rAF which ended the interval.
    await new Promise(r=>setTimeout(r,100));
    g.long.push(...observer.takeRecords().map(e=>[e.startTime,e.duration]));
    return {t0,before,ticks,sent,errors,shown,presented,target,
      links:window.xfsGl.programs.filter(p=>p.linkAt>=t0), creates:g.creates.filter(at=>at>=t0),
      long:g.long.filter(([at,ms])=>at+ms>=t0 && at<=ticks.at(-1).at),
      rasters:g.rasters.slice(starts.rasters), draws:g.draws.slice(starts.draws)};
  };
  g.memory = async () => {
    window.gc?.(); await new Promise(r=>setTimeout(r,100)); window.gc?.();
    return { live:{...g.live}, heapMB: performance.memory ? performance.memory.usedJSHeapSize/1048576 : null,
      residents:window.xfStudioSceneEvidence?.()?.residency.residents ?? [] };
  };
})();`;
