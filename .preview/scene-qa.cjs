const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const sharp = require('sharp');
const assert = require('node:assert/strict');

// Offline render of the actual Canvas drawing commands, without controlling a browser.
function runScene(width, height, reduced = false) {
  let nodes = [], gradients = [], path = '', alpha = 1, stack = [];
  let frame = 0, nextId = 0, refIndex = 0;
  const frames = new Map(), listeners = {}, refs = [], effects = [], cleanups = [];
  const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  const gradient = (kind, attrs) => {
    const stops = [], id = 'g' + gradients.length;
    const item = { id, kind, attrs, stops, addColorStop: (offset, color) => stops.push({ offset, color }) };
    gradients.push(item); return item;
  };
  const fill = value => typeof value === 'string' ? esc(value) : 'url(#' + value.id + ')';
  const ctx = {
    strokeStyle: '#fff', fillStyle: '#fff', lineWidth: 1, font: '10px Consolas', textAlign: 'center',
    globalCompositeOperation: 'source-over',
    get globalAlpha() { return alpha; }, set globalAlpha(value) { alpha = value; },
    save() { stack.push(alpha); }, restore() { alpha = stack.pop() ?? 1; },
    setTransform() {}, clearRect() { nodes = []; gradients = []; },
    beginPath() { path = ''; }, moveTo(x, y) { path += 'M' + x + ' ' + y; },
    lineTo(x, y) { path += 'L' + x + ' ' + y; }, closePath() { path += 'Z'; },
    arc(x, y, r) { path += 'M' + (x-r) + ' ' + y + 'a' + r + ' ' + r + ' 0 1 0 ' + (r*2) + ' 0a' + r + ' ' + r + ' 0 1 0 ' + (-r*2) + ' 0'; },
    stroke() { nodes.push('<path d="' + path + '" fill="none" stroke="' + fill(this.strokeStyle) + '" stroke-width="' + this.lineWidth + '" opacity="' + alpha + '"/>'); },
    fill() { nodes.push('<path d="' + path + '" fill="' + fill(this.fillStyle) + '" opacity="' + alpha + '"/>'); },
    fillRect(x,y,w,h) { nodes.push('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill(this.fillStyle) + '" opacity="' + alpha + '"/>'); },
    createLinearGradient(x1,y1,x2,y2) { return gradient('linearGradient', 'gradientUnits="userSpaceOnUse" x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'"'); },
    createRadialGradient() { return gradient('radialGradient', ''); },
    drawImage(_img,x,y,w,h) { nodes.push('<ellipse cx="' + (x+w/2) + '" cy="' + (y+h/2) + '" rx="' + w/2 + '" ry="' + h/2 + '" fill="url(#sprite)" opacity="' + alpha + '"/>'); },
    fillText(text,x,y) { nodes.push('<text x="'+x+'" y="'+y+'" text-anchor="middle" font-family="Consolas,monospace" font-size="10" fill="'+fill(this.fillStyle)+'" opacity="'+alpha+'">'+esc(text)+'</text>'); },
  };
  const canvas = {
    style: {}, width, height, getContext: () => ctx,
    getBoundingClientRect: () => ({width,height,left:0,top:0}),
    addEventListener: (name, fn) => listeners[name] = fn,
    removeEventListener: name => delete listeners[name],
    captured: null,
    setPointerCapture(id) { this.captured = id; },
    hasPointerCapture(id) { return this.captured === id; },
    releasePointerCapture() { this.captured = null; },
  };
  const mql = { matches: reduced, addEventListener() {}, removeEventListener() {} };
  const document = { hidden: false, createElement: () => ({getContext:()=>({...ctx})}), addEventListener() {}, removeEventListener() {} };
  const react = {
    useRef: value => refs[refIndex++] ?? (refs[refIndex-1] = {current: value === null && refIndex === 1 ? canvas : value}),
    useEffect: fn => effects.push(fn),
  };
  const module = {exports:{}};
  const source = fs.readFileSync('src/components/timeline-scene.tsx','utf8');
  const js = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(js, {
    exports: module.exports, module,
    require: name => name === 'react' ? react : {jsx:()=>({})},
    window: {matchMedia:()=>mql,devicePixelRatio:1}, document,
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: fn => { const id=++nextId; frames.set(id,fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
  });
  const render = props => { refIndex=0; effects.length=0; module.exports.default(props); for(const fn of effects) { const cleanup=fn(); if(cleanup) cleanups.push(cleanup); } };
  render({running:true,speed:1,flat:false,resetKey:0,pulseKey:0});
  const step = () => { frame+=16; const queued=[...frames.values()]; frames.clear(); queued.forEach(fn=>fn(frame)); };
  const snapshot = () => nodes.join('');
  for(let i=0;i<40;i++) step();
  assert(nodes.length > 300, 'scene should generate geometry');
  const first = snapshot(); step();
  if(!reduced) assert.notEqual(snapshot(),first,'running scene moves');
  else assert.equal(snapshot(),first,'reduced motion stays still');
  refs[1].current={running:false,speed:1,flat:false}; refs[3].current();
  for(let i=0;i<80;i++) step();
  const paused=snapshot(); step(); assert.equal(snapshot(),paused,'pause freezes geometry');
  const event={pointerId:1,isPrimary:true,button:0,clientX:100,clientY:100,pointerType:'mouse'};
  listeners.pointerdown(event); listeners.pointermove({...event,clientX:250,clientY:130}); listeners.pointerup(event);
  for(let i=0;i<70;i++) step(); assert.notEqual(snapshot(),paused,'drag changes perspective while paused');
  refs[1].current={running:false,speed:1,flat:true}; refs[3].current();
  for(let i=0;i<80;i++) step(); assert.equal(frames.size,0,'2D transition settles without a perpetual RAF');
  const flat=snapshot(); step(); assert.equal(snapshot(),flat,'2D remains frozen');
  refs[1].current={running:false,speed:1,flat:false}; refs[2].current={yaw:.57,pitch:.23}; refs[3].current();
  for(let i=0;i<80;i++) step();
  assert.equal(canvas.captured,null,'pointer capture is released');
  refs[1].current={running:true,speed:1,flat:false}; refs[3].current(); step();
  const defs=gradients.map(g=>'<'+g.kind+' id="'+g.id+'" '+g.attrs+'>'+g.stops.map(s=>'<stop offset="'+s.offset+'" stop-color="'+s.color+'"/>').join('')+'</'+g.kind+'>').join('');
  const sprite='<radialGradient id="sprite"><stop offset="0" stop-color="#f2ffd5"/><stop offset=".05" stop-color="#e2ffa1" stop-opacity=".85"/><stop offset=".18" stop-color="#c5fb6f" stop-opacity=".24"/><stop offset=".5" stop-color="#acea64" stop-opacity=".05"/><stop offset="1" stop-color="#acea64" stop-opacity="0"/></radialGradient>';
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'"><defs>'+sprite+defs+'</defs><rect width="100%" height="100%" fill="#070909"/>'+snapshot()+'</svg>';
  cleanups.forEach(fn=>fn()); assert.equal(frames.size,0,'unmount cancels animation');
  return svg;
}

(async()=>{
  for(const [name,w,h,reduced] of [['desktop',1440,636,false],['mobile',390,442,false],['reduced',1440,636,true]]) {
    const svg=runScene(w,h,reduced);
    fs.writeFileSync('.preview/'+name+'-scene.svg',svg);
    await sharp(Buffer.from(svg)).png().toFile('.preview/'+name+'-scene.png');
    console.log(name+': rendering, animation, pause, drag, 2D and cleanup passed');
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
