import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvasRenderer} from '../src/renderers/canvas.js';

function setup(readState='unread') {
  const arcs=[],stops=[];
  const ctx={globalAlpha:1,fillStyle:'',strokeStyle:'',fillRect(){},beginPath(){},moveTo(){},arc(...values){arcs.push(values);},fill(){},stroke(){},setLineDash(){},createLinearGradient(){return {addColorStop(...values){stops.push(values);}};}};
  const frame={parameters:{trails:0,linkA:0,size:2,labels:0},birds:[{birdId:'email:1',x:10,y:20,radius:3,linked:0,readState}],geometry:[],width:100,height:100,environment:{}};
  const options={colours:{bg:[21,50,67],fg:[235,242,250],accent:[255,165,0],hover:[125,142,157]},appearance:'dots',connections:false,labels:false};
  return {renderer:createCanvasRenderer(ctx),frame,options,arcs,stops};
}

test('reading an item removes its centre dot after transient activity has finished',()=>{
  const {renderer,frame,options,arcs}=setup();
  renderer.draw(frame,options);assert.equal(arcs.length,2);
  assert.ok(arcs[1][2]<arcs[0][2]);
  arcs.length=0;frame.birds[0].readState='read';
  renderer.draw(frame,options);assert.equal(arcs.length,1);
});

test('fresh weather shapes the dot scene sky and expires back to the original canvas',()=>{
  const {renderer,frame,options,stops}=setup();
  frame.environment.weather={expiresAt:Date.now()+60_000,cloudCover:1,isDay:false};
  renderer.draw(frame,options);assert.equal(stops.length,3);
  assert.equal(stops[2][1],'rgba(125,142,157,0.08)');
  stops.length=0;frame.environment.weather.expiresAt=0;
  renderer.draw(frame,options);assert.equal(stops.length,0);
});
