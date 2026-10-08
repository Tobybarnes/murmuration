const TYPES={news:1,social:2,music:3,quakes:4};
const FAMILIES=4,STRIDE=7;

// Family means are captured before any velocity is updated. Each family has
// equal steering strength, whether it contains five items or fifty.
export function createPublicFamilies(capacity) {
  const codes=new Uint8Array(capacity),means=new Float64Array((FAMILIES+1)*STRIDE);
  const spacing=new Float64Array((FAMILIES+1)*3),whole=new Float64Array(6),force=new Float64Array(3);
  let active=false;
  function prepare(count,px,py,pz,vx,vy,vz) {
    means.fill(0);spacing.fill(0);whole.fill(0);
    let total=0,families=0;
    for(let i=0;i<count;i++) {
      const code=codes[i];if(!code)continue;
      const offset=code*STRIDE;means[offset]++;total++;
      means[offset+1]+=px[i];means[offset+2]+=py[i];means[offset+3]+=pz[i];
      means[offset+4]+=vx[i];means[offset+5]+=vy[i];means[offset+6]+=vz[i];
      whole[0]+=px[i];whole[1]+=py[i];whole[2]+=pz[i];
      whole[3]+=vx[i];whole[4]+=vy[i];whole[5]+=vz[i];
    }
    for(let code=1;code<=FAMILIES;code++) {
      const offset=code*STRIDE,n=means[offset];if(!n)continue;
      families++;for(let axis=1;axis<STRIDE;axis++)means[offset+axis]/=n;
    }
    active=families>1;
    if(!active)return;
    for(let axis=0;axis<6;axis++)whole[axis]/=total;
    for(let a=1;a<=FAMILIES;a++)for(let b=a+1;b<=FAMILIES;b++) {
      if(!means[a*STRIDE]||!means[b*STRIDE])continue;
      let dx=means[a*STRIDE+1]-means[b*STRIDE+1],dy=means[a*STRIDE+2]-means[b*STRIDE+2];
      const distance=Math.hypot(dx,dy);
      if(distance>=110)continue;
      if(distance<.001){const angle=a*1.37+b*2.19;dx=Math.cos(angle);dy=Math.sin(angle);}
      const strength=.2*(1-distance/110)/(Math.hypot(dx,dy)||1);
      const x=dx*strength,y=dy*strength;
      spacing[a*3]+=x;spacing[a*3+1]+=y;spacing[b*3]-=x;spacing[b*3+1]-=y;
    }
  }
  function add(dx,dy,dz,gain,limit) {
    const scale=Math.min(gain,limit/(Math.hypot(dx,dy,dz)||1));
    force[0]+=dx*scale;force[1]+=dy*scale;force[2]+=dz*scale;
  }
  function steering(i,x,y,z,vx,vy,vz) {
    force.fill(0);const code=codes[i];
    if(!active||!code)return force;
    const offset=code*STRIDE;
    add(means[offset+1]-x,means[offset+2]-y,means[offset+3]-z,.006,.35);
    add(means[offset+4]-vx,means[offset+5]-vy,means[offset+6]-vz,.075,.15);
    add(whole[0]-x,whole[1]-y,whole[2]-z,.0007,.12);
    add(whole[3]-vx,whole[4]-vy,whole[5]-vz,.035,.1);
    force[0]+=spacing[code*3];force[1]+=spacing[code*3+1];
    const length=Math.hypot(...force);
    if(length>.5)for(let axis=0;axis<3;axis++)force[axis]*=.5/length;
    return force;
  }
  return {codes,prepare,steering,
    set(i,type){codes[i]=TYPES[type]??0;},
    neighbourWeight(i,j){return active&&codes[i]&&codes[j]&&codes[i]!==codes[j] ? .25 : 1;},
  };
}
