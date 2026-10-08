import {createInputStore} from './store.js';
import {PUBLIC_FEEDS,PUBLIC_CITIES} from './public-providers.js';

// Public signals have their own store and request lifecycle. Personal data never
// enters this store, and only the selected mode makes public network requests.
export function createPublicSession({feeds=PUBLIC_FEEDS,onChange=()=>{},clock=Date.now}={}) {
  const store=createInputStore();
  const states=new Map(feeds.map(feed=>[feed.id,{id:feed.id,status:'idle',message:'Select Public world to start.',lastSeenAt:0,expiresAt:0,nextAt:0,records:[]}]));
  const pending=new Map();
  let active=false,closed=false,epoch=0,city=PUBLIC_CITIES[0];
  function getState(now=clock()) {
    return {...store.getState(now),active,city,sources:[...states.values()].map(state=>({...state,
      status:state.status==='live'&&state.expiresAt<=now?'stale':state.status,
    }))};
  }
  const emit=()=>onChange(getState());
  async function refresh(feed) {
    const now=clock(),state=states.get(feed.id);
    if(!active||closed||pending.has(feed.id)||now<state.nextAt)return;
    const requestEpoch=epoch,controller=new AbortController();pending.set(feed.id,controller);
    states.set(feed.id,{...state,status:'loading',message:state.lastSeenAt?'Refreshing public data…':'Reading public data…',nextAt:now+feed.interval});emit();
    try {
      const result=await (feed.id==='weather'?feed.load(city,{signal:controller.signal}):feed.load({signal:controller.signal}));
      if(epoch!==requestEpoch||closed)return;
      const receivedAt=clock();
      if(!Number.isFinite(result.observedAt)||!Number.isFinite(result.expiresAt)||result.expiresAt<=receivedAt) throw new Error('Provider returned a stale observation.');
      store.applySnapshot(result.sourceId,result.items,{revision:receivedAt,now:receivedAt});
      store.applyChanges(result.changes??[],receivedAt);
      for(const [kind,value] of Object.entries(result.environment??{}))store.setEnvironment(kind,value);
      states.set(feed.id,{...states.get(feed.id),status:'live',message:result.summary,lastSeenAt:receivedAt,observedAt:result.observedAt,reportedAt:result.reportedAt,timestampLabel:result.timestampLabel,expiresAt:result.expiresAt,records:result.records??[]});
    } catch(error) {
      // A failed parallel news read must cancel its siblings before the feed's
      // controller leaves the pending map.
      controller.abort();
      if(epoch!==requestEpoch||closed)return;
      states.set(feed.id,{...states.get(feed.id),status:'unavailable',message:error.message+' Previous items remain until a successful refresh.',nextAt:clock()+Math.max(feed.interval,error.retryAfterMs??0)});
    } finally {
      if(epoch===requestEpoch){pending.delete(feed.id);emit();}
    }
  }
  function tick(){if(!active||closed)return;for(const feed of feeds)void refresh(feed);emit();}
  function suspend(){
    active=false;epoch++;
    for(const [id,controller] of pending){controller.abort();const state=states.get(id);states.set(id,{...state,status:state.lastSeenAt?'stale':'idle',nextAt:0,message:'Requests paused. Select Public world to resume.'});}
    pending.clear();emit();
  }
  return {getState,tick,
    start(){if(closed)return;active=true;tick();},
    suspend,
    setCity(id){
      const next=PUBLIC_CITIES.find(value=>value.id===id);
      if(!next||next.id===city.id)return;
      const resume=active;suspend();city=next;store.setEnvironment('weather',null);
      const state=states.get('weather');if(state)states.set('weather',{...state,status:'idle',nextAt:0,lastSeenAt:0,expiresAt:0,records:[],message:'Reading weather for the selected city…'});
      if(resume){active=true;tick();}else emit();
    },
    dispose(){suspend();closed=true;},
  };
}
