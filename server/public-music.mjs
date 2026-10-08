const FALLBACK_URL='https://api.listenbrainz.org/1/stats/sitewide/recordings?range=this_week&count=40';
const USER_AGENT='Murmuration/0.1 (https://github.com/Tobybarnes/murmuration)';
const clean=(value,limit=160)=>typeof value==='string'?value.replace(/[\u0000-\u001f]/g,' ').trim().slice(0,limit):'';
const count=value=>Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):null;
function trackURL(value) {
  try {const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.hostname!=='www.last.fm'||url.username||url.password)return '';url.protocol='https:';url.hash='';return url.href;}catch{return '';}
}

export function normalizeLastfmChart(data,observedAt=Date.now()) {
  if(data?.error||!Array.isArray(data?.tracks?.track))throw new Error('Last.fm chart is unavailable.');
  const tracks=data.tracks.track.slice(0,20).map((track,index)=>{
    const artist=clean(track.artist?.name),title=clean(track.name),url=trackURL(track.url);
    if(!artist||!title||!url)throw new Error('Last.fm chart returned an invalid track.');
    return {id:url,artist,title,url,rank:index+1,playcount:count(track.playcount),listeners:count(track.listeners)};
  });
  if(!tracks.length)throw new Error('Last.fm chart returned no tracks.');
  return {provider:'lastfm',observedAt,period:'unspecified',periodLabel:'Last.fm top-tracks chart; counting period not specified by the provider.',tracks,
    musicMeta:{provider:'Last.fm',configuration:'configured',refreshIntervalMs:3_600_000,period:'unspecified',message:'Refreshed hourly. These are chart rankings and provider counts, not plays recorded during the last hour.'}};
}

function normalizeListenBrainz(data,now,fallbackReason,configured) {
  const p=data?.payload;
  if(!Array.isArray(p?.recordings)||!Number.isFinite(p.last_updated)||p.last_updated*1000>now+600_000||now-p.last_updated*1000>259_200_000||!Number.isFinite(p.from_ts)||!Number.isFinite(p.to_ts))throw new Error('Public music chart is unavailable or stale.');
  const tracks=[],seen=new Set();
  for(const [index,record] of p.recordings.slice(0,40).entries()) {
    const artist=clean(record.artist_name),title=clean(record.track_name);
    if(!artist||!title)throw new Error('Public music chart returned an invalid recording.');
    const id=/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(record.recording_mbid??'')?record.recording_mbid:`${encodeURIComponent(artist)}:${encodeURIComponent(title)}`;
    if(seen.has(id))continue;
    seen.add(id);tracks.push({id,artist,title,url:'https://listenbrainz.org/statistics/',rank:index+1,playcount:count(record.listen_count),listeners:null});
    if(tracks.length===20)break;
  }
  if(!tracks.length)throw new Error('Public music chart returned no recordings.');
  return {provider:'listenbrainz',observedAt:p.last_updated*1000,period:'week',fromTs:p.from_ts*1000,toTs:p.to_ts*1000,periodLabel:'ListenBrainz community chart for this week.',tracks,
    musicMeta:{provider:'ListenBrainz',configuration:configured?'lastfm-unavailable':'lastfm-key-needed',refreshIntervalMs:3_600_000,period:'week',fallbackReason,message:configured?'Last.fm is unavailable. Showing the weekly ListenBrainz chart.':'Last.fm needs a server API key. Showing the weekly ListenBrainz chart; these are not plays from the last hour.'}};
}

// Fixed charts only. The optional API key stays on the server; callers cannot
// choose a username, method or proxy target. No music plays in this visualizer.
export function createPublicMusicHandler({fetcher=fetch,clock=Date.now,apiKey=process.env.LASTFM_API_KEY??''}={}) {
  let cached=null,expiresAt=0,inflight=null,retryAt=0;
  async function load() {
    if(cached&&clock()<expiresAt)return cached;
    if(inflight)return inflight;
    if(clock()<retryAt)throw new Error('Public music is temporarily unavailable.');
    retryAt=clock()+30_000;
    inflight=(async()=>{
      const deadline=AbortSignal.timeout(15_000);
      const request=async url=>{
        const response=await fetcher(url,{headers:{'User-Agent':USER_AGENT,Accept:'application/json'},signal:deadline,redirect:'error'});
        if(!response.ok)throw new Error('Public music provider is unavailable.');return response.json();
      };
      let next=null,fallbackReason='Last.fm server API key has not been configured.';
      if(apiKey) {
        const url=new URL('https://ws.audioscrobbler.com/2.0/');
        url.search=new URLSearchParams({method:'chart.getTopTracks',api_key:apiKey,format:'json',limit:'20'});
        try {next=normalizeLastfmChart(await request(url.href),clock());}
        catch {fallbackReason='Last.fm did not return a usable chart.';}
      }
      if(!next)next=normalizeListenBrainz(await request(FALLBACK_URL),clock(),fallbackReason,Boolean(apiKey));
      cached=next;
      expiresAt=clock()+3_600_000;return cached;
    })();
    try{return await inflight;}finally{inflight=null;}
  }
  return async function handler(req,res) {
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options','nosniff');
    if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');res.statusCode=405;res.end(JSON.stringify({error:'Method not allowed.'}));return;}
    try {
      const data=await load();res.setHeader('Cache-Control','public, max-age=60, s-maxage=3600');res.statusCode=200;
      res.end(req.method==='HEAD'?undefined:JSON.stringify(data));
    } catch {
      res.setHeader('Cache-Control','no-store');res.statusCode=503;
      res.end(req.method==='HEAD'?undefined:JSON.stringify({error:'Public music is temporarily unavailable. Try again later.'}));
    }
  };
}
