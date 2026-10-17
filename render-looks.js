import * as THREE from 'three';

// Render-only experiment. The model, skeleton, morphs and motion driver stay intact.
export const LOOKS = Object.freeze({
  baseline: {label:'原渲染', detail:'已发布版本的材质与灯光。'},
  natural: {label:'柔光质感', detail:'保留肤色与衣纹，柔化皮肤反光，提亮发束与眼神。'},
  illustrated: {label:'插画层次', detail:'保留原贴图，以明暗色阶和暖冷边光塑造人物。'},
});

const KEY_DIRECTION = new THREE.Vector3(-3.4, 4.2, 5).normalize();

function surfaceParameters(source) {
  const output = {};
  for (const name of ['name','map','alphaMap','normalMap','normalMapType','bumpMap','bumpScale','roughnessMap','metalnessMap','emissiveMap','aoMap','aoMapIntensity','side','transparent','opacity','alphaTest','depthWrite','depthTest','vertexColors','flatShading','fog']) {
    if (source[name] !== undefined) output[name] = source[name];
  }
  output.color = source.color?.clone() || new THREE.Color(1,1,1);
  output.emissive = source.emissive?.clone() || new THREE.Color(0,0,0);
  if (source.normalScale) output.normalScale = source.normalScale.clone();
  return output;
}

function category(source, mesh) {
  const name = source.name.toLowerCase();
  if (/lash|eyebrow/i.test(mesh.name)) return 'brow';
  if (/hair/.test(name)) return 'hair';
  if (/m_head|m_body/.test(name)) return 'skin';
  if (/m_eye|m_iris/.test(name)) return 'eye';
  if (/metal|phong1/.test(name)) return 'metal';
  if (/dress/.test(name)) return 'fabric';
  return 'accessory';
}

function addShaderLayer(material, kind, look) {
  const natural = look === 'natural';
  material.onBeforeCompile = shader => {
    shader.uniforms.llKeyDirection = {value:KEY_DIRECTION};
    shader.fragmentShader = 'uniform vec3 llKeyDirection;\n' + shader.fragmentShader;
    let layer = '';
    if (natural && kind === 'skin') {
      // A small warm wrap approximation, not a subsurface-scattering pass.
      layer = `
        vec3 llLight = normalize((viewMatrix * vec4(llKeyDirection, 0.0)).xyz);
        float llWrap = pow(clamp((dot(normal, llLight) + 0.48) / 1.48, 0.0, 1.0), 2.0);
        float llShadow = 1.0 - smoothstep(0.08, 0.68, dot(normal, llLight));
        outgoingLight += diffuseColor.rgb * vec3(1.0, 0.38, 0.24) * llWrap * llShadow * 0.12;
      `;
    } else if (kind === 'hair') {
      // Hair has POSITION/NORMAL only. Do not invent UV tangents or enable
      // Three's anisotropy path without valid UVs. This is a directional glint.
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vLlrUp;').replace('#include <project_vertex>','vLlrUp = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));\n#include <project_vertex>');
      shader.fragmentShader='varying vec3 vLlrUp;\n'+shader.fragmentShader;
      layer = `
        vec3 llLight = normalize((viewMatrix * vec4(llKeyDirection, 0.0)).xyz);
        vec3 llUp = normalize(vLlrUp);
        vec3 llTangent = normalize(llUp - normal * dot(llUp, normal) + vec3(0.001));
        vec3 llView = normalize(vViewPosition);
        vec3 llHalf = normalize(llLight + llView);
        float llTangentHalf = dot(llTangent, llHalf);
        float llStrand = pow(sqrt(max(0.0, 1.0 - llTangentHalf * llTangentHalf)), ${natural ? '54.0' : '24.0'});
        float llFacing = smoothstep(-0.12, 0.36, dot(normal, llLight));
        float llEdge = pow(1.0 - clamp(dot(normal, llView), 0.0, 1.0), 3.0);
        outgoingLight += vec3(0.42, 0.27, 0.17) * llStrand * llFacing * ${natural ? '0.12' : '0.20'};
        outgoingLight += vec3(0.38, 0.48, 0.62) * llEdge * ${natural ? '0.055' : '0.12'};
      `;
    }
    if (!natural) layer += `
      vec3 llBandLight = normalize((viewMatrix * vec4(llKeyDirection, 0.0)).xyz);
      float llWarm = smoothstep(-0.15, 0.60, dot(normal, llBandLight));
      outgoingLight *= mix(vec3(0.79, 0.86, 1.0), vec3(1.04, 0.99, 0.90), llWarm);
      float llContour = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 4.0);
      outgoingLight += diffuseColor.rgb * vec3(0.31, 0.40, 0.55) * llContour * 0.12;
    `;
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', layer+'\n#include <opaque_fragment>');
  };
  material.customProgramCacheKey = () => `lilinger-render-v1-${look}-${kind}`;
}

