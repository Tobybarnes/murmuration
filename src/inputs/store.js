const CATEGORIES = new Set(['email', 'agents', 'other']);
const READ_STATES = new Set(['read', 'unread', 'unknown']);
const MAX_ITEMS = 2000;
const text = (value, limit = 240) => typeof value === 'string' ? value.slice(0, limit) : '';
const finite = value => typeof value === 'number' && Number.isFinite(value);
export const itemId = (...parts) => parts.map(part => encodeURIComponent(String(part))).join(':');

export function normalizeItem(value) {
  if (!value || !text(value.itemId) || !text(value.sourceId) || !CATEGORIES.has(value.category)) throw new Error('Each item needs an itemId, sourceId and valid category.');
  return { itemId:text(value.itemId, 600), sourceId:text(value.sourceId, 400), source:text(value.source, 50), accountId:text(value.accountId, 200), category:value.category, title:text(value.title) || 'Untitled item', readState:READ_STATES.has(value.readState)?value.readState:'unknown', updatedAt:finite(value.updatedAt)?value.updatedAt:0, revision:finite(value.revision)?value.revision:0 };
}
function normalizeChange(value) {
  if (!value || !text(value.eventId) || !text(value.sourceId) || !['upsert','remove','activity'].includes(value.type) || !finite(value.revision)) throw new Error('Each change needs eventId, sourceId, type and numeric revision.');
  const change = { eventId:text(value.eventId,800), sourceId:text(value.sourceId,400), itemId:text(value.itemId,600), type:value.type, revision:value.revision, occurredAt:finite(value.occurredAt)?value.occurredAt:0, expiresAt:finite(value.expiresAt)?value.expiresAt:0 };
  if (change.type !== 'activity' && !change.itemId) throw new Error('Item changes need an itemId.');
  if (value.type === 'upsert') {
    change.item = normalizeItem(value.item);
    if(change.item.itemId !== change.itemId || change.item.sourceId !== change.sourceId) throw new Error('Change and item source identity must match.');
  }
  return change;
}
function cleanEnvironment(kind, value) {
  if (!value) return null;
  if(!finite(value.observedAt) || !finite(value.expiresAt) || value.expiresAt <= value.observedAt) throw new Error('Environment needs observation and expiry times.');
  const common = { source:text(value.source,400), observedAt:value.observedAt, expiresAt:value.expiresAt };
  const n=(v,lo,hi,fallback=0)=>finite(v)?Math.max(lo,Math.min(hi,v)):fallback;
  if(kind==='weather') return { ...common,location:text(value.location,160),temperatureC:n(value.temperatureC,-100,70),cloudCover:n(value.cloudCover,0,1),windKph:n(value.windKph,0,250),windDirection:n(value.windDirection,0,360),isDay:value.isDay !== false,precipitationMm:n(value.precipitationMm,0,200),weatherCode:n(value.weatherCode,0,99) };
  if(kind==='listening') return { ...common, artist:text(value.artist,160),track:text(value.track,160),playing:value.playing===true };
  throw new Error('Unknown environment kind.');
}

