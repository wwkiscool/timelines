const fs=require('node:fs');
const sharp=require('sharp');
const postcss=require('postcss');
const {solar,captureContext,starsAt,ellipseStats,boundingBox,addPoint}=require('./solar-3d-qa.cjs');

// Approximate CSS layout around an actual renderer capture. This is an offline
// placement preview, not a browser screenshot; glyph metrics are approximate.
const css=postcss.parse(fs.readFileSync('src/app/globals.css','utf8'));
function mediaMatches(query,width,height){
  return query.split(',').some(part=>{
    if(/prefers-|orientation|hover|pointer/.test(part))return false;
    for(const match of part.matchAll(/\((min|max)-(width|height):\s*([\d.]+)px\)/g)){
      const value=match[2]==='width'?width:height,limit=+match[3];
      if(match[1]==='min'?value<limit:value>limit)return false;
    }
    return true;
  });
}
function matchSimple(selector,element){
  if(selector===':root')return element.tag==='root';
  if(/[:#\[]/.test(selector))return false;
  const tag=selector.match(/^[a-z][\w-]*/i)?.[0];
  if(tag&&tag!==element.tag)return false;
  return [...selector.matchAll(/\.([\w-]+)/g)].every(match=>element.classes.includes(match[1]));
}
function matchSelector(selector,chain){
  const parts=selector.trim().split(/\s+/).filter(part=>part!=='>');
  let index=chain.length-1;
  if(!matchSimple(parts.pop(),chain[index--]))return false;
  while(parts.length){const part=parts.pop();while(index>=0&&!matchSimple(part,chain[index]))index--;if(index<0)return false;index--;}
  return true;
}
function style(chain,width,height){
  const values={},scores={};let order=0;
  css.walkRules(rule=>{
    order++;for(let parent=rule.parent;parent;parent=parent.parent)if(parent.type==='atrule'&&parent.name==='media'&&!mediaMatches(parent.params,width,height))return;
    const selectors=rule.selectors.filter(selector=>matchSelector(selector,chain));if(!selectors.length)return;
    const specificity=Math.max(...selectors.map(selector=>(selector.match(/\./g)?.length??0)*100+(selector.match(/(?:^|\s)[a-z]/gi)?.length??0)));
    rule.walkDecls(decl=>{const score=specificity*100000+order+(decl.important?1e9:0);if(score>=(scores[decl.prop]??-1)){values[decl.prop]=decl.value;scores[decl.prop]=score;}});
  });return values;
}
function pixels(expression,width,height,percentBase=height,gutter=0){
  const source=String(expression).replace(/var\(--gutter\)/g,`(${gutter})`).replace(/([-\d.]+)(px|vw|svh|dvh|vh|%)/g,(_all,value,unit)=>String(+value*(unit==='px'?1:unit==='vw'?width/100:unit==='%'?percentBase/100:height/100)));
  const tokens=source.match(/[\d.]+|[a-z]+|[-+*/(),]/g)??[];let index=0;
  function atom(){const token=tokens[index++];if(token==='-')return -atom();if(token==='('){const n=sum();index++;return n;}if(/^[\d.]+$/.test(token))return +token;index++;const args=[sum()];while(tokens[index]===','){index++;args.push(sum());}index++;if(token==='calc')return args[0];if(token==='min')return Math.min(...args);if(token==='max')return Math.max(...args);if(token==='clamp')return Math.max(args[0],Math.min(args[2],args[1]));throw new Error(`Unsupported CSS expression: ${expression}`);}
  function product(){let n=atom();while(tokens[index]==='*'||tokens[index]==='/'){const op=tokens[index++],right=atom();n=op==='*'?n*right:n/right;}return n;}
  function sum(){let n=product();while(tokens[index]==='+'||tokens[index]==='-'){const op=tokens[index++],right=product();n=op==='+'?n+right:n-right;}return n;}
  return sum();
}
const element=(tag,classes)=>({tag,classes:classes.split(' ')});
function layout(width,viewportHeight){
  const root=style([element('root','')],width,viewportHeight),gutter=pixels(root['--gutter'],width,viewportHeight);
  const shell=[element('div','app-shell')],hero=[...shell,element('section','timeline-experience solar-experience')];
  const header=style([...shell,element('header','site-header')],width,viewportHeight),heroStyle=style(hero,width,viewportHeight),height=pixels(heroStyle.height,width,viewportHeight);
  const scene=style([...hero,element('div','scene-wrap')],width,viewportHeight),clockChain=[...hero,element('div','clock-area')],clock=style(clockChain,width,viewportHeight);
  const digital=style([...clockChain,element('span','digital-clock')],width,viewportHeight),digits=style([...clockChain,element('span','digital-clock'),element('span','clock-main')],width,viewportHeight);
  const meta=style([...clockChain,element('div','clock-meta')],width,viewportHeight),caption=style([...clockChain,element('div','clock-caption')],width,viewportHeight);
  const clockTop=pixels(clock.top,width,viewportHeight,height,gutter),font=pixels(digits['font-size'],width,viewportHeight),metaHeight=pixels(meta['font-size'],width,viewportHeight)*1.2;
  const digitTop=clockTop+metaHeight+pixels(digital['margin-top'],width,viewportHeight),digitHeight=font*+(digital['line-height']??1.05);
  const captionTop=digitTop+digitHeight+pixels(caption['margin-top'],width,viewportHeight),captionHeight=pixels(caption['font-size'],width,viewportHeight)*1.2;
  const sceneTop=pixels(scene.top,width,viewportHeight,height,gutter),sceneBottom=pixels(scene.bottom,width,viewportHeight,height,gutter);
  return {width,viewportHeight,headerHeight:pixels(header.height,width,viewportHeight),height,gutter,sceneTop,sceneHeight:height-sceneTop-sceneBottom,clockTop,font,metaHeight,digitTop,digitHeight,captionTop,captionHeight,clockBottom:captionTop+captionHeight};
}
async function preview(width,viewportHeight,seconds=8,suffix=''){
  const box=layout(width,viewportHeight),compact=width<640,ctx=captureContext();solar.drawSolarSystem(ctx,width,box.sceneHeight,seconds);
  const scene=await sharp(Buffer.from(ctx.getSvg(width,box.sceneHeight,starsAt(seconds)))).png().toBuffer();
  const project=solar.createSolarProjection(width,box.sceneHeight),ellipse=ellipseStats(project,compact).bbox,world=[];
  for(const planet of solar.solarPlanets)for(let orbit=0;orbit<128;orbit++)for(let phase=0;phase<32;phase++)world.push(project(addPoint(solar.solarOrbitPosition(planet,orbit/128*planet.period),solar.solarSunPosition(phase/32*solar.SOLAR_SUN_PERIOD,0,compact))));
  const envelope=boundingBox(world),sceneY=box.headerHeight+box.sceneTop,clockY=box.headerHeight;
  const clockWidth=compact?width-2*box.gutter:box.font*(8*.6-7*.085),left=(width-clockWidth)/2,right=(width+clockWidth)/2;
  const report={viewport:`${width}×${viewportHeight}`,canvas:[width,box.sceneHeight],clockBottom:box.clockBottom,sceneTop:box.sceneTop,ellipseMinY:ellipse.minY,ellipseMaxY:ellipse.maxY,envelopeMinY:envelope.minY,envelopeMaxY:envelope.maxY,arcGap:box.sceneTop+ellipse.minY-box.clockBottom};
  const outputHeight=Math.ceil(box.headerHeight+box.height);
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${outputHeight}"><rect width="100%" height="100%" fill="#050b18"/><image x="0" y="${sceneY}" width="${width}" height="${box.sceneHeight}" href="data:image/png;base64,${scene.toString('base64')}"/><g font-family="Arial,Microsoft YaHei,sans-serif"><text x="${box.gutter}" y="${box.headerHeight*.56}" fill="#e3efff" font-size="${compact?14:17}" letter-spacing="2">MOMENT</text><text x="${right}" y="${box.headerHeight*.56}" text-anchor="end" fill="#829bbf" font-size="10">时间线</text><line x1="${box.gutter}" x2="${width-box.gutter}" y1="${box.headerHeight}" y2="${box.headerHeight}" stroke="#86b6ed26"/><text x="${left}" y="${clockY+box.clockTop+box.metaHeight*.8}" fill="#70d9ff" font-size="${compact?7:9}">● LIVE / 正在发生</text><text x="${right}" y="${clockY+box.clockTop+box.metaHeight*.8}" text-anchor="end" fill="#8899bf" font-size="${compact?8:10}">2026 / 11 / 02 · 星期一</text><text x="${width/2}" y="${clockY+box.digitTop+box.font*.8}" text-anchor="middle" fill="#d9eaff" font-family="Consolas,Liberation Mono,monospace" font-size="${box.font}" letter-spacing="${-.085*box.font}">16:24:08</text><text x="${left}" y="${clockY+box.captionTop+box.captionHeight*.8}" fill="#8394b9" font-size="${compact?8:9}">北京时间　UTC +08:00</text>${compact?'':`<text x="${right}" y="${clockY+box.captionTop+box.captionHeight*.8}" text-anchor="end" fill="#627591" font-size="9">慢一点，感受此刻 ↗</text>`}</g></svg>`;
  const name=(compact?'mobile':'desktop')+suffix;fs.writeFileSync(`.preview/solar-placement-${name}.svg`,svg);await sharp(Buffer.from(svg)).png().toFile(`.preview/solar-placement-${name}.png`);
  console.log(`Placement approximation: ${JSON.stringify(report)}`);return report;
}
module.exports={layout,preview};
if(require.main===module)(async()=>{for(const [width,height] of [[1440,1000],[390,844]]){await preview(width,height);for(const second of [0,26,52])await preview(width,height,second,`-phase-${second}`);}})().catch(error=>{console.error(error);process.exitCode=1;});
