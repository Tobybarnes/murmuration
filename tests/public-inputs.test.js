import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchPublicNews,normalizePublicPosts,normalizePublicQuakes,normalizePublicMusic} from '../src/inputs/public-providers.js';
import {createPublicSession} from '../src/inputs/public-session.js';
import {createPublicMusicHandler} from '../server/public-music.mjs';
import {createSkyScene} from '../src/scenes/sky.js';

const now=1_790_000_000_000;
const post={uri:'at://did:plc:abc123/app.bsky.feed.post/3abc',author:{did:'did:plc:abc123',handle:'bsky.app'},record:{text:'A public post',createdAt:new Date(now-1000).toISOString()}};
const quake={id:'q1',properties:{type:'earthquake',title:'M 1.2 - Somewhere',time:now-1000,updated:now-500}};
const music={payload:{last_updated:now/1000-3600,from_ts:now/1000-86400,to_ts:now/1000+86400,recordings:[{artist_name:'Artist',track_name:'Song',recording_mbid:'6f33dc05-cdc0-4a2f-8039-e8fed082eec6',listen_count:100}]}};
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('news performs bounded complete reads and never publishes partial failed snapshots',async()=>{
  let concurrent=0,max=0,reads=0;
  const fetcher=async url=>{
    if(url.includes('newstories'))return {ok:true,json:async()=>Array.from({length:30},(_,i)=>i+1)};
    concurrent++;max=Math.max(max,concurrent);reads++;await settle();concurrent--;
    const id=Number(url.split('/').at(-1).split('.')[0]);
    return {ok:true,json:async()=>({id,type:'story',title:`Story ${id}`,time:(now-1000)/1000})};
  };
  const first=await fetchPublicNews({now,fetcher}),second=await fetchPublicNews({now:now+1000,fetcher});
  assert.equal(first.items.length,24);assert.equal(reads,48);assert.ok(max<=6);
  assert.deepEqual(first.items.map(item=>item.itemId),second.items.map(item=>item.itemId));
  assert.ok(first.records.every(record=>record.url.startsWith('https://news.ycombinator.com/item?id=')));
  await assert.rejects(()=>fetchPublicNews({now,fetcher:async url=>url.includes('newstories')?{ok:true,json:async()=>[1]}:{ok:false,status:503}}),/503/);
});

test('public posts and quakes retain provider identities, accept a quiet hour, and reject stale/invalid data',()=>{
  const posts=normalizePublicPosts({feed:[{post},{post}]},now);
  assert.equal(posts.items.length,1);assert.equal(posts.items[0].readState,'unknown');
  assert.equal(posts.reportedAt,now-1000);assert.equal(posts.timestampLabel,'Latest item');
  assert.throws(()=>normalizePublicPosts({feed:[{post:{...post,uri:'javascript:bad'}}]},now),/invalid/);
  const first=normalizePublicQuakes({type:'FeatureCollection',metadata:{generated:now},features:[quake]},now);
  const second=normalizePublicQuakes({type:'FeatureCollection',metadata:{generated:now+1000},features:[{...quake,properties:{...quake.properties,updated:now+500}}]},now+1000);
  assert.equal(first.items[0].itemId,second.items[0].itemId);
  assert.equal(normalizePublicQuakes({type:'FeatureCollection',metadata:{generated:now},features:[]},now).items.length,0);
  assert.throws(()=>normalizePublicQuakes({type:'FeatureCollection',metadata:{generated:now-600001},features:[]},now),/stale/);
});

test('weekly music deduplicates recordings and cannot claim current listening or revive an old chart',()=>{
  const value=normalizePublicMusic({payload:{...music.payload,recordings:[...music.payload.recordings,...music.payload.recordings]}},now);
  assert.equal(value.items.length,1);assert.equal(value.observedAt,music.payload.last_updated*1000);
  assert.equal(value.environment,undefined);assert.deepEqual(value.changes,[]);
  assert.match(value.summary,/week beginning/);
  assert.throws(()=>normalizePublicMusic({payload:{...music.payload,last_updated:now/1000-259201}},now),/stale/);
});

test('public bird labels show content while bird identity remains provider-scoped',()=>{
  const scene=createSkyScene(),value=normalizePublicPosts({feed:[{post}]},now);
  scene.sync(value.items);
  assert.equal(scene.getFrame().birds[0].label,'@bsky.app: A public post');
  assert.equal(scene.getFrame().birds[0].birdId,value.items[0].itemId);
});

