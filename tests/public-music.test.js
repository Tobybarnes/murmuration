import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicMusicHandler,normalizeLastfmChart} from '../server/public-music.mjs';
import {normalizePublicMusic} from '../src/inputs/public-providers.js';
import {createInputStore} from '../src/inputs/store.js';

const now=1_790_000_000_000;
const chart={tracks:{track:Array.from({length:20},(_,index)=>({name:`Song ${index}`,artist:{name:'Artist'},url:`https://www.last.fm/music/Artist/_/Song+${index}`,playcount:String(1000-index),listeners:String(100-index)}))}};
const weekly={payload:{last_updated:now/1000-3600,from_ts:now/1000-86400,to_ts:now/1000+86400,recordings:Array.from({length:20},(_,index)=>({artist_name:'Artist',track_name:`Weekly ${index}`,listen_count:10+index}))}};
function response(){return {headers:{},setHeader(key,value){this.headers[key]=value;},end(body){this.body=body;}};}

test('Last.fm official chart uses only a server key, exposes ranks and honest count period, and never returns credentials',async()=>{
  let calls=0,request;
  const handler=createPublicMusicHandler({clock:()=>now,apiKey:'test-server-secret',fetcher:async url=>{calls++;request=new URL(url);return {ok:true,json:async()=>chart};}});
  const res=response();await handler({method:'GET',url:'/?method=user.getRecentTracks&user=private'},res);
  const data=JSON.parse(res.body);assert.equal(request.hostname,'ws.audioscrobbler.com');assert.equal(request.searchParams.get('method'),'chart.getTopTracks');
  assert.equal(request.searchParams.get('limit'),'20');assert.equal(request.searchParams.has('user'),false);
  assert.equal(data.provider,'lastfm');assert.equal(data.tracks.length,20);assert.equal(data.tracks[0].playcount,1000);assert.equal(data.tracks[0].rank,1);
  assert.equal(data.period,'unspecified');assert.match(data.musicMeta.message,/not plays recorded during the last hour/);assert.equal(res.body.includes('test-server-secret'),false);
  const snapshot=normalizePublicMusic(data,now);assert.equal(snapshot.sourceId,'public:music');assert.equal(snapshot.items[0].itemId,snapshot.records[0].itemId);assert.match(snapshot.summary,/not last-hour plays/);
  await handler({method:'GET'},response());assert.equal(calls,1);
});

test('missing or failed Last.fm keys use 20 real weekly recordings with explicit fallback setup status',async()=>{
  const noKeyCalls=[],noKey=createPublicMusicHandler({clock:()=>now,apiKey:'',fetcher:async url=>{noKeyCalls.push(url);return {ok:true,json:async()=>weekly};}});
  const res=response();await noKey({method:'GET'},res);const data=JSON.parse(res.body);
  assert.equal(noKeyCalls.length,1);assert.match(noKeyCalls[0],/listenbrainz.*count=40/);assert.equal(data.tracks.length,20);
  assert.equal(data.musicMeta.configuration,'lastfm-key-needed');assert.equal(data.period,'week');assert.match(normalizePublicMusic(data,now).summary,/week beginning/);
  const failCalls=[],failed=createPublicMusicHandler({clock:()=>now,apiKey:'bad-key',fetcher:async url=>{failCalls.push(url);return {ok:true,json:async()=>url.includes('audioscrobbler')?{error:10,message:'private error content'}:weekly};}});
  const fallback=response();await failed({method:'GET'},fallback);assert.equal(failCalls.length,2);assert.equal(JSON.parse(fallback.body).musicMeta.configuration,'lastfm-unavailable');
  assert.equal(fallback.body.includes('bad-key'),false);assert.equal(fallback.body.includes('private error content'),false);
});

test('hourly rechecks retain music identity without replaying unchanged songs and provider changes reconcile one music source',()=>{
  const store=createInputStore(),first=normalizePublicMusic(normalizeLastfmChart(chart,now),now),next=normalizePublicMusic(normalizeLastfmChart(chart,now+3600_000),now+3600_000);
  store.applySnapshot(first.sourceId,first.items,{revision:now,now});store.applySnapshot(next.sourceId,next.items,{revision:now+3600_000,now:now+3600_000});
  assert.equal(store.getState(now+3600_000).changes.length,0);assert.deepEqual(first.items.map(item=>item.itemId),next.items.map(item=>item.itemId));
  const fallback=normalizePublicMusic({provider:'listenbrainz',observedAt:now,fromTs:now-86400_000,tracks:[{id:'weekly-track',title:'Weekly track',artist:'Artist',url:'https://listenbrainz.org/statistics/',rank:1}],periodLabel:'Weekly community chart'},now+3600_001);
  store.applySnapshot(fallback.sourceId,fallback.items,{revision:now+3600_001,now:now+3600_001});assert.equal(store.getState(now+3600_001).items.length,1);
});

test('music adapter fetches again when hourly cache expires rather than reviving an expired chart',async()=>{
  let time=now,calls=0;const handler=createPublicMusicHandler({clock:()=>time,apiKey:'',fetcher:async()=>{calls++;return {ok:true,json:async()=>weekly};}});
  await handler({method:'GET'},response());time+=3600_001;await handler({method:'GET'},response());assert.equal(calls,2);
  assert.throws(()=>normalizeLastfmChart({tracks:{track:[{...chart.tracks.track[0],url:'javascript:bad'}]}},now),/invalid/);
  assert.throws(()=>normalizePublicMusic({...normalizeLastfmChart(chart,now),observedAt:now-7200_001},now),/stale/);
});
