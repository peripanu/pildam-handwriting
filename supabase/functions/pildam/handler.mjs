const encoder=new TextEncoder();
const hex=b=>Array.from(new Uint8Array(b),n=>n.toString(16).padStart(2,'0')).join('');
function visualQuality(annotation){
  const words=[];for(const page of annotation?.pages||[])for(const block of page.blocks||[])for(const paragraph of block.paragraphs||[])for(const word of paragraph.words||[]){
    const v=word.boundingBox?.vertices||[], ys=v.map(p=>p.y||0);const height=Math.max(...ys)-Math.min(...ys);
    if(height>0)words.push({height,confidence:typeof word.confidence==='number'?word.confidence:null});
  }
  if(words.length<2)return null;
  const heights=words.map(w=>w.height),mean=heights.reduce((a,b)=>a+b,0)/heights.length;
  const variation=Math.sqrt(heights.reduce((a,h)=>a+(h-mean)**2,0)/heights.length)/mean;
  const sizeConsistency=Math.max(0,Math.min(100,Math.round(100*(1-variation/.65))));
  const confidenceWords=words.filter(w=>w.confidence!==null);
  const recognitionConfidence=confidenceWords.length?Math.round(100*confidenceWords.reduce((a,w)=>a+w.confidence,0)/confidenceWords.length):null;
  const score=recognitionConfidence===null?sizeConsistency:Math.round(sizeConsistency*.55+recognitionConfidence*.45);
  return {score,sizeConsistency,recognitionConfidence,wordCount:words.length};
}
async function digest(v){return hex(await crypto.subtle.digest('SHA-256',typeof v==='string'?encoder.encode(v):v));}
async function signature(v,s){const k=await crypto.subtle.importKey('raw',encoder.encode(s),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',k,encoder.encode(v)));}
function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return !d;}
function json(data,status=200,extra={}){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});}
async function body(req,limit=8192){if(!req.headers.get('Content-Type')?.startsWith('application/json'))throw Error('요청 형식을 확인해주세요.');const raw=await req.text();if(raw.length>limit)throw Error('요청이 너무 큽니다.');try{return JSON.parse(raw)}catch{throw Error('요청 내용을 확인해주세요.');}}
export function createHandler(env,fetcher=fetch){
  const signingKey=env.SESSION_SECRET||env.CLASS_CODE;
  async function rpc(name,args={}){const r=await fetcher(env.SUPABASE_URL+'/rest/v1/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json',apikey:env.SUPABASE_SERVICE_ROLE_KEY,...(env.SUPABASE_SERVICE_ROLE_KEY.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY})},body:JSON.stringify(args),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('database unavailable');const t=await r.text();return t?JSON.parse(t):null;}
  async function db(path,options={}){const r=await fetcher(env.SUPABASE_URL+'/rest/v1/'+path,{...options,headers:{'Content-Type':'application/json',apikey:env.SUPABASE_SERVICE_ROLE_KEY,...(env.SUPABASE_SERVICE_ROLE_KEY.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY}),...(options.headers||{})},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('database unavailable');return r.status===204?null:r.json();}
  async function limited(bucket,max,expires){return rpc('pildam_throttle',{p_bucket:bucket,p_max:max,p_expiry:new Date(expires).toISOString()});}
  async function auth(req){const token=req.headers.get('X-Pildam-Session');if(!token||!signingKey)return null;const [role,id,expiry,sig]=token.split('.');if(!/^(student|teacher)$/.test(role)||!/^[0-9a-f]{32}$/.test(id)||!/^\d{13}$/.test(expiry)||Number(expiry)<Date.now())return null;if(!equal(sig,await signature(role+'.'+id+'.'+expiry,signingKey)))return null;return {role,id,csrf:await signature('csrf.'+role+'.'+id,signingKey)};}
  async function issue(role){const id=crypto.randomUUID().replaceAll('-',''),expiry=String(Date.now()+8*3600000),value=role+'.'+id+'.'+expiry;return value+'.'+await signature(value,signingKey);}
  async function assignment(){const rows=await db('pildam_assignment?select=title,content&id=eq.1');return rows?.[0];}
  async function handle(req){const path=new URL(req.url).pathname.split('/').pop(),now=Date.now(),a=await auth(req);
    if(!env.CLASS_CODE||env.CLASS_CODE.length<4||!signingKey||!env.SUPABASE_SERVICE_ROLE_KEY)return json({error:'선생님이 수업 설정을 준비하고 있어요.'},503);
    if(path==='status'&&req.method==='GET')return json({requiresLogin:true,authenticated:!!a,role:a?.role||null,configured:!!env.GOOGLE_VISION_API_KEY,teacherReady:!!env.TEACHER_CODE,token:a?.csrf||null});
    if(path==='assignment'&&req.method==='GET'){if(!a)return json({error:'수업 코드를 다시 입력해주세요.'},401);return json({assignment:await assignment()});}
    if(req.method!=='POST')return json({error:'찾을 수 없는 요청입니다.'},404);
    if(path==='login'||path==='teacher-login'){const teacher=path==='teacher-login',code=teacher?env.TEACHER_CODE:env.CLASS_CODE;if(!code)return json({error:'선생님용 코드를 먼저 설정해주세요.'},503);if(!await limited('login:'+Math.floor(now/600000),120,now+1200000))return json({error:'입력 시도가 많아요. 잠시 후 다시 시도해주세요.'},429);const data=await body(req);if(typeof data.code!=='string'||!equal(await digest(data.code),await digest(code)))return json({error:'코드를 확인해주세요.'},401);return json({ok:true,session:await issue(teacher?'teacher':'student')});}
    if(path==='assignment'){if(!a||a.role!=='teacher'||!equal(req.headers.get('X-App-Token'),a.csrf))return json({error:'선생님용 코드로 다시 들어와주세요.'},401);const data=await body(req);if(typeof data.title!=='string'||typeof data.content!=='string'||!data.title.trim()||data.title.length>80||data.content.trim().length>1000)return json({error:'제목은 80자, 연습 글은 1,000자 이내로 입력해주세요.'},400);await db('pildam_assignment?id=eq.1',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify({id:1,title:data.title.trim(),content:data.content.trim(),updated_at:new Date().toISOString()})});return json({assignment:await assignment()});}
    if(path!=='ocr')return json({error:'찾을 수 없는 요청입니다.'},404);
    if(!a)return json({error:'수업 코드를 다시 입력해주세요.'},401);
    if(!equal(req.headers.get('X-App-Token'),a.csrf))return json({error:'페이지를 새로고침하고 수업 코드를 다시 입력해주세요.'},403);
    if(!env.GOOGLE_VISION_API_KEY)return json({error:'선생님이 인식 서비스를 연결하고 있어요.'},503);
    if(!await limited('ocr:'+a.id+':'+Math.floor(now/60000),3,now+120000))return json({error:'1분 후 다시 분석해주세요.'},429);
    const data=await body(req,8100000),content=data.image;if(typeof content!=='string'||content.length>8000000||!/^\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(content))return json({error:'사진 형식을 확인해주세요.'},400);
    let raw;try{raw=Uint8Array.from(atob(content),c=>c.charCodeAt(0))}catch{return json({error:'사진 형식을 확인해주세요.'},400)}
    const hash=await digest(raw),claim=await rpc('pildam_claim',{p_hash:hash});if(claim.state==='done')return json({text:claim.text,cached:true,provider:'Google Cloud Vision'});if(claim.state==='limit')return json({error:'전체 분석 한도에 도달해 추가 비용 방지를 위해 멈췄어요.'},429);if(claim.state!=='claimed')return json({error:'같은 사진을 읽고 있어요. 잠시 후 다시 확인해주세요.'},409);
    try{const r=await fetcher('https://vision.googleapis.com/v1/images:annotate',{method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':env.GOOGLE_VISION_API_KEY},body:JSON.stringify({requests:[{image:{content},features:[{type:'DOCUMENT_TEXT_DETECTION'}],imageContext:{languageHints:['ko']}}]}),signal:AbortSignal.timeout(45000)}),out=await r.json(),entry=out.responses?.[0];if(!r.ok||entry?.error)throw Error('인식 서비스에 문제가 생겼어요.');const text=entry.fullTextAnnotation?.text||'',quality=visualQuality(entry.fullTextAnnotation);await rpc('pildam_finish',{p_hash:hash,p_text:text,p_success:true});return json({text,quality,cached:false,provider:'Google Cloud Vision'});}catch{await rpc('pildam_finish',{p_hash:hash,p_text:null,p_success:false});return json({error:'인식 서버가 응답하지 않았어요. 자동 재시도하지 않았습니다.'},502);}
  }
  return async req=>{const origin=req.headers.get('Origin');if(!env.APP_ORIGIN||origin!==env.APP_ORIGIN)return json({error:'허용되지 않은 앱 주소입니다.'},403);const h={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'content-type, x-app-token, x-pildam-session','Access-Control-Max-Age':'600','Vary':'Origin'};if(req.method==='OPTIONS')return new Response(null,{status:204,headers:h});let r;try{r=await handle(req)}catch{r=json({error:'서비스를 일시적으로 이용할 수 없어요. 잠시 후 다시 시도해주세요.'},503)}for(const[k,v]of Object.entries(h))r.headers.set(k,v);return r;};
}