function makeNatural(source, mesh) {
  const kind = category(source, mesh), parameters = surfaceParameters(source);
  let material;
  if (kind === 'skin') {
    material = new THREE.MeshPhysicalMaterial({...parameters, metalness:0, roughness:/head/i.test(source.name)?0.57:0.64, ior:1.4, specularIntensity:0.38, clearcoat:0, sheen:0});
  } else if (kind === 'eye') {
    material = new THREE.MeshPhysicalMaterial({...parameters, metalness:0, roughness:0.20, ior:1.38, specularIntensity:0.65, clearcoat:0});
  } else {
    material = source.clone();
    material.roughness = kind === 'hair' ? 0.43 : kind === 'brow' ? 0.78 : kind === 'fabric' ? 0.76 : kind === 'metal' ? 0.31 : 0.64;
    material.metalness = kind === 'metal' ? Math.min(0.64, source.metalness || 0.6) : 0;
  }
  material.name = source.name+' · natural';
  addShaderLayer(material, kind, 'natural');
  return material;
}

function makeIllustrated(source, mesh, gradientMap) {
  const kind = category(source, mesh);
  // Preserve face/clothing identity maps and the original skinned material path.
  const parameters = surfaceParameters(source);
  delete parameters.roughnessMap; delete parameters.metalnessMap; delete parameters.flatShading;
  const material = new THREE.MeshToonMaterial({...parameters, gradientMap});
  material.name = source.name+' · illustrated';
  addShaderLayer(material, kind, 'illustrated');
  return material;
}

function createStudioEnvironment(renderer) {
  const canvas = document.createElement('canvas'); canvas.width=256; canvas.height=128;
  const context = canvas.getContext('2d');
  const wash = context.createLinearGradient(0,0,0,128);
  wash.addColorStop(0,'#c3cfdf'); wash.addColorStop(0.48,'#b5bdc8'); wash.addColorStop(1,'#6b665f');
  context.fillStyle=wash; context.fillRect(0,0,256,128);
  const panel=(x,y,rx,ry,color)=>{
    context.save();context.translate(x,y);context.scale(rx,ry);
    const fade=context.createRadialGradient(0,0,0,0,0,1);fade.addColorStop(0,color);fade.addColorStop(0.45,color);fade.addColorStop(1,'rgba(255,255,255,0)');
    context.fillStyle=fade;context.fillRect(-1,-1,2,2);context.restore();
  };
  panel(54,39,35,34,'rgba(255,249,238,0.98)');
  panel(174,44,20,40,'rgba(223,236,255,0.88)');
  const source=new THREE.CanvasTexture(canvas);source.colorSpace=THREE.SRGBColorSpace;source.mapping=THREE.EquirectangularReflectionMapping;
  const generator=new THREE.PMREMGenerator(renderer);
  const target=generator.fromEquirectangular(source);source.dispose();generator.dispose();
  return target;
}

function createGroundTexture() {
  const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;
  const context=canvas.getContext('2d'),fade=context.createRadialGradient(64,64,8,64,64,64);
  fade.addColorStop(0,'rgba(255,255,255,0.75)');fade.addColorStop(0.45,'rgba(255,255,255,0.35)');fade.addColorStop(1,'rgba(255,255,255,0)');
  context.fillStyle=fade;context.fillRect(0,0,128,128);
  return new THREE.CanvasTexture(canvas);
}

