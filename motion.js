import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js';
import {createMotionTracker} from './motion-tracking.js';
import {createRigDriver} from './retarget-rig.js';

const $=s=>document.querySelector(s),host=$('#character'),video=$('#camera');
let renderer,rig,model,spec,bounds,mode='body',loading=false,loadGeneration=0;
let results=null,demo=null,demoStart=0,lastFrame=0,driverStatus,resultCount=0,renderedFrames=0,lastDriverLabel='';
const scene=new THREE.Scene();scene.background=new THREE.Color('#e7edf4');
const camera=new THREE.PerspectiveCamera(31,1,.01,50);
try{
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.02;
  host.append(renderer.domElement);
}catch(error){$('#model-loading').textContent='此浏览器暂不支持三维显示，请换用较新的 Safari 或 Chrome。';throw error}
scene.add(new THREE.HemisphereLight(0xffffff,0x879aaa,2));
const key=new THREE.DirectionalLight(0xfff5e7,2.9);key.position.set(3,5,6);scene.add(key);
const fill=new THREE.DirectionalLight(0xe6f0ff,1.7);fill.position.set(-4,3,1);scene.add(fill);
const rim=new THREE.DirectionalLight(0xffffff,1.3);rim.position.set(0,3,-3);scene.add(rim);
const orbit=new OrbitControls(camera,renderer.domElement);orbit.enableDamping=true;orbit.enablePan=false;
orbit.minPolarAngle=Math.PI*.16;orbit.maxPolarAngle=Math.PI*.8;
let ground;
function frameView(){
  if(!bounds)return;
  const size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
  const height=size.y;
  if(mode==='face'){
    const target=center.clone();target.y=bounds.min.y+height*.825;
    const visibleHeight=height*.42;
    const distance=Math.max(visibleHeight/2/Math.tan(THREE.MathUtils.degToRad(camera.fov/2)),size.x*.53/camera.aspect/2/Math.tan(THREE.MathUtils.degToRad(camera.fov/2)))*1.1;
    camera.position.set(target.x,target.y,target.z+distance);orbit.target.copy(target);
  }else{
    // Fit an extended human arm span as well as the original narrow A-pose.
    const motionSpan=Math.max(size.x,height*1.22);
    const distance=Math.max(height/2/Math.tan(THREE.MathUtils.degToRad(camera.fov/2)),motionSpan/camera.aspect/2/Math.tan(THREE.MathUtils.degToRad(camera.fov/2)))*1.14;
    if(camera.aspect<.95)center.x+=height*.17;
    center.y+=height*.01;camera.position.set(center.x,center.y,center.z+distance);orbit.target.copy(center);
  }
  orbit.minDistance=height*.3;orbit.maxDistance=height*5;orbit.update();
}
function resize(){const r=host.getBoundingClientRect();if(r.width<1||r.height<1)return;renderer.setSize(r.width,r.height);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();frameView()}
new ResizeObserver(resize).observe(host);resize();
function signal(id,active,text){const element=$(id);if(element.dataset.live!==String(active))element.dataset.live=String(active);if(element.textContent!==text)element.textContent=text}
function showDriverStatus(){
  if(tracker.state.phase!=='live'||demo)return;
  const warning=tracker.state.detail||'';
  if((warning.includes('未提供可读取画面')&&(video.readyState<2||!video.videoWidth))||(warning.includes('帧回调未响应')&&!results)){
    if($('#tracking-status').textContent!==warning)$('#tracking-status').textContent=warning;
    $('#camera-badge').textContent='正在检查画面';lastDriverLabel='';return;
  }
  const live=driverStatus?.source==='camera',face=live&&driverStatus.faceDetected,body=live&&driverStatus.poseDetected;
  const label=face||body?'正在跟随':'寻找你';
  signal('#face-signal',face,face?'表情正在跟随':'未识别到脸');
  signal('#body-signal',body,mode==='face'?'仅追踪表情':body?(driverStatus.fullBody?'全身正在跟随':'上半身正在跟随'):'未识别到身体');
  if($('#camera-badge').textContent!==label)$('#camera-badge').textContent=label;
  const detail=mode==='face'?(face?'表情正在同步，试着眨眼、微笑或转头。':'看向镜头，让脸完整进入画面。'):
    body?(driverStatus.fullBody?'全身正在同步，试着抬手、侧身或屈膝。':'上半身正在同步。腿和脚进入画面后也会跟随。'):
    face?'表情正在同步。让肩膀和手臂进入画面，就能带动身体。':'让脸、肩膀和手臂进入镜头。只拍到上半身也可以跟随。';
  if(detail!==lastDriverLabel){lastDriverLabel=detail;$('#tracking-status').textContent=detail}
}
function clearSignals(){signal('#face-signal',false,'脸部待识别');signal('#body-signal',false,mode==='body'?'身体待识别':'仅追踪表情');$('#camera-badge').textContent='摄像头未开启'}
function refreshControls(phase){
  const pending=phase==='requesting'||phase==='loading',live=phase==='live';
  $('#start').hidden=live||pending;$('#start').disabled=!rig||pending;
  $('#start span').textContent=pending?'正在准备…':'开启摄像头';
  $('#stop').hidden=!live&&!pending;$('#stop').disabled=false;$('#stop').textContent=pending?'取消开启':'停止摄像头';
  $('#calibrate').disabled=!live;
  document.querySelectorAll('[data-demo]').forEach(button=>button.disabled=!rig||live||pending);
}
const tracker=createMotionTracker({video,onResults(value){if(!host.isConnected)return;if(value.stopped){results=null;clearPoints();clearSignals();return}results=value;resultCount++;drawPoints(value)},onState(value){
  if(!host.isConnected)return;
  const {phase,detail}=value;refreshControls(phase);
  if(phase==='live'){
    $('#camera-empty').hidden=true;$('#camera-badge').textContent='正在识别';
    lastDriverLabel='';$('#tracking-status').textContent=mode==='face'?'看向镜头，试着眨眼、微笑或转头。':'让肩膀和手臂进入画面；上半身也可以跟随。';
  }else if(phase==='requesting'){$('#tracking-status').textContent='请允许此页面使用摄像头。'}
  else if(phase==='loading'){$('#camera-empty').hidden=video.videoWidth>0;$('#camera-badge').textContent='画面已开启 · 准备识别';$('#tracking-status').textContent='正在准备动作识别，首次载入需要一点时间。'}
  else if(phase==='error'){
    results=null;rig?.reset();clearSignals();$('#camera-empty').hidden=false;
    $('#tracking-status').textContent=detail||'摄像头没有开启，请检查权限后重试。';
  }else if(phase==='stopped'||phase==='idle'){
    results=null;rig?.reset();clearSignals();clearPoints();$('#camera-empty').hidden=false;
    $('#tracking-status').textContent=detail||'摄像头已停止。点击开启后继续。';
  }
},onError(error){console.warn('Motion tracking unavailable:',error?.message||String(error))}});
tracker.setMode('body');
function clearPoints(){const c=$('#landmarks');c.getContext('2d').clearRect(0,0,c.width,c.height)}
function drawPoints(value){
  const canvas=$('#landmarks'),context=canvas.getContext('2d');
  const w=video.videoWidth||640,h=video.videoHeight||480;
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}
  context.clearRect(0,0,w,h);context.strokeStyle='#e7cf93';context.fillStyle='#f7ecd3';context.lineWidth=2;
  const points=value.pose?.landmarks?.[0];
  if(mode==='body'&&points){
    for(const [a,b] of [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]]){
      if((points[a].visibility??1)<.5||(points[b].visibility??1)<.5)continue;
      context.beginPath();context.moveTo(points[a].x*w,points[a].y*h);context.lineTo(points[b].x*w,points[b].y*h);context.stroke();
    }
    for(const i of [11,12,13,14,15,16,23,24,25,26,27,28]){const p=points[i];if((p.visibility??1)<.5)continue;context.beginPath();context.arc(p.x*w,p.y*h,3,0,Math.PI*2);context.fill()}
  }
}
function clearDemo(){demo=null;rig?.reset();$('#clear-demo').hidden=true;document.querySelectorAll('[data-demo]').forEach(button=>button.setAttribute('aria-pressed','false'));$('#demo-note').textContent='动作预览展示绑定效果，不会启动摄像头。'}
$('#start').onclick=async()=>{clearDemo();results=null;resultCount=0;lastDriverLabel='';await tracker.start()};
$('#stop').onclick=()=>tracker.stop('摄像头已停止。点击开启后继续。');
$('#calibrate').onclick=()=>{const calibrated=rig?.calibrate();$('#tracking-status').textContent=calibrated?'已校准。保持自然表情，再试着做动作。':'还没有识别到脸，请看向镜头后再校准。'};
$('#reset-view').onclick=frameView;
document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{
  mode=button.dataset.mode;$('.stage').dataset.mode=mode;tracker.setMode(mode);clearDemo();results=null;clearPoints();
  document.querySelectorAll('[data-mode]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
  $('#stage-hint').textContent=mode==='face'?'眨眼、微笑、转头。她会跟着你。':'抬手、侧身、屈膝。上半身也可以跟随。';
  lastDriverLabel='';if(tracker.state?.phase==='live')$('#tracking-status').textContent=mode==='face'?'看向镜头，试着眨眼、微笑或转头。':'让肩膀和手臂进入画面；上半身也可以跟随。';
  clearSignals();if(tracker.state.phase==='live')$('#camera-badge').textContent='正在识别';frameView();
});
document.querySelectorAll('[data-demo]').forEach(button=>button.onclick=()=>{
  clearDemo();demo=button.dataset.demo;demoStart=performance.now();button.setAttribute('aria-pressed','true');$('#clear-demo').hidden=false;
  const label=button.textContent;$('#demo-note').textContent=`正在预览${label}绑定；这不是摄像头追踪。`;
  if(demo==='wave'&&mode==='face'){
    document.querySelector('[data-mode=body]').click();demo=button.dataset.demo;demoStart=performance.now();
    button.setAttribute('aria-pressed','true');$('#clear-demo').hidden=false;
    $('#demo-note').textContent='正在预览挥手绑定；这不是摄像头追踪。';
  }
});
$('#clear-demo').onclick=clearDemo;
function disposeModel(root){if(!root)return;const mats=new Set(),textures=new Set();root.traverse(object=>{if(!object.isMesh)return;object.geometry.dispose();for(const mat of Array.isArray(object.material)?object.material:[object.material]){mats.add(mat);Object.values(mat).forEach(v=>{if(v?.isTexture)textures.add(v)})}});mats.forEach(m=>m.dispose());textures.forEach(t=>t.dispose())}
async function loadModel(){
  if(loading)return;loading=true;const generation=++loadGeneration;
  $('#model-error').hidden=true;$('#model-loading').hidden=false;$('#model-loading').textContent='正在准备角色…';
  try{
    const specResponse=await fetch('./motion-rig.json');if(!specResponse.ok)throw Error(`rig ${specResponse.status}`);spec=await specResponse.json();
    const modelPath=spec.model?.url||spec.model?.file||spec.modelFile||'models/lilinger-motion.glb';
    const response=await fetch('./'+modelPath);if(!response.ok)throw Error(`model ${response.status}`);
    const bytes=await response.arrayBuffer();
    const expected=spec.model?.sha256||spec.sha256;
    if(expected){const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==expected)throw Error('model integrity')}
    const decoder=new DRACOLoader();decoder.setDecoderPath('./vendor/draco/');decoder.setWorkerLimit(1);
    const loader=new GLTFLoader();loader.setDRACOLoader(decoder);let gltf;
    try{gltf=await loader.parseAsync(bytes,new URL('./',location.href).href)}finally{decoder.dispose()}
    if(generation!==loadGeneration||!host.isConnected){disposeModel(gltf.scene);return}
    tracker.stop();clearDemo();if(model){scene.remove(model);disposeModel(model)}
    model=gltf.scene;model.traverse(object=>{if(object.isMesh){object.frustumCulled=false;object.castShadow=false}});scene.add(model);
    bounds=new THREE.Box3().setFromObject(model);rig=createRigDriver(model,spec);
    if(ground){scene.remove(ground);ground.geometry.dispose();ground.material.dispose()}
    const size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
    ground=new THREE.Mesh(new THREE.CircleGeometry(size.y*.8,80),new THREE.MeshBasicMaterial({color:'#d3dce5',transparent:true,opacity:.32,depthWrite:false}));ground.rotation.x=-Math.PI/2;ground.position.set(center.x,bounds.min.y-.005,center.z);scene.add(ground);
    $('#poster').hidden=true;$('#model-loading').hidden=true;host.dataset.ready='true';frameView();refreshControls('idle');
    $('#tracking-status').textContent='授权摄像头后，用自己的表情和动作带动她。';
    document.dispatchEvent(new CustomEvent('lilinger:motion-ready'));
  }catch(error){host.dataset.ready='false';$('#model-loading').hidden=true;$('#model-error').hidden=false;console.error('Motion model unavailable:',error)}finally{loading=false}
}
$('#retry-model').onclick=loadModel;
function frame(now){
  requestAnimationFrame(frame);if(document.hidden||!host.isConnected||now-lastFrame<32)return;
  const dt=Math.min(.1,(now-lastFrame)/1000||.033);lastFrame=now;
  if(rig){
    if(demo){rig.demo(demo,(now-demoStart)/1000)}
    else if(results){rig.update(results,dt)}
    driverStatus=rig.status;
    showDriverStatus();
  }
  orbit.update();renderer.render(scene,camera);renderedFrames++;
}
requestAnimationFrame(frame);
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearDemo();tracker.stop('已离开页面，摄像头已停止。回来后点击开启继续。')}});
window.addEventListener('pagehide',()=>{tracker.stop('页面已离开，摄像头已停止。');clearDemo();results=null});
window.addEventListener('beforeunload',()=>tracker.stop());
// Read-only diagnostics distinguish real inference from the manual binding preview.
window.lilingerMotion={get state(){return{ready:!!rig,mode,phase:tracker.state?.phase||'idle',source:demo?'demo':driverStatus?.source||'none',faceDetected:!!driverStatus?.faceDetected,poseDetected:!!driverStatus?.poseDetected,resultCount,renderedFrames,pipeline:results?.pipeline||null,lastResultAgeMs:results?Math.round(performance.now()-(results.receivedAt||results.timestamp)):null,video:{width:video.videoWidth,height:video.videoHeight,readyState:video.readyState,paused:video.paused},inferenceMs:results?.inferenceMs||null,backend:results?.backend||null,rig:driverStatus,jointRotations:model?Object.fromEntries(['Head','LeftUpperArm','LeftLowerArm','RightUpperArm','RightLowerArm'].map(name=>[name,model.getObjectByName(name)?.quaternion.toArray()])):null,bones:model?(()=>{let n=0;model.traverse(o=>{if(o.isBone)n++});return n})():0}},get canvas(){return renderer.domElement}};
loadModel();
