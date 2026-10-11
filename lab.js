const $ = selector => document.querySelector(selector);
const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const readJSON = async file => {
  const response = await fetch(file);
  if (!response.ok) throw new Error('资料暂未载入');
  return response.json();
};
const [content, catalog] = await Promise.all([readJSON('./content.json'), readJSON('./catalog.json')]).catch(error=>{
  $('#compose-status').textContent='资料未成功载入，请刷新页面重试。';
  $('#guide-count').textContent=$('#asset-count').textContent='资料未成功载入，请刷新页面重试。';
  throw error;
});
const topics = content.topics;
const answers = content.answers;
const topicById = id => topics.find(topic => topic.id === id);
const answerById = id => answers.find(answer => answer.id === id);
const citation = answer => answer.kind + ' · 《' + answer.sourceTitle + '》' + answer.reference + (answer.line ? ' · 文本第' + answer.line + '行' : '');
const photoRelation = (answer, topic) => '配图：' + topic.title + ' · 《' + topic.sourceTitle + '》' + topic.question + ' · ' + topic.photoDate + (answer.id === 'jiuhai' ? '。陶坛仅作同主题参照，不是酒海实物图。' : '');
const publicBase = 'https://ryanlab.cn/lilinger/';
const publicURL = file => new URL(file, publicBase).href;
const projectFor = (answer,topic) => answer.id==='museum-connection' ? 'https://ryanlab.cn/qhwxg/' : topic.connection;
let mode = 'compose';
let viewerPromise;
let viewer;
let subject;
let capturedModel;
let captureGeneration = 0;
let posterGeneration = 0;
let posterReady = false;
let preset = 'factory';
const imageCache = new Map();
const downloads = new Map();

function image(file, cache = true) {
  if (cache && imageCache.has(file)) return imageCache.get(file);
  const promise = new Promise((resolve, reject) => {
    const picture = new Image();
    picture.onload = () => resolve(picture);
    picture.onerror = () => { imageCache.delete(file); reject(new Error('图片暂时未载入')); };
    picture.src = file;
  });
  if (cache) imageCache.set(file, promise);
  return promise;
}
function offerDownload(id, blob, filename) {
  const link = $(id);
  if (downloads.has(id)) URL.revokeObjectURL(downloads.get(id));
  const url = URL.createObjectURL(blob);
  downloads.set(id, url);
  link.href = url;
  link.download = filename;
  link.hidden = false;
  link.click();
}
function offerJSON(id, value, filename) {
  offerDownload(id, new Blob([JSON.stringify(value, null, 2) + '\n'], {type: 'application/json'}), filename);
}
function ensureViewer() {
  if (!viewerPromise) viewerPromise = import('./viewer.js').then(module => { viewer = module; return module; });
  return viewerPromise;
}
function setMode(value, {focus = false} = {}) {
  mode = ['compose', 'guide', 'assets'].includes(value) ? value : 'compose';
  document.querySelectorAll('[data-mode]').forEach(button => {
    const active = button.dataset.mode === mode;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
    $('#pane-' + button.dataset.mode).hidden = !active;
  });
  if (focus) $('#tab-' + mode).focus();
  history.replaceState(null, '', '#' + mode);
  if (mode === 'compose') {
    ensureViewer().catch(error => { $('#compose-status').textContent = error.message; });
    renderPoster();
  }
}
const modeNames = ['compose', 'guide', 'assets'];
document.querySelectorAll('[data-mode]').forEach(button => {
  button.onclick = () => setMode(button.dataset.mode);
  button.onkeydown = event => {
    const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (offset) { event.preventDefault(); setMode(modeNames[(modeNames.indexOf(mode) + offset + 3) % 3], {focus:true}); }
  };
});

