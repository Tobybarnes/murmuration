export const GMAIL_SCOPE='https://www.googleapis.com/auth/gmail.metadata';
let loading;
export function loadGoogleIdentity() {
  if(globalThis.google?.accounts?.oauth2) return Promise.resolve();
  if(loading) return loading;
  loading=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://accounts.google.com/gsi/client'; script.async=true; script.defer=true;
    const timeout=setTimeout(()=>{script.remove();loading=null;reject(new Error('Google sign-in did not load. Check your connection and try again.'));},15000);
    script.onload=()=>{clearTimeout(timeout);resolve();};
    script.onerror=()=>{clearTimeout(timeout);script.remove();loading=null;reject(new Error('Google sign-in could not load.'));};
    document.head.append(script);
  });
  return loading;
}
export function createGmailSession({onToken,onError}) {
  let token='',expiresAt=0,client=null,epoch=0;
  function disconnect(){epoch++;token='';expiresAt=0;client=null;}
  return {
    connect(clientId) {
      if(!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw new Error('Enter the public Google OAuth web client ID.');
      const oauth=globalThis.google?.accounts?.oauth2;
      if(!oauth) throw new Error('Load Google sign-in first, then connect.');
      disconnect();const requestEpoch=epoch;
      client=oauth.initTokenClient({client_id:clientId,scope:GMAIL_SCOPE,include_granted_scopes:false,
        callback(response) {
          if(requestEpoch!==epoch)return;
          if(response.error || !response.access_token || !oauth.hasGrantedAllScopes(response,GMAIL_SCOPE)) {onError(new Error('Gmail metadata access was not granted.'));return;}
          const lifetime=Number(response.expires_in);
          if(!Number.isFinite(lifetime)||lifetime<=30){onError(new Error('Google returned an expired authorization. Try connecting again.'));return;}
          token=response.access_token;expiresAt=Date.now()+(lifetime-30)*1000;
          onToken();
        },error_callback() {if(requestEpoch===epoch)onError(new Error('Sign-in was closed or could not open. Try connecting again.'));}
      });
      client.requestAccessToken({prompt:'consent'});
    },
    getToken() {if(!token||Date.now()>=expiresAt){token='';throw new Error('Gmail authorization expired. Reconnect to refresh.');}return token;},
    hasToken() {return Boolean(token)&&Date.now()<expiresAt;},
    disconnect,
    revoke() {
      const current=token;disconnect();
      if(!current)return Promise.reject(new Error('Reconnect Gmail to revoke access here, or remove it in your Google Account permissions.'));
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('Google did not confirm revocation. Check your Google Account permissions.')),15000);
        globalThis.google.accounts.oauth2.revoke(current,response=>{
          clearTimeout(timer);
          if(response?.successful)resolve();
          else reject(new Error('Google did not confirm revocation. Check your Google Account permissions.'));
        });
      });
    }
  };
}
