import { expect, test } from "bun:test";
import { existsSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { acquireSetPublishLock } from "../src/set-publish-lock.ts";
import { tempDir } from "../../xf-studio/authoring/tests/temp-dir.ts";

test("a stale abandoned set lock is recovered and the owned lock releases",async()=>{
 const path=join(tempDir("holo-stale-set-"),".set-week.publish.lock"),past=new Date(Date.now()-60000);
 writeFileSync(path,"");utimesSync(path,past,past);
 const release=await acquireSetPublishLock(path,AbortSignal.timeout(1000));
 try{expect(JSON.parse(readFileSync(path,"utf8")).pid).toBe(process.pid);}finally{release();}
 expect(existsSync(path)).toBe(false);
});

test("an aged live publisher's lock is preserved when a waiting writer cancels",async()=>{
 const path=join(tempDir("holo-live-set-"),".set-week.publish.lock"),past=new Date(Date.now()-60000),owner=JSON.stringify({pid:process.pid,token:"live"});
 writeFileSync(path,owner);utimesSync(path,past,past);
 await expect(acquireSetPublishLock(path,AbortSignal.timeout(25))).rejects.toThrow();
 expect(readFileSync(path,"utf8")).toBe(owner);
});

test("a cancelled in-process waiter cannot let the next writer bypass the holder",async()=>{
 const path=join(tempDir("holo-queued-set-"),".set-week.publish.lock"),release=await acquireSetPublishLock(path,AbortSignal.timeout(1000));
 let nextRelease:(()=>void)|undefined;
 try{
   await expect(acquireSetPublishLock(path,AbortSignal.timeout(10))).rejects.toThrow();
   let entered=false;const next=acquireSetPublishLock(path,AbortSignal.timeout(1000)).then(done=>{entered=true;return done;});
   await Bun.sleep(10);expect(entered).toBe(false);release();nextRelease=await next;expect(entered).toBe(true);
 }finally{release();nextRelease?.();}
 expect(existsSync(path)).toBe(false);
});
