// A stand-in session runner for batch15's lock tests (RB-124): tries the session lock once, prints "won" or
// "lost <holder pid>", and holds a won lock for the given milliseconds (or until it is killed) before releasing it.
//   bun tools/test/fixtures/lock-holder.ts <runtime dir> <hold ms>

import { acquireSessionLock } from "../../session-lock.ts";

const [dir, holdText] = process.argv.slice(2);
if (!dir) {
  console.error("usage: lock-holder.ts <runtime dir> <hold ms>");
  process.exit(2);
}
const lock = acquireSessionLock(dir, "lock-holder");
if ("heldBy" in lock) {
  console.log(`lost ${lock.heldBy.pid}`);
  process.exit(0);
}
console.log("won");
setTimeout(() => {
  lock.release();
  process.exit(0);
}, Number(holdText ?? 1000));
