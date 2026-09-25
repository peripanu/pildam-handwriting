const apiBase=window.PILDAM_CONFIG?.apiBase||'';
let sessionToken='';
function apiFetch(path,options={}){
  if(!apiBase)return fetch(path,options);
  const headers=new Headers(options.headers||{});
  if(sessionToken)headers.set('X-Pildam-Session',sessionToken);
  return fetch(apiBase+path.replace(/^\/api/,''),{...options,headers,credentials:'omit'});
}
const $ = id => document.getElementById(id);
const camera=$('camera'), photo=$('photo');
let stream=null, busy=false, worker=null, run=0, hasPhoto=false, opening=false;
function status(text){$('status').textContent=text;}
function clearResult(){ $('result').classList.remove('show'); $('emptyScore').style.display='block'; }
function controls(){
  $('sentenceChoice').disabled=busy; $('reference').disabled=busy;
  $('cameraBtn').disabled=busy||opening;
  $('uploadBtn').disabled=busy||opening;
  $('captureBtn').disabled=busy||opening||(!hasPhoto&&!stream)||(!!stream&&!camera.videoWidth);
  $('captureBtn').textContent=stream?'사진 찍고 분석':'이 사진 분석하기';
  ['flipBtn','rotateBtn'].forEach(id=>$(id).disabled=busy||!hasPhoto||!!stream);
  $('cancelBtn').hidden=!busy;
  $('loading').classList.toggle('show',busy);
}
function stopCamera(){
  stream?.getTracks().forEach(t=>t.stop()); stream=null; camera.srcObject=null; camera.hidden=true;
  photo.hidden=!hasPhoto; $('placeholder').hidden=hasPhoto; $('cameraBtn').textContent='카메라 켜기'; controls();
}
async function showPhoto(src){
  const next=new Image(); next.src=src; await next.decode();
  stopCamera(); photo.src=src; await photo.decode(); hasPhoto=true; photo.hidden=false;
  $('placeholder').hidden=true; clearResult(); controls(); status('사진의 글자 방향을 확인한 뒤 분석해주세요.');
}
$('cameraBtn').onclick=async()=>{
  if(stream){stopCamera();return;}
  opening=true;controls();status('카메라 권한을 확인하고 있어요.');
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:window.matchMedia('(pointer: coarse)').matches?'environment':'user',width:{ideal:1600},height:{ideal:1200}},audio:false});
    camera.srcObject=stream; camera.hidden=false; photo.hidden=true; $('placeholder').hidden=true;
    await camera.play(); camera.style.transform=stream.getVideoTracks()[0].getSettings().facingMode==='environment'?'none':'scaleX(-1)'; $('cameraBtn').textContent='카메라 끄기'; clearResult(); status('글자가 화면에 크게 보이도록 종이와 카메라를 평행하게 맞춰주세요.');
  }catch(e){stopCamera();status('카메라를 열지 못했어요. 카메라 권한을 허용하거나 파일 업로드를 이용해주세요.');}
  finally{opening=false;controls();}
};
camera.onloadeddata=controls;
$('uploadBtn').onclick=()=>$('fileInput').click();
$('fileInput').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;
  if(!file.type.startsWith('image/')||file.size>20*1024*1024){status('20MB 이하의 이미지 파일을 선택해주세요.');return;}
  const url=URL.createObjectURL(file);
  try{await showPhoto(url);}catch(e){status('이미지를 열지 못했어요. JPG 또는 PNG 파일로 다시 선택해주세요.');}
  finally{URL.revokeObjectURL(url);}
};
function canvasFor(image){const c=document.createElement('canvas');const w=image.videoWidth||image.naturalWidth,h=image.videoHeight||image.naturalHeight;const scale=Math.min(1,2400/Math.max(w,h));c.width=Math.round(w*scale);c.height=Math.round(h*scale);return c;}
async function transform(rotate){
  const c=canvasFor(photo);if(rotate){[c.width,c.height]=[c.height,c.width];}
  const ctx=c.getContext('2d');ctx.translate(rotate?c.width:c.width,0);
  if(rotate){ctx.rotate(Math.PI/2);ctx.drawImage(photo,0,0,c.height,c.width);}else{ctx.scale(-1,1);ctx.drawImage(photo,0,0,c.width,c.height);}
  await showPhoto(c.toDataURL('image/png'));
}
$('flipBtn').onclick=()=>transform(false);$('rotateBtn').onclick=()=>transform(true);
$('captureBtn').onclick=async()=>{
  if(busy)return;
  try{
    if(stream){const c=canvasFor(camera);c.getContext('2d').drawImage(camera,0,0,c.width,c.height);await showPhoto(c.toDataURL('image/jpeg',.95));}
    await analyze();
  }catch(e){status('사진을 처리하지 못했어요. 다시 촬영해주세요.');}
};
$('sentenceChoice').onchange=()=>{
  const custom=$('sentenceChoice').value==='custom';$('reference').readOnly=!custom;
  $('reference').value=custom?'':$('sentenceChoice').value;clearResult();
  status('문장이 바뀌었어요. 새 문장을 쓴 사진으로 분석해주세요.');
  if(custom)$('reference').focus();
};
$('reference').oninput=()=>{clearResult();status('변경한 문장으로 다음 분석을 진행합니다.');};
function render(data,reference){
  const text=(data.text||'').trim();const result=SentenceComparison.compare(reference,text);const score=result.score;
  $('emptyScore').style.display='none';$('result').classList.add('show');
  $('total').textContent=score===null?'—':score;$('ring').style.setProperty('--score',score??0);
  $('grade').textContent=score===null?'글자를 찾지 못했어요':'문장 인식 일치도';
  $('summary').textContent=score===null?'점수를 내지 않았어요.':'지정 문장과 OCR 결과 비교 / 100';
  $('level').textContent='교정 연습 참고용';
  $('confidence').textContent=score===null?'측정 불가':score+'점';$('confidenceBar').style.width=(score??0)+'%';
  $('ocrText').textContent=text||'인식된 텍스트가 없습니다.';
  const issues=result.edits.filter(e=>e.type!=='match');
  const count=type=>issues.filter(e=>e.type===type).length;
  $('counts').textContent=score===null?'인식 결과가 없어 비교할 수 없습니다.':`원문 ${result.length}글자 · 일치 ${result.matched} · 다르게 인식 ${count('replace')} · 누락 ${count('missing')} · 추가 ${count('extra')}`;
  $('diff').replaceChildren();$('differences').replaceChildren();
  if(score!==null)for(const edit of result.edits){
    const el=document.createElement(edit.type==='replace'?'mark':'span');el.className=edit.type;
    el.textContent=edit.expected||('['+edit.actual+']');$('diff').append(el);
    if(edit.type!=='match'){
      const li=document.createElement('li');li.textContent=edit.type==='replace'?`${edit.position}번째 ‘${edit.expected}’ → ‘${edit.actual}’로 인식`:edit.type==='missing'?`${edit.position}번째 ‘${edit.expected}’ 인식 누락`:`${edit.position}글자 뒤에 ‘${edit.actual}’ 추가 인식`;
      $('differences').append(li);
    }
  }
  $('feedback').textContent=score===null?'쓴 문장이 크게 보이도록 밝은 곳에서 다시 찍어주세요. OCR이 손글씨를 읽지 못한 경우일 수도 있어요.':score===100?'원문과 모두 일치했어요. 같은 문장을 다시 쓰면서 글자 크기와 간격도 살펴보세요.':'표시된 글자를 사진과 비교해주세요. 획이 붙었는지, 자음·모음이 구별되는지 살펴보고 같은 문장을 다시 써보세요. OCR의 오류일 수도 있으므로 표시된 글자를 모두 잘못 쓴 것으로 보지는 마세요.';
}
let cloudState=null, controller=null;
const localMode=['127.0.0.1','localhost'].includes(location.hostname);
$('teacherLink').hidden=!localMode;
$('teacherPanel').hidden=!(localMode&&new URLSearchParams(location.search).has('teacher'));
if(!$('teacherPanel').hidden)$('teacherPanel').open=true;
async function refreshCloud(){
  try{
    const response=await apiFetch('/api/status',{cache:'no-store'});
    if(!response.ok)throw new Error();cloudState=await response.json();
    const needsLogin=cloudState.requiresLogin&&!cloudState.authenticated;
    $('teacherLink').hidden=!localMode||!!cloudState.requiresLogin;
    if(cloudState.requiresLogin)$('teacherPanel').hidden=true;
    $('loginPanel').hidden=!needsLogin;$('studentWorkspace').hidden=needsLogin;
    $('cloudStatus').textContent=needsLogin?'수업 코드로 들어오면 사진을 분석할 수 있어요.':cloudState.configured?'손글씨 인식 준비 완료':localMode&&!cloudState.requiresLogin?'아직 연결되지 않았어요. 위쪽 선생님 설정에서 키를 연결해주세요.':'선생님이 인식 서비스를 준비하고 있어요. 잠시 후 다시 접속해주세요.';
    if(localMode&&new URLSearchParams(location.search).has('teacher')&&cloudState.configured)$('cloudStatus').textContent+=` · 누적 외부 요청 ${cloudState.used} / ${cloudState.limit}건`;
    $('keySetup').hidden=!localMode;
  }catch(e){cloudState=null;$('cloudStatus').textContent='연결 상태를 확인하지 못했어요. 인터넷 연결을 확인하고 새로고침해주세요.';}
}
$('loginForm').onsubmit=async event=>{
  event.preventDefault();$('loginBtn').disabled=true;$('loginError').textContent='';
  try{
    const response=await apiFetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:$('classCode').value})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'수업 코드를 확인해주세요.');
    if(data.session)sessionToken=data.session;
    $('classCode').value='';await refreshCloud();
  }catch(error){$('loginError').textContent=error.message;}
  finally{$('loginBtn').disabled=false;}
};
$('connectKey').onclick=async()=>{
  if(!cloudState){status('외부 OCR용 로컬 앱을 먼저 열어주세요.');return;}
  try{
    const response=await apiFetch('/api/setup',{method:'POST',headers:{'Content-Type':'application/json','X-App-Token':cloudState.token},body:JSON.stringify({key:$('apiKey').value})});
    const data=await response.json();if(!response.ok)throw new Error(data.error);
    $('apiKey').value='';await refreshCloud();status('키를 메모리에 연결했어요. 실제 연결 상태는 첫 분석 때 확인됩니다.');
  }catch(e){status(e.message);}
};
async function cancel(message){run++;busy=false;controller?.abort();controller=null;controls();status(message);}
$('cancelBtn').onclick=()=>cancel('화면의 분석 대기를 취소했어요. 이미 전송된 요청은 사용량에 포함될 수 있습니다. 같은 사진으로 재시도하면 완료된 결과를 재사용합니다.');
async function analyze(){
  if(busy||!hasPhoto)return;
  const reference=$('reference').value.trim();
  if(!SentenceComparison.normalize(reference).length){status('따라 쓸 문장을 먼저 입력해주세요.');$('reference').focus();return;}
  await refreshCloud();
  if(cloudState?.requiresLogin&&!cloudState.authenticated){status('수업 코드를 먼저 입력해주세요.');return;}
  if(!cloudState?.configured){status('외부 OCR 연결을 먼저 완료해주세요. 기존 OCR로 대신 채점하지 않습니다.');return;}
  if(busy)return;
  const id=++run;busy=true;clearResult();controls();controller=new AbortController();
  status('사진을 Google Cloud Vision으로 전송해 읽고 있어요.');
  $('loading').querySelector('strong').textContent='손글씨를 읽고 있어요';
  $('loading').querySelector('small').textContent='원문을 알려주지 않고 사진만 인식합니다';
  const timer=setTimeout(()=>{if(id===run)cancel('응답 대기 시간이 초과됐어요. 자동 재시도는 하지 않습니다.');},65000);
  try{
    const c=canvasFor(photo),ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(photo,0,0,c.width,c.height);
    const response=await apiFetch('/api/ocr',{method:'POST',headers:{'Content-Type':'application/json','X-App-Token':cloudState.token},body:JSON.stringify({image:c.toDataURL('image/jpeg',.92).split(',')[1]}),signal:controller.signal});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'분석에 실패했습니다.');
    if(id!==run)return;render(data,reference);$('level').textContent='Google Cloud Vision';status(data.cached?'같은 사진의 결과를 재사용했어요. 외부 요청은 추가되지 않았습니다.':'분석이 끝났어요. 인식한 글자를 원문과 비교해주세요.');
    await refreshCloud();
  }catch(e){if(id===run){clearResult();status(e.message||'분석에 실패해 점수를 내지 않았습니다.');}}
  finally{clearTimeout(timer);if(id===run){controller=null;busy=false;controls();}}
}
window.addEventListener('pagehide',()=>{stopCamera();cancel('');});
controls();refreshCloud();
