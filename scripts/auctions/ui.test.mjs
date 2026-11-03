import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Synthetic fixtures are confined to tests, never supplied as production lots.
const source = readFileSync(new URL('../../assets/auctions.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const now = new Date().toISOString();
const later = new Date(Date.now() + 7 * 86400000).toISOString();
const earlier = new Date(Date.now() - 7 * 86400000).toISOString();
const lots = [
  {id:'one',title:'Test flat',address:'Fixture one',town:'Edinburgh',lot_type:'flat',status:'upcoming',guide_price:300000,auction_date:later,scraped_at:now,source_url:'https://example.invalid/one'},
  {id:'two',title:'Test block',address:'Fixture two',town:'Manchester',lot_type:'block',status:'sold',guide_price:null,sold_price:400000,auction_date:earlier,scraped_at:now,source_url:'https://example.invalid/two'},
  {id:'three',title:'Test mixed use',address:'Fixture three',town:'City Of Bristol',lot_type:'mixed-use',status:'upcoming',guide_price:200000,auction_date:null,scraped_at:now,source_url:'https://example.invalid/three'},
  {id:'four',title:'Test HMO',address:'Fixture four',town:'Glasgow',lot_type:'HMO',status:'unsold',guide_price:100000,auction_date:earlier,scraped_at:now},
  {id:'five',title:'Test house',address:'Fixture five',town:'Cheltenham',lot_type:'house',status:'withdrawn',guide_price:150000,auction_date:earlier,scraped_at:now}
];
const base = {town:'',type:'All',status:'all',sort:'date'};
const feed = rows => ({schema_version:1,updated_at:now,lots:rows});
const coverage = {updated_at:now,sources:[{id:'test',name:'Test source',url:'https://example.invalid/',status:'live',lot_count:5,commercial_excluded:2,checked_at:now}],counts_by_town:{Edinburgh:1}};

function harness({payload=feed(lots),sourceCoverage=coverage,failLots=false,failCoverage=false,sharedGrade}={}) {
  const handlers={}, domHandlers={}, requests=[];
  const root={innerHTML:'',addEventListener(name,fn){handlers[name]=fn;}};
  const window={addEventListener(){},...(sharedGrade?{lcAssetGrade:sharedGrade}:{})};
  const context=vm.createContext({
    window,URL,Intl,AbortController,setTimeout,clearTimeout,location:{hash:''},
    document:{readyState:'loading',getElementById(id){return id==='auctions_body'?root:null;},querySelector(){return null;},addEventListener(name,fn){domHandlers[name]=fn;}},
    fetch:async url=>{requests.push(url);const isLots=url.includes('lots.json');return {ok:isLots?!failLots:!failCoverage,status:503,json:async()=>isLots?payload:sourceCoverage};}
  });
  vm.runInContext(source,context,{filename:'assets/auctions.js'});
  domHandlers.DOMContentLoaded();
  return {api:window.lcAuctions,root,requests,
    change(key,value){handlers.change({target:{dataset:{aqFilter:key},value}});},
    click(dataset){handlers.click({target:{closest(){return {dataset};}}});}
  };
}
const ids=rows=>Array.from(rows,l=>l.id);

test('Auctions and every inline application script parse',()=>{
  new vm.Script(source);
  for(const match of index.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(match[1].trim())new vm.Script(match[1]);
});
test('public Auctions entry has main navigation, deep link and startup race guard',()=>{
  for(const text of ['data-g="auctions"','id="auctions_view"','<div id="app">',"window.lcAuctionsActive=active==='auctions'",'location.hash === "#auctions"'])assert.ok(index.includes(text),text);
});
test('all five towns and canonical Bristol/Edinburgh aliases are recognized',()=>{
  const {api}=harness();
  assert.equal(api.town('City Of Bristol'),'Bristol');assert.equal(api.town('City of Edinburgh'),'Edinburgh');
  for(const name of ['Manchester','Glasgow','Edinburgh','Bristol','Cheltenham'])assert.equal(api.town(name),name);
  assert.equal(api.town('Outside target area'),'');
});
test('property type aliases normalize without interpreting sales prose',()=>{
  const {api}=harness();
  for(const [input,expected] of [['block','Blocks'],['houses','Houses'],['flat','Flats'],['HMO','HMO'],['portfolio','Portfolios'],['mixed_use','Mixed-use'],['development-site','Development']])assert.equal(api.type(input),expected);
  assert.equal(api.type('cheap auction bargain'),'');
});
test('town, type and all explicit status filters work',()=>{
  const {api}=harness();
  assert.deepEqual(ids(api.filtered(lots,{...base,town:'Edinburgh'})),['one']);
  assert.deepEqual(ids(api.filtered(lots,{...base,type:'Mixed-use'})),['three']);
  assert.equal(api.filtered(lots,{...base,status:'upcoming'}).length,2);
  for(const [status,id] of [['sold','two'],['unsold','four'],['withdrawn','five']])assert.deepEqual(ids(api.filtered(lots,{...base,status})),[id]);
  assert.equal(api.filtered(lots,base).length,5);
});
test('guide sorting keeps unknown prices last in both directions',()=>{
  const {api}=harness();
  assert.deepEqual(ids(api.filtered(lots,{...base,sort:'price-asc'})),['four','five','three','one','two']);
  assert.deepEqual(ids(api.filtered(lots,{...base,sort:'price-desc'})),['one','three','five','four','two']);
});
test('unknown auction dates sort last and sold-price sorting is separate',()=>{
  const {api}=harness();
  assert.deepEqual(ids(api.filtered(lots,{...base,status:'upcoming'})),['one','three']);
  assert.equal(api.filtered(lots,{...base,sort:'sold-desc'})[0].id,'two');
});
test('auction, receiver keywords, result and low guide never assign distress',()=>{
  const {api}=harness();
  assert.equal(api.grade({title:'Receiver auction bargain',status:'unsold',guide_price:1,source_url:'https://example.invalid'}),'');
  assert.equal(api.grade({grade:'A',source_url:'https://example.invalid'}),'');
  assert.equal(api.grade({grade:'C',grade_evidence:'',source_url:'https://example.invalid'}),'');
});
test('explicit feed grade requires evidence and a usable source URL',()=>{
  const {api}=harness();
  assert.equal(api.grade({grade:'B',grade_evidence:'Verified instruction',source_url:'https://example.invalid'}),'B');
  assert.equal(api.grade({grade:'A',grade_evidence:'Verified filing',sources:[{url:'https://example.invalid/filing'}]}),'A');
  assert.equal(api.grade({grade:'A',grade_evidence:'Claim',source_url:'javascript:alert(1)'}),'');
});
test('old, undated and explicitly stale source checks are marked stale',()=>{
  const {api}=harness();
  assert.equal(api.stale({scraped_at:null}),true);assert.equal(api.stale({scraped_at:'2020-01-01'}),true);
  assert.equal(api.stale({scraped_at:now,stale:true}),true);assert.equal(api.stale({scraped_at:now,stale:false}),false);
});
test('refresh requests only the two public JSON snapshots without Supabase',async()=>{
  const h=harness();await h.api.refresh();assert.equal(h.requests.length,2);
  assert.ok(h.requests.some(u=>u.startsWith('data/auctions/lots.json?')));
  assert.ok(h.requests.some(u=>u.startsWith('data/auctions/coverage.json?')));
  assert.ok(h.requests.every(u=>!u.includes('supabase')));
});
test('feed text is escaped and javascript source URLs are never linked',async()=>{
  const h=harness({payload:feed([{...lots[0],title:'<script>alert(1)</script>',source_url:'javascript:alert(1)'}])});await h.api.refresh();
  assert.ok(h.root.innerHTML.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!h.root.innerHTML.includes('<script>alert'));assert.ok(!h.root.innerHTML.includes('href="javascript:'));
});
test('old snapshots and elapsed upcoming auctions get explicit outcome warnings',async()=>{
  const h=harness({payload:{schema_version:1,updated_at:'2020-01-01',lots:[{...lots[0],auction_date:earlier,scraped_at:'2020-01-01'}]}});await h.api.refresh();
  for(const text of ['Stale or undated snapshot','Outcome unconfirmed','last reported status'])assert.ok(h.root.innerHTML.includes(text));
});
test('coverage reports each source status and commercial exclusion counts',async()=>{
  const h=harness({sourceCoverage:{...coverage,sources:['live','partial','failed','skipped'].map((status,i)=>({...coverage.sources[0],id:String(i),status,commercial_excluded:i===0?2:0}))}});await h.api.refresh();
  for(const text of ['1 live','1 partial','1 failed','1 skipped','2 commercial excluded','Not reported'])assert.ok(h.root.innerHTML.includes(text));
});
test('failed lots feed and unsupported schema show errors rather than invented stock',async()=>{
  const h=harness({failLots:true});await h.api.refresh();
  assert.ok(h.root.innerHTML.includes('Auction feed unavailable'));assert.ok(h.root.innerHTML.includes('No lots have been invented'));
  assert.ok(!h.root.innerHTML.includes('<article class="aq-lot"'));
  const bad=harness({payload:{schema_version:2,lots:[]}});await bad.api.refresh();assert.ok(bad.root.innerHTML.includes('Unsupported or malformed auction feed'));
});
test('empty results explain coverage limits and failed coverage still permits lots',async()=>{
  const empty=harness({payload:feed([])});await empty.api.refresh();
  assert.ok(empty.root.innerHTML.includes('No matching lots loaded'));assert.ok(empty.root.innerHTML.includes('not proof that no properties exist'));
  const partial=harness({failCoverage:true});await partial.api.refresh();
  assert.ok(partial.root.innerHTML.includes('Coverage unavailable'));assert.ok(partial.root.innerHTML.includes('<article class="aq-lot"'));
});
test('status tabs, selects, reset and clearing a town update the rendered records',async()=>{
  const h=harness();await h.api.refresh();
  h.click({aqStatus:'sold'});assert.ok(h.root.innerHTML.includes('Reported sold price'));assert.ok(h.root.innerHTML.includes('£400,000'));
  h.change('status','unsold');assert.ok(h.root.innerHTML.includes('Test HMO'));
  h.change('status','withdrawn');assert.ok(h.root.innerHTML.includes('Test house'));
  h.click({aqAction:'reset'});assert.equal((h.root.innerHTML.match(/<article class="aq-lot"/g)||[]).length,5);
  h.change('town','Edinburgh');assert.equal((h.root.innerHTML.match(/<article class="aq-lot"/g)||[]).length,1);
  h.change('town','');assert.equal((h.root.innerHTML.match(/<article class="aq-lot"/g)||[]).length,5);
});
test('shared grade labels and colors are used for evidenced feed grades',async()=>{
  const h=harness({payload:feed([{...lots[0],grade:'B',grade_evidence:'Verified instruction'}]),sharedGrade:{label:g=>'Shared '+g,color:()=> '#6a1b9a'}});await h.api.refresh();
  for(const text of ['Shared B','--aq-grade:#6a1b9a','Verified instruction'])assert.ok(h.root.innerHTML.includes(text));
});

// Full-page QA caught the redesign's separate navigation and descriptive lot types.
test('redesign keeps Auctions in its actual primary navigation',()=>{
  const focus=readFileSync(new URL('../../assets/focus.js',import.meta.url),'utf8');
  assert.ok(focus.includes("['auctions', 'Auctions']"));
  assert.ok(focus.includes("screenHost().hidden = mode === 'auctions'"));
  assert.ok(focus.includes("viewMode(location.hash === '#auctions' || window.lcAuctionsActive ? 'auctions' : 'assets')"));
  new vm.Script(focus);
});
test('descriptive auctioneer lot types filter by the canonical residential subtype',()=>{
  const {api}=harness();
  const row={...lots[0],lot_type:'2 Bed Top Floor Apartment',residential_subtype:'Flats'};
  assert.deepEqual(ids(api.filtered([row],{...base,type:'Flats'})),['one']);
});
test('opening bids are labelled separately and never rendered as a guide',async()=>{
  const h=harness({payload:feed([{...lots[0],guide_price:null,opening_bid:123000}])});
  await h.api.refresh();
  assert.match(h.root.innerHTML,/Opening bid, not guide/);
  assert.match(h.root.innerHTML,/Guide not published/);
});

test('a source placeholder zero guide is unknown, not a zero-pound offer',async()=>{
 const h=harness({payload:feed([{...lots[0],guide_price:null,guide_price_text:'£0'}])});
 await h.api.refresh();
 assert.match(h.root.innerHTML,/Guide not published/);
 assert.doesNotMatch(h.root.innerHTML,/<strong>£0<\/strong>/);
});

test('sale status text cannot masquerade as a missing guide price',async()=>{
 const h=harness({payload:feed([{...lots[0],status:'sold',guide_price:null,guide_price_text:'Sold prior'}])});
 await h.api.refresh();h.click({aqStatus:'sold'});
 assert.match(h.root.innerHTML,/Guide not published/);
 assert.doesNotMatch(h.root.innerHTML,/<strong>Sold prior<\/strong>/);
});

test('startup view changes preserve the Auctions deep link until user navigation',()=>{
 const focus=readFileSync(new URL('../../assets/focus.js',import.meta.url),'utf8');
 assert.ok(focus.includes("const next = btn.getAttribute('data-v')"));
 assert.ok(focus.includes("next !== 'auctions' && location.hash === '#auctions'"));
 assert.ok(!focus.includes("else if (mode !== 'auctions' && location.hash === '#auctions')"));
});
