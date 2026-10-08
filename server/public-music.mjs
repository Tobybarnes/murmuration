const URL='https://api.listenbrainz.org/1/stats/sitewide/recordings?range=this_week&count=10';
const USER_AGENT='Murmuration/0.1 (https://github.com/Tobybarnes/murmuration)';

// A fixed public chart, with no account IDs, tokens or arbitrary proxy target.
// Identify the app to ListenBrainz and share a cached response between viewers.
export function createPublicMusicHandler({fetcher=fetch,clock=Date.now}={}) {
  let cached=null,expiresAt=0,inflight=null,retryAt=0;
  async function load() {
    if(cached&&clock()<expiresAt)return cached;
    if(inflight)return inflight;
    if(clock()<retryAt)throw new Error('Public music is temporarily unavailable.');
    retryAt=clock()+30_000;
    inflight=(async()=>{
      const response=await fetcher(URL,{headers:{'User-Agent':USER_AGENT,Accept:'application/json'},signal:AbortSignal.timeout(15_000)});
      if(!response.ok)throw new Error('Public music provider is unavailable.');
      const data=await response.json(),p=data?.payload;
      if(!Array.isArray(p?.recordings)||!Number.isFinite(p.last_updated)||p.last_updated*1000>clock()+600_000||clock()-p.last_updated*1000>259_200_000)throw new Error('Public music chart is unavailable or stale.');
      cached={payload:{last_updated:p.last_updated,from_ts:p.from_ts,to_ts:p.to_ts,recordings:p.recordings.slice(0,10).map(record=>({artist_name:record.artist_name,track_name:record.track_name,recording_mbid:record.recording_mbid,listen_count:record.listen_count}))}};
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