// Composition keeps the photo and text bound to one selected source record.
for (const topic of topics) $('#poster-topic').append(new Option(topic.label, topic.id));
function updateAnswerOptions(preferred) {
  const options = answers.filter(answer => answer.topic === $('#poster-topic').value);
  $('#poster-answer').replaceChildren(...options.map(answer => new Option(answer.question, answer.id)));
  if (options.some(answer => answer.id === preferred)) $('#poster-answer').value = preferred;
}
function shortExcerpt(answer) {
  const match = answer.answer.match(/^.*?[。！？]/);
  return match ? match[0] : answer.answer;
}
function wrapText(context, text, x, y, width, lineHeight, maximum = Infinity) {
  let line = '', lines = [];
  for (const character of text) {
    if (context.measureText(line + character).width > width && line) { lines.push(line); line = character; }
    else line += character;
  }
  if (line) lines.push(line);
  if (lines.length > maximum) {
    lines = lines.slice(0, maximum);
    let final = lines[maximum - 1];
    while (final && context.measureText(final + '…').width > width) final = final.slice(0, -1);
    lines[maximum - 1] = final + '…';
  }
  lines.forEach((value, index) => context.fillText(value, x, y + index * lineHeight));
  return y + lines.length * lineHeight;
}
function cover(context, picture, x, y, width, height, focus) {
  const factor = Math.max(width / picture.width, height / picture.height);
  const sourceWidth = width / factor, sourceHeight = height / factor;
  const sourceX = (picture.width - sourceWidth) * focus;
  const sourceY = (picture.height - sourceHeight) * focus;
  context.drawImage(picture, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}
function trimSubject(picture) {
  const canvas = document.createElement('canvas');
  canvas.width = picture.width; canvas.height = picture.height;
  const context = canvas.getContext('2d', {willReadFrequently:true});
  context.drawImage(picture, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    if (pixels[(y * canvas.width + x) * 4 + 3] < 2) continue;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right < 0) throw new Error('人物取景为空，请换一个视角');
  const result = document.createElement('canvas');
  result.width = right - left + 1; result.height = bottom - top + 1;
  result.getContext('2d').drawImage(canvas, left, top, result.width, result.height, 0, 0, result.width, result.height);
  return result;
}
async function captureSubject() {
  const token = ++captureGeneration;
  try {
    const module = await ensureViewer();
    const parameters = module.viewerParameters();
    const picture = await image(module.captureTransparent({height:1400}), false);
    if (token !== captureGeneration) return;
    subject = trimSubject(picture);
    capturedModel = parameters;
    $('#use-camera').disabled = false;
    await renderPoster();
  } catch (error) { $('#compose-status').textContent = error.message; }
}
document.addEventListener('lilinger:model-loading', () => {
  captureGeneration++;
  posterReady = false;
  $('#export-poster').disabled = $('#export-layout').disabled = $('#import-layout').disabled = $('#use-camera').disabled = true;
  $('#compose-status').textContent = '正在载入人物，资料图片可以先看。';
});
document.addEventListener('lilinger:model-ready', () => captureSubject());
document.addEventListener('lilinger:model-error', () => {
  captureGeneration++;
  posterReady=false;
  $('#export-poster').disabled=$('#export-layout').disabled=$('#import-layout').disabled=$('#use-camera').disabled=true;
  $('#compose-status').textContent='人物载入失败，请在下方取景器中重新载入，或换一个画质版本。';
  $('#camera-details').open=true;
});
$('#use-camera').onclick = captureSubject;
function composeParameters() {
  const topic = topicById($('#poster-topic').value);
  const answer = answerById($('#poster-answer').value);
  return {
    type:'lilinger-composition', version:2, sourceVersion:catalog.publicVersion, preset, ratio:$('#poster-ratio').value,
    subjectSide:$('#subject-side').value, subjectPercent:Number($('#subject-size').value),
    photoFocusPercent:Number($('#photo-focus').value), model:capturedModel,
    modelFile:capturedModel ? content.model.variants[capturedModel.quality].file : null,
    modelSha256:capturedModel ? content.model.variants[capturedModel.quality].sha256 : null,
    image:{file:topic.image,sha256:catalog.assets.find(asset=>asset.file===topic.image).sha256,source:photoRelation(answer,topic)},
    text:{id:answer.id,question:answer.question,excerpt:shortExcerpt(answer),citation:citation(answer)},
    composite:true, note:'静态角色与历史配图合成，不证明人物到场或当前厂区现状。'
  };
}
async function renderPoster() {
  const token = ++posterGeneration;
  posterReady = false;
  $('#export-poster').disabled = $('#export-layout').disabled = $('#import-layout').disabled = true;
  const topic = topicById($('#poster-topic').value);
  const answer = answerById($('#poster-answer').value);
  if (!topic || !answer) return;
  const ratio = $('#poster-ratio').value;
  const sizes = {landscape:[1920,1080],portrait:[1080,1920],square:[1600,1600]};
  const [width,height] = sizes[ratio];
  const canvas = $('#poster');
  canvas.width = width; canvas.height = height;
  $('#poster-wrap').dataset.ratio = ratio;
  $('#subject-size-label').value = $('#subject-size').value + '%';
  $('#photo-focus-label').value = $('#photo-focus').value + '%';
  $('#poster-answer-full').textContent = answer.answer;
  $('#poster-citation').textContent = citation(answer);
  $('#poster-photo-relation').textContent = photoRelation(answer,topic);
  $('#poster-project').href = projectFor(answer,topic);
  $('#compose-status').textContent = '正在更新讲解卡…';
  try {
    const picture = await image(topic.image);
    if (token !== posterGeneration) return;
    const context = canvas.getContext('2d');
    const portrait = ratio === 'portrait';
    const left = $('#subject-side').value === 'left';
    context.fillStyle = '#eff2ed'; context.fillRect(0,0,width,height);
    cover(context,picture,0,0,width,height,Number($('#photo-focus').value)/100);
    const gradient = context.createLinearGradient(left ? width : 0,0,left ? 0 : width,0);
    gradient.addColorStop(0,'rgba(251,251,248,.96)');
    gradient.addColorStop(portrait ? .72 : .58,'rgba(251,251,248,.91)');
    gradient.addColorStop(1,'rgba(251,251,248,.1)');
    context.fillStyle = gradient; context.fillRect(0,0,width,height);
    const margin = portrait ? 72 : 96;
    const textX = left && !portrait ? width * .48 : margin;
    const textWidth = portrait ? width - margin*2 : width * .44;
    context.textBaseline = 'top';
    context.fillStyle = '#174782';
    context.font = '500 ' + (portrait ? 36 : 34) + 'px "PingFang SC",sans-serif';
    context.fillText('李灵儿 · ' + ({factory:'数字酒厂导览',training:'工艺讲解',storyboard:'内容取景'})[preset],textX,margin);
    context.fillStyle = '#172d3b';
    context.font = '600 ' + (portrait ? 78 : 82) + 'px "Songti SC",SimSun,serif';
    const titleBottom = wrapText(context,answer.question,textX,margin+72,textWidth,portrait?100:104,3);
    context.font = '400 ' + (portrait ? 48 : 48) + 'px "PingFang SC",sans-serif';
    const textBottom = wrapText(context,shortExcerpt(answer),textX,titleBottom+30,textWidth,72,portrait?6:5);
    context.fillStyle = '#ad9053'; context.fillRect(textX,margin+55,95,5);
    if (subject) {
      const targetHeight = Math.min(height * Number($('#subject-size').value)/100,portrait ? height-textBottom-270 : height-230);
      const maximumWidth = portrait ? width*.72 : width*.48;
      const factor = Math.min(targetHeight/subject.height,maximumWidth/subject.width);
      const subjectWidth = subject.width*factor, subjectHeight = subject.height*factor;
      const x = left ? margin*.4 : width-subjectWidth-margin*.25;
      const y = height-subjectHeight-190;
      context.save(); context.shadowColor='rgba(23,45,59,.14)'; context.shadowBlur=14;
      context.drawImage(subject,x,y,subjectWidth,subjectHeight); context.restore();
    }
    context.fillStyle = 'rgba(251,251,248,.97)';context.fillRect(0,height-160,width,160);
    context.fillStyle = '#172d3b';context.font='500 27px "PingFang SC",sans-serif';
    context.fillText('合成实验 · 静态角色与历史资料配图',margin,height-140);
    context.fillStyle = '#626f75';context.font='400 23px "PingFang SC",sans-serif';
    wrapText(context,'正文：'+answer.sourceTitle+' '+answer.reference,margin,height-103,width-margin*2,29,1);
    wrapText(context,'配图：'+topic.title+' · '+topic.sourceTitle+' '+topic.question+(answer.id==='jiuhai'?' · 陶坛仅作主题参照':''),margin,height-70,width-margin*2,29,1);
    context.fillText('2024年资料摘编 · 配图拍摄日期未核实 · 实验版本 '+catalog.publicVersion,margin,height-37);
    canvas.setAttribute('aria-label',answer.question+'，李灵儿与'+topic.title+'的合成实验预览');
    posterReady = Boolean(subject) && $('#viewer').dataset.ready === 'true' && $('#viewer').dataset.loading !== 'true';
    $('#export-poster').disabled = $('#export-layout').disabled = $('#import-layout').disabled = !posterReady;
    $('#compose-status').textContent = posterReady
      ? '讲解卡已更新 · ' + width + ' × ' + height + ' · 可导出'
      : '资料已经准备好，人物仍在载入；完成后即可导出。';
  } catch (error) { if(token===posterGeneration) $('#compose-status').textContent=error.message+'，可以换一个主题或重新取景。'; }
}
$('#poster-topic').onchange = () => { updateAnswerOptions();renderPoster(); };
for (const id of ['poster-answer','poster-ratio','subject-side','subject-size','photo-focus']) {
  $('#' + id).addEventListener(id==='subject-size'||id==='photo-focus'?'input':'change',renderPoster);
}
const presets = {
  factory:{topic:'campus',ratio:'landscape',side:'right',size:76},
  training:{topic:'qu',ratio:'portrait',side:'right',size:52},
  storyboard:{topic:'storage',ratio:'landscape',side:'left',size:70}
};
function applyPreset(name) {
  preset = name;
  const values = presets[name];
  $('#poster-topic').value = values.topic;updateAnswerOptions();
  $('#poster-ratio').value=values.ratio;$('#subject-side').value=values.side;$('#subject-size').value=values.size;$('#photo-focus').value=50;
  document.querySelectorAll('[data-preset]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.preset===name)));
  renderPoster();
}
document.querySelectorAll('[data-preset]').forEach(button=>button.onclick=()=>applyPreset(button.dataset.preset));
$('#export-poster').onclick = () => {
  if (!posterReady) return;
  const ratio = $('#poster-ratio').value;
  $('#poster').toBlob(blob => { if(blob)offerDownload('#poster-download',blob,'lilinger-card-'+ratio+'.png'); },'image/png');
};
$('#export-layout').onclick = () => { if(posterReady)offerJSON('#layout-download',composeParameters(),'lilinger-layout.json'); };
$('#import-layout').onclick = () => $('#layout-input').click();
$('#layout-input').onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 100000) throw new Error('参数文件过大');
    const value = JSON.parse(await file.text());
    const answer = answerById(value.text?.id),topic = answer && topicById(answer.topic);
    const variant = content.model.variants[value.model?.quality];
    const validPercent = (number,minimum,maximum) => Number.isFinite(number) && number>=minimum && number<=maximum;
    if(value.type!=='lilinger-composition'||value.version!==2||value.sourceVersion!==catalog.publicVersion||!answer||!presets[value.preset]||!['landscape','portrait','square'].includes(value.ratio)||!['left','right'].includes(value.subjectSide)||!validPercent(value.subjectPercent,45,88)||!validPercent(value.photoFocusPercent,0,100)||!variant||value.modelFile!==variant.file||value.modelSha256!==variant.sha256||value.image?.file!==topic.image||value.image.sha256!==catalog.assets.find(asset=>asset.file===topic.image).sha256)throw new Error('参数与当前资料或素材版本不对应');
    const module=await ensureViewer();
    module.validateParameters(value.model);
    $('#compose-status').textContent='正在恢复取景与构图…';
    preset=value.preset;
    document.querySelectorAll('[data-preset]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.preset===preset)));
    $('#poster-topic').value=topic.id;updateAnswerOptions(answer.id);
    $('#poster-ratio').value=value.ratio;$('#subject-side').value=value.subjectSide;$('#subject-size').value=value.subjectPercent;$('#photo-focus').value=value.photoFocusPercent;
    await module.restoreParameters(value.model);
    await captureSubject();
  } catch(error) { $('#compose-status').textContent='未导入：'+error.message+'。可以继续使用当前构图。'; }
  finally { event.target.value=''; }
};
applyPreset('factory');

