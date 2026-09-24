/** One task queue for a raster worker's lifetime. MessageChannel yields to worker
 * events without nested timers' minimum delay; Promise-only yields would starve
 * incoming cancellation messages. Some engines drain one port ahead of another,
 * so every fourth pulse visits the timer queue as a bounded fairness break.
 * Intervening message tasks prevent nesting that timer. Ports are reclaimed
 * when the worker ends. */
export function createRasterTaskYield(channel: MessageChannel | null =
  typeof MessageChannel === "undefined" ? null : new MessageChannel()): () => Promise<void> {
  if (!channel) return () => new Promise(resolve => setTimeout(resolve, 0));
  const pending: (() => void)[] = [];
  let scheduled=false,pulses=0;
  const schedule=()=>{
    if(scheduled||!pending.length)return;
    scheduled=true;
    if(++pulses===4){pulses=0;setTimeout(pulse,0);}
    else channel.port2.postMessage(null);
  };
  const pulse=()=>{
    scheduled=false;pending.shift()?.();schedule();
  };
  channel.port1.onmessage=pulse;
  return () => new Promise(resolve => {
    pending.push(resolve);schedule();
  });
}
