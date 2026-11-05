const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const sharp = require('sharp');
const assert = require('node:assert/strict');

// Captures the actual renderer's Canvas commands as SVG. This is an offline
// scene preview, not a browser screenshot or a replacement for browser QA.
function loadTs(path, requireModule = require, extra = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require: requireModule, ...extra }, { filename: path });
  return module.exports;
}
const solar = loadTs('src/lib/solar-system.ts');
const geometryViewports = [[320,355],[390,355],[768,400],[1440,460],[320,680],[390,680],[768,710],[1440,855],[390,780],[768,840],[1440,955]];
function instrumentCanvas(canvas, listeners) {
  Object.assign(canvas, {
    style: {}, dataset: {}, capturedPointer: null,
    addEventListener: (name, fn) => listeners[name] = fn,
    removeEventListener: name => delete listeners[name],
    setPointerCapture(id) { this.capturedPointer = id; },
    hasPointerCapture(id) { return this.capturedPointer === id; },
    releasePointerCapture(id) { if(this.capturedPointer === id)this.capturedPointer = null; },
    focus() {},
  });
  return canvas;
}
const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const mul = (a,b) => [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];

function captureContext() {
  let nodes = [], defs = [], path = '', id = 0, stack = [], lineSegments = [];
  let state = { matrix: [1,0,0,1,0,0], globalAlpha: 1, fillStyle: '#fff', strokeStyle: '#fff', lineWidth: 1, font: '9px Arial', textAlign: 'left', clip: null };
  const attrs = () => ` transform="matrix(${state.matrix.join(' ')})" opacity="${state.globalAlpha}"${state.clip ? ` clip-path="url(#${state.clip})"` : ''}`;
  const color = value => typeof value === 'string' ? esc(value) : `url(#${value.id})`;
  function gradient(kind, attributes) {
    const item = { id: `gradient${id++}`, kind, attributes, stops: [], addColorStop(offset, value) { this.stops.push({offset,value}); } };
    defs.push(item); return item;
  }
  function ellipse(x,y,rx,ry,rotation,start,end,ccw = false) {
    const delta = Math.abs(end-start);
    const at = a => [x+rx*Math.cos(a)*Math.cos(rotation)-ry*Math.sin(a)*Math.sin(rotation),y+rx*Math.cos(a)*Math.sin(rotation)+ry*Math.sin(a)*Math.cos(rotation)];
    const [sx,sy] = at(start); path += `M${sx} ${sy}`;
    const arc = a => { const [ex,ey] = at(a); path += `A${rx} ${ry} ${rotation*180/Math.PI} ${Math.abs(a-start)>Math.PI ? 1 : 0} ${ccw?0:1} ${ex} ${ey}`; };
    if (delta >= Math.PI*2-.00001) { arc(start+Math.PI); const [ex,ey] = at(end); path += `A${rx} ${ry} ${rotation*180/Math.PI} 0 ${ccw?0:1} ${ex} ${ey}`; }
    else arc(end);
  }
  const ctx = {
    clearRect() { nodes=[]; defs=[]; path=''; id=0; lineSegments=[]; },
    save() { stack.push({...state,matrix:[...state.matrix]}); },
    restore() { state=stack.pop(); },
    setTransform(...matrix) { state.matrix=matrix; },
    translate(x,y) { state.matrix=mul(state.matrix,[1,0,0,1,x,y]); },
    rotate(a) { state.matrix=mul(state.matrix,[Math.cos(a),Math.sin(a),-Math.sin(a),Math.cos(a),0,0]); },
    beginPath() { path=''; }, moveTo(x,y) { path+=`M${x} ${y}`; }, lineTo(x,y) { path+=`L${x} ${y}`; }, closePath() { path+='Z'; },
    arc(x,y,r,start,end,ccw) { ellipse(x,y,r,r,0,start,end,ccw); }, ellipse,
    stroke() {
      const line = /^M([-+.\deE]+) ([-+.\deE]+)L([-+.\deE]+) ([-+.\deE]+)$/.exec(path);
      if(line)lineSegments.push({a:{x:+line[1],y:+line[2]},b:{x:+line[3],y:+line[4]},color:state.strokeStyle,width:state.lineWidth});
      nodes.push(`<path d="${path}" fill="none" stroke="${color(state.strokeStyle)}" stroke-width="${state.lineWidth}"${attrs()}/>`);
    },
    fill() { nodes.push(`<path d="${path}" fill="${color(state.fillStyle)}"${attrs()}/>`); },
    clip() { const clipId=`clip${id++}`; defs.push(`<clipPath id="${clipId}"><path d="${path}" transform="matrix(${state.matrix.join(' ')})"/></clipPath>`); state.clip=clipId; },
    fillRect(x,y,w,h) { nodes.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color(state.fillStyle)}"${attrs()}/>`); },
    fillText(text,x,y) { const size=parseFloat(state.font); nodes.push(`<text x="${x}" y="${y}" font-family="Arial,Microsoft YaHei,sans-serif" font-size="${size}" text-anchor="${state.textAlign==='center'?'middle':'start'}" fill="${color(state.fillStyle)}"${attrs()}>${esc(text)}</text>`); },
    createLinearGradient(x1,y1,x2,y2) { return gradient('linearGradient',`gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"`); },
    createRadialGradient(x0,y0,r0,x1,y1,r1) { return gradient('radialGradient',`gradientUnits="userSpaceOnUse" fx="${x0}" fy="${y0}" fr="${r0}" cx="${x1}" cy="${y1}" r="${r1}"`); },
    snapshot() { return nodes.join(''); },
    getLineSegments() { return lineSegments; },
    getGradients() { return defs.filter(def=>typeof def==='object'); },
    getSvg(width,height,stars='') { return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs>${defs.map(d=>typeof d==='string'?d:`<${d.kind} id="${d.id}" ${d.attributes}>${d.stops.map(s=>`<stop offset="${s.offset}" stop-color="${esc(s.value)}"/>`).join('')}</${d.kind}>`).join('')}</defs><rect width="100%" height="100%" fill="#050b18"/>${stars}${nodes.join('')}</svg>`; },
  };
  for (const key of ['fillStyle','strokeStyle','lineWidth','globalAlpha','font','textAlign']) Object.defineProperty(ctx,key,{get:()=>state[key],set:value=>state[key]=value});
  return ctx;
}

function starsAt(seconds) {
  const jsx = (type, props) => ({type,props});
  const starfield = loadTs('src/components/starfield.tsx',name=>name==='react'?{useRef:()=>({current:null}),useEffect:()=>{}}:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:{default:{}});
  const tree = starfield.default({running:true,speed:1});
  return tree.props.children.map((layer,i)=>{
    const styles=layer.props.style;
    const svg=decodeURIComponent(styles['--star-image'].match(/data:image\/svg\+xml,([^\"]+)/)[1]);
    const circles=svg.slice(svg.indexOf('>')+1,svg.lastIndexOf('</svg>'));
    const offset=(seconds/parseFloat(styles['--rise-period'])*1600)%1600;
    return `<defs><pattern id="stars${i}" width="1600" height="1600" patternUnits="userSpaceOnUse" patternTransform="translate(0 ${offset})">${circles}</pattern></defs><rect width="100%" height="100%" fill="url(#stars${i})" opacity="${styles['--layer-opacity']}"/>`;
  }).join('');
}

const addPoint = (a,b) => ({x:a.x+b.x,y:a.y+b.y,z:a.z+b.z});
function boundingBox(points) {
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const point of points){minX=Math.min(minX,point.x);minY=Math.min(minY,point.y);maxX=Math.max(maxX,point.x);maxY=Math.max(maxY,point.y);}
  return {minX,minY,maxX,maxY,width:maxX-minX,height:maxY-minY};
}
function ellipseStats(project,compact) {
  const points=Array.from({length:128},(_,i)=>project(solar.solarSunPosition(i/128*solar.SOLAR_SUN_PERIOD,0,compact)));
  const mx=points.reduce((sum,p)=>sum+p.x,0)/points.length,my=points.reduce((sum,p)=>sum+p.y,0)/points.length;
  let xx=0,yy=0,xy=0;
  for(const p of points){xx+=(p.x-mx)**2;yy+=(p.y-my)**2;xy+=(p.x-mx)*(p.y-my);}
  const difference=Math.hypot(xx-yy,2*xy);
  return {bbox:boundingBox(points),ratio:Math.sqrt(Math.max(0,(xx+yy-difference)/(xx+yy+difference)))};
}
function sunMotionChecks() {
  for(const compact of [false,true]) {
    const quarters=[0,1,2,3,4].map(i=>solar.solarSunPosition(i/4*solar.SOLAR_SUN_PERIOD,0,compact));
    assert(Math.hypot(quarters[0].x-quarters[4].x,quarters[0].y-quarters[4].y,quarters[0].z-quarters[4].z)<1e-7,'the solar path closes after one independent period');
    const a={x:quarters[2].x-quarters[0].x,y:quarters[2].y-quarters[0].y,z:quarters[2].z-quarters[0].z};
    const b={x:quarters[3].x-quarters[1].x,y:quarters[3].y-quarters[1].y,z:quarters[3].z-quarters[1].z};
    const cross=Math.hypot(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x);
    assert(cross/Math.max(Math.hypot(a.x,a.y,a.z),Math.hypot(b.x,b.y,b.z))**2>.05,'solar motion occupies a real elliptical plane rather than a line');
    for(const planet of solar.solarPlanets)for(const second of [0,8,26,52,78,103]) {
      const center=solar.solarSunPosition(second,0,compact),world=solar.solarPosition(planet,second,0,compact);
      assert(Math.abs(Math.hypot(world.x-center.x,world.y-center.y,world.z-center.z)-planet.orbit)<1e-7,'each planet keeps its orbital radius around the moving sun');
      const later=solar.solarPosition(planet,second+planet.period,0,compact),nextCenter=solar.solarSunPosition(second+planet.period,0,compact);
      for(const axis of ['x','y','z'])assert(Math.abs((later[axis]-world[axis])-(nextCenter[axis]-center[axis]))<1e-7,'a completed planet revolution retains the independent shared solar drift');
    }
    for(const planet of solar.solarPlanets) {
      const current=solar.solarPosition(planet,18,0,compact),past=solar.solarPosition(planet,18,12,compact),earlier=solar.solarPosition(planet,6,0,compact);
      assert(Math.abs(past.x-earlier.x)<1e-8 && Math.abs(past.y-earlier.y)<1e-8,'history retains the prior sun and orbital position');
      assert(Math.abs((past.z-earlier.z)-12*56)<1e-8,'curved shared history still recedes with forward advance');
      assert.notDeepEqual(current,past);
    }
  }
}

function geometryChecks() {
  assert.equal(solar.solarPlanets.length,9);
  const cameras = [{}];
  for (const yaw of Object.values(solar.SOLAR_CAMERA_LIMITS.yaw))
    for (const pitch of Object.values(solar.SOLAR_CAMERA_LIMITS.pitch))
      for (const roll of Object.values(solar.SOLAR_CAMERA_LIMITS.roll))
        for (const distance of Object.values(solar.SOLAR_CAMERA_LIMITS.distance)) cameras.push({yaw,pitch,roll,distance});
  for (const [width,height] of geometryViewports) {
    const compact=width<640;
    const sunSamples=Array.from({length:32},(_,i)=>solar.solarSunPosition(i/32*solar.SOLAR_SUN_PERIOD,0,compact));
    for (const camera of cameras) {
      const project=solar.createSolarProjection(width,height,camera);
      const ellipse=ellipseStats(project,compact);
      assert(ellipse.ratio>(compact?.3:.08),'the projected solar ellipse stays visibly non-collinear at camera limits');
      for (const planet of solar.solarPlanets) for (let phase=0;phase<128;phase++) for(const sun of sunSamples) {
        const point=project(addPoint(solar.solarOrbitPosition(planet,phase/128*planet.period),sun));
        const sphere=solar.solarBodyRadius(planet,point,compact);
        const radius=planet.id==='saturn'?sphere*1.95+Math.max(1.4,sphere*.23)/2:sphere;
        if(!Number.isFinite(point.x)||!Number.isFinite(point.y)||!Number.isFinite(point.scale)||!Number.isFinite(point.depth))assert.fail('finite projection');
        if(point.x-radius<0||point.x+radius>width||point.y-radius<0||point.y+radius>height)assert.fail(`${planet.id} sphere/ring remains in bounds at ${width}×${height}, orbit phase ${phase}, sun ${JSON.stringify(sun)}, camera ${JSON.stringify(camera)}`);
      }
    }
    const project=solar.createSolarProjection(width,height);
    const ellipse=ellipseStats(project,compact);
    assert(ellipse.ratio>(compact?.5:.12),'the default view shows a clearly curved solar ellipse');
    assert(Math.max(ellipse.bbox.width,ellipse.bbox.height)>height*.12,'default solar motion has a visible screen range');
    const near=project({x:100,y:0,z:-500}), far=project({x:100,y:0,z:500});
    assert(near.scale/far.scale>1.5,'near/far perspective has a substantial visible size contrast');
    const origin=project({x:0,y:0,z:0}),history=project({x:0,y:0,z:3000});
    const advanceX=history.x-origin.x,advanceY=history.y-origin.y;
    assert(advanceX>0 && advanceY<0,'the depth axis extends diagonally upper-right');
    assert(advanceX/Math.abs(advanceY)>.4 && advanceX/Math.abs(advanceY)<2,'the depth axis reads as diagonal rather than vertical or horizontal');
    const normalizedDistances = projection => {
      const sun=projection(solar.solarSunPosition(8,0,compact));
      const distances=solar.solarPlanets.map(planet=>{const point=projection(solar.solarPosition(planet,8,0,compact));return Math.hypot(point.x-sun.x,point.y-sun.y);});
      const total=distances.reduce((sum,distance)=>sum+distance,0);
      return distances.map(distance=>distance/total);
    };
    const original=normalizedDistances(project),rotated=normalizedDistances(solar.createSolarProjection(width,height,{yaw:.95,pitch:.55}));
    assert(Math.max(...original.map((distance,i)=>Math.abs(distance-rotated[i])))>.025,'rotating the camera changes relative spatial relationships rather than only zooming or rotating a flat disk');
    assert.deepEqual(solar.createSolarProjection(width,height,{yaw:NaN,pitch:Infinity})({x:100,y:0,z:500}),far,'invalid camera angles fall back to the default');
  }
  sunMotionChecks();
}

function rendererMotionChecks() {
  const attribute=(gradient,name)=>+gradient.attributes.match(new RegExp(`\\b${name}="([^"]+)"`))[1];
  for(const [width,height] of [[1440,460],[1440,855],[390,355],[390,680]])for(const second of [0,8,26,52,78]) {
    const compact=width<640,ctx=captureContext(),project=solar.createSolarProjection(width,height);
    solar.drawSolarSystem(ctx,width,height,second);
    const sunWorld=solar.solarSunPosition(second,0,compact),expected=project(sunWorld);
    const sphere=ctx.getGradients().find(g=>g.stops.some(stop=>stop.value==='#ffda65'));
    assert(sphere,'the renderer paints the sun sphere');
    const x=attribute(sphere,'cx'),y=attribute(sphere,'cy'),radius=attribute(sphere,'r');
    assert(Math.hypot(x-expected.x,y-expected.y)<1e-7,'the painted sun follows the independent elliptical position');
    assert(x-radius>=0&&x+radius<=width&&y-radius>=0&&y+radius<=height,'the entire moving sun sphere stays in frame');
    const lines=ctx.getLineSegments();
    const hasEndpoint=(points,point)=>points.some(line=>Math.hypot(line.a.x-point.x,line.a.y-point.y)<1e-7||Math.hypot(line.b.x-point.x,line.b.y-point.y)<1e-7);
    for(const planet of solar.solarPlanets) {
      const endpoint=project(addPoint(solar.solarOrbitPosition(planet,0),sunWorld));
      assert(hasEndpoint(lines,endpoint),'rendered current planetary rings share the actual moving sun center');
    }
    const ellipseLines=lines.filter(line=>String(line.color).startsWith('rgba(139,235,255,'));
    assert(ellipseLines.length>=32,'the renderer paints a smooth full solar ellipse');
    for(const quarter of [0,1,2,3])assert(hasEndpoint(ellipseLines,project(solar.solarSunPosition(quarter/4*solar.SOLAR_SUN_PERIOD,0,compact))),'the visible solar path reaches every ellipse quadrant');
  }
}

