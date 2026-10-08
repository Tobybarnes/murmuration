import {fetchJSON, fetchWeather} from './providers.js';
import {itemId} from './store.js';

export const PUBLIC_CITIES = [
  {id:'sf',name:'San Francisco',latitude:37.7749,longitude:-122.4194},
  {id:'london',name:'London',latitude:51.5074,longitude:-0.1278},
  {id:'tokyo',name:'Tokyo',latitude:35.6762,longitude:139.6503},
];
const storyBase = 'https://hacker-news.firebaseio.com/v0';
const postActor = 'bsky.app';
const validTime = (time, now) => Number.isFinite(time) && time > 0 && time <= now + 600_000;
const clean = (value, length=240) => typeof value === 'string' ? value.slice(0,length) : '';
const item = (source, id, title, updatedAt) => ({
  itemId:itemId('public',source,id),sourceId:`public:${source}`,source,
  accountId:'',category:'other',title:clean(title),readState:'unknown',updatedAt,revision:updatedAt,
});
function snapshot(source, items, records, now, ttl, summary, observedAt=now) {
  return {sourceId:`public:${source}`,items,changes:[],records,observedAt,expiresAt:observedAt+ttl,summary,
    reportedAt:records.length&&['hacker-news','bluesky'].includes(source)?Math.max(...records.map(record=>record.occurredAt)):observedAt,
    timestampLabel:['hacker-news','bluesky'].includes(source)?'Latest item':'Source updated',
  };
}

export async function fetchPublicNews(options={}) {
  const now=options.now??Date.now();
  const ids=await fetchJSON(`${storyBase}/newstories.json`,options);
  if(!Array.isArray(ids) || ids.some(id=>!Number.isSafeInteger(id)||id<=0)) throw new Error('News feed returned unexpected story IDs.');
  const selected=[...new Set(ids)].slice(0,24), stories=[];
  // Six concurrent reads at most, with one complete snapshot per refresh.
  for(let offset=0;offset<selected.length;offset+=6) {
    stories.push(...await Promise.all(selected.slice(offset,offset+6).map(id=>fetchJSON(`${storyBase}/item/${id}.json`,options))));
  }
  const records=stories.filter(story=>story && !story.deleted && !story.dead && story.type==='story');
  if(records.some(story=>!Number.isSafeInteger(story.id)||!clean(story.title)||!validTime(story.time*1000,now))) throw new Error('News feed returned an invalid story.');
  return snapshot('hacker-news',records.map(story=>item('hacker-news',story.id,story.title,story.time*1000)),records.map(story=>({title:clean(story.title),url:`https://news.ycombinator.com/item?id=${story.id}`,occurredAt:story.time*1000})),now,600_000,`${records.length} newest Hacker News stories. New arrivals join the flock.`);
}

export function normalizePublicQuakes(data,now=Date.now()) {
  const generated=data?.metadata?.generated;
  if(data?.type!=='FeatureCollection' || !Array.isArray(data.features) || !validTime(generated,now) || now-generated>600_000) throw new Error('Earthquake feed is unavailable or stale.');
  const events=data.features.filter(event=>event?.properties?.type==='earthquake').sort((a,b)=>b.properties.time-a.properties.time).slice(0,40);
  if(events.some(event=>!clean(event.id)||!clean(event.properties.title)||!validTime(event.properties.time,now))) throw new Error('Earthquake feed returned an invalid event.');
  return snapshot('usgs',events.map(event=>item('usgs',event.id,event.properties.title,event.properties.updated||event.properties.time)),events.map(event=>({title:clean(event.properties.title),url:`https://earthquake.usgs.gov/earthquakes/eventpage/${encodeURIComponent(event.id)}`,occurredAt:event.properties.time})),now,600_000,`${events.length} earthquakes reported in the past hour${events.length===40?' (latest 40)':''}. Each event is one bird.`,generated);
}
export async function fetchPublicQuakes(options={}) {
  return normalizePublicQuakes(await fetchJSON('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson',options),options.now??Date.now());
}