function snapshot(ids,time){return {sourceId:'public:test',items:ids.map(id=>({itemId:`public:test:${id}`,sourceId:'public:test',source:'test',category:'other',title:id,readState:'unknown',updatedAt:1})),changes:[],records:[],observedAt:time,expiresAt:time+10000,summary:'Current public items'};}

test('public polling is inactive by default, throttled, and reconciles new/removing birds without replaying arrivals',async()=>{
  let time=100,calls=0;
  const session=createPublicSession({clock:()=>time,feeds:[{id:'test',interval:1000,load:async()=>snapshot(++calls===1?['a']:['a','b'],time)}]});
  session.tick();await settle();assert.equal(calls,0);
  session.start();await settle();assert.equal(session.getState().items.length,1);assert.equal(session.getState().changes.length,0);
  time+=500;session.tick();await settle();assert.equal(calls,1);
  time+=500;session.tick();await settle();assert.equal(calls,2);assert.equal(session.getState().items.length,2);
  assert.deepEqual(session.getState().changes.map(change=>change.itemId),['public:test:b']);
  session.suspend();time+=1000;session.tick();await settle();assert.equal(calls,2);
  session.start();await settle();assert.equal(calls,3);assert.equal(session.getState().items.length,2);
  session.dispose();session.start();assert.equal(session.getState().active,false);
});

test('late responses after a mode switch/disposal cannot populate the public store',async()=>{
  let resolve,signal;
  const session=createPublicSession({clock:()=>100,feeds:[{id:'test',interval:1000,load:options=>{signal=options.signal;return new Promise(done=>{resolve=done;});}}]});
  session.start();session.suspend();assert.equal(signal.aborted,true);
  resolve(snapshot(['late'],100));await settle();assert.equal(session.getState().items.length,0);
  session.dispose();session.start();assert.equal(session.getState().items.length,0);
});

test('public failure retains last items, labels outage, respects rate-limit backoff and reports expiry',async()=>{
  let time=100,calls=0;
  const session=createPublicSession({clock:()=>time,feeds:[{id:'test',interval:1000,load:async()=>{if(++calls===1)return snapshot(['a'],time);const error=new Error('Rate limited');error.retryAfterMs=300000;throw error;}}]});
  session.start();await settle();time=1100;session.tick();await settle();
  assert.equal(session.getState().sources[0].status,'unavailable');assert.equal(session.getState().items.length,1);
  time=1500;session.start();await settle();assert.equal(calls,2);
  time=20000;assert.equal(session.getState().sources[0].status,'unavailable');
  const expired=createPublicSession({clock:()=>time,feeds:[{id:'test',interval:60000,load:async()=>snapshot(['a'],time)}]});
  expired.start();await settle();time+=10001;assert.equal(expired.getState().sources[0].status,'stale');
});

function response(){return {headers:{},setHeader(key,value){this.headers[key]=value;},end(body){this.body=body;}};}
test('music adapter uses a fixed provider and identifying agent, coalesces calls, caches and rejects writes',async()=>{
  let calls=0,seenURL,seenHeaders;
  const handler=createPublicMusicHandler({clock:()=>now,fetcher:async(url,options)=>{calls++;seenURL=url;seenHeaders=options.headers;await settle();return {ok:true,json:async()=>music};}});
  const a=response(),b=response();await Promise.all([handler({method:'GET'},a),handler({method:'GET'},b)]);
  await handler({method:'GET',url:'/?target=https://private.test'},response());
  assert.equal(calls,1);assert.match(seenURL,/^https:\/\/api.listenbrainz.org\/1\/stats\/sitewide\/recordings/);
  assert.match(seenHeaders['User-Agent'],/github.com\/Tobybarnes\/murmuration/);assert.equal(a.statusCode,200);
  assert.match(a.headers['Cache-Control'],/s-maxage=3600/);assert.equal(JSON.parse(a.body).payload.recordings.length,1);
  const denied=response();await handler({method:'POST'},denied);assert.equal(denied.statusCode,405);assert.equal(calls,1);
});

test('music adapter reports failure without cached fiction and throttles retries',async()=>{
  let calls=0;const handler=createPublicMusicHandler({clock:()=>now,fetcher:async()=>{calls++;return {ok:false,status:500};}});
  const first=response();await handler({method:'GET'},first);await handler({method:'GET'},response());
  assert.equal(calls,1);assert.equal(first.statusCode,503);assert.equal(first.headers['Cache-Control'],'no-store');
});