function footprintChecks() {
  const report=[];
  for(const [width,height] of [[1440,460],[1440,855],[390,355],[390,680]]) {
    const compact=width<640,project=solar.createSolarProjection(width,height),sun=solar.solarSunPosition(8,0,compact),orbit=[],envelope=[];
    for(const planet of solar.solarPlanets)for(let i=0;i<256;i++) {
      const local=solar.solarOrbitPosition(planet,i/256*planet.period);orbit.push(project(addPoint(local,sun)));
      for(let j=0;j<32;j++)envelope.push(project(addPoint(local,solar.solarSunPosition(j/32*solar.SOLAR_SUN_PERIOD,0,compact))));
    }
    const orbitBounds=boundingBox(orbit),motionBounds=boundingBox(envelope),sunBounds=ellipseStats(project,compact).bbox;
    if(height===855)assert(sunBounds.height>70.1931977919619*1.8,'the desktop solar arc has visibly greater vertical depth');
    if(height===680)assert(sunBounds.height>72.1209550880431*1.3,'the phone solar arc has visibly greater vertical depth');
    report.push({viewport:`${width}×${height}`,orbit:[orbitBounds.width,orbitBounds.height].map(Math.round),sun:[sunBounds.width,sunBounds.height].map(Math.round),envelope:[motionBounds.width,motionBounds.height].map(Math.round)});
  }
  console.log(`Footprints in pixels: ${JSON.stringify(report)}`);
}

