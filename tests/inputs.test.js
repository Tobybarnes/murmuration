import test from 'node:test';
import assert from 'node:assert/strict';
import { createInputStore, itemId, parseFixture, exportFixture } from '../src/inputs/store.js';
import { normalizeGmail, normalizeLastfm, normalizeWeather, fetchGmailInbox } from '../src/inputs/providers.js';

const mail = (id, revision = 1) => ({ itemId: itemId('personal', 'gmail', 'a@example.test', id), sourceId: 'gmail:a@example.test', source:'gmail', accountId:'a@example.test', category:'email', title:'A message', readState:'unread', updatedAt:revision, revision });

test('replayed changes and stale updates preserve one bird and a removal tombstone', () => {
  const store = createInputStore();
  const item = mail('42');
  const event = { eventId:'first', sourceId:item.sourceId, itemId:item.itemId, type:'upsert', item, revision:1, occurredAt:1, expiresAt:10 };
  store.applyChanges([event], 2); store.applyChanges([event], 3);
  assert.equal(store.getState(3).items.length, 1);
  assert.equal(store.getState(3).changes.length, 1);
  store.applyChanges([{ ...event, eventId:'removed', type:'remove', revision:4 }], 5);
  store.applyChanges([{ ...event, eventId:'late', revision:2, item:mail('42',2) }], 6);
  assert.equal(store.getState(6).items.length, 0);
  assert.equal(store.getState(11).changes.length, 0);
  store.applyChanges([event], 12);
  assert.equal(store.getState(12).items.length, 0);
});

test('snapshot reconciliation removes archived mail but never another account, and ignores late snapshots', () => {
  const store = createInputStore();
  const a = mail('42'); const b = { ...mail('55'), sourceId:'fixture:sample', itemId:'personal:sample:b:55' };
  store.applySnapshot(a.sourceId, [a], { revision:10, now:10 });
  store.applySnapshot(b.sourceId, [b], { revision:10, now:10 });
  store.applySnapshot(a.sourceId, [], { revision:12, now:12 });
  store.applySnapshot(a.sourceId, [a], { revision:11, now:13 });
  assert.deepEqual(store.getState(13).items.map(i => i.itemId), [b.itemId]);
  assert.throws(() => store.applySnapshot(a.sourceId, [b], { revision:14, now:14 }), /source/i);
});

test('initial snapshots populate quietly; only subsequent new items create arrival activity', () => {
  const store=createInputStore();
  store.applySnapshot(mail('42').sourceId,[mail('42')],{revision:1,now:1});
  assert.equal(store.getState(1).changes.length,0);
  store.applySnapshot(mail('42').sourceId,[mail('42'),mail('43')],{revision:2,now:2});
  assert.deepEqual(store.getState(2).changes.map(change=>change.itemId),[mail('43').itemId]);
});

test('disconnect preserves ownership and reconnect updates identity; forget removes only selected source', () => {
  const store = createInputStore(); const item = mail('42');
  store.applySnapshot(item.sourceId, [item], { revision:1, now:1 });
  store.setSourceState(item.sourceId, { status:'disconnected' });
  assert.equal(store.getState(2).items[0].itemId, item.itemId);
  store.applySnapshot(item.sourceId, [{ ...item, readState:'read' }], { revision:3, now:3 });
  assert.equal(store.getState(3).items.length, 1);
  assert.equal(store.getState(3).items[0].readState, 'read');
  store.forgetSource(item.sourceId);
  assert.equal(store.getState(4).items.length, 0);
});

test('an older identical snapshot never lowers the newer per-item revision', () => {
  const store=createInputStore(),item=mail('42',100);
  store.applyChanges([{eventId:'newer',sourceId:item.sourceId,itemId:item.itemId,type:'upsert',item,revision:100}],100);
  store.applySnapshot(item.sourceId,[item],{revision:50,now:110});
  store.applyChanges([{eventId:'old-read',sourceId:item.sourceId,itemId:item.itemId,type:'upsert',item:{...item,readState:'read'},revision:75}],120);
  assert.equal(store.getState(120).items[0].readState,'unread');
  assert.equal(store.getState(120).items[0].revision,100);
});

test('snapshots reject another source identity and cannot revive old events after an empty snapshot', () => {
  const store=createInputStore(),item=mail('42',10);
  store.applySnapshot(item.sourceId,[item],{revision:10,now:10});
  assert.throws(()=>store.applySnapshot('other',[{...item,sourceId:'other'}],{revision:20,now:20}),/another source/);
  store.applySnapshot(item.sourceId,[],{revision:100,now:100});
  const unseen=mail('never-seen',90);
  store.applyChanges([{eventId:'old-unseen',sourceId:item.sourceId,itemId:unseen.itemId,type:'upsert',item:unseen,revision:90}],101);
  assert.equal(store.getState(101).items.length,0);
});

