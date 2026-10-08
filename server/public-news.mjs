const USER_AGENT='Murmuration/0.1 (https://github.com/Tobybarnes/murmuration)';
const MAX_BYTES=1_000_000;
export const NEWS_PUBLISHERS=Object.freeze([
  {id:'bbc',name:'BBC News',url:'https://feeds.bbci.co.uk/news/world/rss.xml',hosts:['bbc.co.uk','bbc.com']},
  {id:'guardian',name:'The Guardian',url:'https://www.theguardian.com/world/rss',hosts:['theguardian.com']},
  {id:'npr',name:'NPR',url:'https://feeds.npr.org/1001/rss.xml',hosts:['npr.org']},
]);

function decode(value) {
  const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,entity)=>{
    if(entity[0]!=='#')return entities[entity.toLowerCase()]??'';
    const code=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):parseInt(entity.slice(1),10);
    return code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):'';
  });
}
const plain=(value,limit)=>decode(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,limit);
function field(block,name){return block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'))?.[1]??'';}
function articleURL(value,publisher) {
  try {
    const url=new URL(plain(value,2000));
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password||!publisher.hosts.some(host=>url.hostname===host||url.hostname.endsWith(`.${host}`)))return '';
    url.protocol='https:';url.hash='';
    for(const key of [...url.searchParams.keys()])if(/^utm_/i.test(key)||['CMP','at_medium','at_campaign','at_link_id','at_link_type','at_format','at_ptr_name'].includes(key))url.searchParams.delete(key);
    return url.href;
  } catch {return '';}
}

// These three publishers supply RSS 2.0. No XML entities or remote resources are
// expanded; only bounded item fields are read and emitted as plain text.
export function parsePublicNewsRSS(xml,publisher,now=Date.now()) {
  if(typeof xml!=='string'||xml.length>MAX_BYTES||/<!DOCTYPE|<!ENTITY/i.test(xml)||!/<rss\b/i.test(xml)||!/<channel\b/i.test(xml))throw new Error('News publisher returned an invalid feed.');
  const records=[];
  for(const match of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    if(records.length===60)break;
    const block=match[1],url=articleURL(field(block,'link'),publisher),title=plain(field(block,'title'),240),occurredAt=Date.parse(plain(field(block,'pubDate')||field(block,'dc:date'),100));
    if(!url||!title||!Number.isFinite(occurredAt)||occurredAt<=0||occurredAt>now+600_000||now-occurredAt>7*86400_000)continue;
    records.push({id:`${publisher.id}:${createHash('sha256').update(url).digest('hex').slice(0,24)}`,title,url,publisher:publisher.name,publisherId:publisher.id,occurredAt,summary:plain(field(block,'description'),360)});
  }
  if(!records.length)throw new Error('News publisher has no recent usable headlines.');
  return [...new Map(records.map(record=>[record.id,record])).values()].sort((a,b)=>b.occurredAt-a.occurredAt);
}

async function readRSS(response) {
  if(Number(response.headers?.get('content-length'))>MAX_BYTES)throw new Error('News feed is too large.');
  if(!response.body?.getReader) {const text=await response.text();if(text.length>MAX_BYTES)throw new Error('News feed is too large.');return text;}
  const reader=response.body.getReader(),chunks=[];let size=0;
  try {
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES)throw new Error('News feed is too large.');chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return new TextDecoder().decode(bytes);
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}

export function createPublicNewsHandler({fetcher=fetch,clock=Date.now}={}) {
  let cached=null,expiresAt=0,inflight=null,retryAt=0;
  async function load() {
    if(cached&&clock()<expiresAt)return cached;
    if(inflight)return inflight;
    if(clock()<retryAt)throw new Error('Public news is temporarily unavailable.');
    retryAt=clock()+30_000;
    inflight=(async()=>{
      const now=clock();
      const results=await Promise.allSettled(NEWS_PUBLISHERS.map(async publisher=>{
        const response=await fetcher(publisher.url,{headers:{'User-Agent':USER_AGENT,Accept:'application/rss+xml, application/xml, text/xml'},redirect:'error',signal:AbortSignal.timeout(12_000)});
        if(!response.ok)throw new Error('News publisher is unavailable.');
        return parsePublicNewsRSS(await readRSS(response),publisher,now);
      }));
      const queues=results.map(result=>result.status==='fulfilled'?[...result.value]:[]),records=[];
      // Round-robin allocation preserves a mixture instead of filling the flock
      // with the busiest publisher; unused slots go to available publishers.
      while(records.length<50&&queues.some(queue=>queue.length))for(const queue of queues){if(queue.length&&records.length<50)records.push(queue.shift());}
      if(!records.length)throw new Error('No news publishers are available.');
      cached={observedAt:now,records,publishers:NEWS_PUBLISHERS.map((publisher,index)=>({id:publisher.id,name:publisher.name,url:publisher.url,status:results[index].status==='fulfilled'?'current':'unavailable',count:records.filter(record=>record.publisherId===publisher.id).length}))};
      expiresAt=clock()+300_000;return cached;
    })();
    try{return await inflight;}finally{inflight=null;}
  }
  return async function handler(req,res) {
    res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');
    if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');res.statusCode=405;res.end(JSON.stringify({error:'Method not allowed.'}));return;}
    try {
      const data=await load();res.setHeader('Cache-Control','public, max-age=30, s-maxage=300');res.statusCode=200;res.end(req.method==='HEAD'?undefined:JSON.stringify(data));
    } catch {
      res.setHeader('Cache-Control','no-store');res.statusCode=503;res.end(req.method==='HEAD'?undefined:JSON.stringify({error:'Public news is temporarily unavailable. Try again later.'}));
    }
  };
}
import {createHash} from 'node:crypto';
