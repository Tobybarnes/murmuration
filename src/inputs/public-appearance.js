export const PUBLIC_TYPES = [
  {id:'news',name:'News',shape:'circle',dark:'#df9878',light:'#965038'},
  {id:'social',name:'Social',shape:'square',dark:'#b6c5a0',light:'#4d6c43'},
  {id:'music',name:'Music',shape:'triangle',dark:'#dcc47d',light:'#886921'},
  {id:'quakes',name:'Earthquakes',shape:'diamond',dark:'#d0a3a6',light:'#944f65'},
  {id:'weather',name:'Weather',shape:'sky',dark:'#abc4c8',light:'#48676d'},
];
export function publicType(source) {
  return ({news:'news','hacker-news':'news',bluesky:'social',usgs:'quakes',lastfm:'music',listenbrainz:'music',weather:'weather'})[source] || null;
}
export function typeStyle(type,light=false) {
  const style=PUBLIC_TYPES.find(value=>value.id===type);
  return style?{...style,colour:light?style.light:style.dark}:null;
}

// A larger invisible hit area makes moving nodes selectable without enlarging
// their marks. Resolve overlaps by distance, then foreground depth.
export function hitPublicNode(birds,x,y,reach=22) {
  if(!Number.isFinite(x)||!Number.isFinite(y))return null;
  let selected=null,best=Infinity;
  for(const bird of birds) {
    if(!bird.publicType)continue;
    const distance=Math.hypot(bird.x-x,bird.y-y);
    if(distance>Math.max(reach,bird.radius+8))continue;
    if(distance<best || (distance===best && bird.z<selected.z)) {selected=bird;best=distance;}
  }
  return selected?.birdId??null;
}

export function safePublicURL(value) {
  try {const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;} catch {return null;}
}
