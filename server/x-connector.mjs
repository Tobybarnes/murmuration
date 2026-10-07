// Server-only building block. This directory is excluded from the static bundle.
// A host must supply durable owner authentication and an approved provider budget.
export function createXConnector({bearerToken,query,allowPaidRequests=false,authorize,fetcher=fetch}={}) {
  let busy=false;
  return {
    async poll({ownerCredential,sinceId,now=Date.now()}={}) {
      if(!allowPaidRequests) throw new Error('X paid requests are disabled.');
      if(typeof authorize!=='function' || !await authorize(ownerCredential)) throw new Error('Owner authorization is required.');
      if(typeof bearerToken!=='string' || !bearerToken || typeof query!=='string' || !query.trim()) throw new Error('X bearer token and a narrowly scoped query must be configured on the server.');
      if(busy) throw new Error('An X request is already running.');
      const url=new URL('https://api.x.com/2/tweets/search/recent');
      url.search=new URLSearchParams({query:query.trim().slice(0,512),max_results:'10','tweet.fields':'created_at'});
      if(sinceId) {if(!/^\d+$/.test(sinceId))throw new Error('Invalid X cursor.');url.searchParams.set('since_id',sinceId);}
      busy=true;
      try {
        const response=await fetcher(url.href,{headers:{Authorization:`Bearer ${bearerToken}`},signal:AbortSignal.timeout(15000),cache:'no-store'});
        if(!response.ok) throw new Error(`X request failed (${response.status}). Check access and provider quota.`);
        const data=await response.json();
        if(data.errors?.length) throw new Error('X returned an incomplete result; keep the previous cursor.');
        // One explicit poll pays for one request. Never advance the cursor past
        // a page we did not read, and never silently issue more billed calls.
        if(data.meta?.next_token) throw new Error('X returned more than one page. The previous cursor was kept. Narrow the feed or configure an approved pagination budget.');
        const changes=(data.data??[]).map(post=>{
          if(!/^\d+$/.test(post.id)) throw new Error('X returned an invalid post ID.');
          const occurredAt=Date.parse(post.created_at);
          if(!Number.isFinite(occurredAt)) throw new Error('X returned an invalid timestamp.');
          return {eventId:`x:${post.id}`,sourceId:'x:search',itemId:'',type:'activity',revision:occurredAt,occurredAt,expiresAt:Math.min(now+10000,occurredAt+120000)};
        });
        return {changes,cursor:data.meta?.newest_id??sinceId??null};
      } finally {busy=false;}
    }
  };
}
