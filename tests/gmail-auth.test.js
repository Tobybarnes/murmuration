import test from 'node:test';
import assert from 'node:assert/strict';
import {createGmailSession,GMAIL_SCOPE} from '../src/inputs/gmail-auth.js';

function mockIdentity(t) {
  const previous=globalThis.google;
  const requests=[];
  globalThis.google={accounts:{oauth2:{
    initTokenClient(config){requests.push(config);return {requestAccessToken(){}};},
    hasGrantedAllScopes(response,scope){return response.scope===scope;},
    revoke(token,callback){callback({successful:true});},
  }}};
  t.after(()=>{globalThis.google=previous;});
  return requests;
}
const response={access_token:'ephemeral-test-token',expires_in:3600,scope:GMAIL_SCOPE};

test('disconnect cancels a pending Google callback and another connect supersedes the old one',t=>{
  const requests=mockIdentity(t);let tokens=0;
  const session=createGmailSession({onToken(){tokens++;},onError(error){throw error;}});
  session.connect('123-public.apps.googleusercontent.com');
  session.disconnect();requests[0].callback(response);
  assert.equal(session.hasToken(),false);assert.equal(tokens,0);
  session.connect('123-public.apps.googleusercontent.com');
  session.connect('123-public.apps.googleusercontent.com');
  requests[1].callback(response);assert.equal(session.hasToken(),false);
  requests[2].callback(response);assert.equal(tokens,1);
  assert.equal(session.getToken(),'ephemeral-test-token');
});

test('missing scope or invalid token lifetime cannot create an authorized session',t=>{
  const requests=mockIdentity(t);const errors=[];
  const session=createGmailSession({onToken(){throw new Error('unexpected token');},onError(error){errors.push(error.message);}});
  session.connect('123-public.apps.googleusercontent.com');
  requests[0].callback({...response,scope:'openid'});
  requests[0].callback({...response,expires_in:'invalid'});
  assert.equal(errors.length,2);assert.equal(session.hasToken(),false);
  assert.throws(()=>session.getToken(),/expired/);
});

test('Google revocation is confirmed before success is reported and always clears the local token',async t=>{
  const requests=mockIdentity(t);
  const session=createGmailSession({onToken(){},onError(error){throw error;}});
  await assert.rejects(()=>session.revoke(),/Reconnect/);
  session.connect('123-public.apps.googleusercontent.com');requests[0].callback(response);
  await session.revoke();assert.equal(session.hasToken(),false);
  session.connect('123-public.apps.googleusercontent.com');requests[1].callback(response);
  globalThis.google.accounts.oauth2.revoke=(token,callback)=>callback({successful:false});
  await assert.rejects(()=>session.revoke(),/did not confirm/);
  assert.equal(session.hasToken(),false);
});
