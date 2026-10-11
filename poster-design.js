// Two source-led layouts: an immersive guide and a gallery label.
export const posterDesignVersion = '2026-10-11.2';
const sans = '"PingFang SC", "Microsoft YaHei", sans-serif';
const serif = '"Songti SC", "STSong", serif';
const palette = { ink:'#152e40', paper:'#f4f6f5', blue:'#214e71', mint:'#b7d5cd', muted:'#99adb9' };
const titles = {
  'grain-origin':'从青稞开始', 'qu-definition':'大曲的形态', 'grain-qu':'曲粮合一',
  'pit-material':'花岗岩窖池', 'four-cycle':'清蒸清烧四次清', 'clay-storage':'陶坛储酒',
  'container-types':'储酒的容器', 'jiuhai':'认识酒海', 'campus-photo':'厂区的建筑面貌',
  'sculpture':'金禅酒祖', 'museum-connection':'从资料走向导览', 'character-use':'李灵儿的下一种用法'
};
function lines(ctx,text,x,y,width,size,leading,max=100,color=palette.ink,family=sans,weight=400) {
  ctx.fillStyle=color; ctx.font=`${weight} ${size}px ${family}`; ctx.textBaseline='top';
  const result=[]; let current='';
  for(const ch of text){
    if(ctx.measureText(current+ch).width>width&&current){
      if(/[，。！？；：、）》」』”’]/.test(ch)){result.push(current+ch);current='';}
      else if(/[（《「『“‘]$/.test(current)){result.push(current.slice(0,-1));current=current.slice(-1)+ch;}
      else {result.push(current);current=ch;}
    }else current+=ch;
  }
  if(current)result.push(current);
  if(result.length>1 && ctx.measureText(result.at(-1)).width < width*.35){
    const i=result.length-2,joined=result[i]+result[i+1],target=ctx.measureText(joined).width/2;
    let cut=1;
    while(cut<joined.length-1 && ctx.measureText(joined.slice(0,cut)).width<target)cut++;
    while(cut<joined.length-1 && /[，。！？；：、）》」』”’]/.test(joined[cut]))cut++;
    result[i]=joined.slice(0,cut);result[i+1]=joined.slice(cut);
  }
  if(result.length>max){result.length=max;let last=result[max-1];while(last&&ctx.measureText(last+'…').width>width)last=last.slice(0,-1);result[max-1]=last+'…';}
  result.forEach((line,i)=>ctx.fillText(line,x,y+i*leading));
  return y+result.length*leading;
}
function cover(ctx,image,x,y,w,h,focus=.5) {
  const k=Math.max(w/image.width,h/image.height),sw=w/k,sh=h/k;
  ctx.drawImage(image,(image.width-sw)*focus,(image.height-sh)*focus,sw,sh,x,y,w,h);
}
function contain(ctx,image,x,y,w,h) {
  const k=Math.min(w/image.width,h/image.height),dw=image.width*k,dh=image.height*k;
  ctx.drawImage(image,x+(w-dw)/2,y+(h-dh)/2,dw,dh);
}
function portrait(ctx,subject,x,y,size,percent,dark) {
  ctx.save();ctx.beginPath();ctx.arc(x+size/2,y+size/2,size/2,0,Math.PI*2);ctx.clip();
  ctx.fillStyle=dark?'#d9e3df':'#dfe7e3';ctx.fillRect(x,y,size,size);
  if(subject){
    // The portrait keeps the head at the top of a centred transparent capture.
    const crop=Math.max(.25,Math.min(.55,.50-(percent-45)/140));
    const sw=subject.width*crop,sh=Math.min(subject.height,sw*1.05);
    ctx.drawImage(subject,(subject.width-sw)/2,0,sw,sh,x,y,size,size);
  }
  ctx.restore();
}
function signature(ctx,subject,x,y,w,percent,dark) {
  const size=104;portrait(ctx,subject,x,y,size,percent,dark);
  lines(ctx,'李灵儿',x+size+24,y+15,w-size-24,30,42,1,dark?'#f5f8f6':palette.ink,sans,500);
  lines(ctx,'静态形象 · 资料导览',x+size+24,y+61,w-size-24,22,29,1,dark?palette.muted:'#61747e');
}
function source(ctx,answer,topic,x,y,w,dark,scale=1) {
  const color=dark?'#a8bac5':'#657780',size=22*scale,lead=30*scale;
  const rows=[`正文 / ${answer.sourceTitle} ${answer.reference}`,`配图 / ${topic.sourceTitle} ${topic.question}`];
  if(answer.id==='jiuhai')rows.push('配图为陶坛，仅作储酒主题参照。');
  if(answer.id==='museum-connection')rows.push('配图为厂区雕塑，非文学馆展品。');
  rows.push('2024年资料 · 拍摄日期未核实 · 形象合成实验');
  for(const row of rows)y=lines(ctx,row,x,y,w,size,lead,2,color);
  return y;
}
export function drawPoster(ctx,{width,height,picture,subject,answer,topic,excerpt,style='immersive',side='right',percent=60,focus=.5}) {
  const portraitRatio=height/width>1.4,square=Math.abs(height-width)<5;
  const designWidth=portraitRatio?1080:square?1600:1920;
  const scale=width/designWidth;ctx.save();ctx.scale(scale,scale);
  const W=width/scale,H=height/scale,M=portraitRatio?64:80,title=titles[answer.id]||topic.title;
  const dark=style==='immersive';ctx.fillStyle=dark?palette.ink:palette.paper;ctx.fillRect(0,0,W,H);
  if(portraitRatio){
    if(dark){
      const photoH=H*.48;
      cover(ctx,picture,0,0,W,photoH,focus);
      const shade=ctx.createLinearGradient(0,photoH*.65,0,photoH);shade.addColorStop(0,'#152e4000');shade.addColorStop(1,palette.ink);ctx.fillStyle=shade;ctx.fillRect(0,0,W,photoH);
      let y=photoH-20;
      lines(ctx,`天佑德 / ${topic.label}`,M,y,W-M*2,28,38,1,palette.mint,sans,500);y+=64;
      y=lines(ctx,title,M,y,W-M*2,86,105,2,'#f5f8f6',serif,600)+36;
      lines(ctx,excerpt,M,y,W-M*2,38,59,Math.max(1,Math.min(5,Math.floor((H-400-y)/59))),'#d1dde3');
      signature(ctx,subject,M,H-338,W-M*2,percent,true);
      source(ctx,answer,topic,M,H-194,W-M*2,true);
    }else{
      lines(ctx,`天佑德 / ${topic.label}`,M,M,W-M*2,28,38,1,palette.blue,sans,500);
      const titleEnd=lines(ctx,title,M,M+70,W-M*2,86,108,2,palette.ink,serif,600);
      const photoY=titleEnd+45,photoH=Math.min((W-M*2)*picture.height/picture.width,H*.43);
      ctx.fillStyle='#e2e9e5';ctx.fillRect(M,photoY,W-M*2,photoH);
      contain(ctx,picture,M,photoY,W-M*2,photoH);
      let y=photoY+photoH+58;
      y=lines(ctx,answer.question,M,y,W-M*2,30,45,2,palette.blue,sans,500)+24;
      y=lines(ctx,answer.answer,M,y,W-M*2,46,70,Math.max(1,Math.min(5,Math.floor((H-450-y)/70))),'#354f60');
      signature(ctx,subject,M,Math.min(y+90,H-362),W-M*2,percent,false);
      source(ctx,answer,topic,M,H-204,W-M*2,false);
    }
  }else if(square && !dark){
    lines(ctx,`天佑德 / ${topic.label}`,M,M,W-M*2,28,38,1,palette.blue,sans,500);
    const titleEnd=lines(ctx,title,M,M+68,W-M*2,86,104,2,palette.ink,serif,600);
    const photoY=titleEnd+34,photoH=Math.min(H*.42,H-550-photoY);
    ctx.fillStyle='#e2e9e5';ctx.fillRect(M,photoY,W-M*2,photoH);
    contain(ctx,picture,M,photoY,W-M*2,photoH);
    const y=photoY+photoH+48;
    lines(ctx,excerpt,M,y,W-M*2,60,80,Math.max(1,Math.floor((H-420-y)/80)),'#354f60');
    signature(ctx,subject,M,H-350,W-M*2,percent,false);
    source(ctx,answer,topic,M,H-170,W-M*2,false);
  }else if(dark){
    const photoW=square?W*.51:W*.61,textW=W-photoW;
    const photoX=side==='left'?textW:0,textX=side==='left'?0:photoW;
    cover(ctx,picture,photoX,0,photoW,H,focus);
    const shade=ctx.createLinearGradient(photoX,0,photoX+photoW,0);
    shade.addColorStop(0,'rgba(21,46,64,.06)');shade.addColorStop(.75,'rgba(21,46,64,.08)');shade.addColorStop(1,'rgba(21,46,64,.32)');
    ctx.fillStyle=shade;ctx.fillRect(photoX,0,photoW,H);
    const X=textX+M,textWidth=textW-M*2;
    lines(ctx,`天佑德 / ${topic.label}`,X,M,textWidth,28,38,1,palette.mint,sans,500);
    let y=lines(ctx,title,X,M+88,textWidth,square?77:86,105,3,'#f5f8f6',serif,600)+36;
    y=lines(ctx,excerpt,X,y,textWidth,34,54,Math.max(1,Math.min(square?7:5,Math.floor((H-360-y)/54))),'#d1dde3');
    signature(ctx,subject,X,H-440,textWidth,percent,true);
    source(ctx,answer,topic,X,H-296,textWidth,true,square?.88:.82);
  }else{
    const photoW=square?W*.56:W*.59,textW=W-photoW;
    const photoX=side==='left'?textW:0,textX=side==='left'?0:photoW;
    ctx.fillStyle='#e0e7e4';ctx.fillRect(photoX,0,photoW,H);
    contain(ctx,picture,photoX+M,M,photoW-M*2,H-M*2-75);
    const X=textX+M,textWidth=textW-M*2;
    lines(ctx,`天佑德 / ${topic.label}`,X,M,textWidth,28,38,1,palette.blue,sans,500);
    let y=lines(ctx,title,X,M+92,textWidth,78,96,3,palette.ink,serif,600)+34;
    lines(ctx,excerpt,X,y,textWidth,34,54,Math.max(1,Math.min(square?7:5,Math.floor((H-360-y)/54))),'#354f60');
    signature(ctx,subject,X,H-320,textWidth,percent,false);
    source(ctx,answer,topic,X,H-176,textWidth,false,square?.88:.82);
    lines(ctx,topic.title,photoX+M,H-94,photoW-M*2,25,36,1,'#4c656d');
  }
  ctx.restore();
  return {title,style,version:posterDesignVersion};
}
