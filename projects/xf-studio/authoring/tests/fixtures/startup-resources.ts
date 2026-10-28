/** Runs before the entry script. Counts browser registrations, never application release reports. */
export const STARTUP_RESOURCES = String.raw`(() => {
  const nativeAdd = EventTarget.prototype.addEventListener, nativeRemove = EventTarget.prototype.removeEventListener;
  const listeners = new Set(), timers = new Set(), frames = new Set(), workers = new Set(), contexts = new Set(), observers = new Map();
  const made = { listeners: 0, timers: 0, frames: 0, workers: 0, contexts: 0, observers: 0 };
  const writes = [], draws = [], deliveries = [], domWrites = [], held = [];
  let watching = false;
  const targetName = target => target === window ? 'window' : target === document ? 'document' : 'media';
  const tracked = target => target === window || target === document || (typeof MediaQueryList === 'function' && target instanceof MediaQueryList);
  const captureOf = options => typeof options === 'boolean' ? options : !!options?.capture;
  EventTarget.prototype.addEventListener = function(type, listener, options) {
    if (!tracked(this) || !listener || options?.signal?.aborted) return nativeAdd.call(this, type, listener, options);
    const capture = captureOf(options);
    if ([...listeners].some(row => row.target === this && row.type === type && row.listener === listener && row.capture === capture)) return;
    const row = { target: this, type, listener, capture, wrapped: null, detach: null };
    const forget = () => { listeners.delete(row); if (row.detach) row.detach(); };
    row.wrapped = function(event) {
      if (options?.once) forget();
      if (watching) deliveries.push(targetName(row.target) + ':' + type);
      if (typeof listener === 'function') listener.call(this, event); else listener.handleEvent(event);
    };
    nativeAdd.call(this, type, row.wrapped, options);
    listeners.add(row); made.listeners++;
    if (options?.signal) {
      nativeAdd.call(options.signal, 'abort', forget, { once: true });
      row.detach = () => nativeRemove.call(options.signal, 'abort', forget);
    }
  };
  EventTarget.prototype.removeEventListener = function(type, listener, options) {
    const row = [...listeners].find(row => row.target === this && row.type === type && row.listener === listener && row.capture === captureOf(options));
    if (!row) return nativeRemove.call(this, type, listener, options);
    listeners.delete(row); row.detach?.(); nativeRemove.call(this, type, row.wrapped, options);
  };
  const timeout = window.setTimeout.bind(window), interval = window.setInterval.bind(window), clear = window.clearTimeout.bind(window);
  window.setTimeout = (run, ms, ...args) => {
    const id = timeout(() => { timers.delete(id); if (watching) deliveries.push('timeout'); run(...args); }, ms);
    timers.add(id); made.timers++; return id;
  };
  window.setInterval = (run, ms, ...args) => {
    const id = interval(() => { if (watching) deliveries.push('interval'); run(...args); }, ms);
    timers.add(id); made.timers++; return id;
  };
  window.clearTimeout = window.clearInterval = id => { timers.delete(id); clear(id); };
  const raf = window.requestAnimationFrame.bind(window), caf = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = run => {
    const id = raf(time => { frames.delete(id); if (watching) deliveries.push('frame'); run(time); });
    frames.add(id); made.frames++; return id;
  };
  window.cancelAnimationFrame = id => { frames.delete(id); caf(id); };
  if (window.Worker) window.Worker = new Proxy(window.Worker, { construct(Type, args) {
    const worker = Reflect.construct(Type, args), terminate = worker.terminate.bind(worker);
    workers.add(worker); made.workers++;
    worker.terminate = () => { workers.delete(worker); terminate(); }; return worker;
  } });
  for (const name of ['ResizeObserver', 'MutationObserver', 'IntersectionObserver', 'PerformanceObserver']) {
    const Type = window[name]; if (!Type) continue;
    window[name] = new Proxy(Type, { construct(Type, args) {
      const callback = args[0]; let observer;
      observer = Reflect.construct(Type, [(...values) => { if (watching) deliveries.push(name); callback(...values); }]);
      const observe = observer.observe.bind(observer), disconnect = observer.disconnect.bind(observer), unobserve = observer.unobserve?.bind(observer);
      observer.observe = (target, ...options) => { observe(target, ...options); if (!observers.has(observer)) made.observers++; const targets = observers.get(observer) ?? new Set(); targets.add(target); observers.set(observer, targets); };
      observer.disconnect = () => { observers.delete(observer); disconnect(); };
      if (unobserve) observer.unobserve = target => { unobserve(target); const targets = observers.get(observer); targets?.delete(target); if (!targets?.size) observers.delete(observer); };
      return observer;
    } });
  }
  const get = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(kind, ...options) {
    const context = get.call(this, kind, ...options);
    if (context && /^webgl2?$|^experimental-webgl$/.test(kind) && !contexts.has(context)) {
      contexts.add(context); made.contexts++;
      nativeAdd.call(this, 'webglcontextlost', () => contexts.delete(context));
      nativeAdd.call(this, 'webglcontextrestored', () => contexts.add(context));
    }
    return context;
  };
  for (const [name, methods] of [['WebGLRenderingContext', ['drawArrays', 'drawElements']], ['WebGL2RenderingContext', ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']], ['CanvasRenderingContext2D', ['drawImage', 'putImageData', 'clearRect', 'fillRect', 'fill', 'stroke']]]) {
    const proto = window[name]?.prototype; if (!proto) continue;
    for (const method of methods) { const run = proto[method]; if (!run) continue; proto[method] = function(...args) { if (watching) draws.push(name + '.' + method); return run.apply(this, args); }; }
  }
  for (const method of ['setItem', 'removeItem', 'clear']) {
    const run = Storage.prototype[method]; Storage.prototype[method] = function(...args) { if (watching) writes.push(method + ':' + (args[0] ?? '')); return run.apply(this, args); };
  }
  for (const name of ['Node', 'Element', 'HTMLElement']) {
    const proto = window[name]?.prototype; if (!proto) continue;
    for (const method of ['appendChild', 'insertBefore', 'removeChild', 'replaceChild', 'append', 'prepend', 'remove', 'replaceChildren', 'setAttribute', 'removeAttribute']) {
      if (!Object.hasOwn(proto, method)) continue;
      const run = proto[method]; proto[method] = function(...args) { if (watching && this.isConnected) domWrites.push(method); return run.apply(this, args); };
    }
    for (const property of ['textContent', 'innerHTML', 'innerText']) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, property); if (!descriptor?.set) continue;
      Object.defineProperty(proto, property, { ...descriptor, set(value) { if (watching && this.isConnected) domWrites.push(property); descriptor.set.call(this, value); } });
    }
  }
  const counts = () => ({ listeners: listeners.size, timers: timers.size, frames: frames.size, workers: workers.size, contexts: contexts.size, observers: observers.size });
  const baseline = counts();
  window.xfsReleaseProbe = {
    baseline, counts, made, writes, draws, deliveries, domWrites, held,
    detail: () => [...listeners].map(row => targetName(row.target) + ':' + row.type),
    // Harness waits use native functions so the harness cannot conceal an application timer/frame.
    settle: () => new Promise(resolve => raf(() => raf(() => timeout(resolve, 0)))),
    wait: ms => new Promise(resolve => timeout(resolve, ms)),
    watch: () => { watching = true; writes.length = draws.length = deliveries.length = domWrites.length = 0; },
    // Intentionally ignores AbortSignal: late host/body answers must still be rejected by owners.
    defer: (url, init, value) => new Promise(resolve => held.push({ url, signal: init?.signal, release: () => resolve(Response.json(value)) })),
  };
})();`;

export type StartupResourceCounts = { listeners: number; timers: number; frames: number; workers: number; contexts: number; observers: number };
