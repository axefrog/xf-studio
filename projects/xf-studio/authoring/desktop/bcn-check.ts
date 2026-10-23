// Loads one copy of XF Studio's texture compressor and compresses a BC4 block with it (src/native/write/bcn.ts `checkBcnLibrary`).
// verify-canary.ts runs it as its own process, because Windows keeps a loaded DLL's file in use until the process that loaded it ends.
//   bun bcn-check.ts <xfs_bcn.dll>
import { checkBcnLibrary, loadBcnLibrary } from "../src/native/write/bcn";

const path = process.argv[2];
if (!path) throw Error("Usage: bun bcn-check.ts <xfs_bcn.dll>");
const library = loadBcnLibrary(path);
try { checkBcnLibrary(library); } finally { library.close(); }
console.log("XFS_BCN_OK");