test('oversized changes reject the whole batch without consuming event IDs', () => {
  const store=createInputStore(),base=mail('0');
  store.applySnapshot(base.sourceId,Array.from({length:1999},(_,i)=>mail(String(i))),{revision:1,now:1});
  const changes=['new-a','new-b'].map(id=>({eventId:id,sourceId:base.sourceId,itemId:mail(id).itemId,type:'upsert',item:mail(id),revision:2}));
  assert.throws(()=>store.applyChanges(changes,2),/2,000/);
  assert.equal(store.getState(2).items.length,1999);
  store.applyChanges([changes[0]],3);
  assert.equal(store.getState(3).items.length,2000);
  assert.ok(store.getState(3).items.some(item=>item.itemId===changes[0].itemId));
});

test('environment expires without creating birds and rejects an older observation', () => {
  const store = createInputStore();
  store.setEnvironment('listening', { source:'lastfm:me', observedAt:20, expiresAt:40, artist:'One', track:'Song', playing:true });
  store.setEnvironment('listening', { source:'lastfm:me', observedAt:10, expiresAt:50, artist:'Old', track:'Old', playing:true });
  assert.equal(store.getState(30).environment.listening.track, 'Song');
  assert.equal(store.getState(40).environment.listening, null);
  assert.equal(store.getState(40).items.length, 0);
});

test('fixture imports strip content and credentials, reject malformed records and size overflow', () => {
  const json = JSON.stringify({ version:1, items:[{ ...mail('42'), body:'private', token:'secret' }], changes:[], environment:{} });
  const parsed = parseFixture(json);
  assert.equal('body' in parsed.items[0], false);
  assert.equal('token' in parsed.items[0], false);
  assert.throws(() => parseFixture('{oops'), /JSON/);
  assert.throws(() => parseFixture(JSON.stringify({version:1,items:[{itemId:'x'}]})), /source|category/);
  assert.throws(() => parseFixture(' '.repeat(1_000_001)), /1 MB/);
  const store = createInputStore(); store.applySnapshot('gmail:a@example.test', parsed.items,{revision:1,now:1});
  assert.equal(JSON.parse(exportFixture(store.getState(1))).items.length,1);
});

test('Gmail normalization uses account-scoped message IDs and only labels, not body content', () => {
  const value = normalizeGmail({id:'123',internalDate:'1000',labelIds:['INBOX','UNREAD'],payload:{body:{data:'secret'}}}, 'a@example.test', 20);
  assert.equal(value.itemId,'personal:gmail:a%40example.test:123');
  assert.equal(value.title,'Inbox message');
  assert.equal(value.readState,'unread');
  assert.equal('body' in value,false);
});

test('Gmail snapshot fetch paginates Inbox using metadata scope and never returns a partial failed snapshot', async () => {
  const urls = [];
  const fetcher = async (url) => {
    urls.push(url);
    const u = new URL(url);
    if(u.pathname.endsWith('/profile')) return {ok:true,json:async()=>({emailAddress:'a@example.test'})};
    if(u.pathname.endsWith('/messages')) return {ok:true,json:async()=>u.searchParams.has('pageToken')?{messages:[{id:'b'}]}:{messages:[{id:'a'}],nextPageToken:'next'}};
    return {ok:true,json:async()=>({id:u.pathname.split('/').pop(),labelIds:['INBOX'],internalDate:'1'})};
  };
  const result = await fetchGmailInbox('test-token', {fetcher,now:10});
  assert.equal(result.items.length,2);
  assert.ok(urls.filter(u=>new URL(u).pathname.endsWith('/messages')).every(u=>new URL(u).searchParams.get('labelIds')==='INBOX'));
  assert.ok(urls.every(u=>!new URL(u).searchParams.has('q')));
  await assert.rejects(()=>fetchGmailInbox('test-token',{fetcher:async()=>({ok:false,status:401})}),/reconnect/i);
});

test('Last.fm plays have stable dedup keys while current listening expires and is not an item', () => {
  const body = {recenttracks:{track:[{name:'Current',artist:{'#text':'Artist'},'@attr':{nowplaying:'true'}},{name:'Previous',artist:{'#text':'Artist'},date:{uts:'150'}}]}};
  const first = normalizeLastfm(body, 'me', 200_000);
  const second = normalizeLastfm(body, 'me', 220_000);
  assert.equal(first.changes[0].eventId, second.changes[0].eventId);
  assert.equal(first.items.length,0);
  assert.equal(first.listening.track,'Current');
  assert.equal(first.listening.expiresAt,290_000);
  const stopped=normalizeLastfm({recenttracks:{track:[]}},'me',230_000);
  assert.equal(stopped.listening.playing,false);
});

test('weather normalization bounds atmospheric inputs and uses observation time for freshness', () => {
  const weather=normalizeWeather({current:{time:1000,temperature_2m:18,cloud_cover:200,wind_speed_10m:15,wind_direction_10m:90,is_day:1,precipitation:0,weather_code:3}}, {name:'Portland',latitude:45,longitude:-122}, 1_005_000);
  assert.equal(weather.observedAt,1_000_000);
  assert.equal(weather.expiresAt,2_800_000);
  assert.equal(weather.cloudCover,1);
  assert.equal(weather.isDay,true);
});
