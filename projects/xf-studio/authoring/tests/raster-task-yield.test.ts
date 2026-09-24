import {expect,test} from "bun:test";
import {createRasterTaskYield} from "../src/raster-task-yield";
import {createRasterProcessor,type RasterResponse} from "../src/raster-processor";
import {initialRecipe,raster} from "../src/recipe";

test("raster MessageChannel pause crosses a task boundary and preserves FIFO pulses",async()=>{
  const channel=new MessageChannel(),pause=createRasterTaskYield(channel),events:number[]=[];
  try{
    const first=pause().then(()=>events.push(1)),second=pause().then(()=>events.push(2));
    expect(events).toEqual([]);
    await Promise.resolve();await Promise.resolve();
    expect(events).toEqual([]);
    await Promise.all([first,second]);expect(events).toEqual([1,2]);
    for(let i=3;i<=12;i++){
      const next=pause().then(()=>events.push(i));
      await Promise.resolve();expect(events.length).toBe(i-1);
      await next;expect(events.at(-1)).toBe(i);
    }
  }finally{channel.port1.close();channel.port2.close();}
});

test("raster task pauses admit incoming cancellation and a complete replacement",async()=>{
  const channel=new MessageChannel(),incoming=new MessageChannel(),responses:RasterResponse[]=[];
  let clock=0;
  const processor=createRasterProcessor(value=>responses.push(value),createRasterTaskYield(channel),()=>++clock*10);
  incoming.port1.onmessage=event=>processor.cancel(event.data);
  try{
    const layer=initialRecipe().layers[0]!,pending=processor.start({i:0,version:1,layer,size:512});
    expect(responses).toEqual([]);
    incoming.port2.postMessage(1);
    await pending;
    expect(responses.map(r=>({i:r.i,version:r.version,cancelled:r.cancelled}))).toEqual([{i:0,version:1,cancelled:true}]);
    await processor.start({i:0,version:2,layer,size:32});
    const replacement=responses[1]!;expect(replacement.cancelled).not.toBe(true);
    if(!replacement.cancelled)expect(replacement.data).toEqual(raster(layer,32));
  }finally{channel.port1.close();channel.port2.close();incoming.port1.close();incoming.port2.close();}
});

test("unavailable MessageChannel uses an asynchronous timer fallback",async()=>{
  const pause=createRasterTaskYield(null);let finished=false;
  const pending=pause().then(()=>{finished=true;});
  expect(finished).toBe(false);await Promise.resolve();expect(finished).toBe(false);
  await pending;expect(finished).toBe(true);
});
