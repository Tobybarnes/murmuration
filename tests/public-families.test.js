import test from 'node:test';
import assert from 'node:assert/strict';
import {createSkyScene} from '../src/scenes/sky.js';

const STEP=1000/60;
const SOURCES=['news','bluesky','listenbrainz','usgs'];
const COUNTS=[50,25,20,5];
const TYPES=['news','social','music','quakes'];
const publicItems=()=>SOURCES.flatMap((source,family)=>Array.from({length:COUNTS[family]},(_,index)=>({
  itemId:`item:${family}:${index}`,sourceId:`public:${source}`,source,
})));

function withSeed(initial,run) {
  let seed=initial;const original=Math.random;
  Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  try{return run();}finally{Math.random=original;}
}
function advance(scene,steps) {
  let time=scene.getState().simTime;
  for(let index=0;index<steps;index++)scene.update(STEP,time+=STEP);
}
function familyMetrics(positions) {
  let offset=0;const centres=[],spreads=[];
  for(const count of COUNTS) {
    const points=positions.slice(offset,offset+count);offset+=count;
    const centre=[0,1,2].map(axis=>points.reduce((sum,point)=>sum+point[axis],0)/count);
    centres.push(centre);
    spreads.push(Math.sqrt(points.reduce((sum,point)=>sum+point.reduce((distance,value,axis)=>distance+(value-centre[axis])**2,0),0)/count));
  }
  const distances=[];
  for(let a=0;a<centres.length;a++)for(let b=a+1;b<centres.length;b++)distances.push(Math.hypot(...centres[a].map((value,axis)=>value-centres[b][axis])));
  return {spreads,gap:Math.min(...distances),span:Math.max(...distances)};
}
function sampledMotion(initial,isPublic) {
  return withSeed(initial,()=>{
    const scene=createSkyScene();
    try {
      scene.sync(publicItems().map(item=>({...item,sourceId:isPublic?item.sourceId:`personal:${item.source}`})));
      const samples=[];
      for(let step=1;step<=1800;step++) {
        scene.update(STEP,step*STEP);
        if(step>=600&&step%120===0)samples.push(familyMetrics(scene.getState().positions));
      }
      return samples;
    }finally{scene.dispose();}
  });
}

test('public families form compact distinct groups within one wider flock over time',()=>{
  for(const seed of [12345,3271,8191]) {
    const grouped=sampledMotion(seed,true),control=sampledMotion(seed,false);
    for(let family=0;family<TYPES.length;family++) {
      const mean=samples=>samples.reduce((sum,sample)=>sum+sample.spreads[family],0)/samples.length;
      assert.ok(mean(grouped)<mean(control)*.55,`${TYPES[family]} must gather substantially more than its otherwise identical nonpublic control (seed ${seed})`);
      assert.ok(grouped.every(sample=>sample.spreads[family]<90),`${TYPES[family]} should remain compact across the sampled window`);
    }
    assert.ok(grouped.every(sample=>sample.gap>35),'family centroids must remain visibly distinct rather than merge into one coloured clump');
    assert.ok(grouped.every(sample=>sample.span<300),'families must stay within a shared flock rather than drift into independent corners');
  }
});

test('empty, single, one-family and mixed unknown feeds keep finite bounded motion',()=>{
  const fixtures=[[],publicItems().slice(0,1),publicItems().slice(0,50),[
    ...publicItems().filter((_,index)=>[0,50,75,95].includes(index)),
    {itemId:'unknown',sourceId:'public:unknown',source:'unknown'},
    {itemId:'personal:news',sourceId:'personal:news',source:'news'},
  ]];
  for(const items of fixtures)withSeed(41,()=>{
    const scene=createSkyScene();
    try {
      scene.sync(items);advance(scene,240);
      const state=scene.getState();
      assert.equal(state.count,items.length);assert.equal(state.finite,true);
      for(const velocity of state.velocities) {
        const speed=Math.hypot(...velocity);
        assert.ok(speed>=state.parameters.speed*.55-.00001);
        assert.ok(speed<=state.parameters.speed+.00001);
      }
      if(items.some(item=>item.itemId==='unknown')) {
        assert.equal(scene.getFrame().birds.find(bird=>bird.birdId==='unknown').publicType,null);
        assert.equal(scene.getFrame().birds.find(bird=>bird.birdId==='personal:news').publicType,null);
      }
    }finally{scene.dispose();}
  });
});

