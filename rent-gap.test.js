/* node rent-gap.test.js; browser UI is skipped when document is absent. */
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const scope={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'rent-gap.js'),'utf8'),scope);const api=scope.RentGap;
const tests=[];function test(name,fn){try{fn();tests.push('PASS '+name)}catch(err){console.error('FAIL '+name,err.message);process.exitCode=1}}
function close(a,b){assert.ok(Math.abs(a-b)<1e-9,a+' != '+b)}
test('exports only calculate and benchmarks',()=>assert.deepEqual(Object.keys(api).sort(),['benchmarks','calculate']));
test('Manchester two bed gap and denominator',()=>{const r=api.calculate(1233,875);assert.equal(r.gap,358);close(r.gapPct,358/1233*100);close(r.coveragePct,875/1233*100);assert.equal(r.annualGap,4296);assert.equal(r.direction,'below')});
test('Bristol two bed £449 gap',()=>assert.equal(api.calculate(1544,1095).gap,449));
test('Cheltenham two bed £296 gap',()=>assert.equal(api.calculate(1096,800).gap,296));
test('percentage is relative to OM not to LHA',()=>{const r=api.calculate(1000,800);assert.equal(r.gapPct,20);assert.equal(r.coveragePct,80)});
test('equal rates produce zero gap',()=>{const r=api.calculate(1000,1000);assert.equal(r.gap,0);assert.equal(r.direction,'equal');assert.equal(r.coveragePct,100)});
test('LHA above OM preserves negative gap and >100 coverage',()=>{const r=api.calculate(1000,1200);assert.equal(r.gap,-200);assert.equal(r.gapPct,-20);assert.equal(r.coveragePct,120);assert.equal(r.direction,'above')});
test('portfolio arithmetic does not change per-home percentage',()=>{const r=api.calculate(1233,875,10);assert.equal(r.totalMonthlyGap,3580);assert.equal(r.totalAnnualGap,42960);close(r.gapPct,358/1233*100)});
test('missing rent never becomes zero',()=>{for(const n of [null,undefined,'',true,false,'1000',NaN,Infinity,-1,0])assert.equal(api.calculate(n,800),null)});
test('invalid LHA never becomes zero',()=>{for(const n of [null,undefined,'',true,false,'800',NaN,Infinity,-1])assert.equal(api.calculate(1000,n),null)});
test('explicit numeric zero LHA remains valid',()=>assert.equal(api.calculate(1000,0).gapPct,100));
test('whole positive units required',()=>{for(const n of [null,0,-1,1.5,'10',Infinity,NaN])assert.equal(api.calculate(1000,800,n),null)});
test('decimal rent arithmetic preserves precision',()=>{const r=api.calculate(1000.25,875.75);close(r.gap,124.5);close(r.totalAnnualGap,1494)});
const rents=JSON.parse(fs.readFileSync(path.join(__dirname,'rents.json'),'utf8')),lha=JSON.parse(fs.readFileSync(path.join(__dirname,'underwriting_lha.json'),'utf8'));
test('real source rows use exact council and BRMA names',()=>{const rows=api.benchmarks(rents,lha,'2');assert.equal(rows.length,3);assert.equal(rows[0].result.gap,358);assert.equal(rows[1].result.gap,296);assert.equal(rows[2].result.gap,449);assert.equal(rows[0].month,'Aug 2026')});
test('one and three bed cohorts come from their own columns',()=>{const a=api.benchmarks(rents,lha,'1'),b=api.benchmarks(rents,lha,'3');assert.equal(a[0].om,1003);assert.equal(a[0].lha,775);assert.equal(b[0].om,1433);assert.equal(b[0].lha,950)});
test('4 bed and shared OM are withheld, no all-bedroom fallback',()=>{for(const bed of ['4','SAR'])for(const row of api.benchmarks(rents,lha,bed)){assert.equal(row.om,null);assert.equal(row.result,null)}});
test('missing whole source does not invent comparisons',()=>{for(const row of api.benchmarks({},{})){assert.equal(row.om,null);assert.equal(row.lha,null);assert.equal(row.result,null)}});
test('invalid bedroom category rejected',()=>assert.throws(()=>api.benchmarks(rents,lha,'all')));
test('pure deterministic calculation and source projection',()=>{const before=JSON.stringify([rents,lha]);const a=JSON.stringify(api.benchmarks(rents,lha)),b=JSON.stringify(api.benchmarks(rents,lha));assert.equal(a,b);assert.equal(JSON.stringify([rents,lha]),before)});
console.log(tests.join('\n'));console.log(tests.length+'/19 tests passed');