function placementChecks() {
  const {layout}=require('./solar-placement-qa.cjs');
  const report=[];
  for(const [width,viewportHeight] of [[1440,1000],[768,1000],[390,844],[320,844]]) {
    const box=layout(width,viewportHeight),compact=width<640,project=solar.createSolarProjection(width,box.sceneHeight),ellipse=ellipseStats(project,compact).bbox;
    const gap=box.sceneTop+ellipse.minY-box.clockBottom;
    assert(gap>=10&&gap<=65,'the main solar arc sits directly beneath the clock caption across screen widths');
    const digitWidth=box.font*(8*.6-7*.085),clockLeft=(width-digitWidth)/2,clockRight=(width+digitWidth)/2;
    for(const second of [0,8,26,52])for(const planet of solar.solarPlanets) {
      const point=project(solar.solarPosition(planet,second,0,compact)),radius=solar.solarBodyRadius(planet,point,compact)*(planet.id==='saturn'?2.07:1),y=point.y+box.sceneTop;
      const overlaps=point.x+radius>clockLeft&&point.x-radius<clockRight&&y+radius>box.digitTop&&y-radius<box.digitTop+box.digitHeight;
      assert(!overlaps,`${planet.id} remains clear of the clock digit rectangle at phase ${second} and width ${width}`);
    }
    report.push({width,canvasHeight:box.sceneHeight,clockToArcGap:+gap.toFixed(1),ellipseY:[ellipse.minY,ellipse.maxY].map(Math.round)});
  }
  console.log(`Placement approximation in pixels: ${JSON.stringify(report)}`);
}

