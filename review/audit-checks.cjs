// Run from the repository root: node review/audit-checks.cjs
// These checks reproduce existing behavior; they do not assert the app is bug-free.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const current = fs.readFileSync('王陆语料库听写练习_v5.html', 'utf8');
// This is a historical audit, not the current application's regression suite.
const html = current.includes('const VOCAB =') ? current : execFileSync('git', ['show', '865479d:王陆语料库听写练习_v5.html'], {encoding: 'utf8', maxBuffer: 2 * 1024 * 1024});
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(source);
const body = source.slice(0, source.lastIndexOf('// ── INIT ──'));
const findings = [];

function makeContext() {
  const saved = new Map(), elements = new Map(), timers = [];
  let writes = 0;
  function element(id) {
    if (!elements.has(id)) {
      const el = {
        id, value: '', className: '', textContent: '', innerHTML: '',
        style: {}, dataset: {}, disabled: false, listeners: {},
        focus() {}, scrollIntoView() {}, setSelectionRange() {},
        addEventListener(type, fn) { this.listeners[type] = fn; },
        querySelectorAll() { return []; }
      };
      el.classList = {
        contains(c) { return el.className.split(' ').includes(c); },
        add(c) { if (!this.contains(c)) el.className += ' ' + c; },
        remove(c) { el.className = el.className.split(' ').filter(x => x !== c).join(' '); },
        toggle(c, on) {
          if (on === undefined) on = !this.contains(c);
          on ? this.add(c) : this.remove(c);
        }
      };
      elements.set(id, el);
    }
    return elements.get(id);
  }
  const document = {
    getElementById: element,
    querySelector(s) { return element(s.slice(1)); },
    querySelectorAll(s) {
      if (s === '.row-input') return [...elements.values()].filter(e => e.id.startsWith('inp-'));
      return [];
    },
    addEventListener() {}
  };
  const ctx = vm.createContext({
    window: {}, document, console, Date, Map, Set, Promise, AbortController,
    localStorage: {
      getItem: k => saved.get(k) || null,
      setItem(k, v) { writes++; saved.set(k, v); }
    },
    setTimeout(fn, ms) { timers.push({fn, ms}); return timers.length; },
    clearTimeout() {}, setInterval() {}, clearInterval() {}
  });
  vm.runInContext(body, ctx);
  return {
    ctx, saved, element, timers, writes: () => writes,
    run: s => vm.runInContext(s, ctx)
  };
}

