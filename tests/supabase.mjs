import assert from 'node:assert/strict';
import {createHandler} from '../supabase/functions/pildam/handler.mjs';
const env={SUPABASE_URL:'https://project.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-secret',CLASS_CODE:'test-class-code-2026',GOOGLE_VISION_API_KEY:'test-key',APP_ORIGIN:'https://example.github.io'};
let visionCalls=0,rpcCalls=0,claimState='claimed';
const handler=createHandler(env,async(url,options)=>{
  if(url.includes('/rest/v1/rpc/')){
    rpcCalls++;assert.equal(options.headers.Authorization,'Bearer server-secret');
    if(url.endsWith('pildam_throttle'))return Response.json(true);
    if(url.endsWith('pildam_claim'))return Response.json({state:claimState,text:'cached text'});
    if(url.endsWith('pildam_finish'))return new Response('');
    throw new Error('unexpected RPC');
  }
  assert.equal(url,'https://vision.googleapis.com/v1/images:annotate');visionCalls++;
  assert.equal(options.headers['X-Goog-Api-Key'],'test-key');
  const payload=JSON.parse(options.body);assert.deepEqual(payload.requests[0].features,[{type:'DOCUMENT_TEXT_DETECTION'}]);assert.equal(payload.reference,undefined);
  return Response.json({responses:[{fullTextAnnotation:{text:'오늘은 맑음'}}]});
});
const req=(path,data,headers={},method)=>new Request('https://project.supabase.co/functions/v1/pildam/'+path,{method:method||(data===undefined?'GET':'POST'),headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json',...headers},body:data===undefined?undefined:JSON.stringify(data)});
let r=await handler(req('status',undefined,{Origin:'https://other.test'}));assert.equal(r.status,403);assert.equal(rpcCalls,0);
r=await handler(req('ocr',undefined,{},'OPTIONS'));assert.equal(r.status,204);assert.equal(r.headers.get('Access-Control-Allow-Origin'),env.APP_ORIGIN);
r=await handler(req('ocr',{image:'/9j/dGVzdA=='}));assert.equal(r.status,401);assert.equal(visionCalls,0);
r=await handler(req('login',{code:'incorrect'}));assert.equal(r.status,401);
r=await handler(req('login',{code:env.CLASS_CODE}));assert.equal(r.status,200);const token=(await r.json()).session;assert.ok(token);assert.ok(!token.includes(env.CLASS_CODE));
r=await handler(req('status',undefined,{'X-Pildam-Session':token}));const state=await r.json();assert.equal(state.authenticated,true);assert.equal(state.key,undefined);
const auth={'X-Pildam-Session':token,'X-App-Token':state.token};
r=await handler(req('ocr',{image:'/9j/dGVzdA=='},auth));assert.equal(r.status,200);assert.equal((await r.json()).text,'오늘은 맑음');assert.equal(visionCalls,1);
claimState='done';r=await handler(req('ocr',{image:'/9j/dGVzdA=='},auth));assert.equal((await r.json()).cached,true);assert.equal(visionCalls,1);
claimState='limit';r=await handler(req('ocr',{image:'/9j/dGVzdA=='},auth));assert.equal(r.status,429);assert.equal(visionCalls,1);
r=await handler(req('setup',{key:'replacement'},auth));assert.equal(r.status,404);
r=await handler(req('ocr',{image:'/9j/dGVzdA=='},{...auth,'X-Pildam-Session':token+'x'}));assert.equal(r.status,401);
console.log('PASS: CORS, unauthenticated rejection, signed sessions, server-only keys, cache/limit responses, no setup endpoint. Database mocked; migration needs Supabase validation.');