function lifecycleChecks() {
  const refs=[], effectSlots=[], pending=[], frames=new Map(), listeners={}, mediaListeners={}, canvasListeners={}, windowListeners={};
  let refIndex=0,effectIndex=0,frameId=0,stamp=1000,rendered=[];
  const media={matches:false,addEventListener:(name,fn)=>mediaListeners[name]=fn,removeEventListener:name=>delete mediaListeners[name]};
  const document={hidden:false,addEventListener:(name,fn)=>listeners[name]=fn,removeEventListener:name=>delete listeners[name]};
  const canvas=instrumentCanvas({getContext:()=>({setTransform(){}}),getBoundingClientRect:()=>({width:390,height:355,left:0,top:0})},canvasListeners);
  const poster={hidden:false};
  const react={
    useRef(value) { return refs[refIndex++] ?? (refs[refIndex-1]={current:value}); },
    useEffect(fn,deps) { const slot=effectIndex++; const old=effectSlots[slot]; if(!old || !deps || deps.some((d,i)=>d!==old.deps[i])) pending.push(()=>{old?.cleanup?.();effectSlots[slot]={deps,cleanup:fn()};}); },
  };
  const jsx=(type,props)=>{if(type==='canvas')props.ref.current=canvas;if(type==='picture')props.ref.current=poster;return {type,props};};
  const Scene=loadTs('src/components/solar-system-scene.tsx',name=>name==='react'?react:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='@/lib/solar-system'?{...solar,drawSolarSystem:(_ctx,_w,_h,phase,flash,camera)=>rendered.push({phase,flash,camera:{...camera}})}:{default:{}},{
    window:{matchMedia:()=>media,devicePixelRatio:1,addEventListener:(name,fn)=>windowListeners[name]=fn,removeEventListener:name=>delete windowListeners[name]},document,
    requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:id=>frames.delete(id),
    ResizeObserver:class {observe(){} disconnect(){}},
  }).default;
  const render=props=>{refIndex=effectIndex=0;Scene(props);while(pending.length)pending.shift()();};
  const step=()=>{stamp+=16;const batch=[...frames.values()];frames.clear();batch.forEach(fn=>fn(stamp));};
  render({running:true,speed:1,pulseKey:0});
  assert.equal(rendered.length,1,'initial scene paints synchronously before RAF');
  assert.equal(rendered[0].phase,0);
  assert.equal(poster.hidden,true,'poster hides after successful synchronous paint');
  step(); step();
  assert(rendered.at(-1).phase>0,'running advances phase');
  const beforeSpeed=rendered.at(-1).phase;
  render({running:true,speed:2,pulseKey:0});
  assert.equal(rendered.at(-1).phase,beforeSpeed,'changing speed retains current phase'); step();
  assert(Math.abs(rendered.at(-1).phase-beforeSpeed-.032)<1e-8,'double speed scales increment');
  render({running:false,speed:2,pulseKey:0});step();
  const paused=rendered.at(-1).phase; step();
  assert.equal(rendered.at(-1).phase,paused); assert.equal(frames.size,0,'pause stops RAF');
  const pointer=(type,x,y,id=7)=>({isPrimary:true,button:0,pointerId:id,pointerType:type,clientX:x,clientY:y});
  const pausedCamera={...rendered.at(-1).camera};
  canvasListeners.pointerdown(pointer('mouse',100,100));
  assert.equal(canvas.capturedPointer,7,'drag captures its pointer');
  assert.equal(canvas.dataset.dragging,'true');
  canvasListeners.pointermove(pointer('mouse',170,70));step();
  assert(rendered.at(-1).camera.yaw>pausedCamera.yaw && rendered.at(-1).camera.pitch>pausedCamera.pitch,'drag rotates both actual camera axes');
  assert.equal(rendered.at(-1).phase,paused,'paused drag never advances orbital phase');
  assert.equal(frames.size,0,'paused drag paints one frame and stops');
  canvasListeners.pointerup(pointer('mouse',170,70));assert.equal(canvas.capturedPointer,null);assert.equal(canvas.dataset.dragging,'false');
  let prevented=0;
  canvasListeners.keydown({key:'Home',preventDefault:()=>prevented++});step();
  assert.deepEqual(rendered.at(-1).camera,{...solar.DEFAULT_SOLAR_CAMERA},'Home restores the default camera');
  canvasListeners.keydown({key:'ArrowLeft',shiftKey:false,preventDefault:()=>prevented++});step();
  assert(Math.abs(rendered.at(-1).camera.yaw-(solar.DEFAULT_SOLAR_CAMERA.yaw-.055))<1e-8,'keyboard rotates actual yaw');
  assert.equal(prevented,2);assert.equal(rendered.at(-1).phase,paused);assert.equal(frames.size,0,'paused keyboard input settles after a single frame');
  canvasListeners.pointermove(pointer('mouse',390,355,8));step();
  const hovering={...rendered.at(-1).camera};canvasListeners.pointerleave();step();
  assert.notDeepEqual(rendered.at(-1).camera,hovering,'pointer leave removes restrained hover parallax');
  render({running:true,speed:2,pulseKey:0});step();step();assert(rendered.at(-1).phase>paused,'resume continues phase');
  document.hidden=true;listeners.visibilitychange();assert.equal(frames.size,0,'hidden page stops RAF');
  document.hidden=false;listeners.visibilitychange();step();assert.equal(frames.size,1,'visible page resumes RAF');
  media.matches=true;mediaListeners.change();step();const frozen=rendered.at(-1).phase;step();assert.equal(rendered.at(-1).phase,frozen);assert.equal(frames.size,0,'reduced motion stops RAF');
  const beforeReduced={...rendered.at(-1).camera};canvasListeners.pointermove(pointer('mouse',0,0,8));step();
  assert.deepEqual(rendered.at(-1).camera,beforeReduced,'reduced motion disables incidental hover parallax');
  canvasListeners.pointerdown(pointer('touch',100,100));
  canvasListeners.pointermove(pointer('touch',102,135));assert.equal(frames.size,0,'vertical touch movement keeps the page scroll gesture');
  canvasListeners.pointermove(pointer('touch',150,105));step();
  assert.notDeepEqual(rendered.at(-1).camera,beforeReduced,'deliberate horizontal touch drag still controls a reduced-motion camera');
  assert.equal(rendered.at(-1).phase,frozen);assert.equal(frames.size,0,'reduced-motion drag remains frozen and settles');
  canvasListeners.pointercancel(pointer('touch',150,105));assert.equal(canvas.capturedPointer,null,'pointer cancel releases capture');
  canvasListeners.pointerdown(pointer('mouse',100,100));canvasListeners.lostpointercapture(pointer('mouse',100,100));assert.equal(canvas.dataset.dragging,'false','lost capture clears dragging');
  canvasListeners.pointerdown(pointer('mouse',100,100));document.hidden=true;listeners.visibilitychange();assert.equal(canvas.capturedPointer,null,'hidden document releases active capture');
  document.hidden=false;listeners.visibilitychange();step();
  canvasListeners.pointerdown(pointer('mouse',100,100));
  effectSlots.forEach(slot=>slot.cleanup?.());assert.equal(frames.size,0,'unmount stops RAF');assert.equal(canvas.capturedPointer,null,'unmount releases pointer capture');assert.equal(Object.keys(canvasListeners).length,0,'unmount removes every pointer and keyboard listener');
}