export function createRenderLooks({renderer, scene, host}) {
  const original={background:scene.background.clone(),toneMapping:renderer.toneMapping,exposure:renderer.toneMappingExposure,environment:scene.environment,environmentIntensity:scene.environmentIntensity};
  const lights=new THREE.Group();lights.name='render-experiment-lights';scene.add(lights);
  const meshRecords=[];let current='baseline',model=null,ground=null,groundOriginal=null,environment=null,lastWidth=0,lastHeight=0;
  const gradient=new THREE.DataTexture(new Uint8Array([68,106,173,235]),4,1,THREE.RedFormat);
  gradient.minFilter=gradient.magFilter=THREE.NearestFilter;gradient.generateMipmaps=false;gradient.needsUpdate=true;
  const groundTexture=createGroundTexture();
  const addLight=(color,intensity,position)=>{const light=new THREE.DirectionalLight(color,intensity);light.position.set(...position);lights.add(light)};
  function setupLights(look) {
    lights.clear();
    if(look==='baseline'){
      lights.add(new THREE.HemisphereLight(0xffffff,0x879aaa,2));
      addLight(0xfff5e7,2.9,[3,5,6]);addLight(0xe6f0ff,1.7,[-4,3,1]);addLight(0xffffff,1.3,[0,3,-3]);
    }else if(look==='natural'){
      lights.add(new THREE.HemisphereLight(0xdce7f5,0x8e7d6f,0.72));
      addLight(0xffead4,3.0,[-3.4,4.2,5]);addLight(0xddeaff,0.55,[4,2.4,2]);addLight(0xd4e5ff,1.75,[2.0,3.5,-3.2]);
    }else{
      lights.add(new THREE.HemisphereLight(0xe5edff,0x9d8178,0.68));
      addLight(0xffefd4,2.7,[-3.4,4.2,5]);addLight(0x91b6e0,0.45,[4,1,1]);addLight(0xd5e8ff,1.1,[2,3,-3]);
    }
  }
  function resize(width,height) {
    lastWidth=width;lastHeight=height;
    const device=globalThis.devicePixelRatio||1;
    renderer.setPixelRatio(current==='baseline'?Math.min(device,1.5):Math.min(device,1.5,Math.sqrt(1100000/Math.max(1,width*height))));
  }
  function setLook(look) {
    if(!Object.hasOwn(LOOKS,look))throw new TypeError('Unknown render look');
    current=look;host.dataset.renderLook=look;document.documentElement.dataset.renderLook=look;
    setupLights(look);
    const natural=look==='natural';
    scene.background=look==='baseline'?original.background.clone():new THREE.Color(natural?'#e4e1dc':'#d5dee9');
    renderer.toneMapping=original.toneMapping;renderer.toneMappingExposure=look==='baseline'?original.exposure:natural?1.03:1.0;
    if(natural&&!environment)environment=createStudioEnvironment(renderer);
    scene.environment=natural?environment.texture:original.environment;
    scene.environmentIntensity=natural?0.32:original.environmentIntensity;
    for(const record of meshRecords)record.mesh.material=look==='baseline'?record.original:record[look];
    if(ground&&groundOriginal){
      ground.material.color.copy(look==='baseline'?groundOriginal.color:new THREE.Color(natural?'#8c857d':'#7c8fa6'));
      ground.material.opacity=look==='baseline'?groundOriginal.opacity:natural?0.27:0.21;
      ground.material.map=look==='baseline'?groundOriginal.map:groundTexture;ground.material.needsUpdate=true;
    }
    resize(lastWidth,lastHeight);
    if(lastWidth&&lastHeight)renderer.setSize(lastWidth,lastHeight);
    document.querySelectorAll('[data-render-look]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.renderLook===look)));
    const detail=document.getElementById('render-look-note');if(detail)detail.textContent=LOOKS[look].detail;
    document.dispatchEvent(new CustomEvent('lilinger:render-look',{detail:{look}}));
  }
  function detachModel() {
    for(const record of meshRecords){
      record.mesh.material=record.original;
      for(const look of ['natural','illustrated'])for(const material of Array.isArray(record[look])?record[look]:[record[look]])material.dispose();
    }
    if(ground&&groundOriginal){ground.material.map=groundOriginal.map;ground.material.color.copy(groundOriginal.color);ground.material.opacity=groundOriginal.opacity}
    meshRecords.length=0;model=null;ground=null;groundOriginal=null;
  }
  function attachModel(root, floor) {
    detachModel();model=root;ground=floor;
    groundOriginal={color:floor.material.color.clone(),opacity:floor.material.opacity,map:floor.material.map};
    root.traverse(mesh=>{
      if(!mesh.isMesh)return;
      const source=mesh.material,build=fn=>Array.isArray(source)?source.map(mat=>fn(mat,mesh)):fn(source,mesh);
      meshRecords.push({mesh,original:source,natural:build(makeNatural),illustrated:build((mat,obj)=>makeIllustrated(mat,obj,gradient))});
    });
    setLook(current);
  }
  setupLights('baseline');
  return {setLook,attachModel,detachModel,resize,get state(){return {look:current,label:LOOKS[current].label,modelAttached:!!model,meshCount:meshRecords.length,pixelRatio:renderer.getPixelRatio(),maxCandidatePixels:1100000,postprocessing:false,shadowPasses:0,extraModelDraws:0,environment:current==='natural'?'generated-256x128-studio':'none',approximation:'warm wrap and directional hair glint; no true SSS or strand simulation'}}};
}
