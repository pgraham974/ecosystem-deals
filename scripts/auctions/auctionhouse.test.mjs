import test from 'node:test';
import assert from 'node:assert/strict';
import { collect } from './auctionhouse.mjs';
const base='https://www.auctionhouse.co.uk/manchester';
const lot=id=>`${base}/auction/lot/${id}`;
const source={id:'auctionhouse',name:'Auction House',url:base,entries:[base],max_pages:30,max_details:150};
const card=(id,type,address='1 High Street, Manchester, M1 1AA',price='*Guide | £100,000')=>`<a class="home-lot-wrapper-link" href="${lot(id)}"><div class="grid-view-guide">${price}</div><p>${type}</p><p class="grid-address">${address}</p></a>`;
const detail=(type='Flat',guide='£120,000',date='Thu 26/11/2026')=>`<meta property="twitter:title" content="Property for Auction in Manchester - 1 High Street, Manchester, M1 1AA"><h4 class="guideprice">${guide}</h4><ul><li>${type}</li><li>2 Bedrooms</li><li>Tenure: Leasehold</li></ul><div class="auction-date">Auction Date <p>${date}</p></div><nav><li>Unsold Lots</li></nav><script>Sold for £999,999</script><div class="modal"><h5>You won the auction lot</h5></div>`;
const run=(map,over={})=>collect({source:{...source,...over},now:new Date('2026-11-03T10:00:00Z'),get:async u=>{if(!(u in map))throw Error('fixture missing '+u);return map[u];}});
test('factual detail amounts/dates override guide; status never inferred from guide/navigation/modal',async()=>{
 const r=await run({[base]:card(1,'2 Bed Flat'),[lot(1)]:detail()});assert.equal(r.lots.length,1);assert.equal(r.lots[0].guide_price,120000);assert.equal(r.lots[0].auction_date,'2026-11-26');assert.equal(r.lots[0].status,null);assert.equal(r.lots[0].sold_price,null);assert.equal(r.lots[0].description,undefined);assert.equal(r.lots[0].images,undefined);
});
test('result Sold for is achieved price, Last Bid is not; ignore iframe',async()=>{
 const rows=['Sold for: &pound;139,000','Last Bid: &pound;43,000'].map((s,i)=>`<tr><td><a href="${lot(i+1)}">detail</a></td><td>1 High Street, Manchester, M1 1AA</td><td>AH</td><td>27/10/2026 12:19</td><td>&#163;115,000+</td><td>${s}</td></tr>`).join('');
 const r=await run({[base]:`<iframe src="https://auctioneertemplates.eigroup.co.uk/pastauctions.aspx?a=758"></iframe><table><tr><th></th><th>Address</th><th>Auctioneer</th><th>Auction Ended</th><th>Guide</th><th>Result</th></tr>${rows}</table>`,[lot(1)]:detail(),[lot(2)]:detail()});assert.equal(r.lots.length,2);assert.equal(r.lots[0].sold_price,139000);assert.equal(r.lots[1].sold_price,null);assert.equal(r.lots[1].status,'last_bid');assert.equal(r.lots[0].auction_date,'2026-10-27');assert.equal(r.lots[0].guide_price,115000);
});
test('commercial excluded; mixed-use, blocks and residential development retained',async()=>{
 const types=['Commercial Property','Mixed-use shop with upper flat','Block of Apartments','Residential Development'];
 const map={[base]:types.map((t,i)=>card(i+1,t)).join('')};for(let i=2;i<=4;i++)map[lot(i)]=detail(types[i-1]);
 const r=await run(map);assert.equal(r.commercial_excluded,1);assert.deepEqual(r.lots.map(x=>x.residential_subtype),['Mixed-use','Blocks','Development']);
});
test('opening-only online date remains null; preserve numbered header address',async()=>{
 const online='https://online.auctionhouse.co.uk/lot/redirect/123';
 const r=await run({[base]:card(1,'3 Bed House').replace(lot(1),online),[online]:`<meta property="og:title" content="High Street, Manchester, M1 1AA - Online Auctions"><nav><li>Unsold Lots</li></nav><div id="lotnav"><ul><li>For Sale By Unconditional Online Auction</li><li>Guide Price*: £150,000</li><li>Bidding Opens 23/11/2026 13:00</li></ul><p><b>1 High Street, Manchester, M1 1AA</b></p></div>`});
 assert.equal(r.lots[0].address,'1 High Street, Manchester, M1 1AA');assert.equal(r.lots[0].status,'available');assert.equal(r.lots[0].auction_date,null);
});
test('discovered pagination only; cap and failures explicitly partial',async()=>{
 const r=await run({[base]:card(1,'House')+'<a href="?page=2">2</a><a href="/search-results?page=3">restricted</a>'},{max_pages:1,max_details:0});assert.equal(r.pages,1);assert.ok(r.errors.some(x=>x.includes('max_pages')));assert.ok(r.errors.some(x=>x.includes('max_details')));
 const f=await run({});assert.equal(f.pages,1);assert.ok(f.errors.some(x=>x.startsWith('Page failed')));
});
test('access block and unsafe entries never presented as complete',async()=>{
 const r=await run({[base]:'<title>Just a moment...</title>'});assert.equal(r.lots.length,0);assert.ok(r.errors.some(x=>x.includes('Access block')));
 const x=await run({}, {entries:['https://www.auctionhouse.co.uk/search-results']});assert.equal(x.pages,0);assert.ok(x.errors.some(x=>x.includes('Rejected unsafe')));
});
