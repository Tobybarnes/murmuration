import test from 'node:test';
import assert from 'node:assert/strict';
import {hitPublicNode,safePublicURL,publicType} from '../src/inputs/public-appearance.js';
import {createCanvasRenderer,publicMarkerOutline} from '../src/renderers/canvas.js';
import {weatherSkyKind} from '../src/inputs/weather-sky.js';

function recordingContext() {
  const paths=[],rectangles=[];let current=null;
  const command=(name,...values)=>{
    assert.ok(current,`${name} needs a path`);
    assert.ok(values.every(Number.isFinite),`${name} coordinates must be finite`);
    current.commands.push([name,...values]);
  };
  const paint=(kind,style,width)=>{
    assert.ok(current?.commands.length,`${kind} needs geometry`);
    current.paints.push({kind,style,width});
  };
  return {paths,rectangles,globalAlpha:1,
    beginPath(){assert.ok(!current||current.paints.length,'Every path must be painted before beginning another');current={commands:[],paints:[]};paths.push(current);},
    arc(...values){command('arc',...values);},moveTo(...values){command('moveTo',...values);},lineTo(...values){command('lineTo',...values);},rect(...values){command('rect',...values);},
    closePath(){assert.ok(current?.commands.length,'A closed path needs geometry');current.commands.push(['closePath']);},
    stroke(){paint('stroke',this.strokeStyle,this.lineWidth);},fill(){paint('fill',this.fillStyle);},
    fillRect(...values){assert.ok(values.every(Number.isFinite));rectangles.push({kind:'fill',values,style:this.fillStyle});},
    clearRect(...values){assert.ok(values.every(Number.isFinite));rectangles.push({kind:'clear',values});},
  };
}
const colours={bg:[38,57,46],fg:[238,229,210],accent:[196,166,122],hover:[159,172,143]};
function frame(birds,theme=0){return {width:800,height:600,parameters:{theme,trails:0,linkA:0,labels:0,size:5},birds,geometry:[],environment:{}};}
const marker=(kind,index,radius=3)=>({publicType:kind,birdId:`public:${kind}:stable-${index}`,x:100+index*100,y:200+index*20,z:index,radius});

test('the real public renderer draws four different finite shapes and balanced paths without changing bird state',()=>{
  const ctx=recordingContext(),value=frame(['news','social','music','quakes'].map((kind,index)=>marker(kind,index)));
  const before=structuredClone(value);
  createCanvasRenderer(ctx).draw(value,{colours,publicMode:true,connections:false,labels:false});
  assert.deepEqual(value,before);assert.equal(ctx.paths.length,4);
  assert.deepEqual(ctx.paths.map(path=>path.commands.map(command=>command[0])),[
    ['arc'],['rect'],['moveTo','lineTo','lineTo','closePath'],['moveTo','lineTo','lineTo','lineTo','closePath'],
  ]);
  assert.ok(ctx.paths.every(path=>path.paints.map(paint=>paint.kind).join(',')==='stroke,fill,stroke'));
  assert.equal(new Set(ctx.paths.map(path=>path.paints.find(paint=>paint.kind==='fill').style)).size,4);
  assert.ok(ctx.paths[0].commands[0][3]>=4.2,'Small projected circles remain visible');
  assert.equal(ctx.paths[0].commands[0][4],0);assert.equal(ctx.paths[0].commands[0][5],Math.PI*2);
});

test('selection paints two halos only around the selected stable identity and photograph rendering clears the previous frame',()=>{
  const ctx=recordingContext(),birds=[marker('music',0,8),marker('news',1,3)];
  createCanvasRenderer(ctx).draw(frame(birds),{colours,publicMode:true,photo:true,selectedId:birds[0].birdId,connections:false,labels:false});
  assert.equal(ctx.paths.length,4);const innerHalo=ctx.paths[1],outerHalo=ctx.paths[2];
  assert.deepEqual(innerHalo.commands[0].slice(0,3),['arc',birds[0].x,birds[0].y]);
  assert.deepEqual(outerHalo.commands[0].slice(0,3),['arc',birds[0].x,birds[0].y]);
  assert.ok(innerHalo.commands[0][3]>birds[0].radius);assert.equal(outerHalo.commands[0][3]-innerHalo.commands[0][3],2);
  assert.deepEqual(innerHalo.paints.map(paint=>paint.kind),['stroke']);assert.deepEqual(outerHalo.paints.map(paint=>paint.kind),['stroke']);
  assert.equal(ctx.rectangles[0].kind,'clear');assert.match(ctx.rectangles[1].style,/0\.28\)/);
  const unselected=recordingContext();createCanvasRenderer(unselected).draw(frame(birds),{colours,publicMode:true,selectedId:'removed-item',connections:false,labels:false});
  assert.equal(unselected.paths.length,2);
});

