import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceLifecycle} from '../src/inputs/lifecycle.js';

function target() {
  const listeners=new Map();
  return {hidden:false,addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type){listeners.delete(type);},dispatch(type,event={}){listeners.get(type)?.(event);}};
}
test('source polling resumes after back-forward-cache restoration without duplicate intervals',()=>{
  const host=target(),page=target(),intervals=new Map();let next=0,ticks=0,suspensions=0,disposals=0;
  const timers={setInterval(fn){const id=++next;intervals.set(id,fn);return id;},clearInterval(id){intervals.delete(id);}};
  const cleanup=createSourceLifecycle({host,page,timers,tick(){ticks++;},suspend(){suspensions++;},dispose(){disposals++;}});
  intervals.values().next().value();assert.equal(ticks,1);
  page.hidden=true;intervals.values().next().value();assert.equal(ticks,1);
  host.dispatch('pagehide',{persisted:true});assert.equal(intervals.size,0);assert.equal(disposals,0);
  page.hidden=false;host.dispatch('pageshow',{persisted:true});assert.equal(intervals.size,1);assert.equal(ticks,2);
  host.dispatch('pageshow',{persisted:true});assert.equal(intervals.size,1);
  host.dispatch('pagehide',{persisted:false});assert.equal(intervals.size,0);assert.equal(disposals,1);
  host.dispatch('pageshow',{persisted:true});assert.equal(intervals.size,0);
  cleanup();assert.equal(disposals,1);assert.equal(suspensions,2);
});
