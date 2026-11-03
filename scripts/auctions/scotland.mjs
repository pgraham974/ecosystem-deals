/** Public factual metadata only. No descriptions, images or legal packs retained.
 * get owns network access, robots enforcement and rate limiting.
 * Public sale terms contained no automation ban when audited 2026-11-03;
 * no open reuse licence was established. Review policy before redistribution.
 */
const TOWNS=['Manchester','Glasgow','Edinburgh','Bristol','Cheltenham'];
const POLICY='Policy caveat: no open reuse licence established; metadata only; recheck terms and robots before each run.';
const decode=s=>String(s??'').replace(/&#(x[\da-f]+|\d+);/gi,(_,n)=>{try{return String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):+n);}catch{return '';}}).replace(/&(nbsp|amp|pound|quot|apos|lt|gt|ndash|mdash);/gi,(_,n)=>({nbsp:' ',amp:'&',pound:'£',quot:'"',apos:"'",lt:'<',gt:'>',ndash:'-',mdash:'-'}[n.toLowerCase()]));
const clean=s=>decode(s).replace(/\s+/g,' ').trim();
function parse(html){
 const root={tag:'root',a:{},kids:[]};const stack=[root];
 const safe=String(html).replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
 for(const token of safe.match(/<[^>]+>|[^<]+/g)||[]){
  if(token[0]!=='<'){stack.at(-1).kids.push(decode(token));continue;}
  const end=token.match(/^<\/\s*([\w:-]+)/);if(end){let k=stack.length-1;while(k>0&&stack[k].tag!==end[1].toLowerCase())k--;if(k)stack.length=k;continue;}
  const start=token.match(/^<\s*([\w:-]+)/);if(!start)continue;
  const a={};for(const m of token.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))a[m[1].toLowerCase()]=decode(m[2]??m[3]??m[4]);
  const n={tag:start[1].toLowerCase(),a,kids:[],parent:stack.at(-1)};stack.at(-1).kids.push(n);
  if(!/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(n.tag)&&!token.endsWith('/>'))stack.push(n);
 }return root;
}
function all(n,p){const out=[];function walk(v){if(typeof v==='string')return;if(p(v))out.push(v);for(const c of v.kids)walk(c);}walk(n);return out;}
const cls=(n,c)=>(n.a.class||'').split(/\s+/).includes(c);
const text=n=>clean(typeof n==='string'?n:(n?.kids||[]).map(text).join(' '));
const first=(n,p)=>all(n,p)[0];
function context(n){let p=n;while(p.parent){if(cls(p,'listing-item')||cls(p,'property-item')||p.tag==='tr'||(p.tag==='li'&&cls(p,'product')))return p;p=p.parent;}return n;}
function addressTown(address){
 const segs=clean(address).split(/[,;\n]+/).map(x=>x.trim());
 for(const town of TOWNS){const re=new RegExp('^'+town+'(?:$|\\s+(?:City|[A-Z]{1,2}\\d)|\\s*[-(])','i');if(segs.some(s=>re.test(s)))return town;}
 return null;
}
const postcode=s=>clean(s).match(/\b(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/i)?.[0].toUpperCase().replace(/\s/g,'').replace(/(.{3})$/,' $1')||null;
function subtype(primary,evidence=''){
 // Titles and dedicated Type fields are authoritative. Marketing prose about
 // adding one dwelling to a portfolio is not evidence of a portfolio sale.
 const portfolio=s=>/\bportfolio of (?:properties|houses|flats|apartments|residential units)\b|\bresidential (?:property )?portfolio\b|\bcollection of (?:properties|houses|flats)\b/i.test(s);
 const block=s=>/\bblock of (?:\w+[ -])?(?:flats|apartments)\b|\b(?:building|comprising|comprises|contains|consists of|converted into|arranged as)\s+(?:of\s+)?(?:\d+|two|three|four|five|six|seven|eight|nine|ten)\s+(?:self[ -]contained\s+)?(?:flats|apartments)\b/i.test(s);
 const mixed=s=>/\bmixed[ -]use\b|\b(?:ground[ -]floor )?(?:shop|retail|commercial unit).{0,60}(?:with|and|plus).{0,30}(?:upper |above |first[ -]floor )?(?:residential accommodation|flat(?:s)?|apartment(?:s)?)\b|\b(?:upper|above|first[ -]floor) residential accommodation.{0,60}(?:shop|retail|commercial)\b/i.test(s);
 const development=s=>/\bresidential development (?:site|opportunity|land|plot)\b|\bdevelopment (?:site|land|plot).{0,60}(?:for|with consent for)\s+(?:\d+\s+)?(?:houses|homes|flats|apartments|dwellings)\b|\b(?:approved|granted|extant)\s+(?:residential )?planning (?:permission|consent).{0,90}(?:residential|dwellings|flats|apartments|houses)\b/i.test(s);
 if(portfolio(primary))return 'Portfolios';
 if(/\bHMO\b|house (?:in|of) multiple occupation/i.test(primary))return 'HMO';
 if(mixed(primary))return 'Mixed-use';
 if(block(primary))return 'Blocks';
 if(development(primary))return 'Development';
 let base=/\bflats?\b|\bapartments?\b|\bmaisonette\b|\bstudio\b/i.test(primary)?'Flats':/\bhouses?\b|\bbungalow\b|\bcottage\b|\bresidential\b|\bdwelling\b/i.test(primary)?'Houses':null;
 // Supplementary prose can establish a use only with affirmative, lot-specific
 // evidence. Reject comparisons, local-area descriptions and hypothetical use.
 const facts=clean(evidence).split(/(?<=[.!?;])\s+/).filter(s=>!/(?:comparab|similar propert|\bnear\b|nearby|close to|adjacent|opposite|amenit|neighbou?r|surrounding|local area|within the area|potential|scope for|could|may be|subject to|suitable for|add(?:ition)? to.{0,30}portfolio)/i.test(s));
 for(const s of facts){
  if(/\b(?:licensed|licenced|operating|registered|existing|current)\s+(?:\w+[ -]){0,4}HMO\b|\bHMO\s+(?:licen[cs]e|registration)\s+(?:in place|held|current|valid)\b/i.test(s))return 'HMO';
  if(/\b(?:this|the) (?:property|building|lot|subjects|accommodation)\b|\b(?:comprises|comprising|consists of|contains)\b/i.test(s)){
   if(mixed(s))return 'Mixed-use';
   if(block(s))return 'Blocks';
   if(development(s))return 'Development';
  }
 }
 if(base)return base;
 // If the address is the title, a clear description of the actual offered
 // dwelling can supply its basic class, but never infer a portfolio from prose.
 for(const s of facts){
  if(/^(?:this |the |a |an |offered (?:for sale )?(?:is )?)*(?:\w+[ -]){0,5}(?:house|flat|apartment|bungalow|cottage)\b/i.test(s)){
   if(/\bflat\b|\bapartment\b/i.test(s))return 'Flats';
   if(/\bhouse\b|\bbungalow\b|\bcottage\b/i.test(s))return 'Houses';
  }
 }
 return null;
}
const commercial=s=>/\bcommercial\b|\bretail\b|\boffice(?:s)?\b|\bwarehouse\b|\bindustrial\b|\brestaurant\b|\bpublic house\b|\bpub\b|\bshop\b/i.test(s)&&!/\bresidential\b|\bflat(?:s)?\b|\bapartment(?:s)?\b|\bHMO\b|\bdwelling\b|\bmixed[ -]use\b|\bconversion\b|\bdevelopment\b/i.test(s);
const money=s=>{const m=String(s).match(/£\s*([\d,]+(?:\.\d{1,2})?)/);return m?Number(m[1].replace(/,/g,'')):null;};
function labelledMoney(nodes,label){for(const n of nodes){const t=text(n).replace(/^Status\s*:\s*/i,'');if(t.length>220)continue;const a=t.match(new RegExp('^(?:'+label+')\\s*[:*=-]?\\s*(£\\s*[\\d,]+(?:\\.\\d{1,2})?)','i'));const b=t.match(new RegExp('^(£\\s*[\\d,]+(?:\\.\\d{1,2})?)\\s*(?:'+label+')','i'));if(a||b)return {value:money((a||b)[1]),label:clean((a||b)[0])};}return {value:null,label:null};}
function dateOnly(s){
 s=clean(s);const m=s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(20\d{2})\b/i)||s.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(20\d{2})\b/i);
 if(m){const dm=/^\d/.test(m[1]);const day=+(dm?m[1]:m[2]);const mo=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf((dm?m[2]:m[1]).slice(0,3).toLowerCase())+1;const d=m[3]+'-'+String(mo).padStart(2,'0')+'-'+String(day).padStart(2,'0');return new Date(d+'T12:00:00Z').toISOString().startsWith(d)?d:null;}
 return s.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0]||null;
}
function fields(root,id){
 const ownSupplementary=n=>/(?:description|related|upsells|cross-sells|footer|contentinfo)/i.test((n.a.class||'')+' '+(n.a.id||'')+' '+(n.a.role||'')+' '+n.tag);
 const supplementary=n=>{for(let p=n;p;p=p.parent)if(ownSupplementary(p))return true;return false;};
 const containsSupplementary=n=>all(n,p=>p!==n&&ownSupplementary(p)).length>0;
 const eligible=n=>!supplementary(n)&&!containsSupplementary(n);
 const h=first(root,n=>n.tag==='h1'&&cls(n,'product_title')&&eligible(n))||first(root,n=>/^h[12]$/.test(n.tag)&&eligible(n));
 const title=text(h).replace(/\s+LOT\s+\d+\s*$/i,'');
 const addr=first(root,n=>cls(n,'listing-address')&&eligible(n));
 const address=text(addr)||(id==='braveheart'?title:'');
 const headings=all(root,n=>/^h[1-4]$/.test(n.tag)&&eligible(n));
 // Only atomic lot fields: never search a summary/container's whole subtree.
 // Inline label/value markup is allowed; nested block fields and supplementary
 // descendants disqualify a container, including short .summary ancestors.
 const small=all(root,n=>['p','li','h2','h3','h4','span','div'].includes(n.tag)&&eligible(n)&&text(n).length<220&&!all(n,p=>p!==n&&/^(?:p|li|div|section|article|h[1-6]|form)$/.test(p.tag)).length);
 const labelled=key=>{for(const n of small){const m=text(n).match(new RegExp('^'+key+'\\s*:\\s*(.+)$','i'));if(m)return m[1];}return null;};
 const propertyType=labelled('Type');
 const description=first(root,n=>(cls(n,'woocommerce-Tabs-panel--description')||cls(n,'woocommerce-product-details__short-description')||cls(n,'property-description')||n.a.id==='description')&&!all(n,p=>p!==n&&/(?:related|upsells|cross-sells)/i.test((p.a.class||'')+' '+(p.a.id||''))).length);
 // Description informs only categorisation transiently, never price or status.
 const typeHeading=headings.find(n=>n!==h&&n.tag==='h2'&&text(n).length<140);
 const primary=[title,propertyType].filter(Boolean).join(' ');
 const headingType=typeHeading?text(typeHeading):'';
 const basePrimary=subtype(primary);
 const classification=[primary,headingType].filter(Boolean).join(' ');
 const type=subtype(basePrimary?primary:classification,text(description));
 const opening=labelledMoney(small,'opening bid|starting bid');
 let guide=labelledMoney(small,'guide(?: price)?');
 if(guide.value===0)guide={value:null,label:guide.label};
 const result=labelledMoney(small,'sold(?: prior| after| post auction| at auction)?(?: for| at| price)?|hammer(?: price)?');
 const labelledDate=pattern=>{for(const n of small){const t=text(n);if(pattern.test(t)){const d=dateOnly(t);if(d)return d;}}return null;};
 const startDate=labelledDate(/^(?:Start On|Starting On|Auction Starts|Bidding Opens)\s*:/i);
 // Ending/event date is the operative auction date; start is never allowed to
 // override an explicit end. Future's single-day event heading remains valid.
 let date=labelledDate(/^(?:Ending On|End On|Auction Ends|Bidding Closes|Closing Date|End Date)\s*:/i)||labelledDate(/^(?:Auction Date|Timed Online Auction)\b/i);
 if(!date&&id==='future'){const headingDate=headings.find(n=>dateOnly(text(n))&&!/^(?:Start On|Starting On)\s*:/i.test(text(n)));date=headingDate?dateOnly(text(headingDate)):null;}
 if(!date)date=startDate;
 const statusText=labelled('Status');
 const stateNodes=small.filter(n=>/^(?:Auction has|Auction is|Sold\b|Withdrawn\b|Postponed\b|Unsold\b|Bidding not|BIDDING OPENS|BIDDING OPEN)/i.test(text(n))||/^(?:Available|For Sale|Under Offer|Sale Agreed|Sold STC)$/i.test(text(n)));
 const states=[statusText,...stateNodes.map(text)].filter(Boolean).join(' | ');
 return {title,address,classification,type,pureCommercial:commercial(classification),opening,guide,result,date,startDate,states};
}
function statusOf(f,now){const s=f.states;if(/\bwithdrawn\b/i.test(s))return 'withdrawn';if(/\bpostponed\b/i.test(s))return 'postponed';if(/\bunsold\b/i.test(s))return 'unsold';if(/sold stc|sale agreed|under offer/i.test(s))return 'under_offer';if(/\bsold\b/i.test(s)||f.result.value!==null)return 'sold';if(/not (?:been )?started|not yet open|BIDDING OPENS/i.test(s)&&(f.startDate||f.date)&&(f.startDate||f.date)>now.slice(0,10))return 'upcoming';if(/\bavailable\b|\bfor sale\b/i.test(s))return 'available';if(/bidding open now|auction is live/i.test(s))return 'live';return 'unknown';}
function links(root,base){return all(root,n=>n.tag==='a'&&n.a.href).map(n=>{try{return {n,url:new URL(n.a.href,base),label:text(n)};}catch{return null;}}).filter(Boolean);}
function allowed(u,base,id){return u.hostname.replace(/^www\./,'')===base.hostname.replace(/^www\./,'')&&/^https?:$/.test(u.protocol)&&!/(?:login|log-in|account|legal|contact_docs|contact_terms|offer_form|deposit|upload|wp-admin|add-to-cart)/i.test(u.href);}
function detail(u,id){return id==='future'?/\/property_details\.asp$/i.test(u.pathname)&&/^\d+$/.test(u.searchParams.get('id')||''):/^\/product\/[^/]+\/?$/i.test(u.pathname);}
function catalogue(u,id){return id==='future'?/\/(?:catalogue[^/]*|auctions)\.asp$/i.test(u.pathname):/^\/(?:all-auctions|auctions)(?:\/page\/\d+)?\/?$/i.test(u.pathname);}
function canonical(u){const v=new URL(u);const qs=[...v.searchParams.entries()].sort((a,b)=>a[0].localeCompare(b[0])||a[1].localeCompare(b[1])).map(([k,val])=>encodeURIComponent(k)+'='+encodeURIComponent(val)).join('&');return v.protocol+'//'+v.hostname.replace(/^www\./,'')+(v.port?':'+v.port:'')+v.pathname+(qs?'?'+qs:'');}
/** @returns {Promise<{lots:object[],commercial_excluded:number,errors:string[],pages:number}>} */
export async function collect({get,source,now}){
 const out={lots:[],commercial_excluded:0,errors:[],warnings:[POLICY],pages:0,successful_pages:0};
 if(!source||!['future','braveheart'].includes(source.id)||typeof get!=='function'){out.errors.push('Invalid source/get contract');return out;}
 const time=new Date(typeof now==='function'?now():now??Date.now());if(Number.isNaN(+time)){out.errors.push('Invalid now');return out;}const stamp=time.toISOString();
 const base=new URL(source.url);const limit=Math.min(30,Math.max(0,source.max_pages??30));const detailLimit=Math.min(150,Math.max(0,source.max_details??150));
 const queue=(source.entries||[]).map(x=>({url:typeof x==='string'?x:x.url,kind:'catalogue'}));const seen=new Set();const candidates=new Map();let catalogues=0,details=0;
 async function read(url){out.pages++;try{const r=await get(url);if(r==null)throw Error('Empty response');if(r.ok===false)throw Error('HTTP '+r.status);const html=typeof r==='string'?r:typeof r.html==='string'?r.html:typeof r.text==='function'?await r.text():null;if(html===null)throw Error('get must return HTML, {html}, or Response');if(/captcha|cf-chl-|just a moment|access denied|verify (?:that )?you are human/i.test(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''))&&html.length<60000)throw Error('Access challenge; not bypassed');out.successful_pages++;return parse(html);}catch(e){out.errors.push(url+': '+e.message);return null;}}
 while(queue.length&&catalogues<limit){
  const item=queue.shift();let u;try{u=new URL(item.url,base);}catch{out.errors.push('Invalid entry URL');continue;}const key=canonical(u);if(seen.has(key)||!allowed(u,base,source.id))continue;seen.add(key);catalogues++;
  const root=await read(u.href);if(!root)continue;let found=0;
  for(const l of links(root,u)){if(!allowed(l.url,base,source.id))continue;
   if(detail(l.url,source.id)){const ctx=context(l.n);const ctxAddress=text(first(ctx,n=>cls(n,'listing-address')))||text(first(ctx,n=>/^h[1-4]$/.test(n.tag)))||l.label;const pk=canonical(l.url);if(!candidates.has(pk))candidates.set(pk,{url:l.url.href,address:ctxAddress,card:text(ctx)});found++;}
   else if(catalogue(l.url,source.id)){
    const samePath=l.url.pathname.toLowerCase()===u.pathname.toLowerCase();const paging=(samePath&&(['offset','page','paged'].some(p=>l.url.searchParams.has(p))))||/\/page\/\d+/.test(l.url.pathname)||/^(?:next|previous|[»«›‹]|\d+)$/i.test(l.label)||/\bnext\b/i.test(l.n.a.rel||'');
    const event=source.id==='future'&&/catalogue_viewall_auction/i.test(l.url.pathname);
    const fallback=source.id==='braveheart'&&/all-auctions/i.test(l.url.pathname);
    if(paging||event||fallback)queue.push({url:l.url.href,kind:'catalogue'});
   }
  }
  if(!found)out.errors.push(u.href+': no server-rendered detail links found; JS-only catalogues require a discovered HTML alternative, no AJAX endpoints guessed.');
 }
 if(queue.length)out.errors.push('Catalogue page limit reached; collection incomplete.');
 // Target-address candidates first. Never qualify from menu/header/region text.
 const ordered=[...candidates.values()].sort((a,b)=>Number(!!addressTown(b.address))-Number(!!addressTown(a.address)));
 for(const c of ordered){
  // An identified non-target address can be rejected without fetching its detail.
  if(c.address&&c.address.includes(',')&&!addressTown(c.address))continue;
  if(details>=detailLimit){out.errors.push('Detail limit reached; collection incomplete.');break;}details++;
  const root=await read(c.url);if(!root)continue;const f=fields(root,source.id);
  const address=f.address||c.address;const town=addressTown(address);if(!town)continue;
  if(f.pureCommercial){out.commercial_excluded++;continue;}if(!f.type){out.errors.push(c.url+': unclassified property type; omitted.');continue;}
  const status=statusOf(f,stamp);
  out.lots.push({title:f.title||address,address,town,postcode:postcode(address),lot_type:f.type,residential_subtype:f.type,guide_price:f.guide.value,guide_price_text:f.guide.label,opening_bid:f.opening.value,auction_date:f.date,auction_start_date:f.startDate,status,sold_price:status==='sold'?f.result.value:null,source_url:c.url,source:source.name||source.id,scraped_at:stamp,grade:'',grade_evidence:[]});
 }
 return out;
}