test('a feed with one public family preserves the shared baseline movement',()=>{
  const run=isPublic=>withSeed(1729,()=>{
    const scene=createSkyScene();
    try {
      scene.sync(publicItems().slice(0,50).map(item=>({...item,sourceId:isPublic?item.sourceId:'personal:news'})));
      advance(scene,180);const {positions,velocities}=scene.getState();
      return {positions,velocities};
    }finally{scene.dispose();}
  });
  assert.deepEqual(run(true),run(false));
});

test('reordered snapshots retain each bird and its motion when music providers change',()=>withSeed(7331,()=>{
  const scene=createSkyScene(),items=publicItems();
  try {
    scene.sync(items);advance(scene,300);
    const state=scene.getState();
    const saved=new Map(state.itemIds.map((id,index)=>[id,{position:state.positions[index],velocity:state.velocities[index],bird:scene.getFrame().birds[index]}]));
    const refreshed=items.slice(1).reverse().map(item=>item.source==='listenbrainz'?{...item,source:'lastfm'}:item);
    scene.sync(refreshed);
    const next=scene.getState();
    next.itemIds.forEach((id,index)=>{
      assert.equal(scene.getFrame().birds[index],saved.get(id).bird);
      assert.deepEqual(next.positions[index],saved.get(id).position);
      assert.deepEqual(next.velocities[index],saved.get(id).velocity);
    });
    assert.equal(next.count,99);
    assert.ok(scene.getFrame().birds.filter(bird=>bird.birdId.startsWith('item:2:')).every(bird=>bird.publicType==='music'));
    advance(scene,180);assert.equal(scene.getState().finite,true);
  }finally{scene.dispose();}
}));

test('zero elapsed time and visual refreshes leave family movement frozen',()=>withSeed(99,()=>{
  const scene=createSkyScene();
  try {
    scene.sync(publicItems());advance(scene,120);
    const {positions,velocities,simTime}=scene.getState();
    for(let index=0;index<20;index++)scene.update(0,simTime);
    scene.resize({width:375,height:812});scene.sync(publicItems());
    const after=scene.getState();
    assert.equal(after.simTime,simTime);assert.deepEqual(after.positions,positions);assert.deepEqual(after.velocities,velocities);
  }finally{scene.dispose();}
}));

test('after scatter a real incoming news item rejoins its existing family without changing identities',()=>withSeed(12345,()=>{
  const scene=createSkyScene(),items=publicItems();
  try {
    scene.sync(items);advance(scene,600);scene.scatter();advance(scene,600);
    const arrival={itemId:'news:new',sourceId:'public:news',source:'news'};
    const survivors=new Map(scene.getFrame().birds.map(bird=>[bird.birdId,bird]));
    scene.sync([...items,arrival],[{eventId:'arrival:news:new',itemId:arrival.itemId,type:'upsert',expiresAt:Date.now()+60000}]);
    const distance=()=>{
      const {positions}=scene.getState();
      const centre=[0,1,2].map(axis=>positions.slice(0,50).reduce((sum,point)=>sum+point[axis],0)/50);
      return Math.hypot(...positions.at(-1).map((value,axis)=>value-centre[axis]));
    };
    const entering=distance();assert.ok(entering>300,'arrival enters from outside the existing flock');
    advance(scene,900);
    assert.ok(distance()<90,'arrival should settle within its news family');
    assert.ok(distance()<entering*.2);
    assert.equal(scene.getState().count,101);assert.equal(scene.getState().finite,true);
    for(const bird of scene.getFrame().birds)if(survivors.has(bird.birdId))assert.equal(bird,survivors.get(bird.birdId));
    assert.equal(scene.getFrame().birds.at(-1).publicType,'news');
  }finally{scene.dispose();}
}));