// Source navigation and an editable route use only the curated public records.
let guideTopic='all',guideSelection=answers[0].id,route=[],routeIndex=-1;
const sourceGroup = answer => answer.kind==='实验说明'?'experiment':answer.sourceTitle.includes('技术')?'technical':'enterprise';
function showGuide(answer) {
  guideSelection=answer.id;
  const topic=topicById(answer.topic);
  $('#guide-title').textContent=answer.question;
  $('#guide-answer').textContent=answer.answer;
  $('#guide-citation').textContent=citation(answer);
  const photo = $('#guide-photo');
  photo.hidden = true;
  photo.onload = () => { photo.hidden = false; };
  photo.onerror = () => { photo.hidden = true; $('#guide-photo-note').textContent += ' · 配图暂未载入'; };
  photo.src=topic.image;photo.alt=topic.imageAlt;
  $('#guide-photo-note').textContent=photoRelation(answer,topic);
  $('#guide-project').href=projectFor(answer,topic);
  document.querySelectorAll('[data-answer]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.answer===answer.id)));
  $('#add-route').disabled=route.includes(answer.id);
  $('#add-route').textContent=route.includes(answer.id)?'已在我的路径里':'加入我的路径';
}
function renderGuide() {
  const group=$('#guide-source').value;
  const matches=answers.filter(answer=>(group==='all'||sourceGroup(answer)===group)&&(guideTopic==='all'||answer.topic===guideTopic));
  $('#guide-count').textContent='当前有 '+matches.length+' 条内容，每条保留问题、来源和配图关系。';
  const list=$('#guide-questions');list.replaceChildren();
  $('#guide-detail').hidden=!matches.length;
  if(!matches.length){list.append(element('p','这一来源里暂未收录该主题，可以切换来源或查看全部主题。','empty-guide'));return;}
  for(const answer of matches){const button=element('button',answer.question);button.dataset.answer=answer.id;button.append(element('span',answer.kind+' · '+answer.sourceTitle));button.onclick=()=>showGuide(answer);list.append(button);}
  showGuide(matches.find(answer=>answer.id===guideSelection)||matches[0]);
}
$('#guide-source').onchange=()=>{guideTopic='all';document.querySelectorAll('[data-stop]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.stop==='all')));renderGuide();};
document.querySelectorAll('[data-stop]').forEach(button=>button.onclick=()=>{guideTopic=button.dataset.stop;document.querySelectorAll('[data-stop]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));renderGuide();});
function renderRoute() {
  const list=$('#route-list');list.replaceChildren();
  for(const id of route){const answer=answerById(id),item=element('li',answer.question),remove=element('button','移除');remove.setAttribute('aria-label','移除 '+answer.question);remove.onclick=()=>{route=route.filter(value=>value!==id);routeIndex=-1;renderRoute();showGuide(answerById(guideSelection));};item.append(remove);list.append(item);}
  $('#route-status').textContent=route.length?'已选 '+route.length+' 条资料，可开始导览或导出。':'选择问题，再加入路径。';
  for(const id of ['play-route','next-route','export-route'])$('#'+id).disabled=!route.length;
}
$('#add-route').onclick=()=>{if(!route.includes(guideSelection))route.push(guideSelection);renderRoute();showGuide(answerById(guideSelection));};
function routeStep(index) {
  if(!route.length)return;
  routeIndex=(index+route.length)%route.length;
  $('#guide-source').value='all';guideTopic='all';document.querySelectorAll('[data-stop]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.stop==='all')));
  guideSelection=route[routeIndex];renderGuide();
  $('#route-status').textContent='正在走第 '+(routeIndex+1)+' / '+route.length+' 条：'+answerById(guideSelection).question;
  $('#guide-detail').scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
}
$('#play-route').onclick=()=>routeStep(0);$('#next-route').onclick=()=>routeStep(routeIndex+1);
$('#export-route').onclick=()=>offerJSON('#route-download',{type:'lilinger-source-route',version:1,steps:route.map(id=>{const answer=answerById(id),topic=topicById(answer.topic);return {id,question:answer.question,answer:answer.answer,citation:citation(answer),image:publicURL(topic.image),imageRelation:photoRelation(answer,topic),project:projectFor(answer,topic)};}),scope:'历史资料摘编与实验说明；不是当前业务确认。'},'lilinger-route.json');
$('#guide-to-poster').onclick=()=>{const answer=answerById(guideSelection);$('#poster-topic').value=answer.topic;updateAnswerOptions(answer.id);setMode('compose');$('#tab-compose').scrollIntoView({block:'start'});};
renderGuide();renderRoute();

// Download links and manifests refer to the same bytes actually listed in catalog.json.
const selectedAssets=new Set();
const kindNames={model:'静态模型',image:'主题图片',video:'表情视频',preview:'表情预览'};
function selectedSummary() {
  const assets=catalog.assets.filter(asset=>selectedAssets.has(asset.id));
  const bytes=assets.reduce((total,asset)=>total+asset.bytes,0);
  $('#selection-status').textContent=assets.length?'已选 '+assets.length+' 件 · '+(bytes/1e6).toFixed(2)+' MB':'还没有选用素材。';
  $('#export-assets').disabled=!assets.length;
}
function visibleAssets(){return catalog.assets.filter(asset=>$('#asset-kind').value==='all'||asset.kind===$('#asset-kind').value);}
function renderAssets() {
  const assets=visibleAssets(),list=$('#asset-list');list.replaceChildren();
  $('#asset-count').textContent='当前显示 '+assets.length+' 件 · 来源与校验值可展开。';
  for(const asset of assets) {
    const item=element('article',undefined,'asset-item');
    if(asset.thumbnail){const thumb=element('img');thumb.src=asset.thumbnail;thumb.alt='';thumb.loading='lazy';thumb.className='asset-thumb';item.append(thumb);}
    item.append(element('h3',asset.label),element('p',kindNames[asset.kind]+' · '+(asset.bytes/1e6).toFixed(2)+' MB'),element('p',asset.usage));
    const label=element('label',undefined,'asset-select'),check=element('input');check.type='checkbox';check.checked=selectedAssets.has(asset.id);check.setAttribute('aria-label','选用 '+asset.label);check.onchange=()=>{if(check.checked)selectedAssets.add(asset.id);else selectedAssets.delete(asset.id);selectedSummary();};label.append(check,element('span','选用这件素材'));item.append(label);
    const download=element('a','下载文件');download.href=asset.file;download.download=asset.file.split('/').pop();download.setAttribute('aria-label','下载 '+asset.label);item.append(download);
    const detail=element('details');detail.append(element('summary','来源与校验值'));
    if(asset.sourceCitation)detail.append(element('p',asset.sourceCitation));
    detail.append(element('p','文件：'+asset.file),element('p','SHA-256：'+asset.sha256));
    item.append(detail);list.append(item);
  }
  selectedSummary();
}
$('#asset-kind').onchange=renderAssets;
$('#select-visible').onclick=()=>{visibleAssets().forEach(asset=>selectedAssets.add(asset.id));renderAssets();};
$('#clear-assets').onclick=()=>{selectedAssets.clear();renderAssets();};
$('#export-assets').onclick=()=>offerJSON('#assets-download',{type:'lilinger-asset-selection',version:1,sourceVersion:catalog.publicVersion,assets:catalog.assets.filter(asset=>selectedAssets.has(asset.id)).map(asset=>({...asset,url:publicURL(asset.file)})),scope:'天佑德既有角色与资料的展示副本；可作为索引或交接样本，未连接NAS权限。'},'lilinger-assets.json');
renderAssets();
setMode(location.hash.slice(1)||'compose');
