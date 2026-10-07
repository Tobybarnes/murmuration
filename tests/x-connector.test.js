import test from 'node:test';
import assert from 'node:assert/strict';
import {createXConnector} from '../server/x-connector.mjs';
test('X never sends a billable request without paid access and owner authorization', async()=>{
 let requests=0;
 const fetcher=async()=>{requests++;throw new Error('unexpected request');};
 const disabled=createXConnector({bearerToken:'test',query:'birds',fetcher});
 await assert.rejects(()=>disabled.poll({ownerCredential:'owner'}),/disabled/);
 const noAuth=createXConnector({bearerToken:'test',query:'birds',allowPaidRequests:true,fetcher});
 await assert.rejects(()=>noAuth.poll({ownerCredential:'owner'}),/authorization/);
 assert.equal(requests,0);
});
test('authorized X search emits stable activity IDs and passes a cursor without persisting the bearer token',async()=>{
 let url;
 const connector=createXConnector({bearerToken:'test',query:'birds -is:retweet',allowPaidRequests:true,authorize:async credential=>credential==='owner',fetcher:async(request,options)=>{url=new URL(request);assert.equal(options.headers.Authorization,'Bearer test');return {ok:true,json:async()=>({data:[{id:'123',created_at:'2026-10-07T10:00:00Z'}],meta:{newest_id:'123'}})};}});
 const value=await connector.poll({ownerCredential:'owner',sinceId:'122',now:Date.parse('2026-10-07T10:00:01Z')});
 assert.equal(url.searchParams.get('since_id'),'122');
 assert.equal(url.searchParams.get('max_results'),'10');
 assert.equal(value.changes[0].eventId,'x:123');
 assert.equal(value.cursor,'123');
 assert.equal(JSON.stringify(value).includes('Bearer'),false);
});

test('a truncated X page preserves the caller cursor without hidden billed pagination',async()=>{
 let requests=0;
 const connector=createXConnector({bearerToken:'test',query:'birds',allowPaidRequests:true,authorize:async()=>true,fetcher:async()=>{requests++;return {ok:true,json:async()=>({data:[{id:'200',created_at:'2026-10-07T10:00:00Z'}],meta:{newest_id:'200',next_token:'another-page'}})};}});
 await assert.rejects(()=>connector.poll({ownerCredential:'owner',sinceId:'100'}),/previous cursor was kept/);
 assert.equal(requests,1);
});
