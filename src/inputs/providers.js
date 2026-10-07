import {itemId} from './store.js';

export async function fetchJSON(url,{fetcher=fetch,headers,signal}={}) {
  const timeout=AbortSignal.timeout(15000);
  const response=await fetcher(url,{headers,signal:signal?AbortSignal.any([signal,timeout]):timeout,cache:'no-store',referrerPolicy:'no-referrer'});
  if(!response.ok) {
    if(response.status===401) {const error=new Error('Authorization expired. Reconnect this source.');error.status=401;throw error;}
    if(response.status===429) {const error=new Error('Provider rate limit reached. Automatic refresh will wait at least five minutes.');error.retryAfterMs=Math.max(300_000,(Number(response.headers?.get('Retry-After'))||0)*1000);throw error;}
    throw new Error(`Provider request failed (${response.status}). Try again later.`);
  }
  return response.json();
}
export function normalizeGmail(message,accountId,now) {
  if(typeof message.id!=='string' || !message.id) throw new Error('Gmail returned a message without an ID.');
  return {itemId:itemId('personal','gmail',accountId,message.id),sourceId:`gmail:${accountId}`,source:'gmail',accountId,category:'email',title:'Inbox message',readState:message.labelIds?.includes('UNREAD')?'unread':'read',updatedAt:Number(message.internalDate)||now,revision:now};
}
export async function fetchGmailInbox(token,{fetcher=fetch,now=Date.now(),signal}={}) {
  const base='https://gmail.googleapis.com/gmail/v1/users/me';
  const options={fetcher,signal,headers:{Authorization:`Bearer ${token}`}};
  const profile=await fetchJSON(`${base}/profile?fields=emailAddress`,options);
  if(typeof profile.emailAddress!=='string') throw new Error('Gmail account identity was unavailable.');
  const ids=new Set(); let pageToken=''; const pages=new Set();
  do {
    const params=new URLSearchParams({labelIds:'INBOX',maxResults:'500',fields:'messages/id,nextPageToken'});
    if(pageToken) params.set('pageToken',pageToken);
    const page=await fetchJSON(`${base}/messages?${params}`,options);
    for(const message of page.messages??[]) ids.add(message.id);
    if(ids.size>2000) throw new Error('Inbox exceeds this pilot’s 2,000-message limit. Existing birds were kept; no partial snapshot was applied.');
    pageToken=page.nextPageToken??'';
    if(pageToken && pages.has(pageToken)) throw new Error('Gmail repeated a page. Retry the complete refresh.');
    pages.add(pageToken);
  } while(pageToken);
  const list=[...ids]; const items=[];
  // A small concurrency window keeps large inboxes from flooding the API.
  for(let offset=0;offset<list.length;offset+=8) {
    const batch=await Promise.all(list.slice(offset,offset+8).map(async id=>{
      const message=await fetchJSON(`${base}/messages/${encodeURIComponent(id)}?format=minimal&fields=id,labelIds,internalDate`,options);
      return message.labelIds?.includes('INBOX')?normalizeGmail(message,profile.emailAddress,now):null;
    }));
    items.push(...batch.filter(Boolean));
  }
  return {sourceId:`gmail:${profile.emailAddress}`,accountId:profile.emailAddress,items};
}
export function normalizeLastfm(data,username,now=Date.now()) {
  if(data.error) throw new Error('Last.fm could not read this user. Check the API key and username.');
  if(!data.recenttracks) throw new Error('Last.fm returned an unexpected response.');
  const tracks=Array.isArray(data.recenttracks.track)?data.recenttracks.track:data.recenttracks.track?[data.recenttracks.track]:[];
  const source=`lastfm:${username.toLowerCase()}`;
  const current=tracks.find(track=>track['@attr']?.nowplaying==='true');
  const artist=track=>String(track.artist?.['#text']??track.artist?.name??'').slice(0,160);
  const changes=tracks.filter(track=>Number(track.date?.uts)>0).map(track=>{
    const occurredAt=Number(track.date.uts)*1000;
    return {eventId:itemId(source,track.date.uts,artist(track),track.name),sourceId:source,itemId:'',type:'activity',revision:occurredAt,occurredAt,expiresAt:occurredAt+90_000};
  });
  return {items:[],changes,listening:{source,observedAt:now,expiresAt:now+90_000,playing:Boolean(current),artist:current?artist(current):'',track:current?String(current.name).slice(0,160):''}};
}
export async function fetchLastfm(username,key,options={}) {
  const url=new URL('https://ws.audioscrobbler.com/2.0/');
  url.search=new URLSearchParams({method:'user.getRecentTracks',user:username,api_key:key,format:'json',limit:'10'});
  return normalizeLastfm(await fetchJSON(url.href,options),username,options.now??Date.now());
}
export async function searchLocations(query,options={}) {
  const url=new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.search=new URLSearchParams({name:query,count:'5',language:'en',format:'json'});
  const data=await fetchJSON(url.href,options);
  return (data.results??[]).map(location=>({id:location.id,name:location.name,region:location.admin1??'',country:location.country??'',latitude:location.latitude,longitude:location.longitude}));
}
export function normalizeWeather(data,location,now=Date.now()) {
  const c=data.current;
  if(!c || !Number.isFinite(Number(c.time)) || !Number.isFinite(c.temperature_2m)) throw new Error('Weather observations were unavailable.');
  const observedAt=Number(c.time)*1000;
  if(observedAt>now+600_000 || now-observedAt>1_800_000) throw new Error('Weather observation is stale. Try again later.');
  return {source:'open-meteo',observedAt,expiresAt:observedAt+1_800_000,location:location.name,temperatureC:c.temperature_2m,cloudCover:Math.max(0,Math.min(1,(c.cloud_cover??0)/100)),windKph:Math.max(0,Math.min(250,c.wind_speed_10m??0)),windDirection:c.wind_direction_10m??0,isDay:c.is_day===1,precipitationMm:c.precipitation??0,weatherCode:c.weather_code??0};
}
export async function fetchWeather(location,options={}) {
  if(!Number.isFinite(location.latitude)||!Number.isFinite(location.longitude)) throw new Error('Choose a location first.');
  const url=new URL('https://api.open-meteo.com/v1/forecast');
  url.search=new URLSearchParams({latitude:String(location.latitude),longitude:String(location.longitude),current:'temperature_2m,is_day,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m',timeformat:'unixtime',timezone:'UTC',forecast_days:'1'});
  return normalizeWeather(await fetchJSON(url.href,options),location,options.now??Date.now());
}
