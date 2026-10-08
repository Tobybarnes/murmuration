import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchPublicNews,normalizePublicNews,normalizePublicPosts,normalizePublicQuakes,normalizePublicMusic} from '../src/inputs/public-providers.js';
import {createPublicSession} from '../src/inputs/public-session.js';
import {createPublicMusicHandler} from '../server/public-music.mjs';
import {createSkyScene} from '../src/scenes/sky.js';

const now=1_790_000_000_000;
const post={uri:'at://did:plc:abc123/app.bsky.feed.post/3abc',author:{did:'did:plc:abc123',handle:'bsky.app'},record:{text:'A public post',createdAt:new Date(now-1000).toISOString()}};
const quake={id:'q1',properties:{type:'earthquake',title:'M 1.2 - Somewhere',time:now-1000,updated:now-500}};
const musicResponse={provider:'listenbrainz',observedAt:now-3600_000,fromTs:now-86400_000,periodLabel:'Weekly community chart',tracks:[{id:'track1',artist:'Artist',title:'Song',url:'https://listenbrainz.org/statistics/',rank:1,playcount:100,listeners:null}]};
const music={payload:{last_updated:now/1000-3600,from_ts:now/1000-86400,to_ts:now/1000+86400,recordings:[{artist_name:'Artist',track_name:'Song',recording_mbid:'6f33dc05-cdc0-4a2f-8039-e8fed082eec6',listen_count:100}]}};
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('public news reads the fixed server adapter, retains article identities and exposes publisher detail',async()=>{
  let seenURL;
  const data={observedAt:now,records:[{id:'bbc:article1',title:'World news',url:'https://www.bbc.com/news/articles/article1',publisher:'BBC News',occurredAt:now-1000,summary:'A short description.'}],publishers:[{name:'BBC News',status:'current'},{name:'NPR',status:'unavailable'}]};
  const fetcher=async url=>{seenURL=url;return {ok:true,json:async()=>data};};
  const first=await fetchPublicNews({now,fetcher}),second=await fetchPublicNews({now:now+1000,fetcher});
  assert.equal(seenURL,'/api/public-news');assert.equal(first.items.length,1);
  assert.deepEqual(first.items.map(item=>item.itemId),second.items.map(item=>item.itemId));
  assert.equal(first.records[0].itemId,first.items[0].itemId);assert.equal(first.records[0].publisher,'BBC News');
  assert.match(first.summary,/NPR unavailable/);assert.equal(first.sourceId,'public:news');
  assert.throws(()=>normalizePublicNews({...data,observedAt:now-600001},now),/stale/);
  assert.throws(()=>normalizePublicNews({...data,records:[{...data.records[0],url:'javascript:bad'}]},now),/invalid/);
  await assert.rejects(()=>fetchPublicNews({now,fetcher:async()=>({ok:false,status:503})}),/503/);
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
  const value=normalizePublicMusic({...musicResponse,tracks:[...musicResponse.tracks,...musicResponse.tracks]},now);
  assert.equal(value.items.length,1);assert.equal(value.observedAt,musicResponse.observedAt);
  assert.equal(value.environment,undefined);assert.deepEqual(value.changes,[]);
  assert.match(value.summary,/week beginning/);
  assert.throws(()=>normalizePublicMusic({...musicResponse,observedAt:now-259201000},now),/stale/);
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

function rankedSnapshot(source,ids,time) {
  const sourceId=`public:${source}`;
  return {sourceId,items:ids.map(id=>({itemId:`${sourceId}:${id}`,sourceId,source,category:'other',title:id,readState:'unknown',updatedAt:1})),
    records:ids.map(id=>({itemId:`${sourceId}:${id}`,title:id,summary:`Detail for ${id}`,url:`https://example.com/${id}`})),
    changes:[],observedAt:time,expiresAt:time+10000,summary:'Current ranked public items'};
}

test('public quotas admit 100 nodes while retaining the full provider details',async()=>{
  const feeds=[['news','news',64],['social','bluesky',30],['music','lastfm',24],['quakes','usgs',9]].map(([id,source,count])=>({
    id,interval:1000,load:async()=>rankedSnapshot(source,Array.from({length:count},(_,index)=>`${id}-${index}`),100),
  }));
  const session=createPublicSession({clock:()=>100,feeds});
  session.start();await settle();
  const state=session.getState();
  assert.equal(state.items.length,100);
  assert.equal(new Set(state.items.map(item=>item.itemId)).size,100);
  for(const [source,count] of [['news',50],['bluesky',25],['lastfm',20],['usgs',5]])assert.equal(state.items.filter(item=>item.source===source).length,count);
  assert.equal(state.sources.find(source=>source.id==='news').records.length,64);
  assert.equal(state.sources.find(source=>source.id==='news').records[63].summary,'Detail for news-63');
  assert.equal(state.sources.find(source=>source.id==='quakes').records[8].summary,'Detail for quakes-8');
  assert.equal(state.changes.length,0);
  session.dispose();
});

test('newest earthquakes enter the quota on refresh without changing existing identities or replaying arrivals',async()=>{
  let time=100,ids=['a','b','c','d','e','f'];
  const session=createPublicSession({clock:()=>time,feeds:[{id:'quakes',interval:1000,load:async()=>rankedSnapshot('usgs',ids,time)}]});
  session.start();await settle();
  assert.deepEqual(session.getState().items.map(item=>item.itemId),['a','b','c','d','e'].map(id=>`public:usgs:${id}`));
  time+=1000;ids=['new','a','b','c','d','e','f'];session.tick();await settle();
  const changed=session.getState();
  assert.deepEqual(changed.items.map(item=>item.itemId),['new','a','b','c','d'].map(id=>`public:usgs:${id}`));
  assert.deepEqual(changed.changes.map(change=>change.itemId),['public:usgs:new']);
  assert.equal(changed.sources[0].records.find(record=>record.itemId==='public:usgs:e').summary,'Detail for e');
  time+=1000;session.tick();await settle();
  assert.deepEqual(session.getState().items.map(item=>item.itemId),changed.items.map(item=>item.itemId));
  assert.deepEqual(session.getState().changes.map(change=>change.eventId),changed.changes.map(change=>change.eventId));
  time+=5001;session.tick();await settle();
  assert.equal(session.getState().changes.length,0);
  session.dispose();
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
  assert.match(a.headers['Cache-Control'],/s-maxage=3600/);assert.equal(JSON.parse(a.body).tracks.length,1);
  const denied=response();await handler({method:'POST'},denied);assert.equal(denied.statusCode,405);assert.equal(calls,1);
});

test('music adapter reports failure without cached fiction and throttles retries',async()=>{
  let calls=0;const handler=createPublicMusicHandler({clock:()=>now,fetcher:async()=>{calls++;return {ok:false,status:500};}});
  const first=response();await handler({method:'GET'},first);await handler({method:'GET'},response());
  assert.equal(calls,1);assert.equal(first.statusCode,503);assert.equal(first.headers['Cache-Control'],'no-store');
});
