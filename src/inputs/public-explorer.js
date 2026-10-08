import {PUBLIC_TYPES,publicType,typeStyle,safePublicURL} from './public-appearance.js';
import {PUBLIC_CITIES} from './public-providers.js';

const time=value=>Number.isFinite(value)?new Date(value).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'Not reported';
const statusLabel={idle:'Waiting',loading:'Refreshing',live:'Current',stale:'Stale',unavailable:'Unavailable'};

export function mountPublicExplorer({onSelect=()=>{},onCity=()=>{},onOpen=()=>{}}={}) {
  const legend=document.getElementById('public-legend');
  const panel=document.getElementById('node-details');
  const city=document.getElementById('scene-city');
  const buttons=new Map();
  let state=null,selectedType=null,selectedId=null,lastRecord=null,signature='';
  for(const location of PUBLIC_CITIES) {const option=document.createElement('option');option.value=location.id;option.textContent=location.name;city.append(option);}
  city.addEventListener('change',()=>onCity(city.value));
  for(const type of PUBLIC_TYPES) {
    const button=document.createElement('button');button.type='button';button.dataset.type=type.id;button.className='legend-entry';button.setAttribute('aria-pressed','false');
    const mark=document.createElementNS('http://www.w3.org/2000/svg','svg');mark.setAttribute('class','type-mark');mark.setAttribute('viewBox','0 0 12 12');mark.setAttribute('aria-hidden','true');
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',({circle:'M10 6a4 4 0 1 1-8 0a4 4 0 1 1 8 0',square:'M2 2h8v8H2z',triangle:'M6 1.5 10.5 10H1.5z',diamond:'M6 1 11 6 6 11 1 6z',sky:'M10 6a4 4 0 1 1-8 0a4 4 0 1 1 8 0'})[type.shape]);mark.append(path);
    const name=document.createElement('span');name.textContent=type.name;
    const count=document.createElement('span');count.className='legend-count';
    button.append(mark,name,count);button.addEventListener('click',()=>selectType(type.id));legend.append(button);buttons.set(type.id,{button,count});
  }
  const $=id=>document.getElementById(id);
  const records=()=>state?.sources?.flatMap(source=>(source.records??[]).map(record=>({...record,feedId:source.id,status:source.status,checkedAt:source.lastSeenAt})))??[];
  function show() {panel.hidden=false;panel.classList.add('is-open');onOpen();$('detail-close').focus();}
  function close({focus=true}={}) {
    panel.hidden=true;panel.classList.remove('is-open');selectedId=null;selectedType=null;lastRecord=null;signature='';onSelect(null);
    for(const {button} of buttons.values())button.setAttribute('aria-pressed','false');
    if(focus)document.getElementById('flock').focus();
  }
  $('detail-close').addEventListener('click',()=>close());
  panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();close();}});
  $('detail-back').addEventListener('click',()=>selectType(selectedType));
  function selectType(type) {
    if(state?.mode!=='public')return;
    selectedType=type;selectedId=null;lastRecord=null;signature='';onSelect(null);
    render();show();
  }
  function selectItem(id) {
    const record=records().find(value=>value.itemId===id);
    const item=state?.items.find(value=>value.itemId===id);
    if(!record||!item)return;
    selectedId=id;selectedType=publicType(item.source);lastRecord=record;signature='';onSelect(id);
    render();show();
  }
  function render() {
    for(const [id,{button}] of buttons)button.setAttribute('aria-pressed',String(id===selectedType));
    if(!selectedType||!state)return;
    panel.dataset.type=selectedType;
    const type=typeStyle(selectedType);
    $('detail-kind').textContent=type?.name??'Public item';
    $('detail-back').hidden=!selectedId;
    $('detail-list').hidden=Boolean(selectedId)||selectedType==='weather';
    $('detail-item').hidden=!selectedId&&selectedType!=='weather';
    const source=state.sources?.find(value=>value.id===selectedType);
    $('detail-status').textContent=statusLabel[source?.status]??'Waiting';
    if(selectedId) {
      const current=records().find(record=>record.itemId===selectedId);
      const item=state.items.find(value=>value.itemId===selectedId);
      const record=current??lastRecord;
      if(!record)return;
      lastRecord=record;
      $('detail-title').textContent=record.title;
      $('detail-copy').textContent=record.summary||'Open the original source for the full story.';
      $('detail-meta').textContent=[record.publisher,time(record.occurredAt)].filter(Boolean).join(' · ');
      $('detail-extra').textContent=[record.rank?`Rank ${record.rank}`:'',Number.isFinite(record.playcount)?`${record.playcount.toLocaleString()} chart plays`:'',Number.isFinite(record.listeners)?`${record.listeners.toLocaleString()} listeners`:'',record.period||''].filter(Boolean).join(' · ');
      $('detail-availability').textContent=item?'This node follows the live feed.': 'This item has left the latest feed. Its last details are kept here.';
      $('detail-status').textContent=item?(statusLabel[source?.status]??'Current'):'Left the feed';
      const url=safePublicURL(record.url);$('detail-link').hidden=!url;if(url)$('detail-link').href=url;
      $('detail-link').textContent=selectedType==='music'?'View on the music source ↗':selectedType==='social'?'Read the post ↗':selectedType==='quakes'?'View the event ↗':'Read the story ↗';
    } else if(selectedType==='weather') {
      const weather=state.environment?.weather;
      $('detail-title').textContent=state.city?.name??'Weather';
      $('detail-copy').textContent=weather?`${Math.round(weather.temperatureC)}°C · ${Math.round(weather.cloudCover*100)}% cloud · wind ${Math.round(weather.windKph)} km/h. ${weather.isDay?'Daylight':'Nighttime'} at the selected location.`:(source?.message??'Reading the current weather…');
      $('detail-meta').textContent=weather?`Open-Meteo · observed ${time(weather.observedAt)}`:'';
      $('detail-extra').textContent=weather?`Precipitation ${weather.precipitationMm} mm · ${document.getElementById('sky-condition').textContent}`:'';
      $('detail-availability').textContent='Weather changes the sky and flock movement. The photograph illustrates the conditions; it is not a live camera of this city.';
      $('detail-link').hidden=false;$('detail-link').href='https://open-meteo.com/';$('detail-link').textContent='Weather source ↗';
    } else {
      const all=records().filter(record=>record.feedId===selectedType);
      const visible=new Set(state.items.map(item=>item.itemId));
      const values=all.filter(record=>visible.has(record.itemId));
      $('detail-title').textContent=type.name;
      $('detail-copy').textContent=(source?.message??'Reading the public feed…')+(all.length>values.length?` Showing the latest ${values.length} of ${all.length} items to keep the flock near 100 nodes.`:'');
      $('detail-meta').textContent=source?.lastSeenAt?`Checked ${time(source.lastSeenAt)} · ${values.length} nodes`:'';
      const next=JSON.stringify(values.map(record=>[record.itemId,record.title,record.occurredAt]));
      if(signature===next)return;signature=next;
      $('detail-list').replaceChildren();
      for(const record of values) {
        const button=document.createElement('button');button.type='button';button.className='detail-record';button.dataset.itemId=record.itemId;
        const title=document.createElement('span');title.textContent=record.title;
        const meta=document.createElement('small');meta.textContent=[record.publisher,time(record.occurredAt)].filter(Boolean).join(' · ');
        button.append(title,meta);button.addEventListener('click',()=>selectItem(record.itemId));$('detail-list').append(button);
      }
      if(!values.length){const p=document.createElement('p');p.textContent=source?.status==='unavailable'?'The feed is unavailable. Existing data is kept when possible.':'No items in this feed yet.';$('detail-list').append(p);}
    }
  }
  function update(next) {
    state=next;legend.hidden=state.mode!=='public';$('weather-controls').hidden=state.mode!=='public';
    if(state.mode!=='public'){if(!panel.hidden)close({focus:false});return;}
    if(state.city)city.value=state.city.id;
    for(const [id,{count}] of buttons)count.textContent=id==='weather'?(state.environment?.weather?`${Math.round(state.environment.weather.temperatureC)}°`:'…'):String(state.items.filter(item=>publicType(item.source)===id).length);
    render();
  }
  return {update,selectItem,selectType,close};
}
