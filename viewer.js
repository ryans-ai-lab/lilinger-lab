import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js';
const $=s=>document.querySelector(s),host=$('#canvas-host'),status=$('#model-status');
const data=await fetch('./content.json').then(r=>r.json()),variants=data.model.variants;
let renderer,model,box,dimensions,center,wire=false,clay=false,dirty=true,visible=true,generation=0,abortController;
try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});}catch(e){status.textContent='此浏览器暂不支持三维显示';$('#model-error').hidden=false;throw e}
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.95;host.append(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color('#edf0ec');
const camera=new THREE.PerspectiveCamera(32,1,.01,1000),controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.autoRotateSpeed=.8;controls.maxPolarAngle=Math.PI*.94;controls.addEventListener('change',()=>dirty=true);
scene.add(new THREE.HemisphereLight(0xffffff,0x7e8d7a,1.7));const key=new THREE.DirectionalLight(0xfff5e2,2.3);key.position.set(3,5,5);scene.add(key);const fill=new THREE.DirectionalLight(0xe3efff,1.5);fill.position.set(-3,3,-2);scene.add(fill);
const draco=new DRACOLoader();draco.setDecoderPath('./vendor/draco/');draco.setWorkerLimit(2);const loader=new GLTFLoader();loader.setDRACOLoader(draco);
let grid;const originals=new Map();
function resize(){const r=host.getBoundingClientRect();if(r.width<1||r.height<1)return;renderer.setSize(r.width,r.height);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();dirty=true}new ResizeObserver(resize).observe(host);resize();
new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;dirty=true}).observe(host);document.addEventListener('visibilitychange',()=>dirty=true);
function rotate(state){controls.autoRotate=state;$('#rotate').setAttribute('aria-pressed',String(state));$('#rotate').textContent=state?'停止旋转':'旋转';dirty=true}
const reduced=matchMedia('(prefers-reduced-motion: reduce)');reduced.addEventListener('change',e=>{if(e.matches)rotate(false)});renderer.domElement.addEventListener('pointerdown',()=>{if(controls.autoRotate)rotate(false)});
function position(view='front'){if(!model)return;const h=dimensions.y,d=Math.max(h/2/Math.tan(THREE.MathUtils.degToRad(camera.fov/2)),dimensions.x/camera.aspect)*1.13,c=center.clone();if(view==='face'){c.y=center.y+h*.35;camera.position.set(c.x,c.y+.015,c.z+h*.68)}else if(view==='back')camera.position.set(c.x,c.y,c.z-d);else if(view==='side')camera.position.set(c.x+d,c.y,c.z);else camera.position.set(c.x,c.y,c.z+d);controls.target.copy(c);controls.update();$('#viewer').dataset.view=view;document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-pressed',String(b.dataset.view===view))});dirty=true;}
function dispose(root){const textures=new Set(),materials=new Set();root.traverse(m=>{if(!m.isMesh)return;m.geometry.dispose();for(const mat of Array.isArray(m.material)?m.material:[m.material]){materials.add(mat);for(const value of Object.values(mat))if(value?.isTexture)textures.add(value)}});textures.forEach(t=>t.dispose());materials.forEach(m=>m.dispose());}
function updateMaterials(){if(!model)return;model.traverse(m=>{if(!m.isMesh)return;if(m.userData.temporary){m.material.dispose();m.userData.temporary=false}if(clay){m.material=new THREE.MeshStandardMaterial({color:0xbdbcae,roughness:.78,side:THREE.DoubleSide,wireframe:wire});m.userData.temporary=true}else{m.material=originals.get(m);for(const mat of Array.isArray(m.material)?m.material:[m.material])mat.wireframe=wire}});dirty=true}
async function loadModel(quality='mobile'){const variant=variants[quality]||variants.mobile;if(!variant.bytes){$('#quality').value='web';return loadModel('web')}const id=++generation;abortController?.abort();abortController=new AbortController();$('#model-error').hidden=true;$('#save-view').disabled=true;$('#viewer').dataset.loading='true';status.textContent=`载入${variant.label}…`;document.dispatchEvent(new CustomEvent('lilinger:model-loading'));try{const response=await fetch('./'+variant.file,{signal:abortController.signal});if(!response.ok)throw new Error('HTTP '+response.status);const total=Number(response.headers.get('content-length'))||variant.bytes;const reader=response.body?.getReader();let buffer;if(reader){const chunks=[];let length=0;while(true){const {value,done}=await reader.read();if(done)break;chunks.push(value);length+=value.length;if(id===generation)status.textContent=`载入角色 ${Math.min(99,Math.round(length/total*100))}%`;}const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}buffer=bytes.buffer}else buffer=await response.arrayBuffer();if(id!==generation)return;if(buffer.byteLength!==variant.bytes)throw new Error('模型文件未完整下载');if(variant.sha256){const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==variant.sha256)throw new Error('模型文件校验未通过')}status.textContent='整理角色细节…';const gltf=await loader.parseAsync(buffer,new URL('./',location.href).href);if(id!==generation){dispose(gltf.scene);return}rotate(false);if(model){model.traverse(m=>{if(m.isMesh&&m.userData.temporary){m.material.dispose();m.material=originals.get(m);m.userData.temporary=false}});scene.remove(model);dispose(model);originals.clear()}model=gltf.scene;scene.add(model);model.traverse(m=>{if(m.isMesh){originals.set(m,m.material);m.frustumCulled=false}});box=new THREE.Box3().setFromObject(model);dimensions=box.getSize(new THREE.Vector3());center=box.getCenter(new THREE.Vector3());if(grid){scene.remove(grid);grid.geometry.dispose();grid.material.dispose()}grid=new THREE.GridHelper(dimensions.y*1.9,20,0xc4cfc6,0xdde3dc);grid.position.set(center.x,box.min.y-.005,center.z);scene.add(grid);controls.minDistance=dimensions.y*.15;controls.maxDistance=dimensions.y*6;updateMaterials();position('front');status.textContent=`${variant.label} · ${(variant.bytes/1e6).toFixed(1)} MB`;$('#download-model').href=variant.file;$('#compression-note').textContent=`原始显示模型 ${(data.model.sourceBytes/1e6).toFixed(0)}MB → 当前 ${(variant.bytes/1e6).toFixed(1)}MB，减少 ${(100*(1-variant.bytes/data.model.sourceBytes)).toFixed(1)}%。${data.model.hairPolicy}`;$('#viewer').dataset.ready='true';$('#model-poster').hidden=true;$('#save-view').disabled=false;window.labModel={loaded:true,quality,bytes:variant.bytes,triangles:variant.triangles,animations:gltf.animations.length,bounds:dimensions.toArray()};$('#viewer').dataset.loading='false';document.dispatchEvent(new CustomEvent('lilinger:model-ready',{detail:{quality,bytes:variant.bytes}}));dirty=true;}catch(e){if(e.name==='AbortError'||id!==generation)return;status.textContent='角色暂时未载入';$('#model-error').hidden=false;$('#viewer').dataset.ready='false';$('#viewer').dataset.loading='false';document.dispatchEvent(new CustomEvent('lilinger:model-error'));console.error(e)}}
$('#quality').onchange=e=>loadModel(e.target.value);$('#retry-model').onclick=()=>loadModel($('#quality').value);
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>position(b.dataset.view));$('#rotate').onclick=()=>rotate(!controls.autoRotate);$('#clay').onclick=e=>{clay=!clay;e.currentTarget.setAttribute('aria-pressed',String(clay));updateMaterials()};$('#wireframe').onclick=e=>{wire=!wire;e.currentTarget.setAttribute('aria-pressed',String(wire));updateMaterials()};$('#reset-view').onclick=()=>{rotate(false);clay=wire=false;$('#clay').setAttribute('aria-pressed','false');$('#wireframe').setAttribute('aria-pressed','false');updateMaterials();position('front')};
let lastFrame=0;function frame(now){requestAnimationFrame(frame);if(!visible||document.hidden||now-lastFrame<32)return;lastFrame=now;controls.update();if(dirty||controls.autoRotate){renderer.render(scene,camera);dirty=false}}requestAnimationFrame(frame);loadModel('mobile');
window.labViewer={position,renderer,scene,camera,controls};