test('public hit testing chooses distance before depth, resolves exact overlaps to the foreground stable ID, and ignores nonpublic birds',()=>{
  const a={...marker('news',0),x:100,y:100,z:30},b={...marker('music',1),x:109,y:100,z:-30};
  assert.equal(hitPublicNode([a,b],101,100),a.birdId,'Nearest beats a more distant foreground mark');
  const front={...b,x:100,y:100};assert.equal(hitPublicNode([a,front],100,100),front.birdId);
  assert.equal(hitPublicNode([front,a],100,100),front.birdId,'Depth choice is independent of array order');
  const personal={...a,birdId:'personal:email',publicType:null};assert.equal(hitPublicNode([personal],100,100),null);
  assert.equal(hitPublicNode([a],123,100),null);assert.equal(hitPublicNode([a],122,100),a.birdId,'Boundary hit is included');
  assert.equal(hitPublicNode([a],NaN,100),null);assert.equal(hitPublicNode([a],100,Infinity),null);
  const larger={...a,radius:30};assert.equal(hitPublicNode([larger],135,100),larger.birdId,'Large marks retain their hit area');
  assert.equal(publicType('lastfm'),'music');assert.equal(publicType('listenbrainz'),'music');assert.equal(publicType('gmail'),null);
});

test('detail links accept absolute HTTPS while rejecting executable schemes, credentials and relative paths',()=>{
  assert.equal(safePublicURL('https://www.bbc.com/news/article?ref=flock'),'https://www.bbc.com/news/article?ref=flock');
  for(const value of ['javascript:alert(1)','data:text/html,bad','http://example.com','file:///tmp/data','/relative','https://user:secret@example.com',null,undefined,''])assert.equal(safePublicURL(value),null);
});

function luminance(channels){const linear=channels.map(value=>{const channel=value/255;return channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4;});return .2126*linear[0]+.7152*linear[1]+.0722*linear[2];}
function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
test('marker outline maintains at least 4.5 contrast throughout theme interpolation and across every grey background',()=>{
  const backgrounds=Array.from({length:1001},(_,index)=>[38,57,46].map((value,channel)=>Math.round(value+([238,230,214][channel]-value)*index/1000)));
  backgrounds.push(...Array.from({length:256},(_,index)=>[index,index,index]));
  for(const background of backgrounds){const outline=publicMarkerOutline(background),channels=outline.match(/^rgb\((\d+),(\d+),(\d+)\)$/)?.slice(1).map(Number);assert.ok(channels?.every(value=>value>=0&&value<=255));assert.ok(contrast(background,channels)>=4.5,`${outline} must contrast against ${background}`);}
});

test('weather imagery follows WMO precipitation and fog codes, cloud cover and daylight with expiry taking precedence',()=>{
  const now=1_790_000_000_000,weather={expiresAt:now+1800_000,isDay:true,cloudCover:0,weatherCode:0};
  const kind=(weatherCode,extra={})=>weatherSkyKind({...weather,weatherCode,...extra},now);
  for(const code of [71,73,75,77,85,86]){assert.equal(kind(code),'snow');assert.equal(kind(code,{isDay:false}),'snow');}
  for(const code of [45,48])assert.equal(kind(code),'fog');
  for(const code of [51,53,55,56,57,61,63,65,66,67,80,81,82,95,96,99])assert.equal(kind(code),'rain');
  assert.equal(kind(0),'sun');assert.equal(kind(1),'clear');assert.equal(kind(2),'cloud');assert.equal(kind(3),'cloud');
  assert.equal(kind(0,{cloudCover:.18}),'clear');assert.equal(kind(0,{cloudCover:.55}),'cloud');
  for(const code of [0,1])assert.equal(kind(code,{isDay:false}),'night');
  for(const code of [2,3])assert.equal(kind(code,{isDay:false}),'cloud');
  assert.equal(kind(0,{isDay:false,cloudCover:.87}),'cloud','Cloudy night should not show a clear star field');
  assert.equal(kind(95,{expiresAt:now}),null);assert.equal(kind(0,{expiresAt:now-1}),null);assert.equal(kind(0,{expiresAt:Infinity}),null);assert.equal(weatherSkyKind(null,now),null);
});