export function createInputStore() {
  let items = new Map(), versions = new Map(), seen = new Map();
  const sources = new Map(), snapshotVersions = new Map();
  const environment = {weather:null,listening:null};
  let changes = [];
  function applyChanges(incoming, now = Date.now()) {
    const normalized = incoming.map(normalizeChange);
    // Build the next state first: a bad or oversized batch must not partially
    // change either the flock or its deduplication history.
    const nextItems = new Map(items), nextVersions = new Map(versions), nextSeen = new Map(seen);
    const nextChanges = [];
    for (const change of normalized) {
      const eventKey = itemId(change.sourceId, change.eventId);
      if(nextSeen.has(eventKey)) continue;
      nextSeen.set(eventKey,change.sourceId);
      // Bounded dedup memory; per-item versions still reject old item mutations.
      if(nextSeen.size>20000) nextSeen.delete(nextSeen.keys().next().value);
      const existing=nextItems.get(change.itemId);
      const version=nextVersions.get(change.itemId);
      if(existing && existing.sourceId !== change.sourceId) continue;
      if(change.type!=='activity' && change.revision <= (snapshotVersions.get(change.sourceId)??-Infinity)) continue;
      if(version && (version.sourceId !== change.sourceId || change.revision <= version.revision)) continue;
      if(change.type==='upsert') {
        nextItems.set(change.itemId, {...change.item,revision:change.revision});
        nextVersions.set(change.itemId,{sourceId:change.sourceId,revision:change.revision});
      } else if(change.type==='remove') {
        nextItems.delete(change.itemId);
        nextVersions.set(change.itemId,{sourceId:change.sourceId,revision:change.revision});
      }
      if(change.expiresAt>now) nextChanges.push(change);
    }
    if(nextItems.size>MAX_ITEMS) throw new Error('This pilot supports up to 2,000 items.');
    items=nextItems;versions=nextVersions;seen=nextSeen;
    changes=[...changes,...nextChanges].filter(change=>change.expiresAt>now).slice(-500);
  }
  function applySnapshot(sourceId, incoming, {revision,now=Date.now()}={}) {
    if(!finite(revision)) throw new Error('Snapshot revision must be numeric.');
    const normalized=incoming.map(normalizeItem);
    if(normalized.some(item=>item.sourceId!==sourceId)) throw new Error('Snapshot contains another source.');
    if(revision <= (snapshotVersions.get(sourceId)??-Infinity)) return false;
    if(new Set(normalized.map(item=>item.itemId)).size!==normalized.length) throw new Error('Snapshot has duplicate item IDs.');
    if(normalized.some(item=>versions.has(item.itemId) && versions.get(item.itemId).sourceId!==sourceId)) throw new Error('Snapshot cannot claim another source’s item ID.');
    const knownSource=snapshotVersions.has(sourceId)||[...versions.values()].some(version=>version.sourceId===sourceId);
    const next=new Set(normalized.map(item=>item.itemId));
    const updates=[];
    for(const item of items.values()) if(item.sourceId===sourceId && !next.has(item.itemId)) updates.push({eventId:`snapshot:${sourceId}:${revision}:remove:${item.itemId}`,sourceId,itemId:item.itemId,type:'remove',revision,occurredAt:now,expiresAt:now+5000});
    for(const item of normalized) {
      const previous=items.get(item.itemId);
      const version=versions.get(item.itemId);
      if(version && revision<=version.revision) continue;
      const changed=!previous || ['title','category','readState','updatedAt'].some(key=>previous[key]!==item[key]);
      if(changed) updates.push({eventId:`snapshot:${sourceId}:${revision}:upsert:${item.itemId}`,sourceId,itemId:item.itemId,item,type:'upsert',revision,occurredAt:now,expiresAt:knownSource?now+5000:0});
    }
    applyChanges(updates,now);
    for(const item of normalized) {
      const version=versions.get(item.itemId);
      if(!version || revision>version.revision) {
        versions.set(item.itemId,{sourceId,revision});
        items.set(item.itemId,{...items.get(item.itemId),revision});
      }
    }
    snapshotVersions.set(sourceId,revision);
    return true;
  }
  function setEnvironment(kind,value) {
    const next=cleanEnvironment(kind,value);
    if(next && environment[kind] && next.observedAt<environment[kind].observedAt) return;
    environment[kind]=next;
  }
  function forgetSource(sourceId) {
    for(const [id,item] of items) if(item.sourceId===sourceId) items.delete(id);
    for(const [id,version] of versions) if(version.sourceId===sourceId) versions.delete(id);
    for(const [id,source] of seen) if(source===sourceId) seen.delete(id);
    for(const kind of Object.keys(environment)) if(environment[kind]?.source===sourceId) environment[kind]=null;
    changes=changes.filter(change=>change.sourceId!==sourceId);
    snapshotVersions.delete(sourceId); sources.delete(sourceId);
  }
  return {applyChanges,applySnapshot,setEnvironment,forgetSource,
    setSourceState(sourceId,state) {sources.set(sourceId,{...sources.get(sourceId),...state,sourceId});},
    getState(now=Date.now()) {return {items:[...items.values()],changes:changes.filter(change=>change.expiresAt>now),environment:Object.fromEntries(Object.entries(environment).map(([kind,value])=>[kind,value && value.expiresAt>now?{...value}:null])),sources:[...sources.values()]};}
  };
}

export function parseFixture(json) {
  if(typeof json!=='string' || json.length>1_000_000) throw new Error('Fixture must be a JSON file smaller than 1 MB.');
  let data; try {data=JSON.parse(json);} catch {throw new Error('Could not read fixture JSON.');}
  if(data?.version!==1 || !Array.isArray(data.items) || data.items.length>MAX_ITEMS) throw new Error('Fixture needs version 1 and at most 2,000 items.');
  const items=data.items.map(normalizeItem);
  if(new Set(items.map(item=>item.itemId)).size!==items.length) throw new Error('Fixture has duplicate item IDs.');
  if(data.changes && (!Array.isArray(data.changes) || data.changes.length>2000)) throw new Error('Too many fixture changes.');
  const changes=(data.changes??[]).map(normalizeChange);
  const environment={weather:null,listening:null};
  for(const kind of Object.keys(environment)) environment[kind]=cleanEnvironment(kind,data.environment?.[kind]);
  return {version:1,items,changes,environment};
}
export function exportFixture(state) {
  return JSON.stringify({version:1,items:state.items.map(normalizeItem),changes:[],environment:{weather:cleanEnvironment('weather',state.environment.weather),listening:cleanEnvironment('listening',state.environment.listening)}},null,2);
}
