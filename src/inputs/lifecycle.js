// A page restored from the back-forward cache keeps its source session, but
// must restart polling and recheck expiry. Never leave an old interval running.
export function createSourceLifecycle({tick,suspend,dispose,interval=1000,host=window,page=document,timers=globalThis}) {
  let timer=null,closed=false;
  const visibleTick=()=>{if(!closed&&!page.hidden)tick();};
  function start(){if(timer===null&&!closed)timer=timers.setInterval(visibleTick,interval);}
  function stop(){if(timer!==null){timers.clearInterval(timer);timer=null;}}
  function onHide(event){
    stop();suspend();
    if(!event.persisted){closed=true;dispose();}
  }
  function onShow(event){if(event.persisted&&!closed){start();visibleTick();}}
  host.addEventListener('pagehide',onHide);
  host.addEventListener('pageshow',onShow);
  page.addEventListener('visibilitychange',visibleTick);
  start();
  return ()=>{
    stop();
    if(!closed){closed=true;suspend();dispose();}
    host.removeEventListener('pagehide',onHide);
    host.removeEventListener('pageshow',onShow);
    page.removeEventListener('visibilitychange',visibleTick);
  };
}
