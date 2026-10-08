import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicNewsHandler,parsePublicNewsRSS,NEWS_PUBLISHERS} from '../server/public-news.mjs';
import {normalizePublicNews} from '../src/inputs/public-providers.js';

const now=1_790_000_000_000;
function rss(publisher,count=30) {
  return `<rss><channel>${Array.from({length:count},(_,index)=>`<item><title><![CDATA[News ${index} &amp; more]]></title><link>https://www.${publisher.hosts[0]}/news/article-${index}?utm_source=rss</link><pubDate>${new Date(now-index*60000).toUTCString()}</pubDate><description><![CDATA[<p>A useful <strong>headline</strong> description.</p>]]></description></item>`).join('')}</channel></rss>`;
}
function response(){return {headers:{},setHeader(key,value){this.headers[key]=value;},end(body){this.body=body;}};}

test('RSS parsing emits plain summaries and stable canonical IDs while rejecting unsafe links and XML expansion',()=>{
  const publisher=NEWS_PUBLISHERS[0],xml=rss(publisher,2);
  const records=parsePublicNewsRSS(xml,publisher,now);
  assert.equal(records[0].title,'News 0 & more');assert.equal(records[0].summary,'A useful headline description.');
  assert.equal(records[0].url,'https://www.bbc.co.uk/news/article-0');
  assert.deepEqual(records.map(record=>record.id),parsePublicNewsRSS(xml.replaceAll('utm_source=rss','utm_source=another'),publisher,now+1000).map(record=>record.id));
  assert.throws(()=>parsePublicNewsRSS(xml.replaceAll('https://www.bbc.co.uk','https://www.bbc.co.uk.attacker.test'),publisher,now),/no recent/);
  assert.throws(()=>parsePublicNewsRSS(xml.replaceAll('https://www.bbc.co.uk','javascript:evil'),publisher,now),/no recent/);
  assert.throws(()=>parsePublicNewsRSS('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+xml,publisher,now),/invalid/);
  assert.throws(()=>parsePublicNewsRSS('x'.repeat(1_000_001),publisher,now),/invalid/);
});

test('news adapter loads only three fixed publishers, mixes 50 headlines, coalesces reads and exposes precise attribution',async()=>{
  const calls=[],handler=createPublicNewsHandler({clock:()=>now,fetcher:async(url,options)=>{
    calls.push({url,options});const publisher=NEWS_PUBLISHERS.find(value=>value.url===url);
    await new Promise(resolve=>setImmediate(resolve));
    return {ok:true,text:async()=>rss(publisher,publisher.id==='npr'?10:30)};
  }});
  const a=response(),b=response();await Promise.all([handler({method:'GET'},a),handler({method:'GET',url:'/?url=https://private.test'},b)]);
  assert.deepEqual(calls.map(call=>call.url),NEWS_PUBLISHERS.map(value=>value.url));
  assert.ok(calls.every(call=>call.options.signal instanceof AbortSignal&&call.options.redirect==='error'));
  const data=JSON.parse(a.body);assert.equal(data.records.length,50);assert.equal(data.observedAt,now);
  assert.deepEqual(data.publishers.map(publisher=>publisher.count),[20,20,10]);
  assert.equal(normalizePublicNews(data,now).items.length,50);assert.equal(a.statusCode,200);assert.match(a.headers['Cache-Control'],/s-maxage=300/);
  await handler({method:'HEAD'},response());assert.equal(calls.length,3);
  const denied=response();await handler({method:'POST'},denied);assert.equal(denied.statusCode,405);assert.equal(calls.length,3);
});

test('publisher failure is explicit, successful publishers remain usable, and complete failures back off',async()=>{
  const handler=createPublicNewsHandler({clock:()=>now,fetcher:async url=>url.includes('npr.org')?{ok:false}:{ok:true,text:async()=>rss(NEWS_PUBLISHERS.find(value=>value.url===url))}});
  const partial=response();await handler({method:'GET'},partial);const data=JSON.parse(partial.body);
  assert.equal(data.records.length,50);assert.equal(data.publishers.find(publisher=>publisher.id==='npr').status,'unavailable');
  assert.match(normalizePublicNews(data,now).summary,/NPR unavailable/);
  let calls=0;const broken=createPublicNewsHandler({clock:()=>now,fetcher:async()=>{calls++;return {ok:false};}});
  const first=response();await broken({method:'GET'},first);await broken({method:'GET'},response());
  assert.equal(first.statusCode,503);assert.equal(calls,3);assert.equal(first.headers['Cache-Control'],'no-store');
});

test('news cache expires and failed oversized responses never publish a partial fabricated snapshot',async()=>{
  let time=now,calls=0;
  const handler=createPublicNewsHandler({clock:()=>time,fetcher:async url=>{calls++;return {ok:true,text:async()=>rss(NEWS_PUBLISHERS.find(value=>value.url===url))};}});
  await handler({method:'GET'},response());time+=299_000;await handler({method:'GET'},response());assert.equal(calls,3);
  time+=2000;const fresh=response();await handler({method:'GET'},fresh);assert.equal(calls,6);assert.equal(JSON.parse(fresh.body).observedAt,time);
  const oversized=createPublicNewsHandler({clock:()=>now,fetcher:async()=>({ok:true,headers:{get:()=>1_000_001},text:async()=>'<rss><channel/></rss>'})});
  const denied=response();await oversized({method:'GET'},denied);assert.equal(denied.statusCode,503);
});
