const encoder=new TextEncoder();
const hex=buffer=>Array.from(new Uint8Array(buffer),n=>n.toString(16).padStart(2,'0')).join('');
async function digest(value){return hex(await crypto.subtle.digest('SHA-256',typeof value==='string'?encoder.encode(value):value));}
function json(data,status=200,extra={}){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});}
async function signature(value,secret){const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',key,encoder.encode(value)));}
function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
async function session(request,env){
  const token=request.headers.get('X-Pildam-Session');
  if(!token||token.length>250||!env.CLASS_CODE)return null;
  const [id,expires,sig]=token.split('.');
  if(!/^[0-9a-f]{32}$/.test(id)||!/^\d{10,13}$/.test(expires)||Number(expires)<Date.now())return null;
  if(!equal(sig,await signature(id+'.'+expires,env.CLASS_CODE)))return null;
  return {id,csrf:await signature('csrf.'+id,env.CLASS_CODE)};
}
async function body(request,limit){
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new Error('요청 형식을 확인해주세요.');
  if(Number(request.headers.get('Content-Length'))>limit)throw new Error('사진 용량이 너무 큽니다.');
  const reader=request.body?.getReader();if(!reader)throw new Error('요청 내용이 없습니다.');
  const chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new Error('사진 용량이 너무 큽니다.');}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new Error('요청 내용을 확인해주세요.');}
}
export function providerError(error,status){
  const reasons=(error?.details||[]).map(d=>d.reason);
  if(reasons.includes('BILLING_DISABLED'))return '선생님의 인식 서비스 결제 연결을 확인해야 합니다.';
  if(reasons.includes('SERVICE_DISABLED'))return '선생님이 Cloud Vision API를 사용 설정해야 합니다.';
  if(status===429)return '인식 서비스 요청 한도에 도달했어요. 선생님에게 알려주세요.';
  if(status===401||status===403)return '인식 서비스 연결 권한을 확인해야 합니다. 선생님에게 알려주세요.';
  return '인식 서비스에 문제가 생겼어요. 자동으로 다시 요청하지 않았습니다.';
}
export function createHandler(env, fetcher=fetch){
  async function rpc(name,args={}){
    const r=await fetcher(env.SUPABASE_URL+'/rest/v1/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json',apikey:env.SUPABASE_SERVICE_ROLE_KEY,...(env.SUPABASE_SERVICE_ROLE_KEY.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY})},body:JSON.stringify(args),signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw new Error('database unavailable');
    const content=await r.text();return content?JSON.parse(content):null;
  }
  async function limited(bucket,max,expires){return rpc('pildam_throttle',{p_bucket:bucket,p_max:max,p_expiry:new Date(expires).toISOString()});}
  async function handle(request){
    const path=new URL(request.url).pathname.split('/').pop(),now=Date.now();
    if(!env.CLASS_CODE||env.CLASS_CODE.length<12||!env.SUPABASE_SERVICE_ROLE_KEY)return json({error:'선생님이 수업을 준비하고 있어요.'},503);
    const auth=await session(request,env);
    if(path==='status'&&request.method==='GET')return json({requiresLogin:true,authenticated:!!auth,configured:!!env.GOOGLE_VISION_API_KEY,token:auth?.csrf||null});
    if(request.method!=='POST')return json({error:'찾을 수 없는 요청입니다.'},404);
    if(path==='login'){
      // A shared global limiter is independent of spoofable proxy/IP headers.
      if(!await limited('login:'+Math.floor(now/600000),120,now+1200000))return json({error:'입력 시도가 많아요. 잠시 후 다시 시도해주세요.'},429);
      const data=await body(request,2048);
      if(typeof data.code!=='string'||!equal(await digest(data.code),await digest(env.CLASS_CODE)))return json({error:'수업 코드를 확인해주세요.'},401);
      const id=crypto.randomUUID().replaceAll('-',''),expiry=now+8*3600000,value=id+'.'+expiry;
      return json({ok:true,session:value+'.'+await signature(value,env.CLASS_CODE)});
    }
    if(path!=='ocr')return json({error:'찾을 수 없는 요청입니다.'},404);
    if(!auth)return json({error:'수업 코드를 다시 입력해주세요.'},401);
    if(!equal(request.headers.get('X-App-Token'),auth.csrf))return json({error:'페이지를 새로고침하고 수업 코드를 다시 입력해주세요.'},403);
    if(!env.GOOGLE_VISION_API_KEY)return json({error:'선생님이 인식 서비스를 연결하고 있어요.'},503);
    if(!await limited('ocr:'+auth.id+':'+Math.floor(now/60000),3,now+120000))return json({error:'1분 후 다시 분석해주세요.'},429);
    const data=await body(request,8100000),content=data.image;
    if(typeof content!=='string'||content.length>8000000||!/^\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(content))return json({error:'사진 형식을 확인해주세요.'},400);
    let raw;try{raw=Uint8Array.from(atob(content),c=>c.charCodeAt(0));}catch{return json({error:'사진 형식을 확인해주세요.'},400);}
    const hash=await digest(raw),claim=await rpc('pildam_claim',{p_hash:hash});
    if(claim.state==='done')return json({text:claim.text,cached:true,provider:'Google Cloud Vision'});
    if(claim.state==='limit')return json({error:'전체 분석 한도에 도달해 추가 비용 방지를 위해 멈췄어요.'},429);
    if(claim.state!=='claimed')return json({error:claim.state==='pending'?'같은 사진을 읽고 있어요. 잠시 후 다시 확인해주세요.':'이 사진의 요청이 실패해 중복 요청을 보류했어요. 선생님에게 알려주세요.'},409);
    try{
      const response=await fetcher('https://vision.googleapis.com/v1/images:annotate',{method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':env.GOOGLE_VISION_API_KEY},body:JSON.stringify({requests:[{image:{content},features:[{type:'DOCUMENT_TEXT_DETECTION'}],imageContext:{languageHints:['ko']}}]}),signal:AbortSignal.timeout(45000)});
      const result=await response.json(),entry=result.responses?.[0];
      if(!response.ok||entry?.error)throw new Error(providerError(entry?.error||result.error,response.status));
      if(!entry)throw new Error('인식 결과를 받지 못했어요. 선생님에게 알려주세요.');
      const text=entry.fullTextAnnotation?.text||'';
      await rpc('pildam_finish',{p_hash:hash,p_text:text,p_success:true});
      return json({text,cached:false,provider:'Google Cloud Vision'});
    }catch(error){
      await rpc('pildam_finish',{p_hash:hash,p_text:null,p_success:false});
      return json({error:error.message?.startsWith('인식')||error.message?.startsWith('선생님')?error.message:'인식 서버가 응답하지 않았어요. 자동 재시도하지 않았습니다.'},502);
    }
  }
  return async request=>{
    const origin=request.headers.get('Origin');
    if(!env.APP_ORIGIN||origin!==env.APP_ORIGIN)return json({error:'허용되지 않은 앱 주소입니다.'},403);
    const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'content-type, x-app-token, x-pildam-session','Access-Control-Max-Age':'600','Vary':'Origin'};
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    let response;try{response=await handle(request);}catch{response=json({error:'서비스를 일시적으로 이용할 수 없어요. 잠시 후 다시 시도해주세요.'},503);}
    for(const [key,value] of Object.entries(headers))response.headers.set(key,value);
    return response;
  };
}
