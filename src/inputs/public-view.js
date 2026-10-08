import {PUBLIC_FEEDS,PUBLIC_CITIES} from './public-providers.js';
import {safePublicURL} from './public-appearance.js';

export const publicMarkup = `
<section class="source-card public-card" id="public-world" hidden>
  <div class="source-card-heading"><h3>The public world</h3><span class="source-badge">No accounts needed</span></div>
  <p>Stories, public posts, earthquakes and community music become birds. New items arrive; items leaving each feed leave the flock. Weather changes the atmosphere.</p>
  <label for="public-city">Weather in</label>
  <select id="public-city">${PUBLIC_CITIES.map(city=>`<option value="${city.id}">${city.name}</option>`).join('')}</select>
  <p class="source-status">Refreshes while Public world is selected and this tab is visible. A failed feed keeps its last birds and shows the error.</p>
  <div class="public-feeds">${PUBLIC_FEEDS.map(feed=>`
    <section class="public-feed" aria-label="${feed.name}">
      <div class="source-card-heading"><h3>${feed.name}</h3><span id="public-${feed.id}-badge" class="source-badge">Waiting</span></div>
      <p id="public-${feed.id}-status" class="source-status">Reading public data…</p>
      <p id="public-${feed.id}-time" class="public-time"></p>
      <a id="public-${feed.id}-provider" href="${feed.url}" target="_blank" rel="noopener noreferrer">${feed.provider} ↗</a>
      <details><summary>View latest items</summary><ul id="public-${feed.id}-items" class="public-items"></ul></details>
    </section>`).join('')}</div>
  <p class="source-status">Social uses the selected @bsky.app account, including reposts. X / Twitter requires paid API setup. Music charts are checked hourly; their counts are not last-hour plays. Last.fm needs a server API key; otherwise the weekly ListenBrainz chart is shown. No audio plays.</p>
</section>`;

const labels={idle:'Waiting',loading:'Refreshing',live:'Current',stale:'Stale',unavailable:'Unavailable'};
const time=value=>new Date(value).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});

export function createPublicView(panel) {
  const cache=new Map();
  function update(state) {
    if(state.city)panel.querySelector('#public-city').value=state.city.id;
    for(const source of state.sources) {
      const badge=panel.querySelector(`#public-${source.id}-badge`);
      if(!badge)continue;
      badge.textContent=state.active?labels[source.status]:'Paused';
      badge.dataset.status=source.status;
      panel.querySelector(`#public-${source.id}-status`).textContent=source.status==='stale'?'Last data is stale. Waiting for a fresh response.':source.message;
      const timing=panel.querySelector(`#public-${source.id}-time`);
      timing.textContent=source.lastSeenAt?`Checked ${time(source.lastSeenAt)} · ${(source.timestampLabel??'Source updated').toLowerCase()} ${time(source.reportedAt??source.observedAt)}.`:'';
      if(source.id==='music'&&source.musicMeta){
        const provider=panel.querySelector('#public-music-provider');
        const lastfm=source.musicMeta.provider==='Last.fm';
        provider.textContent=`${lastfm?'Last.fm':'ListenBrainz · weekly fallback'} ↗`;
        provider.href=lastfm?'https://www.last.fm/charts':'https://listenbrainz.org/statistics/';
      }
      // Keep the focused link stable when periodic state notifications arrive.
      const signature=JSON.stringify(source.records);
      if(cache.get(source.id)===signature)continue;
      cache.set(source.id,signature);
      const list=panel.querySelector(`#public-${source.id}-items`);
      list.replaceChildren();
      for(const record of source.records.slice(0,5)) {
        const li=document.createElement('li'),link=document.createElement('a');
        const url=safePublicURL(record.url);
        if(!url)continue;
        link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=record.title;
        li.append(link);list.append(li);
      }
      if(!source.records.length){const li=document.createElement('li');li.textContent=source.id==='weather'?'Weather shapes the sky without adding birds.':'No items returned yet.';list.append(li);}
    }
  }
  return {update};
}