function initializationChecks() {
  function harness({hidden=false,legacyMedia=false,noMedia=false,noObserver=false,noContext=false,throwContext=false,fail=false,box={width:390,height:355}}={}) {
    const refs=[], effects=[], pending=[], frames=new Map(), listeners={}, windowListeners={}, mediaListeners={}, canvasListeners={}, errors=[], paints=[];
    const state={fail,box:{...box},observerResize:null};
    let refIndex=0,effectIndex=0,frameId=0,stamp=1000;
    const media={matches:false};
    if(legacyMedia) {
      media.addListener=fn=>mediaListeners.change=fn;
      media.removeListener=()=>delete mediaListeners.change;
    } else {
      media.addEventListener=(name,fn)=>mediaListeners[name]=fn;
      media.removeEventListener=name=>delete mediaListeners[name];
    }
    const document={hidden,addEventListener:(name,fn)=>listeners[name]=fn,removeEventListener:name=>delete listeners[name]};
    const window={devicePixelRatio:1,addEventListener:(name,fn)=>windowListeners[name]=fn,removeEventListener:name=>delete windowListeners[name]};
    if(!noMedia)window.matchMedia=()=>media;
    const poster={hidden:false};
    const canvas=instrumentCanvas({getContext:()=>{if(throwContext)throw new Error('test context failure');return noContext?null:{setTransform(){}};},getBoundingClientRect:()=>({left:0,top:0,...state.box})},canvasListeners);
    const react={
      useRef(value){return refs[refIndex++]??(refs[refIndex-1]={current:value});},
      useEffect(fn,deps){const index=effectIndex++;const old=effects[index];if(!old||deps.some((d,i)=>d!==old.deps[i]))pending.push(()=>{old?.cleanup?.();effects[index]={deps,cleanup:fn()};});},
    };
    const jsx=(type,props)=>{if(type==='canvas')props.ref.current=canvas;if(type==='picture')props.ref.current=poster;return {type,props};};
    const extra={window,document,console:{error:(...args)=>errors.push(args)},requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:id=>frames.delete(id)};
    if(!noObserver)extra.ResizeObserver=class{constructor(resize){state.observerResize=resize;}observe(){}disconnect(){}};
    const Scene=loadTs('src/components/solar-system-scene.tsx',name=>name==='react'?react:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='@/lib/solar-system'?{...solar,drawSolarSystem:(_ctx,_w,_h,phase,flash,camera)=>{if(state.fail)throw new Error('test painter failure');paints.push({phase,flash,camera:{...camera}});}}:{default:{}},extra).default;
    const render=(props={running:true,speed:1,pulseKey:0})=>{refIndex=effectIndex=0;Scene(props);while(pending.length)pending.shift()();};
    const step=()=>{stamp+=16;const batch=[...frames.values()];frames.clear();batch.forEach(fn=>fn(stamp));};
    const cleanup=()=>effects.forEach(effect=>effect.cleanup?.());
    render();
    return {state,poster,paints,frames,listeners,windowListeners,media,mediaListeners,errors,render,step,cleanup};
  }
  const hidden=harness({hidden:true});
  assert.equal(hidden.paints.length,1,'an initially hidden document still receives its first scene paint');
  assert.equal(hidden.poster.hidden,true);assert.equal(hidden.frames.size,0,'hidden initialization does not schedule RAF');hidden.cleanup();
  const legacy=harness({noObserver:true,legacyMedia:true});
  assert.equal(legacy.paints.length,1,'missing ResizeObserver does not prevent initial paint');
  assert.equal(typeof legacy.windowListeners.resize,'function','resize listener is the observer fallback');
  assert.equal(typeof legacy.mediaListeners.change,'function','legacy media listener is registered');
  legacy.windowListeners.resize();assert.equal(legacy.paints.length,2,'fallback resize repaints the scene');
  legacy.cleanup();assert.equal(legacy.windowListeners.resize,undefined);assert.equal(legacy.mediaListeners.change,undefined);
  const noMedia=harness({noObserver:true,noMedia:true});assert.equal(noMedia.paints.length,1,'missing matchMedia does not prevent initial paint');noMedia.cleanup();
  const noContext=harness({noContext:true});assert.equal(noContext.poster.hidden,false,'poster remains when Canvas context is unavailable');assert.equal(noContext.frames.size,0);noContext.cleanup();
  const throwingContext=harness({throwContext:true});assert.equal(throwingContext.poster.hidden,false,'poster remains when getContext throws');assert.equal(throwingContext.frames.size,0);assert.equal(throwingContext.paints.length,0);assert.equal(throwingContext.errors.length,1,'unavailable context error is handled');throwingContext.cleanup();
  const zeroObserver=harness({box:{width:0,height:0}});
  assert.equal(zeroObserver.poster.hidden,false,'zero layout retains the poster');assert.equal(zeroObserver.paints.length,0,'zero layout does not paint a tiny substitute canvas');assert.equal(zeroObserver.frames.size,0,'zero layout does not schedule RAF');
  zeroObserver.render({running:true,speed:2,pulseKey:0});assert.equal(zeroObserver.frames.size,0,'state updates do not start RAF before nonzero layout');
  zeroObserver.state.box={width:390,height:355};zeroObserver.state.observerResize();
  assert.equal(zeroObserver.paints.length,1,'observer paints after layout becomes nonzero');assert.equal(zeroObserver.poster.hidden,true,'a successful nonzero observer paint hides the poster');assert.equal(zeroObserver.frames.size,1);
  zeroObserver.state.box={width:390,height:0};zeroObserver.state.observerResize();assert.equal(zeroObserver.poster.hidden,false,'returning to zero height restores the poster');assert.equal(zeroObserver.frames.size,0,'zero height stops the running RAF');zeroObserver.cleanup();
  const zeroFallback=harness({noObserver:true,box:{width:0,height:355}});assert.equal(zeroFallback.paints.length,0);assert.equal(zeroFallback.poster.hidden,false);
  zeroFallback.state.box.width=390;zeroFallback.windowListeners.resize();assert.equal(zeroFallback.paints.length,1,'resize fallback paints after a zero width becomes nonzero');assert.equal(zeroFallback.poster.hidden,true);zeroFallback.cleanup();
  const failed=harness({fail:true,noObserver:true});
  assert.equal(failed.poster.hidden,false,'a failed first paint retains the poster');assert.equal(failed.frames.size,0,'failed first paint does not start a failing RAF loop');assert.equal(failed.errors.length,1);
  failed.state.fail=false;failed.windowListeners.resize();assert.equal(failed.paints.length,1);assert.equal(failed.poster.hidden,true,'poster hides only after a later successful paint');
  failed.state.fail=true;failed.step();assert.equal(failed.poster.hidden,false,'poster returns after a subsequent paint failure');assert.equal(failed.frames.size,0,'subsequent paint failure stops RAF');failed.cleanup();
}