export function normalizePublicPosts(data,now=Date.now()) {
  if(!Array.isArray(data?.feed)) throw new Error('Public social feed returned an unexpected response.');
  const posts=[...new Map(data.feed.filter(entry=>!entry.post?.labels?.some(label=>['porn','sexual','nudity','graphic-media'].includes(label.val))).map(entry=>[entry.post?.uri,entry.post])).values()].slice(0,20);
  if(posts.some(post=>!/^at:\/\/did:[a-z]+:[a-zA-Z0-9._:%-]+\/app\.bsky\.feed\.post\/[a-zA-Z0-9]+$/.test(post?.uri) || !clean(post.record?.text)||!validTime(Date.parse(post.record.createdAt),now))) throw new Error('Public social feed returned an invalid post.');
  const records=posts.map(post=>({title:clean(`@${post.author?.handle??postActor}: ${post.record.text}`),url:`https://bsky.app/profile/${encodeURIComponent(post.author.did)}/post/${post.uri.split('/').at(-1)}`,occurredAt:Date.parse(post.record.createdAt)}));
  return snapshot('bluesky',posts.map((post,index)=>item('bluesky',post.uri,records[index].title,records[index].occurredAt)),records,now,600_000,`${posts.length} recent posts and reposts from @${postActor}. This is a selected public account, not the global stream.`);
}
export async function fetchPublicPosts(options={}) {
  return normalizePublicPosts(await fetchJSON(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${postActor}&limit=20&filter=posts_no_replies`,options),options.now??Date.now());
}
export async function fetchPublicWeather(location=PUBLIC_CITIES[0],options={}) {
  const weather=await fetchWeather(location,options);
  return {...snapshot('weather',[],[],options.now??Date.now(),1_800_000,`${weather.location} · ${Math.round(weather.temperatureC)}°C · wind ${Math.round(weather.windKph)} km/h · ${Math.round(weather.cloudCover*100)}% cloud.`,weather.observedAt),environment:{weather}};
}

export function normalizePublicMusic(data,now=Date.now()) {
  const p=data?.payload,observedAt=p?.last_updated*1000;
  if(!Array.isArray(p?.recordings)||!validTime(observedAt,now)||now-observedAt>259_200_000||!validTime(p.from_ts*1000,now)||!Number.isFinite(p.to_ts))throw new Error('Community music chart is unavailable or stale.');
  const recordings=[...new Map(p.recordings.slice(0,10).map(record=>{
    if(!clean(record.artist_name)||!clean(record.track_name))throw new Error('Community music returned an invalid recording.');
    const id=/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(record.recording_mbid??'')?record.recording_mbid:itemId(record.artist_name,record.track_name);
    return [id,{...record,id}];
  })).values()];
  const records=recordings.map(record=>({title:clean(`${record.artist_name} · ${record.track_name}`),url:'https://listenbrainz.org/statistics/',occurredAt:observedAt}));
  const week=new Date(p.from_ts*1000).toLocaleDateString([],{month:'short',day:'numeric'});
  const result=snapshot('listenbrainz',recordings.map((record,index)=>item('listenbrainz',record.id,records[index].title,p.from_ts*1000)),records,now,259_200_000,`${recordings.length} popular recordings for the week beginning ${week} across ListenBrainz. Community charts update daily, sometimes later.`,observedAt);
  return result;
}
export async function fetchPublicMusic(options={}) {
  return normalizePublicMusic(await fetchJSON('/api/public-music',options),options.now??Date.now());
}

export const PUBLIC_FEEDS = [
  {id:'news',name:'News',provider:'Hacker News',url:'https://github.com/HackerNews/API',interval:120_000,load:fetchPublicNews},
  {id:'social',name:'Public social',provider:'Bluesky · @bsky.app',url:'https://bsky.app/profile/bsky.app',interval:120_000,load:fetchPublicPosts},
  {id:'quakes',name:'Earthquakes',provider:'USGS',url:'https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php',interval:60_000,load:fetchPublicQuakes},
  {id:'music',name:'Popular music this week',provider:'ListenBrainz · CC0',url:'https://listenbrainz.org/statistics/',interval:3_600_000,load:fetchPublicMusic},
  {id:'weather',name:'Weather',provider:'Open-Meteo · CC BY 4.0',url:'https://open-meteo.com/',interval:900_000,load:fetchPublicWeather},
];
