/** Bounded directory metadata enumeration. Win32 returns size/write time with each name, avoiding per-file stats. */
import { opendirSync, statSync } from "node:fs";
import { join } from "node:path";
export interface DirectoryMetadata { name:string; directory:boolean; file:boolean; size:number; mtimeMs:number }
export interface DiscoveryStats { entries:number; directories:number; fileStats:number; native:boolean }
function openDirectoryKernel(ffi:typeof import("bun:ffi")){return ffi.dlopen("kernel32.dll",{
      FindFirstFileW:{args:[ffi.FFIType.ptr,ffi.FFIType.ptr],returns:ffi.FFIType.i64},FindNextFileW:{args:[ffi.FFIType.i64,ffi.FFIType.ptr],returns:ffi.FFIType.i32},
      FindClose:{args:[ffi.FFIType.i64],returns:ffi.FFIType.i32},GetLastError:{args:[],returns:ffi.FFIType.u32},
    });}
export function metadataReader(stats:DiscoveryStats,portable=false) {
  if(!portable&&process.platform==="win32"&&process.arch==="x64") {
    let ffi:typeof import("bun:ffi"),kernel:ReturnType<typeof openDirectoryKernel>;
    try {ffi=import.meta.require("bun:ffi");kernel=openDirectoryKernel(ffi);}catch{return metadataReader(stats,true);}
    stats.native=true;
    return {close:()=>kernel.close(),*entries(path:string):Generator<DirectoryMetadata> {
      const data=Buffer.alloc(592),pattern=Buffer.from(join(path,"*")+"\0","utf16le");let handle:number|bigint|undefined;
      try {
        handle=kernel.symbols.FindFirstFileW!(ffi.ptr(pattern),ffi.ptr(data)) as number|bigint;
        if(BigInt(handle)===-1n){const code=Number(kernel.symbols.GetLastError!());if(code===2||code===3)return;throw Error(`REDmod directory enumeration failed (${code}).`);}
        while(true){
          const attributes=data.readUInt32LE(0),name=data.toString("utf16le",44,564).split("\0",1)[0]!;
          if(name!=="."&&name!=="..")yield {name,directory:!(attributes&0x400)&&!!(attributes&0x10),file:!(attributes&(0x10|0x400)),size:data.readUInt32LE(28)*2**32+data.readUInt32LE(32),mtimeMs:Number(data.readBigUInt64LE(20)-116444736000000000n)/10000};
          if(!kernel.symbols.FindNextFileW!(handle,ffi.ptr(data))){const code=Number(kernel.symbols.GetLastError!());if(code!==18)throw Error(`REDmod directory enumeration failed (${code}).`);break;}
        }
      }finally{if(handle!==undefined&&BigInt(handle)!==-1n)kernel.symbols.FindClose!(handle);}
    }};
  }
  return {close(){},*entries(path:string):Generator<DirectoryMetadata>{
    let dir;try{dir=opendirSync(path);}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return;throw error;}
    try {let entry;while((entry=dir.readSync())!==null){const needed=entry.isDirectory()||entry.isFile()&&entry.name.endsWith(".tweak");let size=0,mtimeMs=0;
      if(needed){const stamp=statSync(join(path,entry.name));size=stamp.size;mtimeMs=stamp.mtimeMs;if(entry.isFile())stats.fileStats++;}
      yield {name:entry.name,directory:entry.isDirectory(),file:entry.isFile(),size,mtimeMs};
    }}finally{dir.closeSync();}
  }};
}
