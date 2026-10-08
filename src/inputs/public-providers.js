import {fetchJSON, fetchWeather} from './providers.js';
import {itemId} from './store.js';

export const PUBLIC_CITIES = [
  {id:'sf',name:'San Francisco',latitude:37.7749,longitude:-122.4194},
  {id:'london',name:'London',latitude:51.5074,longitude:-0.1278},
  {id:'tokyo',name:'Tokyo',latitude:35.6762,longitude:139.6503},
  {id:'tromso',name:'Tromsø',latitude:69.6492,longitude:18.9553},
  {id:'dubai',name:'Dubai',latitude:25.2048,longitude:55.2708},
  {id:'singapore',name:'Singapore',latitude:1.3521,longitude:103.8198},
];
const postActor = 'bsky.app';
const validTime = (time, now) => Number.isFinite(time) && time > 0 && time <= now + 600_000;
const clean = (value, length=240) => typeof value === 'string' ? value.slice(0,length) : '';
const safeURL = value => {try {const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';}catch{return '';}};
const item = (source, id, title, updatedAt) => ({
  itemId:itemId('public',source,id),sourceId:`public:${source}`,source,
  accountId:'',category:'other',title:clean(title),readState:'unknown',updatedAt,revision:updatedAt,
});
function snapshot(source, items, records, now, ttl, summary, observedAt=now) {
  return {sourceId:`public:${source}`,items,changes:[],records,observedAt,expiresAt:observedAt+ttl,summary,
    reportedAt:records.length&&['news','bluesky'].includes(source)?Math.max(...records.map(record=>record.occurredAt)):observedAt,
    timestampLabel:['news','bluesky'].includes(source)?'Latest item':'Source updated',
  };
}

export function normalizePublicNews(data,now=Date.now()) {
  if(!Array.isArray(data?.records)||!validTime(data.observedAt,now)||now-data.observedAt>600_000)throw new Error('News headlines are unavailable or stale.');
  const records=[...new Map(data.records.slice(0,50).map(record=>{
    if(!clean(record.id)||!clean(record.title)||!clean(record.publisher)||!safeURL(record.url)||!validTime(record.occurredAt,now))throw new Error('News feed returned an invalid headline.');
    return [record.id,{itemId:itemId('public','news',record.id),title:clean(record.title),url:safeURL(record.url),publisher:clean(record.publisher,100),occurredAt:record.occurredAt,summary:clean(record.summary,360)}];
  })).values()];
  const publishers=(data.publishers??[]).filter(publisher=>publisher.status==='current').map(publisher=>clean(publisher.name,80));
  const unavailable=(data.publishers??[]).filter(publisher=>publisher.status!=='current').map(publisher=>clean(publisher.name,80));
  const result=snapshot('news',records.map(record=>({itemId:record.itemId,sourceId:'public:news',source:'news',accountId:'',category:'other',title:record.title,readState:'unknown',updatedAt:record.occurredAt,revision:record.occurredAt})),records,now,600_000,`${records.length} recent headlines from ${publishers.join(', ')||'public news publishers'}. RSS is checked every two minutes and shared for five minutes.${unavailable.length?` ${unavailable.join(', ')} unavailable; other publishers remain current.`:''}`,data.observedAt);
  return {...result,publisherStatus:data.publishers??[]};
}
export async function fetchPublicNews(options={}) {
  return normalizePublicNews(await fetchJSON('/api/public-news',options),options.now??Date.now());
}

export function normalizePublicQuakes(data,now=Date.now()) {
  const generated=data?.metadata?.generated;
  if(data?.type!=='FeatureCollection' || !Array.isArray(data.features) || !validTime(generated,now) || now-generated>600_000) throw new Error('Earthquake feed is unavailable or stale.');
  const events=data.features.filter(event=>event?.properties?.type==='earthquake').sort((a,b)=>b.properties.time-a.properties.time).slice(0,40);
  if(events.some(event=>!clean(event.id)||!clean(event.properties.title)||!validTime(event.properties.time,now))) throw new Error('Earthquake feed returned an invalid event.');
  return snapshot('usgs',events.map(event=>item('usgs',event.id,event.properties.title,event.properties.updated||event.properties.time)),events.map(event=>({itemId:itemId('public','usgs',event.id),title:clean(event.properties.title),url:`https://earthquake.usgs.gov/earthquakes/eventpage/${encodeURIComponent(event.id)}`,publisher:'USGS',occurredAt:event.properties.time,summary:clean(`Magnitude ${event.properties.mag??'unavailable'} · ${event.properties.place??'location unavailable'}.`,360),magnitude:Number.isFinite(event.properties.mag)?event.properties.mag:null})),now,600_000,`${events.length} earthquakes reported in the past hour${events.length===40?' (latest 40)':''}. Each event is one bird.`,generated);
}
export async function fetchPublicQuakes(options={}) {
  return normalizePublicQuakes(await fetchJSON('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson',options),options.now??Date.now());
}

export function normalizePublicPosts(data,now=Date.now()) {
  if(!Array.isArray(data?.feed)) throw new Error('Public social feed returned an unexpected response.');
  const posts=[...new Map(data.feed.filter(entry=>!entry.post?.labels?.some(label=>['porn','sexual','nudity','graphic-media'].includes(label.val))).map(entry=>[entry.post?.uri,entry.post])).values()].slice(0,25);
  if(posts.some(post=>!/^at:\/\/did:[a-z]+:[a-zA-Z0-9._:%-]+\/app\.bsky\.feed\.post\/[a-zA-Z0-9]+$/.test(post?.uri) || !clean(post.record?.text)||!validTime(Date.parse(post.record.createdAt),now))) throw new Error('Public social feed returned an invalid post.');
  const records=posts.map(post=>({itemId:itemId('public','bluesky',post.uri),publisher:`Bluesky · @${clean(post.author?.handle??postActor,100)}`,summary:clean(post.record.text,1000),title:clean(`@${post.author?.handle??postActor}: ${post.record.text}`),url:`https://bsky.app/profile/${encodeURIComponent(post.author.did)}/post/${post.uri.split('/').at(-1)}`,occurredAt:Date.parse(post.record.createdAt)}));
  return snapshot('bluesky',posts.map((post,index)=>item('bluesky',post.uri,records[index].title,records[index].occurredAt)),records,now,600_000,`${posts.length} recent posts and reposts from @${postActor}. This is a selected public account, not the global stream.`);
}
export async function fetchPublicPosts(options={}) {
  return normalizePublicPosts(await fetchJSON(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${postActor}&limit=25&filter=posts_no_replies`,options),options.now??Date.now());
}
export async function fetchPublicWeather(location=PUBLIC_CITIES[0],options={}) {
  const weather=await fetchWeather(location,options);
  return {...snapshot('weather',[],[],options.now??Date.now(),1_800_000,`${weather.location} · ${Math.round(weather.temperatureC)}°C · wind ${Math.round(weather.windKph)} km/h · ${Math.round(weather.cloudCover*100)}% cloud.`,weather.observedAt),environment:{weather}};
}

export function normalizePublicMusic(data,now=Date.now()) {
  if(!['lastfm','listenbrainz'].includes(data?.provider)||!Array.isArray(data.tracks)||!validTime(data.observedAt,now)||now-data.observedAt>(data.provider==='lastfm'?7_200_000:259_200_000))throw new Error('Public music chart is unavailable or stale.');
  const provider=data.provider,publisher=provider==='lastfm'?'Last.fm':'ListenBrainz';
  const tracks=[...new Map(data.tracks.slice(0,20).map(track=>{
    if(!clean(track.id)||!clean(track.artist)||!clean(track.title)||!safeURL(track.url))throw new Error('Public music returned an invalid track.');
    return [track.id,track];
  })).values()];
  const from=Number(data.fromTs),week=Number.isFinite(from)?new Date(from).toLocaleDateString([],{month:'short',day:'numeric'}):'';
  const period=provider==='lastfm'?'Last.fm chart counts have no specified counting period; these are not last-hour plays.':`Weekly ListenBrainz chart for the week beginning ${week}. These are not last-hour plays.`;
  const records=tracks.map(track=>({itemId:itemId('public',provider,track.id),title:clean(`${track.artist} · ${track.title}`),url:safeURL(track.url),publisher,occurredAt:data.observedAt,summary:`#${track.rank} in the ${publisher} chart. ${period}`,artist:clean(track.artist),track:clean(track.title),rank:track.rank,playcount:track.playcount,listeners:track.listeners,period:clean(data.periodLabel,240)}));
  const items=tracks.map((track,index)=>({...item(provider,track.id,records[index].title,provider==='lastfm'?0:from),sourceId:'public:music'}));
  const summary=`${tracks.length} popular tracks from ${publisher}. ${period} Refreshed hourly.${data.musicMeta?.configuration==='lastfm-key-needed'?' Last.fm needs a server API key.':''}${data.musicMeta?.configuration==='lastfm-unavailable'?' Last.fm is unavailable; using the weekly community chart.':''}`;
  return {...snapshot('music',items,records,now,provider==='lastfm'?7_200_000:259_200_000,summary,data.observedAt),timestampLabel:provider==='lastfm'?'Chart checked':'Chart updated',musicMeta:data.musicMeta};
}
export async function fetchPublicMusic(options={}) {
  return normalizePublicMusic(await fetchJSON('/api/public-music',options),options.now??Date.now());
}

export const PUBLIC_FEEDS = [
  {id:'news',name:'News',provider:'BBC News · The Guardian · NPR',url:'https://www.bbc.com/news',interval:120_000,load:fetchPublicNews},
  {id:'social',name:'Public social',provider:'Bluesky · @bsky.app',url:'https://bsky.app/profile/bsky.app',interval:120_000,load:fetchPublicPosts},
  {id:'quakes',name:'Earthquakes',provider:'USGS',url:'https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php',interval:60_000,load:fetchPublicQuakes},
  {id:'music',name:'Popular music',provider:'Last.fm / ListenBrainz',url:'https://www.last.fm/charts',interval:3_600_000,load:fetchPublicMusic},
  {id:'weather',name:'Weather',provider:'Open-Meteo · CC BY 4.0',url:'https://open-meteo.com/',interval:900_000,load:fetchPublicWeather},
];
