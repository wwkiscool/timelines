const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const assert = require('node:assert/strict');

// Exercise the real React component's rendered state and handlers without a browser.
const states=[], refs=[], effects=[], listeners={};
let stateIndex=0,refIndex=0;
const react={
  useState(initial) {
    const index=stateIndex++;
    if(!(index in states))states[index]=typeof initial==='function'?initial():initial;
    return [states[index],value=>states[index]=typeof value==='function'?value(states[index]):value];
  },
  useRef(value) {const index=refIndex++;return refs[index]??(refs[index]={current:value});},
  useCallback:fn=>fn,
  useEffect:fn=>effects.push(fn),
};
const jsx=(type,props)=>({type,props});
class FakeElement {constructor(isButton=false){this.isButton=isButton;}closest(){return this.isButton?{}:null;}}
const window={addEventListener:(type,fn)=>listeners[type]=fn,removeEventListener:type=>delete listeners[type]};
function load(path) {
  const module={exports:{}};
  const code=ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code,{
    module,exports:module.exports,window,Element:FakeElement,
    require:name=>name==='react'?react:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='@/lib/time'?load('src/lib/time.ts'):()=>null,
  },{filename:path});
  return module.exports;
}
const MomentApp=load('src/components/moment-app.tsx').default;
function render(){stateIndex=refIndex=0;effects.length=0;return MomentApp();}
function find(tree,predicate){
  if(!tree||typeof tree!=='object')return null;
  if(Array.isArray(tree)){for(const child of tree){const found=find(child,predicate);if(found)return found;}return null;}
  if(predicate(tree))return tree;
  return find(tree.props?.children,predicate);
}
function visibleText(tree){
  if(tree==null||typeof tree==='boolean')return '';
  if(typeof tree==='string'||typeof tree==='number')return String(tree);
  if(Array.isArray(tree))return tree.map(visibleText).join(' ');
  if(tree.props?.hidden)return '';
  return visibleText(tree.props?.children);
}
const clock=tree=>find(tree,node=>node.props?.className==='clock-display');
const seconds=tree=>find(tree,node=>node.props?.id==='clock-seconds');
const fraction=tree=>find(tree,node=>node.props?.id==='clock-fraction');
const pause=tree=>find(tree,node=>node.props?.className==='pause-button');
let tree=render();
assert.equal(clock(tree).type,'button','clock has native button keyboard behavior');
assert.equal(clock(tree).props['aria-expanded'],false,'milliseconds are collapsed by default');
assert.notEqual(seconds(tree).props.hidden,true,'seconds stay visible on the first render');
assert.equal(fraction(tree).props.hidden,true,'milliseconds are hidden on the first render');
assert.equal(clock(tree).props['aria-controls'],'clock-fraction');
assert.equal(clock(tree).props['aria-label'],'显示毫秒','the toggle describes only optional milliseconds');
assert(!visibleText(tree).includes('毫秒'),'default page contains no visible milliseconds prompt');
assert.equal(find(tree,node=>node.props?.className==='clock-reveal-hint'),null,'no reveal hint is rendered');
const runningLabel=pause(tree).props['aria-label'];
clock(tree).props.onClick();tree=render();
assert.equal(clock(tree).props['aria-expanded'],true);
assert.notEqual(seconds(tree).props.hidden,true,'showing milliseconds does not change visible seconds');
assert.equal(fraction(tree).props.hidden,false,'click reveals milliseconds');
assert.equal(clock(tree).props['aria-label'],'隐藏毫秒');
assert.equal(pause(tree).props['aria-label'],runningLabel,'revealing precision does not pause the scene');
clock(tree).props.onClick();tree=render();
assert.notEqual(seconds(tree).props.hidden,true,'seconds remain visible when milliseconds are collapsed again');
assert.equal(fraction(tree).props.hidden,true,'second click hides milliseconds again');
const keyboardEffect=effects.find(fn=>fn.toString().includes('event.target instanceof Element'));
assert(keyboardEffect,'real global keyboard handler was found');
const cleanup=keyboardEffect();
let prevented=false;
listeners.keydown({target:new FakeElement(true),code:'Space',key:' ',repeat:false,metaKey:false,ctrlKey:false,altKey:false,preventDefault:()=>prevented=true});
tree=render();assert.equal(pause(tree).props['aria-label'],runningLabel,'Space on a focused clock button does not invoke global pause');
assert.equal(prevented,false,'native button Space handling remains available');
listeners.keydown({target:new FakeElement(false),code:'Space',key:' ',repeat:false,metaKey:false,ctrlKey:false,altKey:false,preventDefault:()=>prevented=true});
tree=render();assert.notEqual(pause(tree).props['aria-label'],runningLabel,'global Space still pauses away from controls');
assert.equal(prevented,true);cleanup();
const css=fs.readFileSync('src/app/globals.css','utf8');
assert(/\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/.test(css),'hidden state takes precedence over flex display');
assert(/\.clock-display\s*\{[^}]*pointer-events\s*:\s*auto/.test(css),'the clock remains clickable inside the noninteractive clock area');
assert(/\.clock-seconds\s*\{[^}]*display\s*:\s*inline-flex/.test(css),'expanded seconds retain digit alignment');
console.log('Clock: HH:mm:ss always visible, no visible milliseconds prompt, milliseconds toggle, native button/global keyboard separation, hidden and pointer CSS passed');