export function captureTransparent({height=1200}={}) {
  if(!model || $('#viewer').dataset.loading==='true')throw new Error('人物尚未准备好');
  const background=scene.background,ground=grid?.visible,alpha=renderer.getClearAlpha();
  const size=renderer.getSize(new THREE.Vector2()),pixelRatio=renderer.getPixelRatio();
  const aspect=camera.aspect||1,scale=Math.min(1,1920/Math.max(height,height*aspect));
  const captureHeight=Math.max(1,Math.round(height*scale)),captureWidth=Math.max(1,Math.round(captureHeight*aspect));
  try {
    scene.background=null;if(grid)grid.visible=false;renderer.setClearAlpha(0);
    renderer.setPixelRatio(1);renderer.setSize(captureWidth,captureHeight,false);
    renderer.render(scene,camera);return renderer.domElement.toDataURL('image/png');
  } finally {
    scene.background=background;if(grid)grid.visible=ground;renderer.setClearAlpha(alpha);
    renderer.setPixelRatio(pixelRatio);renderer.setSize(size.x,size.y,false);
    renderer.render(scene,camera);dirty=true;
  }
}
export function viewerParameters(){return {quality:$('#quality').value,view:$('#viewer').dataset.view||'front',clay,wire,camera:camera.position.toArray(),target:controls.target.toArray(),aspect:camera.aspect,fov:camera.fov}}
export function validateParameters(value){
  const vector=item=>Array.isArray(item)&&item.length===3&&item.every(number=>Number.isFinite(number)&&Math.abs(number)<100000);
  if(!variants[value?.quality]||!vector(value.camera)||!vector(value.target)||!Number.isFinite(value.aspect)||value.aspect<.1||value.aspect>10||!Number.isFinite(value.fov)||value.fov<10||value.fov>100||!['front','face','back','side'].includes(value.view)||typeof value.clay!=='boolean'||typeof value.wire!=='boolean')throw new Error('相机参数格式不正确');
}
export async function restoreParameters(value){
  validateParameters(value);
  if($('#quality').value!==value.quality||$('#viewer').dataset.ready!=='true'){$('#quality').value=value.quality;await loadModel(value.quality)}
  if($('#viewer').dataset.loading==='true'||$('#viewer').dataset.ready!=='true')throw new Error('人物尚未准备好');
  rotate(false);clay=value.clay;wire=value.wire;updateMaterials();
  $('#clay').setAttribute('aria-pressed',String(clay));$('#wireframe').setAttribute('aria-pressed',String(wire));
  camera.position.fromArray(value.camera);controls.target.fromArray(value.target);camera.aspect=value.aspect;camera.fov=value.fov;camera.updateProjectionMatrix();controls.update();
  $('#viewer').dataset.view=value.view;document.querySelectorAll('[data-view]').forEach(button=>{button.classList.toggle('active',button.dataset.view===value.view);button.setAttribute('aria-pressed',String(button.dataset.view===value.view))});dirty=true;
}
let transparentDownload;
$('#save-view').onclick=()=>{if(!model)return;const link=$('#download-view'),data=captureTransparent().split(',')[1],binary=atob(data),bytes=Uint8Array.from(binary,character=>character.charCodeAt(0));if(transparentDownload)URL.revokeObjectURL(transparentDownload);transparentDownload=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));link.href=transparentDownload;link.hidden=false;link.click()};
