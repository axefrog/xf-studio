import { expect, test } from 'bun:test';
import { encodeScalarBytes, scalarBytes } from '../src/platform/api/scalar-image';
test('scalar image observations round-trip complete and partial base64 groups across chunk boundaries',()=>{
 for(const length of [0,1,2,3,127,12287,12288,12289,262144]){
 const bytes=Uint8Array.from({length},(_,i)=>(i*17+13)%256);const encoded=encodeScalarBytes(bytes);
 expect(scalarBytes(encoded)).toEqual(bytes);expect(Object.freeze({values:encoded}).values).toBe(encoded);
 }
});
