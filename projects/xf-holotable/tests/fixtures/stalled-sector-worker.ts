// Synthetic stalled synchronous decode; never opens an archive or native library.
let state:Int32Array;
self.onmessage=event=>{
  if(event.data.state){state=new Int32Array(event.data.state);return;}
  if(event.data.close){self.postMessage({closed:true});self.close();return;}
  Atomics.store(state,0,1);Atomics.notify(state,0);
  Atomics.wait(state,0,1,30_000); // bounded even if the test's owner shutdown fails
  self.postMessage({data:new Uint8Array()});
};
