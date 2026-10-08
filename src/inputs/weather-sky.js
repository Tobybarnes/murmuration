const photo=(id,condition,photographer,slug)=>({
  condition,photographer,url:`https://images.unsplash.com/${id}?auto=format&fit=crop&w=1920&q=80`,
  source:`https://unsplash.com/photos/${slug}?utm_source=murmuration&utm_medium=referral`,
});
export const WEATHER_PHOTOS = {
  clear:photo('photo-1625898383203-3980ac9f3a10','Clear skies','CHUTTERSNAP','white-clouds-and-blue-sky-PRQsqtr3hIE'),
  sun:photo('photo-1594860848653-667197625bcc','Sunshine','CHUTTERSNAP','white-clouds-and-blue-sky-during-daytime-m6ownudLtjc'),
  cloud:photo('photo-1501630834273-4b5604d2ee31','Cloudy skies','Billy Huynh','cloudy-sky-at-daytime-v9bnfMCyKbg'),
  rain:photo('photo-1769411972457-e89bb3350ac6','Rain / storm clouds','engin akyurt','dark-storm-clouds-gathering-in-the-sky-jYjuUXgi2NU'),
  snow:photo('photo-1769093577761-f048fd57fd7b','Snowfall','Liana S','snow-falling-against-a-sunset-sky-Db3iMYzCqJI'),
  fog:photo('photo-1485800027848-f469cc05bff0','Fog','Nathan Anderson','birds-eye-view-of-road-with-thick-fog-during-daytime-8XVhIdy9y7k'),
  night:photo('photo-1548242291-8b7147c140c0','Night sky','Aperture Vintage','a-night-sky-filled-with-lots-of-stars-wPdudbaEEOA'),
};

export function weatherSkyKind(weather,now=Date.now()) {
  if(!weather||!Number.isFinite(weather.expiresAt)||weather.expiresAt<=now)return null;
  const code=weather.weatherCode;
  if([71,73,75,77,85,86].includes(code))return 'snow';
  if([45,48].includes(code))return 'fog';
  if([51,53,55,56,57,61,63,65,66,67,80,81,82,95,96,99].includes(code))return 'rain';
  if(code===2||code===3||weather.cloudCover>=.55)return 'cloud';
  if(weather.isDay===false)return 'night';
  return code===1||weather.cloudCover>=.18?'clear':'sun';
}

export function mountWeatherSky({onVisible=()=>{}}={}) {
  const images=[...document.querySelectorAll('#weather-sky img')];
  const label=document.getElementById('sky-condition');
  const credit=document.getElementById('sky-credit');
  const toggle=document.getElementById('photo-toggle');
  let enabled=true,active=false,current=null,epoch=0,slot=0,visible=false,loadingKind=null,failedKind=null,retryAt=0;
  const setVisible=next=>{visible=next;document.body.classList.toggle('has-weather-photo',next);onVisible(next);};
  toggle.addEventListener('click',()=>{enabled=!enabled;toggle.setAttribute('aria-pressed',String(enabled));update(current,active,true);});
  function update(weather,publicMode,force=false) {
    current=weather;active=publicMode;
    const kind=weatherSkyKind(weather),asset=kind?WEATHER_PHOTOS[kind]:null;
    document.body.classList.toggle('weather-night',Boolean(publicMode&&weather?.isDay===false&&kind&&kind!=='night'));
    label.textContent=asset?.condition??'Reading weather…';
    toggle.hidden=!publicMode;
    if(!asset||!enabled||!active) {
      epoch++;loadingKind=null;for(const image of images)image.classList.remove('is-active');credit.hidden=true;
      setVisible(false);return;
    }
    if(!force&&images[slot].dataset.kind===kind&&visible)return;
    if(!force&&failedKind===kind&&Date.now()<retryAt){label.textContent=`${asset.condition} · photo unavailable`;return;}
    if(!force&&loadingKind===kind)return;
    loadingKind=kind;
    const request=++epoch,index=(slot+1)%images.length,image=images[index];
    image.onload=()=>{
      if(request!==epoch||!enabled||!active)return;
      loadingKind=null;failedKind=null;
      images[slot].classList.remove('is-active');slot=index;image.classList.add('is-active');
      credit.textContent=`${asset.photographer} / Unsplash · weather illustration`;credit.href=asset.source;credit.hidden=false;
      setVisible(true);
    };
    image.onerror=()=>{if(request!==epoch)return;loadingKind=null;failedKind=kind;retryAt=Date.now()+300_000;credit.hidden=true;label.textContent=`${asset.condition} · photo unavailable`;for(const value of images)value.classList.remove('is-active');setVisible(false);};
    image.dataset.kind=kind;image.src=asset.url;
  }
  return {update};
}