async function main() {
  let t = makeContext();
  const missing = ['toImport', 'doImport', 'clearAllData'].filter(n => t.run('typeof ' + n) === 'undefined');
  assert.equal(missing.length, 3);
  findings.push({id: 'F1', observed: 'UI handlers are undefined', handlers: missing});

  const cases = [
    ['archaeologist', 'archaeologist=archeologist'],
    ['archeologist', 'archaeologist=archeologist'],
    ['fertiliser', 'fertiliser=fertilizer'],
    ['fertilizer', 'fertiliser=fertilizer'],
    ['RA', 'RA(research assistant)'],
    ['truck license', 'truck licence']
  ];
  const grading = cases.map(([input, answer]) => ({input, answer, accepted: t.ctx.isOk(input, answer)}));
  assert(grading.every(x => !x.accepted));
  findings.push({id: 'F2', observed: 'Alternative answers rejected', cases: grading});

  t = makeContext();
  t.run("curChap='3.2';curWords=[{w:'hello',p:'',m:'你好'}]");
  t.element('inp-0').value = 'helo';
  t.ctx.checkAll(); t.ctx.checkAll();
  assert.equal(JSON.parse(t.saved.get('wl3_wb')).hello.n, 2);
  findings.push({id: 'F3', observed: 'Grading the same answer twice increments error count twice', count: 2});

  t = makeContext();
  t.run("curChap='3.2';curWords=[{w:'hello',p:'',m:'你好'}]");
  t.ctx.buildRows(); t.ctx.checkAll();
  t.element('inp-0').value = 'hello';
  t.element('inp-0').listeners.input();
  t.run('showResults=()=>{}'); t.ctx.finishDict();
  assert.equal(JSON.parse(t.saved.get('wl3_hist'))['3.2'][0].pct, 0);
  findings.push({id: 'F4', observed: 'Correcting a blank graded row keeps skip state; finish records 0%', input: 'hello', answer: 'hello', grade: t.element('inp-0').className, pct: 0});

  t = makeContext();
  t.run("curChap=null;wbMode=true;curWords=[{w:'hello',p:'',m:'你好'}];showResults=()=>{}");
  t.ctx.addToWb('hello', '', '你好', '3.2');
  t.element('inp-0').value = 'hello'; t.ctx.finishDict();
  assert(!t.saved.has('wl3_hist'));
  assert.equal(JSON.parse(t.saved.get('wl3_wb')).hello.n, 1);
  findings.push({id: 'F5', observed: 'Successful wordbook practice has no saved result or mastery state', historySaved: false, wordbook: JSON.parse(t.saved.get('wl3_wb')).hello});

  t = makeContext();
  t.run('blockRunning=true;renderWb=()=>{}'); t.ctx.toWb();
  assert.equal(t.run('blockRunning'), true);
  findings.push({id: 'F6', observed: 'Opening wordbook leaves continuous playback running'});

  t = makeContext();
  t.run("curChap='3.2';curWords=[{w:'hello',p:'',m:'你好'}];blockRunning=true;showResults=()=>{}");
  t.element('inp-0').value = 'hello'; t.ctx.finishDict();
  assert.equal(t.run('blockRunning'), true);
  findings.push({id: 'F7', observed: 'Finishing session leaves continuous playback running'});

  t = makeContext();
  t.run("curChap='11.4';curWords=VOCAB['11.4'];"); t.ctx.checkAll();
  assert.equal(t.writes(), 916);
  findings.push({id: 'F8', observed: 'Grading an unanswered 916-entry section performs 916 full wordbook writes', writes: t.writes()});

  t = makeContext();
  t.run("curWords=[{w:'hello',p:'',m:'你好'}];blockRunning=true;playWordAudio=async()=>false;showTtsHint=()=>{};flashRow=()=>{};");
  t.ctx.playBlockFrom(0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(t.timers.length, 1);
  findings.push({id: 'F9', observed: 'Failed playback still schedules next item', scheduled: t.timers.length});

  t = makeContext();
  t.run("window.lastWrong=[{w:'hello',typed:'<b>audit-marker</b>',m:'你好'}]"); t.ctx.renderResList();
  assert(t.element('r-wrong').innerHTML.includes('<b>audit-marker</b>'));
  findings.push({id: 'F10', observed: 'Typed answer is inserted as raw HTML instead of text', payload: '<b>audit-marker</b>'});

  t = makeContext(); t.saved.set('wl3_hist', 'null');
  assert.throws(() => t.ctx.chapSessions('3.2'));
  findings.push({id: 'F11', observed: 'Syntactically valid null storage breaks history access'});

  t = makeContext();
  t.saved.set('wl3_wb', JSON.stringify({
    older: {word: 'older-marker', mean: '', chap: '3.2', n: 1, d: '2026/9/30'},
    newer: {word: 'newer-marker', mean: '', chap: '3.2', n: 1, d: '2026/10/1'}
  }));
  t.run("wbSortBy='date'"); t.ctx.renderWb();
  const sortedHtml = t.element('wb-body').innerHTML;
  assert(sortedHtml.indexOf('older-marker') < sortedHtml.indexOf('newer-marker'));
  findings.push({id: 'F12', observed: 'Wordbook date view lists September before October in descending date order', dates: ['2026/9/30', '2026/10/1']});

  t = makeContext();
  t.run("curWords=[{w:'one'},{w:'two'}]"); t.element('inp-0').value = 'one';
  assert.equal(t.ctx.nextUnanswered(0), 0);
  findings.push({id: 'F13', observed: 'First unanswered lookup includes filled, ungraded inputs', firstFilledIndex: 0, returnedIndex: 0});

  t = makeContext();
  t.run("curChap='3.2';curWords=[{w:'hello',p:'',m:'你好'}];showResults=()=>{}");
  t.ctx.buildRows(); t.element('inp-0').value = 'helo'; t.ctx.checkAll();
  t.element('inp-0').value = 'hello'; t.element('inp-0').listeners.input(); t.ctx.finishDict();
  assert.equal(JSON.parse(t.saved.get('wl3_hist'))['3.2'][0].pct, 100);
  findings.push({id: 'F14', observed: 'Correcting an incorrect answer after reveal records 100% without an initial score', pct: 100});

  const dataset = t.run(`(() => {
    const all=Object.entries(VOCAB).flatMap(([chap,words])=>words.map((w,index)=>({...w,chap,index:index+1})));
    const groups=new Map();
    for(const item of all){const key=norm(item.w);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);}
    return {
      sections:Object.keys(VOCAB).length,entries:all.length,uniqueAnswerStrings:groups.size,
      repeatedAnswerGroups:[...groups.values()].filter(g=>g.length>1).length,
      largestSection:Math.max(...Object.values(VOCAB).map(words=>words.length)),
      annotatedAnswers:all.filter(w=>/[()=,/]/.test(w.w)),
      phoneticPlaceholders:all.filter(w=>/[<>]/.test(w.p)).length
    };
  })()`);
  const report = {
    scope: 'Local source, isolated VM and DOM/storage mocks; no real browser/audio validation',
    syntax: 'pass', dataset, findings
  };
  fs.mkdirSync('review', {recursive: true});
  fs.writeFileSync('review/audit-evidence-2026-10-15.json', JSON.stringify(report, null, 2) + '\n');
  console.log(`Reproduced ${findings.length} observations; syntax valid; ${dataset.entries} entries across ${dataset.sections} sections.`);
  for (const finding of findings) console.log(`${finding.id}: ${finding.observed}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
