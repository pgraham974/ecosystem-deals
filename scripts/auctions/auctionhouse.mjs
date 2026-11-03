/* Auction House factual metadata collector. No descriptions, images or legal packs.
 * Transport MUST enforce robots, identified UA, crawl delay and block handling.
 * Public access is not a commercial reuse licence; no affirmative licence located.
 */
const POLICY = 'Policy caveat: public factual metadata only; no published automation-specific/reuse restriction located in audit, but not licensed for reuse.';
function decode(s = '') {
  return String(s).replace(/&(#x[\da-f]+|#\d+|pound|amp|nbsp|quot|apos|lt|gt);/gi, (a, b) => {
    if (/^#x/i.test(b)) return String.fromCodePoint(Math.min(0x10ffff, parseInt(b.slice(2),16)));
    if (b[0] === '#') return String.fromCodePoint(Math.min(0x10ffff, +b.slice(1)));
    return ({pound:'£',amp:'&',nbsp:' ',quot:'"',apos:"'",lt:'<',gt:'>'})[b.toLowerCase()] || a;
  }).replace(/\u00a0/g,' ');
}
function text(s) { return decode(String(s).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim(); }
function attrs(tag) {
  const a = {}; for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) a[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4]); return a;
}
// Small, local tree parser. Scripts/styles/iframes cannot supply lot evidence.
function tree(html) {
  const root={tag:'root',a:{},children:[]}, stack=[root];
  html=html.replace(/<(script|style|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
  for (const m of html.matchAll(/<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][^>]*>|[^<]+/gi)) {
    const v=m[0]; if (/^<!/.test(v)) continue;
    if (/^<\//.test(v)) { const name=v.match(/^<\/([\w:-]+)/)?.[1].toLowerCase(); for(let i=stack.length-1;i>0;i--) if(stack[i].tag===name){stack.length=i;break;} }
    else if(v[0]==='<') {const tag=v.match(/^<([\w:-]+)/)?.[1].toLowerCase(); if(!tag)continue;const n={tag,a:attrs(v),children:[]};stack.at(-1).children.push(n);if(!/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag)&&!/\/>$/.test(v))stack.push(n);}
    else stack.at(-1).children.push(v);
  } return root;
}
function nodes(n, pred, out=[]) { if(typeof n==='string')return out;if(pred(n))out.push(n);for(const c of n.children)nodes(c,pred,out);return out; }
function content(n) { return typeof n==='string'?decode(n):n.children.map(content).join(' ').replace(/\s+/g,' ').trim(); }
function has(n,c) { return (n.a.class||'').split(/\s+/).includes(c); }
function first(n,p) { return nodes(n,p)[0]; }
function money(s) { const m=decode(s).match(/£\s*([\d,]+(?:\.\d{1,2})?)/);return m?Number(m[1].replace(/,/g,'')):null; }
function dateISO(s) {
  let m=String(s).match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);if(!m)return null;
  const y=+m[3],mo=+m[2],d=+m[1],dt=new Date(Date.UTC(y,mo-1,d));return dt.getUTCFullYear()===y&&dt.getUTCMonth()===mo-1&&dt.getUTCDate()===d?`${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`:null;
}
function postcode(s) { return String(s).toUpperCase().match(/\b(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/)?.[0].replace(/\s*(\d[A-Z]{2})$/,' $1')||null; }
function subtype(s) {
  if(['Blocks','Houses','Flats','HMO','Portfolios','Mixed-use','Development'].includes(s))return s;
  if(/\bmixed[ -]use\b|\b(?:shop|commercial|retail).{0,60}(?:flat|upper|residen)|\b(?:flat|residen).{0,60}(?:shop|commercial|retail)/i.test(s))return 'Mixed-use';
  if(/\bportfolio\b/i.test(s))return 'Portfolios';
  if(/\bHMO\b|house in multiple occupation/i.test(s))return 'HMO';
  if(/\bblock (?:of )?(?:apartments|flats)|\b(?:[2-9]|\d{2,})\s*(?:x\s*)?(?:self.contained )?(?:flats|apartments)\b/i.test(s))return 'Blocks';
  if(/\bdevelopment\b|\bbuilding plot\b|\bresidential (?:land|planning)\b|\bconversion\b/i.test(s))return 'Development';
  if(/\bflat\b|\bapartment\b|\bmaisonette\b|\bstudio\b/i.test(s))return 'Flats';
  if(/\bhouse\b|\bbungalow\b|\bcottage\b|\bchalet\b|\bdwelling\b|\b(?:mid |end )?terrace(?:d)? property\b|\b(?:semi|detached) property\b/i.test(s))return 'Houses';
  return null;
}
function commercial(s) { return /\bcommercial\b|\boffice\b|\bretail\b|\bshop\b|\bwarehouse\b|\bindustrial\b|\bgarage\b|\bparking\b|\bplace of worship\b|\bagricultural\b/i.test(s); }
function status(s) {
  s=text(s);if(/\bsold\s+prior\b/i.test(s))return 'sold prior';
  if(/\bsold\s+after\b/i.test(s))return 'sold after auction';
  if(/\bsold\s+for\s*:?\s*£/i.test(s)||/^sold(?:\s|$)/i.test(s))return 'sold';
  if(/\bwithdrawn\b/i.test(s))return 'withdrawn';if(/\bpostponed\b/i.test(s))return 'postponed';
  if(/\bunsold\b/i.test(s))return 'unsold';if(/\bno bids\b/i.test(s))return 'no_bids';
  if(/\blast bid\b/i.test(s))return 'last_bid';
  if(/\bfor sale\b|\bbidding opens\b|\bavailable\b/i.test(s))return 'available';return null;
}
function safe(url,base) {
  try { const u=new URL(decode(url).replace(/#.*$/,''),base);
    if(u.protocol!=='https:'||!['www.auctionhouse.co.uk','online.auctionhouse.co.uk'].includes(u.hostname))return null;
    if(/\/(?:search-results|account|files|outbound|local|blog|arrange-viewing|home|asset-file-item|signalr|error)(?:\/|$)|print-lot|privacy-policy|\/calendar\/upcoming-auctions|\/lot\/legals|\.(?:pdf|jpe?g|png|webp|zip)$/i.test(u.pathname)||/[?&](?:token|searchToken)=/i.test(u.search))return null;
    return u.href;
  } catch{return null;}
}
function detailURL(url) {try {return /^\/(?:[^/]+\/auction\/lot\/\d+|lot\/(?:redirect|details)\/[\w-]+)\/?$/.test(new URL(url).pathname);}catch{return false;} }
function meta(root,key) {return first(root,n=>n.tag==='meta'&&(n.a.property===key||n.a.name===key))?.a.content||'';}
function detail(html, seed) {
  const r=tree(html), all=nodes(r,()=>true), title=meta(r,'twitter:title')||meta(r,'og:title');
  let address=title.replace(/^Property for Auction in .*? - /i,'').replace(/ - Online Auctions$/i,'');
  if(!postcode(address))address=seed.address;
  const guideNode=all.find(n=>has(n,'guideprice'));
  const lotnav=all.find(n=>n.a.id==='lotnav');
  const headerLis=lotnav?nodes(lotnav,n=>n.tag==='li'&&/^(?:Guide Price|Bidding Opens|Bidding Ends|Auction Ends|For Sale By|Sold for|Sold prior|Withdrawn|Postponed|Unsold)/i.test(content(n))):[];
  const headerAddress=lotnav&&first(lotnav,n=>n.tag==='b'&&!!postcode(content(n)));
  if(headerAddress)address=content(headerAddress);
  const guide=guideNode?content(guideNode):headerLis.map(content).find(x=>/^Guide Price/i.test(x))||meta(r,'twitter:data1');
  const dateNode=all.find(n=>has(n,'auction-date'));
  const end=headerLis.map(content).find(x=>/^(?:Bidding Ends|Auction Ends)/i.test(x));
  const opens=headerLis.map(content).find(x=>/^Bidding Opens/i.test(x));
  const date=dateISO(end||'')||dateISO(dateNode?content(dateNode):'');
  const typeList=guideNode?all.find(n=>n.tag==='ul'&&n.children.some(c=>typeof c!=='string'&&c.tag==='li'&&/Bedrooms|Tenure/.test(content(c)))):null;
  // No body descriptions or bidding modal text are stored or used as status evidence.
  let type=typeList?nodes(typeList,n=>n.tag==='li').map(content).filter(x=>!/Tenure|Bedrooms/i.test(x)).join(' '):'';
  // Derive only an enum from the first property-summary paragraph if no type field exists.
  // Never return or persist the paragraph or any descriptive text.
  if(!subtype(type)) {
    const summary=html.match(/<h[1-6][^>]*>\s*Description\s*<\/h[1-6]>\s*<p[^>]*>([\s\S]*?)<\/p>/i)?.[1];
    if(summary)type=subtype(text(summary))||(commercial(text(summary))?'Commercial':'');
  }
  const evidence=[guide,...headerLis.map(content)].filter(Boolean).join(' | ');
  const explicit=status(evidence), sold=evidence.match(/\bSold for\s*:?\s*(£[\d,.]+)/i);
  return {address,postcode:postcode(address),guide_price:money(guide),guide_price_text:guide||null,auction_date:date,status:explicit,sold_price:sold?money(sold[1]):null,type,opens_only:!!opens&&!end&&!dateNode};
}
/** Return partial observations. Null/ambiguous statuses are deliberately retained for parent validation. */
export async function collect({get,source,now}) {
  const result={lots:[],commercial_excluded:0,errors:[],warnings:[POLICY],pages:0,successful_pages:0};
  const stamp=(now instanceof Date?now: new Date(now||Date.now())).toISOString();
  const maxPages=Math.max(0,Number(source.max_pages??30)), maxDetails=Math.max(0,Number(source.max_details??150));
  const queue=[],seenPages=new Set(),seeds=new Map();let details=0;
  const err=s=>{if(!result.errors.includes(s))result.errors.push(s);};
  for(const entry of source.entries||[source.url]){const u=safe(entry,source.url);if(u&&!detailURL(u))queue.push(u);else err(`Rejected unsafe/non-catalogue entry: ${entry}`);}
  function add(s) {if(!s.source_url)return;const key=s.source_url+'|'+s.kind+'|'+(s.auction_date||'');if(!seeds.has(key))seeds.set(key,s);}
  while(queue.length&&result.pages<maxPages){
    const url=queue.shift();if(seenPages.has(url))continue;seenPages.add(url);result.pages++;
    try {
      const html=await get(url);if(typeof html!=='string'||!html.trim())throw Error('Empty/non-string HTML');
      if(/<title>\s*(?:Just a moment|Access denied)|cf-chl-/i.test(html))throw Error('Access block');
      result.successful_pages++; const r=tree(html);let count=0;
      for(const a of nodes(r,n=>n.tag==='a'&&has(n,'home-lot-wrapper-link'))){
        const dest=safe(a.a.href,url);if(!dest||!detailURL(dest))continue;
        const addr=first(a,n=>has(n,'grid-address')), ps=nodes(a,n=>n.tag==='p');
        const type=ps.find(n=>n!==addr)?content(ps.find(n=>n!==addr)):'';
        const g=first(a,n=>has(n,'grid-view-guide'));const gText=g?content(g):'';
        const address=addr?content(addr):'';if(!address){err(`Missing card address: ${dest}`);continue;}
        add({kind:'catalogue',address,type,guide_price:money(gText),guide_price_text:gText||null,status:status(gText),sold_price:null,auction_date:null,source_url:dest,entry:url});count++;
      }
      for(const table of nodes(r,n=>n.tag==='table')){
        const heads=nodes(table,n=>n.tag==='th').map(content);if(!heads.includes('Address')||!heads.includes('Result'))continue;
        for(const tr of nodes(table,n=>n.tag==='tr')){
          const cells=tr.children.filter(n=>typeof n!=='string'&&n.tag==='td');if(cells.length<6)continue;
          const a=first(cells[0],n=>n.tag==='a'),dest=a&&safe(a.a.href,url);if(!dest||!detailURL(dest))continue;
          const values=cells.map(content),sold=values[5].match(/\bSold for\s*:?\s*(£[\d,.]+)/i);
          add({kind:'results',address:values[1],type:'',auction_date:dateISO(values[3]),guide_price:money(values[4]),guide_price_text:values[4],status:status(values[5]),sold_price:sold?money(sold[1]):null,source_url:dest,entry:url});count++;
        }
      }
      if(!count)err(`No native lot cards/result rows parsed: ${url} (EIG iframe not followed)`);
      for(const a of nodes(r,n=>n.tag==='a'&&n.a.href)){
        const dest=safe(a.a.href,url);if(!dest||seenPages.has(dest)||detailURL(dest))continue;
        const u=new URL(dest),current=new URL(url);
        const pagination=u.pathname===current.pathname&&u.searchParams.has('page');
        if(pagination&&/^\d+$/.test(u.searchParams.get('page'))&&!queue.includes(dest))queue.push(dest);
      }
    }catch(e){err(`Page failed ${url}: ${e.message||e}`);}
  }
  if(queue.some(x=>!seenPages.has(x)))err(`PARTIAL: max_pages=${maxPages} reached; discovered catalogue/results pages remain.`);
  let unknown=0,unverified=0;
  for(const seed of seeds.values()){
    // Region catalogues also contain unrelated towns. Do not request their details.
    const pc=postcode(seed.address)||'';
    if(!(/\bManchester\b/i.test(seed.address)&&/^M\d/.test(pc)||/\bGlasgow\b/i.test(seed.address)&&/^G\d/.test(pc)||/\bEdinburgh\b/i.test(seed.address)&&/^EH\d/.test(pc)||/\bBristol\b/i.test(seed.address)&&/^BS\d/.test(pc)||/\bCheltenham\b/i.test(seed.address)&&/^GL5[0-4]/.test(pc))) continue;
    let sub=subtype(seed.type),d=null,verification='unverified';
    if(details<maxDetails){
      details++;try {const html=await get(seed.source_url);if(!html||/<title>\s*(?:Just a moment|Access denied)|cf-chl-/i.test(html))throw Error('Empty or blocked detail');d=detail(html,seed);verification='detail checked';}catch(e){err(`Detail failed ${seed.source_url}: ${e.message||e}`);}
    }else{unverified++;}
    if(d?.postcode&&seed.address&&postcode(seed.address)&&d.postcode!==postcode(seed.address)){err(`Detail address mismatch ${seed.source_url}`);d=null;}
    const detailSub=subtype(d?.type||'');
    sub=(detailSub&& !['Houses','Flats'].includes(detailSub)?detailSub:null)||sub||detailSub||subtype(seed.address);
    if(!sub&&commercial((d?.type||'')+' '+seed.type)){result.commercial_excluded++;continue;}
    if(!sub){unknown++;continue;}
    const historical=seed.kind==='results';
    if(d&&historical&&d.auction_date&&seed.auction_date&&d.auction_date!==seed.auction_date)err(`Detail date differs from historical result ${seed.source_url}; result event date/amount retained.`);
    const finalStatus=historical?seed.status:(d?.status||seed.status);
    const finalGuide=historical?seed.guide_price:(d?.guide_price??seed.guide_price);
    if(!historical&&!d?.auction_date)err(`Current auction date unverified ${seed.source_url}`);
    if(d?.opens_only)err(`Only bidding-opens date public in static HTML ${seed.source_url}; auction_date left null rather than treating an opening date as the auction end.`);
    const lot={title:d?.address||seed.address,address:d?.address||seed.address,postcode:d?.postcode||postcode(seed.address),lot_type:seed.type||d?.type||sub,residential_subtype:sub,guide_price:finalGuide,guide_price_text:historical?seed.guide_price_text:(d?.guide_price_text||seed.guide_price_text),auction_date:historical?seed.auction_date:(d?.auction_date||null),status:finalStatus||null,sold_price:historical?seed.sold_price:(d?.sold_price??null),source_url:seed.source_url,source:source.name||source.id,scraped_at:stamp,grade:'',grade_evidence:`${verification}; factual ${seed.kind} metadata from ${seed.entry}; policy caveat: not licensed`};
    result.lots.push(lot);
  }
  if(unverified)err(`PARTIAL: max_details=${maxDetails} reached; ${unverified} residential/unknown candidates not detail-verified.`);
  if(unknown)err(`Unknown residential classification excluded: ${unknown}; not counted as commercial.`);
  return result;
}
