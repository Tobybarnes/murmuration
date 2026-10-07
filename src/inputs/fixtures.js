import {itemId} from './store.js';
export const SAMPLE_SOURCE='sample:studio';
export function sampleItems(now=Date.now()) {
  const labels={email:['A note from a friend','Weekend plans','A new invitation','Photos from the coast'],agents:['A conversation with an agent','Research ready to read','A draft in progress'],other:['A document shared','A saved thought','A chat with the team']};
  return Array.from({length:36},(_,index)=>{
    const category=index<16?'email':index<26?'agents':'other';
    return {itemId:itemId('sample','studio',index),sourceId:SAMPLE_SOURCE,source:'sample',accountId:'studio',category,title:labels[category][index%labels[category].length],readState:index%3?'unread':'read',updatedAt:now-60_000*(36-index),revision:now};
  });
}
export function sampleSequence(items,now=Date.now()) {
  const newItem={...items[0],itemId:itemId('sample','studio','arrival'),title:'A new email arrives',updatedAt:now+1000,revision:now+1000};
  const arrival={eventId:`demo:${now}:arrival`,sourceId:SAMPLE_SOURCE,itemId:newItem.itemId,type:'upsert',item:newItem,revision:now+1000,occurredAt:now+1000,expiresAt:now+7000};
  return [
    {label:'A new email arrives',changes:[arrival]},
    {label:'The same delivery retries. Bird count stays the same.',changes:[arrival]},
    {label:'An email is read',changes:[{...arrival,eventId:`demo:${now}:read`,itemId:items[1].itemId,item:{...items[1],readState:'read'},revision:now+3000,occurredAt:now+3000,expiresAt:now+9000}]},
    {label:'An agent replies',changes:[{eventId:`demo:${now}:reply`,sourceId:SAMPLE_SOURCE,itemId:items[18].itemId,type:'activity',revision:now+4000,occurredAt:now+4000,expiresAt:now+10000}]},
    {label:'An email is archived',changes:[{eventId:`demo:${now}:archive`,sourceId:SAMPLE_SOURCE,itemId:items[0].itemId,type:'remove',revision:now+5000,occurredAt:now+5000,expiresAt:now+11000}]},
  ];
}
