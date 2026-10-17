export const REVIEW_LOOKS=Object.freeze({
  baseline:{label:'原渲染',detail:'已发布版本的材质与灯光，作为比较基线。'},
  natural:{label:'柔光质感',detail:'保留肤色与衣纹，柔化皮肤反光，提亮发束与眼神。白衣和发梢仍待完善。'},
  illustrated:{label:'插画层次',detail:'保留原贴图，以明暗色阶和暖冷边光塑造人物。脸部与手臂的色阶较硬。'},
});
export function safeLook(value){return Object.hasOwn(REVIEW_LOOKS,value)?value:'baseline'}
export function splitPercent(value){const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(100,n)):50}
export function reviewRecord({preference='',note='',look='baseline'},date=new Date()){
  return{reviewVersion:2,reviewRevision:'fix1',createdAtUTC:date.toISOString(),preference:Object.hasOwn(REVIEW_LOOKS,preference)?preference:null,note:String(note).slice(0,1200),viewedLook:safeLook(look),adopted:false,published:false,sourceModelSHA256:'f239496db791ba338ffd6709356669896ef1244e4e2abc5bf363160e12798a9f',evidence:'static frames from previous browser QA; fix1 passed four-viewport Chrome QA; physical Safari and live camera unverified'};
}
export function bindReview(doc=document){
  const $=id=>doc.getElementById(id);let look='baseline';
  const updateSplit=()=>{const value=splitPercent($('split').value);$('original-layer').style.clipPath=`inset(0 ${100-value}% 0 0)`;$('divider').style.setProperty('--split-position',value+'%');$('split-value').textContent=`原渲染 ${value}%`;$('split').setAttribute('aria-valuetext',`左侧原渲染 ${value}%，右侧${REVIEW_LOOKS[look].label} ${100-value}%`)};
  function setLook(value){look=safeLook(value);const item=REVIEW_LOOKS[look];for(const button of doc.querySelectorAll('[data-review-look]'))button.setAttribute('aria-pressed',String(button.dataset.reviewLook===look));for(const id of ['candidate-image','full-image']){$(id).src=`review-assets/${look}.jpg`;$(id).alt=`${item.label}，上一轮同镜头实际截图`}$('look-description').textContent=item.detail;$('comparison-caption').textContent=`左侧原渲染 · 右侧${item.label}。静帧来自上一轮真实浏览器验收，不是本轮重新渲染。`;$('live-link').href=`render-review.html?look=${look}`;updateSplit()}
  for(const button of doc.querySelectorAll('[data-review-look]'))button.addEventListener('click',()=>setLook(button.dataset.reviewLook));
  $('split').addEventListener('input',updateSplit);
  // The native range remains the keyboard/screen-reader control; the image handle
  // offers the same comparison for pointer input without intercepting page scroll.
  const handle=$('divider-handle');let drag=null;
  handle.addEventListener('pointerdown',event=>{
    if(event.button!==0||event.isPrimary===false||drag)return;
    const width=$('comparison').getBoundingClientRect().width;if(width<=0)return;
    handle.setPointerCapture(event.pointerId);
    drag={id:event.pointerId,x:event.clientX,value:splitPercent($('split').value),width};
    event.preventDefault();
  });
  handle.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.id)return;
    $('split').value=String(Math.round(splitPercent(drag.value+(event.clientX-drag.x)/drag.width*100)));
    updateSplit();
  });
  const endDrag=event=>{if(!drag||event.pointerId!==drag.id)return;drag=null;if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId)};
  handle.addEventListener('pointerup',endDrag);handle.addEventListener('pointercancel',endDrag);
  handle.addEventListener('lostpointercapture',event=>{if(drag?.id===event.pointerId)drag=null});
  $('reset-review').addEventListener('click',()=>{$('preference').value='';$('review-note').value='';$('review-message').textContent='临时意见已清除；未改变项目状态。'});
  $('export-review').addEventListener('click',()=>{const record=reviewRecord({preference:$('preference').value,note:$('review-note').value,look});const blob=new Blob([JSON.stringify(record,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const link=doc.createElement('a');link.href=url;link.download='李灵儿-临时审阅意见.json';doc.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);$('review-message').textContent='已请求下载审阅意见；文件未上传，也未更改线上版本。'});
  $('preference').value='';$('review-note').value='';setLook('baseline');return{setLook,updateSplit};
}
if(typeof document!=='undefined')bindReview(document);