function starfieldApiChecks() {
  const starCss=fs.readFileSync('src/components/starfield.module.css','utf8');
  assert(/top:\s*-1600px/.test(starCss) && /to\s*\{\s*transform:\s*translateY\(1600px\)/.test(starCss),'star tile starts above the viewport and moves downward');
  function mount({getAnimations,legacyMedia=false,noMedia=false}={}) {
    const refs=[],pending=[],listeners={},mediaListeners={};
    const field={dataset:{}};if(getAnimations)field.getAnimations=getAnimations;
    const media=legacyMedia?{addListener:fn=>mediaListeners.change=fn,removeListener:()=>delete mediaListeners.change}:{addEventListener:(name,fn)=>mediaListeners[name]=fn,removeEventListener:name=>delete mediaListeners[name]};
    const window={};if(!noMedia)window.matchMedia=()=>media;
    const document={hidden:false,addEventListener:(name,fn)=>listeners[name]=fn,removeEventListener:name=>delete listeners[name]};
    const react={useRef:value=>{const ref={current:value};refs.push(ref);return ref;},useEffect:fn=>pending.push(fn)};
    const jsx=(type,props)=>{if(props.ref)props.ref.current=field;return{type,props};};
    const Starfield=loadTs('src/components/starfield.tsx',name=>name==='react'?react:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:{default:{}},{window,document}).default;
    Starfield({running:true,speed:2});const cleanup=pending.map(fn=>fn());
    return{field,listeners,mediaListeners,cleanup:()=>cleanup.forEach(fn=>fn?.())};
  }
  const noApi=mount({noMedia:true});assert.equal(noApi.field.dataset.hidden,'false','starfield mounts without getAnimations, CSSAnimation, or matchMedia');noApi.cleanup();
  const animation={animationName:'local_rise',playbackRate:1};
  const legacy=mount({getAnimations:()=>[animation],legacyMedia:true});assert.equal(animation.playbackRate,2,'missing updatePlaybackRate uses the writable playbackRate API');assert.equal(typeof legacy.mediaListeners.change,'function');legacy.cleanup();assert.equal(legacy.mediaListeners.change,undefined);
}

async function renderPreview(name,width,height,seconds,publish=false) {
  const ctx=captureContext();solar.drawSolarSystem(ctx,width,height,seconds);
  const first=ctx.snapshot();solar.drawSolarSystem(ctx,width,height,seconds+.05);assert.notEqual(ctx.snapshot(),first,'actual scene changes with time');
  solar.drawSolarSystem(ctx,width,height,seconds);const svg=ctx.getSvg(width,height,starsAt(seconds));assert(!/NaN|Infinity/.test(svg));
  fs.writeFileSync(`.preview/solar-3d-${name}.svg`,svg);await sharp(Buffer.from(svg)).png().toFile(`.preview/solar-3d-${name}.png`);
  if(publish)fs.copyFileSync(`.preview/solar-3d-${name}.png`,`public/solar-system-${name}.png`);
}

module.exports={solar,captureContext,starsAt,ellipseStats,boundingBox,addPoint,renderPreview};
if(require.main===module)(async()=>{
  const previewOnly=process.argv.includes('--preview-only'),publish=process.argv.includes('--publish-posters');
  assert(!(previewOnly&&publish),'candidate previews cannot publish unverified posters');
  if(!previewOnly){geometryChecks();rendererMotionChecks();footprintChecks();placementChecks();lifecycleChecks();initializationChecks();starfieldApiChecks();}
  for(const [name,width,height] of [['desktop',1440,855],['mobile',390,680]]) {
    await renderPreview(name,width,height,8,publish);
    for(const seconds of [0,26,52,78])await renderPreview(`${name}-phase-${seconds}`,width,height,seconds);
    console.log(`${name}: offline phase-8 and four sun-ellipse phase previews generated at ${width}×${height}`);
  }
  await renderPreview('desktop-460',1440,460,8);await renderPreview('mobile-355',390,355,8);
  if(!previewOnly){
    console.log('Geometry: full sphere/ring bounds at camera extrema, history, perspective, spatial parallax passed');
    console.log('Lifecycle: running, pause, resume, speed continuity, visibility, reduced motion, paused/touch drag, keyboard/Home, capture/listener cleanup passed');
    console.log('Initialization: synchronous/hidden first paint, zero-layout/context recovery, observer/media/API fallbacks, poster retention and recovery passed');
  } else console.log('Candidate previews only; final geometry validation and poster publication pending');
})().catch(error=>{console.error(error);process.exitCode=1;});
