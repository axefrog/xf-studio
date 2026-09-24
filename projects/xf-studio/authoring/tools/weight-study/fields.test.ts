import { test, expect } from 'bun:test';
import { boundaryKernel, pointKernel, subdivide } from './fields';
import type { Point } from '../../src/recipe';
const square:Point[]=[{u:.3,v:.3,weight:0},{u:.7,v:.3,weight:0},{u:.7,v:.7,weight:1},{u:.3,v:.7,weight:1}];

test('arclength integral agrees with independent midpoint quadrature',()=>{
  const field=boundaryKernel(square,.002);
  for(const [u,v] of [[.5,.5],[.32,.34],[.3,.31],[.8,.3],[.8,.8]]) {
    let sum=0,total=0;
    for(let i=0;i<square.length;i++) {
      const a=square[i],b=square[(i+1)%square.length],n=20000,length=Math.hypot(b.u-a.u,b.v-a.v);
      for(let j=0;j<n;j++) {
        const t=(j+.5)/n,x=a.u+(b.u-a.u)*t,y=a.v+(b.v-a.v)*t;
        const k=length/n/((u-x)**2+(v-y)**2+.002**2);
        sum+=k*(a.weight+(b.weight-a.weight)*t);total+=k;
      }
    }
    expect(Math.abs(field(u,v)-sum/total)).toBeLessThan(2e-8);
  }
});

test('continuous at previous medial-axis winner switch; bounded and uniform',()=>{
  for(const epsilon of [0,.0005,.002]) {
    const field=boundaryKernel(square,epsilon);
    expect(Math.abs(field(.5,.5+1e-8)-field(.5,.5-1e-8))).toBeLessThan(1e-6);
    for(const value of [0,.37,1]) {
      const uniform=boundaryKernel(square.map(p=>({...p,weight:value})),epsilon);
      for(let y=0;y<=20;y++)for(let x=0;x<=20;x++) {
        const u=x/20,v=y/20,r=field(u,v);
        expect(Number.isFinite(r)&&r>=0&&r<=1).toBe(true);
        expect(Math.abs(uniform(u,v)-value)).toBeLessThan(1e-12);
      }
    }
  }
});

test('nonuniform boundary subdivision, reversal and rotation do not change integral',()=>{
  const angle=.637,c=Math.cos(angle),s=Math.sin(angle);
  const rotate=(u:number,v:number)=>[.5+(u-.5)*c-(v-.5)*s,.5+(u-.5)*s+(v-.5)*c];
  const split=subdivide(square,0,12);
  for(const epsilon of [0,.0005,.002]) {
    const base=boundaryKernel(square,epsilon),b=boundaryKernel(split,epsilon),reverse=boundaryKernel([...square].reverse(),epsilon);
    const rotated=boundaryKernel(square.map(p=>{const [u,v]=rotate(p.u,p.v);return {...p,u,v};}),epsilon);
    for(let y=0;y<=20;y++)for(let x=0;x<=20;x++) {
      const u=x/20,v=y/20,[ru,rv]=rotate(u,v),r=base(u,v);
      expect(Math.abs(r-b(u,v))).toBeLessThan(1e-11);
      expect(Math.abs(r-reverse(u,v))).toBeLessThan(1e-11);
      expect(Math.abs(r-rotated(ru,rv))).toBeLessThan(1e-11);
    }
  }
  expect(Math.abs(pointKernel(square,.002)(.5,.5)-pointKernel(split,.002)(.5,.5))).toBeGreaterThan(.2);
});

test('regularization handles conflicting crossings; exact-boundary limit cannot',()=>{
  const cross=[square[0],{...square[2],weight:0},{...square[3],weight:1},{...square[1],weight:1}];
  for(const epsilon of [.00025,.0005,.002]) {
    const field=boundaryKernel(cross,epsilon);
    expect(Math.abs(field(.5+1e-8,.5+1e-8)-field(.5+1e-8,.5-1e-8))).toBeLessThan(1e-7);
    expect(Math.abs(field(.5,.5)-boundaryKernel([...cross].reverse(),epsilon)(.5,.5))).toBeLessThan(1e-12);
  }
  const singular=boundaryKernel(cross,0);
  expect(Math.abs(singular(.5+1e-8,.5+1e-8)-singular(.5+1e-8,.5-1e-8))).toBeGreaterThan(.99);
});
