/**
 * 健人 × Strava — OAuth2 proxy for Cloudflare Workers.
 * Secrets and refresh tokens NEVER run on or ship to GitHub Pages.
 * Requires STRAVA_SESSIONS (Workers KV), APP_URL and three env secrets.
 */
const STRAVA_OAUTH = 'https://www.strava.com/oauth/authorize';
const STRAVA_TOKEN = 'https://www.strava.com/oauth/token';
const STRAVA_REVOKE = 'https://www.strava.com/oauth/revoke';
const encoder = new TextEncoder();

const json = (data, status=200, extra={}) => new Response(JSON.stringify(data), {
  status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra}
});
function hex(b){return Array.from(b, x=>x.toString(16).padStart(2,'0')).join('');}
function randomKey(){return hex(crypto.getRandomValues(new Uint8Array(32)));}
function b64(bytes){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function fromB64(s){return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),x=>x.charCodeAt(0));}
async function sha256(s){return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(s))));}
async function hmac(s, secret){const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(s)));}
function constantTimeSame(a,b){if(a.length!==b.length)return false;let result=0;for(let i=0;i<a.length;i++)result|=a[i]^b[i];return result===0;}
async function signState(payload,env){const raw=b64(encoder.encode(JSON.stringify(payload)));return raw+'.'+b64(await hmac(raw,env.STATE_SECRET));}
async function verifyState(state,env){
  const [raw,sig,...rest]=String(state||'').split('.');
  if(!raw||!sig||rest.length)throw Error('無效的授權狀態');
  const good=await hmac(raw,env.STATE_SECRET);if(!constantTimeSame(fromB64(sig),good))throw Error('授權簽章驗證失敗');
  const p=JSON.parse(new TextDecoder().decode(fromB64(raw)));
  if(!p || typeof p.ts!=='number'||Math.abs(Date.now()-p.ts)>10*60*1000|| !/^[a-f0-9]{48}$/.test(p.nonce)) throw Error('授權逾時，請重新連線');
  return p;
}
function cors(request,env){const origin=request.headers.get('Origin');const allowed=new URL(env.APP_URL).origin;return origin===allowed ? {
  'Access-Control-Allow-Origin':allowed,'Vary':'Origin','Access-Control-Allow-Headers':'Authorization, Content-Type',
  'Access-Control-Allow-Methods':'GET, DELETE, OPTIONS','Access-Control-Max-Age':'600'
}:{};}
function requireEnv(env){
  if(!env.STRAVA_SESSIONS || !env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET || !env.STATE_SECRET || !env.APP_URL) throw Error('後端尚未完成設定：請參照 strava-worker/README.md');
  if(!env.APP_URL.startsWith('https://'))throw Error('APP_URL 必須是 HTTPS 網址');
}
async function tokenExchange(params,env){
  const body=new URLSearchParams({...params,client_id:String(env.STRAVA_CLIENT_ID),client_secret:String(env.STRAVA_CLIENT_SECRET)});
  const resp=await fetch(STRAVA_TOKEN,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
  const data=await resp.json();
  if(!resp.ok||!data.access_token||!data.refresh_token)throw Error('Strava 授權伺服器無法核發憑證，請重新授權');
  return data;
}
async function record(request,env){
  const h=request.headers.get('Authorization')||'';
  const match=/^Bearer ([a-f0-9]{64})$/i.exec(h);
  if(!match)throw Object.assign(Error('請先在網站設定中連結 Strava'),{status:401});
  const id='session:'+await sha256(match[1]);
  const txt=await env.STRAVA_SESSIONS.get(id);
  if(!txt)throw Object.assign(Error('連線已過期，請重新連結 Strava'),{status:401});
  return {id,data:JSON.parse(txt)};
}
async function freshToken(session,env){
  if((session.data.expires_at||0)>Math.floor(Date.now()/1000)+90)return session.data.access_token;
  const next=await tokenExchange({grant_type:'refresh_token',refresh_token:session.data.refresh_token},env);
  session.data.access_token=next.access_token;session.data.refresh_token=next.refresh_token;session.data.expires_at=next.expires_at;
  await env.STRAVA_SESSIONS.put(session.id,JSON.stringify(session.data),{expirationTtl:3600*24*365});
  return next.access_token;
}
async function handler(request,env){
  requireEnv(env);
  const url=new URL(request.url);const path=url.pathname;
  const headers=cors(request,env);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(path==='/health'&&request.method==='GET')return json({ok:true,name:'Jianren Strava OAuth Proxy'},200,headers);
  if(path==='/oauth/start'&&request.method==='GET'){
    const nonce=url.searchParams.get('nonce');const appUrl=url.searchParams.get('return_url');
    if(!/^[a-f0-9]{48}$/.test(nonce||'')||appUrl!==env.APP_URL) return json({error:'來源網站網址不正確，請確認 APP_URL 與網站網址完全一致'},400,headers);
    const state=await signState({nonce,ts:Date.now()},env);
    const auth=new URL(STRAVA_OAUTH);
    auth.search=new URLSearchParams({client_id:String(env.STRAVA_CLIENT_ID),response_type:'code',redirect_uri:url.origin+'/oauth/callback',approval_prompt:'auto',scope:'read,activity:read',state}).toString();
    return Response.redirect(auth.toString(),302);
  }
  if(path==='/oauth/callback'&&request.method==='GET'){
    let nonce;
    try {
      const p=await verifyState(url.searchParams.get('state'),env);nonce=p.nonce;
      if(url.searchParams.has('error'))throw Error('你已取消 Strava 授權');
      const code=url.searchParams.get('code');if(!code)throw Error('未收到 Strava 授權碼');
      const scope=(url.searchParams.get('scope')||'').split(',');
      if(!scope.includes('activity:read'))throw Error('尚未授權讀取活動，請重新連線並允許相關權限');
      const tok=await tokenExchange({grant_type:'authorization_code',code},env);
      const key=randomKey();
      const id='session:'+await sha256(key);
      await env.STRAVA_SESSIONS.put(id,JSON.stringify({
        access_token:tok.access_token,refresh_token:tok.refresh_token,
        expires_at:tok.expires_at,athlete:tok.athlete||null,
        connected_at:new Date().toISOString()
      }),{expirationTtl:3600*24*365});
      return Response.redirect(env.APP_URL+'#strava-auth='+nonce+'.'+key,302);
    } catch(e){
      const message=encodeURIComponent(e.message||'Strava 授權失敗');
      return Response.redirect(env.APP_URL+'#strava-error='+message,302);
    }
  }
  if(path==='/api/me'&&request.method==='GET'){
    const session=await record(request,env);
    return json({athlete:session.data.athlete,connected_at:session.data.connected_at},200,headers);
  }
  if(path==='/api/activities'&&request.method==='GET'){
    const session=await record(request,env);
    const tok=await freshToken(session,env);
    const api=await fetch('https://www.strava.com/api/v3/athlete/activities?per_page=100&page=1',{
      headers:{'Authorization':'Bearer '+tok},cf:{cacheTtl:0}
    });
    if(api.status===429)throw Object.assign(Error('Strava 使用量已達上限，稍後再同步'),{status:429});
    if(!api.ok)throw Object.assign(Error('Strava 活動讀取失敗，請稍後重試或重新連線'),{status:502});
    const events=await api.json();if(!Array.isArray(events))throw Error('Strava 活動格式不正確');
    return json({activities:events.map(a=>({
      id:a.id,name:a.name,type:a.type,sport_type:a.sport_type,
      distance:a.distance,moving_time:a.moving_time,average_heartrate:a.average_heartrate,
      start_date:a.start_date,start_date_local:a.start_date_local
    }))},200,headers);
  }
  if(path==='/api/session'&&request.method==='DELETE'){
    const session=await record(request,env);
    // Revoke refresh token with Basic auth, per Strava's June 2026 guidance.
    const auth=btoa(String(env.STRAVA_CLIENT_ID)+':'+String(env.STRAVA_CLIENT_SECRET));
    const resp=await fetch(STRAVA_REVOKE,{method:'POST',headers:{'Authorization':'Basic '+auth,'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({token:session.data.refresh_token,token_type_hint:'refresh_token'})});
    if(!resp.ok)throw Object.assign(Error('Strava 撤銷授權失敗，請重試'),{status:502});
    await env.STRAVA_SESSIONS.delete(session.id);
    return json({disconnected:true},200,headers);
  }
  return json({error:'沒有此服務路徑'},404,headers);
}
export default { async fetch(request,env){
  try{return await handler(request,env);}
  catch(e){const status=(e&&e.status)||500;const msg=(e&&e.message)||'服務異常';
    let extra={};try{extra=cors(request,env)}catch(_){}
    return json({error:status===500 && !String(msg).startsWith('後端尚未')?'伺服器處理失敗，請檢查 Worker 日誌':msg},status,extra);
  }
}};
