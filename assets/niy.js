/* Net initial yield for one comp. Published figures are kept. Otherwise NIY is the stated rent divided by price plus tax and fees. Rent is never guessed. */
(function (root) {
  'use strict';

  const FEE = 0.018;
  const AREAS = ['Manchester', 'Cheltenham', 'Bristol', 'Glasgow', 'Edinburgh'];
  const CLASSES = ['Resi block', 'Houses', 'Flats', 'HMO', 'Mixed-use', 'Office', 'Development'];
  const RESIDENTIAL = ['Resi block', 'Houses', 'Flats', 'HMO', 'Mixed-use'];
  const FLOOR = 40000;

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function bands(price, steps) {
    let tax = 0;
    let prev = 0;
    for (let i = 0; i < steps.length; i++) {
      const limit = steps[i][0];
      const rate = steps[i][1];
      const top = Math.min(price, limit);
      if (top > prev) tax += (top - prev) * rate;
      prev = limit;
      if (price <= limit) break;
    }
    return tax;
  }

  function sdltAdditional(price) {
    if (!(price >= FLOOR)) return 0;
    return bands(price, [[125000, 0.05], [250000, 0.07], [925000, 0.10], [1500000, 0.15], [Infinity, 0.17]]);
  }

  function sdltNonResidential(price) {
    return bands(price, [[150000, 0], [250000, 0.02], [Infinity, 0.05]]);
  }

  function lbttWithAds(price) {
    if (!(price >= FLOOR)) return 0;
    const lbtt = bands(price, [[145000, 0], [250000, 0.02], [325000, 0.05], [750000, 0.10], [Infinity, 0.12]]);
    return lbtt + price * 0.08;
  }

  function cityName(city) {
    const t = String(city || '');
    if (/glasgow/i.test(t)) return 'Glasgow';
    if (/edinburgh/i.test(t)) return 'Edinburgh';
    if (/bristol/i.test(t)) return 'Bristol';
    if (/cheltenham/i.test(t)) return 'Cheltenham';
    if (/manchester/i.test(t)) return 'Manchester';
    return t;
  }

  function areaLabel(city) {
    return cityName(city) === 'Manchester' ? 'Greater Manchester' : cityName(city);
  }

  function townOf(row) {
    const named = String((row && (row.sub_area || row.subArea)) || '').trim();
    if (named) return named;
    if (cityName(row && row.city) !== 'Manchester') return '';
    const blob = [row && row.address, row && row.location, row && row.postcode].join(' ');
    const towns = [
      [/bolton|\bBL\d/i, 'Bolton'],
      [/stockport|\bSK\d/i, 'Stockport'],
      [/oldham|\bOL\d/i, 'Oldham'],
      [/salford/i, 'Salford'],
      [/wigan|\bWN\d/i, 'Wigan'],
      [/\bbury\b/i, 'Bury'],
      [/rochdale/i, 'Rochdale'],
      [/trafford|stretford|altrincham/i, 'Trafford'],
      [/ashton-under-lyne|tameside|\bdenton\b|droylsden|\bhyde\b|stalybridge/i, 'Tameside'],
      [/warrington|\bWA\d/i, 'Warrington']
    ];
    for (let i = 0; i < towns.length; i++) if (towns[i][0].test(blob)) return towns[i][1];
    return 'Manchester';
  }

  function scotland(city) {
    const name = cityName(city);
    return name === 'Glasgow' || name === 'Edinburgh';
  }

  function dwellingCount(type) {
    const t = String(type || '');
    const block = t.match(/block of\s+(\d+)/i);
    if (block) return Number(block[1]);
    const many = t.match(/(\d+)\s*(?:x\s*)?(?:flats|apartments)\b/i);
    if (many) return Number(many[1]);
    return null;
  }

  function costs(price, city, type) {
    if (!(price >= FLOOR)) {
      return { tax: 0, label: 'Higher rates of SDLT, and the Scottish additional dwelling supplement, do not apply when the price is under £40,000' };
    }
    const count = dwellingCount(type);
    const many = count != null && count >= 6;
    if (scotland(city)) {
      return { tax: lbttWithAds(price), label: 'LBTT plus 8% additional dwelling supplement' };
    }
    if (many) {
      return { tax: sdltNonResidential(price), label: 'SDLT at non-residential rates, because the lot is six or more dwellings' };
    }
    return { tax: sdltAdditional(price), label: 'SDLT at the higher rates for an additional dwelling (from 31 October 2024)' };
  }

  function assetClass(type) {
    const t = String(type || '');
    const homes = /flat|apartment|house|hmo|residential|dwelling|maisonette|studio|block of|\d+\s+flats\b|\d+\s+apartments\b/i.test(t);
    if (/mixed/i.test(t)) return 'Mixed-use';
    if (/office/i.test(t) && !homes) return 'Office';
    if (/retail|\bshop\b|public house|\bpub\b|restaurant|nightclub|industrial|warehouse/i.test(t) && !homes) return 'Retail';
    if (/hmo/i.test(t)) return 'HMO';
    if (/development|conversion|building plot/i.test(t)) return 'Development';
    if (/portfolio|resi block|block of|apartment block|\d+\s+flats\b|\d+\s+apartments\b/i.test(t)) return 'Resi block';
    if (/studio|\bflat\b|apartment|maisonette/i.test(t)) return 'Flats';
    if (/house|terrace|semi|detached|bungalow|cottage|dwelling|residential/i.test(t)) return 'Houses';
    return 'Other residential';
  }

  function money(n) {
    return '£' + Math.round(n).toLocaleString('en-GB');
  }

  function derive(price, rent, city, type) {
    if (!(price > 0) || !(rent > 0)) return null;
    const tax = costs(price, city, type);
    const fees = price * FEE;
    const allIn = price + tax.tax + fees;
    return {
      niy: rent / allIn,
      pct: round2(100 * rent / allIn),
      tax: tax.tax,
      fees: fees,
      allIn: allIn,
      taxLabel: tax.label
    };
  }

  function priceBasis(row) {
    if (row.price_basis === 'guide' || row.price_basis === 'sold') return row.price_basis;
    const blob = [row.rent_text, row.evidence, row.notes].join(' ');
    if (/guide price|if purchased at the guide|around the guide/i.test(blob) && !(row.sold_price > 0)) return 'guide';
    return row.sold_price > 0 ? 'sold' : '';
  }

  function passingRent(row) {
    return row.rent_basis === 'passing' && !/in the region of|scope for|asking rent|potential|lha|estimated to achieve|appraisal/i.test(row.rent_text || '');
  }

  function outlier(pct) {
    return pct != null && (pct > 12 || pct < 3);
  }

  function fromAuction(row) {
    const klass = assetClass(row.type);
    const basisPrice = priceBasis(row);
    const passing = passingRent(row);
    const base = {
      id: 'auction-' + (row.url || row.address),
      city: cityName(row.city),
      asset: klass,
      address: row.address,
      date: row.sold_date || '',
      price: basisPrice === 'sold' ? row.sold_price : (row.guide_price || null),
      rent: row.rent_pa,
      url: row.url || '',
      source: row.auctioneer || 'Auction catalogue',
      subArea: row.sub_area || townOf(row),
      rentWords: row.rent_text || '',
      rentKind: row.rent_basis || '',
      priceKind: basisPrice
    };
    if (!(row.rent_pa > 0) || basisPrice !== 'sold') {
      const why = row.rent_pa > 0 && basisPrice === 'guide'
        ? 'Unverified. Passing or stated rent is on the page, but the only price is a guide, not a completed sale. No NIY is derived from a guide.'
        : 'NIY unavailable. This comp does not publish both a completed sold price and a rent. No rent has been estimated.';
      return Object.assign(base, { basis: row.rent_pa > 0 && basisPrice === 'guide' ? 'unverified' : 'unavailable', pct: null, average: false, review: false, note: why });
    }
    const price = row.sold_price;
    const d = derive(price, row.rent_pa, row.city, row.type);
    const kind = passing ? 'stated passing rent' : 'not passing rent (asking, ERV, LHA or “in the region of”)';
    const priceWords = 'completed sold price';
    const review = outlier(d.pct);
    const qualified = passing && basisPrice === 'sold';
    const verified = row.verified === true && qualified;
    const commercial = klass === 'Office' || klass === 'Retail';
    const average = !commercial && qualified && (!review || verified);
    let why = '';
    if (commercial) why = 'Kept out. Office and retail comps are not in the residential averages.';
    else if (!qualified) why = 'Unverified. An average uses only passing rent and a completed sold price.';
    else if (review && !verified) why = 'Review. The derived NIY is outside 3% to 12% and has not been verified, so it is kept out of the average.';
    return Object.assign(base, {
      basis: qualified ? 'derived' : 'unverified',
      pct: d.pct,
      average: average,
      review: review,
      lowSample: false,
      note: (why ? why + ' ' : '') + 'Worked figure: ' + kind + ' ' + money(row.rent_pa) + ' a year, divided by the ' + priceWords + ' ' + money(price) + ' plus ' + d.taxLabel + ' of ' + money(d.tax) + ' and fees at 1.8% (' + money(d.fees) + '). The auctioneer did not print this NIY.'
    });
  }

  function fromEvidence(row) {
    const klass = assetClass(row.asset_type);
    const base = {
      id: row.id,
      city: cityName(row.city),
      asset: klass,
      address: row.location,
      date: row.date || '',
      url: row.url || '',
      source: row.source || '',
      quote: row.quote_status || '',
      subArea: townOf({ city: row.city, address: row.location, sub_area: row.sub_area }),
      inFile: row.in_average !== false && row.yield_kind !== 'agent_view' && row.set_id !== 'agent-view'
    };
    if (row.yield_kind === 'agent_view' || row.set_id === 'agent-view') {
      return Object.assign(base, {
        basis: 'published',
        pct: Number(row.yield_pct),
        average: false,
        note: 'Published agent market view, not a single-asset comp. Left out of the area average. ' + (row.notes || '')
      });
    }
    if (row.yield_kind === 'niy' && row.yield_pct != null) {
      const sold = row.quote_status === 'completed sale';
      const review = outlier(Number(row.yield_pct));
      const conflict = /disagree|not used in an average|not averaged|counted twice|left out of the average/i.test(row.notes || '');
      const verified = row.verified === true && sold;
      const commercial = klass === 'Office' || klass === 'Retail';
      const average = !commercial && row.in_average !== false && sold && !conflict && (!review || verified);
      let why = '';
      if (commercial) why = 'Kept out. Office and retail comps are not in the residential averages.';
      else if (!sold) why = 'Unverified. The figure is an asking quote, not a completed sale.';
      else if (conflict) why = 'Kept out. The notes say this figure double-counts a building or disagrees with another source.';
      else if (review && !verified) why = 'Review. Published NIY is outside 3% to 12% and is not verified for the average.';
      return Object.assign(base, {
        basis: sold ? 'published' : 'unverified',
        pct: Number(row.yield_pct),
        average: average,
        review: review,
        note: (why ? why + ' ' : '') + 'Published NIY. ' + (row.source || '') + (row.notes ? ' ' + row.notes : '')
      });
    }
    return Object.assign(base, {
      basis: 'unavailable',
      pct: null,
      average: false,
      note: 'NIY unavailable. The source did not publish a net initial yield, and this row has no rent and price from which to derive one.'
    });
  }

  function book(evidence, auctions) {
    const comps = [];
    (auctions && auctions.rows || []).forEach(function (row) { comps.push(fromAuction(row)); });
    (evidence && evidence.rows || []).forEach(function (row) { comps.push(fromEvidence(row)); });
    return comps;
  }

  function summarise(rows) {
    const nums = rows.map(function (r) { return r.pct; }).filter(function (n) { return n != null && isFinite(n); }).sort(function (a, b) { return a - b; });
    if (!nums.length) return null;
    const mid = nums.length >> 1;
    const median = nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
    const dates = rows.map(function (r) { return r.date || ''; }).filter(Boolean).sort();
    return {
      mean: round2(nums.reduce(function (s, n) { return s + n; }, 0) / nums.length),
      median: round2(median),
      n: nums.length,
      min: round2(nums[0]),
      max: round2(nums[nums.length - 1]),
      from: dates[0] || '',
      to: dates[dates.length - 1] || ''
    };
  }

  function averages(comps) {
    const usable = (comps || []).filter(function (c) {
      return c.average !== false && (c.basis === 'published' || c.basis === 'derived') && c.pct != null && AREAS.indexOf(c.city) >= 0;
    });
    const out = [];
    AREAS.forEach(function (city) {
      RESIDENTIAL.forEach(function (asset) {
        const rows = usable.filter(function (c) { return c.city === city && c.asset === asset; });
        const stat = summarise(rows);
        out.push({
          id: city + '|' + asset,
          city: city,
          asset: asset,
          stat: stat,
          rows: rows
        });
      });
    });
    return out;
  }

  function hintAsset(state) {
    const blob = [state && state.name, state && state.tenant, state && state.prefill_note, state && state.pc].join(' ');
    const units = (state && state.rows || []).reduce(function (n, r) { return n + (Number(r.units) || 0); }, 0);
    if (/hmo/i.test(blob)) return 'HMO';
    if (/mixed/i.test(blob)) return 'Mixed-use';
    if (/development|conversion/i.test(blob)) return 'Development';
    if (/block|portfolio/i.test(blob) || units >= 6) return 'Resi block';
    if (/flat|apartment|studio/i.test(blob)) return 'Flats';
    if (/house|terrace|semi|bungalow/i.test(blob)) return 'Houses';
    return '';
  }

  function usableAverage(row) {
    return row && row.stat && row.stat.n >= 3;
  }

  function pickId(comps, state) {
    const rows = averages(comps);
    const city = cityName(state && state.city);
    const hinted = hintAsset(state);
    const withStat = rows.filter(usableAverage);
    const exact = withStat.filter(function (r) { return r.city === city && r.asset === hinted; })[0];
    if (exact) return exact.id;
    const inCity = withStat.filter(function (r) { return r.city === city; }).sort(function (a, b) { return b.stat.n - a.stat.n; })[0];
    return inCity ? inCity.id : '';
  }

  function counts(comps) {
    const c = { published: 0, derived: 0, unverified: 0, unavailable: 0, inAverage: 0, review: 0 };
    (comps || []).forEach(function (row) {
      if (row.basis === 'published') c.published += 1;
      else if (row.basis === 'derived') c.derived += 1;
      else if (row.basis === 'unverified') c.unverified += 1;
      else c.unavailable += 1;
      if (row.average) c.inAverage += 1;
      if (row.review) c.review += 1;
    });
    return c;
  }

  root.lcNiy = {
    FEE: FEE,
    AREAS: AREAS,
    CLASSES: CLASSES,
    RESIDENTIAL: RESIDENTIAL,
    areaLabel: areaLabel,
    townOf: townOf,
    derive: derive,
    costs: costs,
    assetClass: assetClass,
    cityName: cityName,
    fromAuction: fromAuction,
    fromEvidence: fromEvidence,
    book: book,
    averages: averages,
    usableAverage: usableAverage,
    hintAsset: hintAsset,
    pickId: pickId,
    counts: counts,
    round2: round2
  };
})(typeof window !== 'undefined' ? window : globalThis);
