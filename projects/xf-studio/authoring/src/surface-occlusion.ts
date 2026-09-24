import * as THREE from "three";

type Triangle={a:number;b:number;c:number;material:number};
type Node={box:THREE.Box3;left?:Node;right?:Node;triangles?:number[]};

/** Exact deformed-head visibility for projected UI. Cache original vertex
 * sampling once per changed pose; a refitted topology BVH avoids reskinning
 * shared triangle vertices for every parent ray. No renderer/mesh mutation. */
export function createSurfaceOcclusion(mesh:THREE.Mesh) {
  let geometry:THREE.BufferGeometry|undefined,topologyKey="",triangles:Triangle[]=[],root:Node|undefined,
    positions=new Float64Array(),pose:number[]=[],refits=0,sampledVertices=0,queries=0,triangleTests=0;
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),intersection=new THREE.Vector3();
  const identities=new WeakMap<object,number>();let nextIdentity=0;
  const identity=(value:object)=>{let id=identities.get(value);if(id===undefined){id=++nextIdentity;identities.set(value,id);}return id;};
  const read=(id:number,target:THREE.Vector3)=>target.fromArray(positions,id*3);
  function build(ids:number[]):Node {
    const node:Node={box:new THREE.Box3()};
    if(ids.length<=12){node.triangles=ids;return node;}
    const bounds=new THREE.Box3(),centres=new Map<number,THREE.Vector3>();
    for(const id of ids){const t=triangles[id],center=read(t.a,a).clone().add(read(t.b,b)).add(read(t.c,c)).divideScalar(3);
      centres.set(id,center);bounds.expandByPoint(center);}
    const size=bounds.getSize(new THREE.Vector3()),axis=size.x>=size.y&&size.x>=size.z?"x":size.y>=size.z?"y":"z";
    ids.sort((x,y)=>centres.get(x)![axis]-centres.get(y)![axis]||x-y);
    const split=Math.floor(ids.length/2);node.left=build(ids.slice(0,split));node.right=build(ids.slice(split));return node;
  }
  function refit(node:Node) {
    node.box.makeEmpty();
    if(node.triangles)for(const id of node.triangles){const t=triangles[id];
      node.box.expandByPoint(read(t.a,a)).expandByPoint(read(t.b,b)).expandByPoint(read(t.c,c));}
    else {refit(node.left!);refit(node.right!);node.box.union(node.left!.box).union(node.right!.box);}
  }
  function refresh() {
    const g=mesh.geometry,index=g.index,count=index?.count??g.getAttribute("position").count;
    const key=JSON.stringify([g.id,index?identity(index):null,index?.version,count,g.getAttribute("position").count,
      Array.isArray(mesh.material),g.drawRange,g.groups]);
    const topologyChanged=geometry!==g||topologyKey!==key;
    let changed=topologyChanged,cursor=0;
    const record=(value:number)=>{if(pose[cursor]!==value)changed=true;pose[cursor++]=value;};
    const matrix=(value:THREE.Matrix4)=>{for(const n of value.elements)record(n);};
    const attributeVersion=(attribute:THREE.BufferAttribute|THREE.InterleavedBufferAttribute)=>{
      record(identity(attribute));record("data" in attribute?attribute.data.version:attribute.version);};
    matrix(mesh.matrixWorld);
    record(identity(mesh.getVertexPosition));
    for(const attribute of Object.values(g.attributes))attributeVersion(attribute);
    record(g.morphTargetsRelative?1:0);
    for(const attribute of g.morphAttributes.position??[])attributeVersion(attribute);
    for(const value of mesh.morphTargetInfluences??[])record(value);
    if(mesh instanceof THREE.SkinnedMesh){record(identity(mesh.applyBoneTransform));matrix(mesh.bindMatrix);matrix(mesh.bindMatrixInverse);
      for(const bone of mesh.skeleton.bones)matrix(bone.matrixWorld);
      for(const inverse of mesh.skeleton.boneInverses)matrix(inverse);}
    if(pose.length!==cursor)changed=true;pose.length=cursor;
    if(!changed)return;
    const vertexCount=g.getAttribute("position").count;
    if(positions.length!==vertexCount*3)positions=new Float64Array(vertexCount*3);
    for(let i=0;i<vertexCount;i++)mesh.getVertexPosition(i,a).applyMatrix4(mesh.matrixWorld).toArray(positions,i*3);
    sampledVertices+=vertexCount;
    if(topologyChanged){
      geometry=g;topologyKey=key;triangles=[];
      const start=Math.max(0,g.drawRange.start),end=Math.min(count,start+g.drawRange.count);
      const ranges=Array.isArray(mesh.material)?g.groups:[{start:0,count,materialIndex:0}];
      for(const range of ranges)for(let i=Math.max(start,range.start),stop=Math.min(end,range.start+range.count);i+2<stop;i+=3)
        triangles.push({a:index?index.getX(i):i,b:index?index.getX(i+1):i+1,c:index?index.getX(i+2):i+2,material:range.materialIndex??0});
      root=triangles.length?build(triangles.map((_,i)=>i)):undefined;
    }
    if(root)refit(root);refits++;
  }
  function occluded(ray:THREE.Ray,maximumDistance:number) {
    if(!Number.isFinite(maximumDistance)||maximumDistance<=0)return false;
    refresh();queries++;
    const flipped=mesh.matrixWorld.determinant()<0;
    const stack=root?[root]:[],limit=maximumDistance*maximumDistance;
    while(stack.length){
      const node=stack.pop()!;
      const entry=ray.intersectBox(node.box,intersection);
      if(!entry||(!node.box.containsPoint(ray.origin)&&entry.distanceToSquared(ray.origin)>=limit))continue;
      if(!node.triangles){stack.push(node.left!,node.right!);continue;}
      for(const id of node.triangles){
        const triangle=triangles[id],material=Array.isArray(mesh.material)?mesh.material[triangle.material]:mesh.material;
        if(!material)continue;
        read(triangle.a,a);read(triangle.b,b);read(triangle.c,c);triangleTests++;
        const reverse=(material.side===THREE.BackSide)!==flipped,cull=material.side!==THREE.DoubleSide;
        const result=reverse?ray.intersectTriangle(c,b,a,cull,intersection):ray.intersectTriangle(a,b,c,cull,intersection);
        if(result&&result.distanceToSquared(ray.origin)<limit)return true;
      }
    }
    return false;
  }
  return {occluded,diagnostics:()=>({refits,sampledVertices,queries,triangleTests,triangles:triangles.length,
    cachedPositionBytes:positions.byteLength})};
}
