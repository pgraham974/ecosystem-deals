/* Upload a tenancy schedule into the deal underwrite. Session only; nothing is written to the repo. */
(function () {
  'use strict';

  const FIELDS = [
    ['unit', 'Unit / flat'],
    ['tenant', 'Tenant'],
    ['rent', 'Rent'],
    ['erv', 'ERV / target rent'],
    ['start', 'Lease start'],
    ['end', 'Lease end'],
    ['status', 'Status'],
    ['sc', 'Service charge'],
    ['other', 'Other income'],
    ['contractual', 'Contractual / headline rent'],
    ['review', 'Review / index'],
    ['steps', 'Stepped rent'],
    ['rentFree', 'Rent-free / commencement'],
    ['breakCol', 'Break option']
  ];

  function esc(s) {
    return (typeof window !== 'undefined' && typeof window.esc === 'function') ? window.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function money(n) {
    if (n == null || !isFinite(+n)) return 'Unknown';
    return '£' + Math.round(+n).toLocaleString('en-GB');
  }

  function parseCsv(text) {
    const rows = [];
    let row = [], cur = '', q = false;
    const src = String(text || '').replace(/^\uFEFF/, '');
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (q) {
        if (ch === '"' && src[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (ch !== '\r') cur += ch;
    }
    if (cur.length || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return String(c).trim(); }); });
  }

  function norm(s) {
    return String(s || '').toLowerCase().replace(/£/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function scoreHeader(cell, field) {
    const h = norm(cell);
    if (!h) return 0;
    const rules = {
      unit: [['unit', 5], ['flat', 5], ['apartment', 4], ['plot', 3], ['demise', 4], ['property', 2], ['address', 2], ['tenancy', 2]],
      tenant: [['tenant', 6], ['occupier', 5], ['lessee', 5], ['resident', 3]],
      rent: [['passing rent', 8], ['current rent', 8], ['rent pcm', 8], ['rent pa', 8], ['monthly rent', 7], ['annual rent', 7], ['rent', 4]],
      erv: [['erv', 7], ['market rent', 6], ['target rent', 6], ['quoting rent', 5]],
      start: [['lease start', 7], ['start date', 6], ['commencement', 5], ['commenced', 6], ['lease from', 5], ['from', 2]],
      end: [['lease end', 7], ['lease expiry', 7], ['expiry', 6], ['end date', 5], ['term end', 5]],
      status: [['status', 4], ['occupancy', 5], ['void', 4], ['vacant', 4]],
      sc: [['service charge', 8], ['servicecharge', 8], ['svc charge', 7], ['svc', 5]],
      other: [['other income', 7], ['parking', 4], ['sundry', 3]],
      contractual: [['contractual rent', 8], ['headline rent', 8], ['contracted rent', 8], ['headline', 4]],
      review: [['rent review', 8], ['review basis', 7], ['index', 4], ['rpi', 6], ['cpi', 6]],
      steps: [['stepped rent', 8], ['step rent', 7], ['rent steps', 7]],
      rentFree: [['rent free', 8], ['rent-free', 8], ['rent commencement', 8], ['commencement of rent', 7]],
      breakCol: [['break option', 8], ['lease break', 7], ['break date', 7], ['break', 5]]
    };
    let best = 0;
    (rules[field] || []).forEach(function (pair) {
      const term = pair[0];
      const hit = term.length <= 3 ? (' ' + h + ' ').indexOf(' ' + term + ' ') >= 0 : (h === term || h.indexOf(term) >= 0);
      if (hit) best = Math.max(best, pair[1]);
    });
    if (field === 'rent' && /review|arrear|deposit|free|step|headline|contractual|break|index/.test(h)) best = Math.max(0, best - 6);
    if (field === 'rent' && /\brent\b/.test(' ' + h + ' ') && /passing|current/.test(h)) best = Math.max(best, 9);
    if (field === 'start' && /rent commencement|rent free|rent-free|break/.test(h)) best = 0;
    if (field === 'breakCol' && best > 0 && !/\bbreak\b/.test(' ' + h + ' ')) best = 0;
    return best;
  }

  function filledCells(cells) {
    return (cells || []).map(function (c) { return String(c == null ? '' : c).trim(); }).filter(Boolean);
  }

  function looksLikeNote(cells) {
    const parts = filledCells(cells);
    if (!parts.length) return false;
    const joined = parts.join(' ');
    if (/^(notes?\b|total\b|sub-?total\b|source\b|prepared\b|disclaimer\b|confidential\b|abstract\b)/i.test(joined)) return true;
    if (parts.length <= 2 && joined.length > 45) return true;
    return false;
  }

  function unknownRentText(v) {
    const t = String(v == null ? '' : v).replace(/£/g, '').trim();
    if (!t) return false;
    if (/vacant|void|empty|unlet/i.test(t) && !/\d{2,}/.test(t)) return false;
    const digits = t.replace(/[^0-9.]/g, '');
    if (digits && !/not stated/i.test(t)) return false;
    return /not stated|n\/a|n\.a\.|^na$|tbc|unknown|see lease|refer to|as per lease|^-$|^—$|^–$/i.test(t);
  }

  function rowKeywordHits(cells) {
    const seen = {};
    (cells || []).forEach(function (cell) {
      FIELDS.forEach(function (f) {
        if (scoreHeader(cell, f[0]) >= 4) seen[f[0]] = 1;
      });
    });
    return Object.keys(seen).length;
  }

  function headerRowIndex(grid) {
    let best = 0, bestScore = -1;
    const limit = Math.min(grid.length, 25);
    for (let i = 0; i < limit; i++) {
      const cells = grid[i] || [];
      const filled = filledCells(cells);
      if (filled.length < 3) continue;
      if (looksLikeNote(cells)) continue;
      const hits = rowKeywordHits(cells);
      if (!hits) continue;
      const det = detectMap(cells);
      let samples = 0, dataLike = 0;
      for (let r = i + 1; r < Math.min(grid.length, i + 8); r++) {
        const row = grid[r] || [];
        if (!filledCells(row).length || looksLikeNote(row)) continue;
        samples++;
        const rentCell = det.map.rent >= 0 ? row[det.map.rent] : '';
        const amount = parseMoney(rentCell);
        const unit = det.map.unit >= 0 ? String(row[det.map.unit] || '') : filledCells(row)[0] || '';
        if (amount != null || unknownRentText(rentCell) || /flat|apt|unit|g\d|\d/i.test(unit)) dataLike++;
        if (rowKeywordHits(row) >= 3 && amount == null) dataLike -= 1;
      }
      const ownRent = det.map.rent >= 0 ? parseMoney(cells[det.map.rent]) : null;
      const score = hits * 3 + (samples ? (dataLike / samples) * 8 : 0) + Math.min(filled.length, 8) * 0.2 - (ownRent != null ? 10 : 0);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return bestScore > 0 ? best : 0;
  }

  function detectMap(headers) {
    const map = {};
    const ambiguous = [];
    FIELDS.forEach(function (f) {
      const scored = headers.map(function (h, i) { return { i: i, h: h, s: scoreHeader(h, f[0]) }; }).filter(function (x) { return x.s > 0; }).sort(function (a, b) { return b.s - a.s; });
      if (!scored.length) { map[f[0]] = -1; return; }
      map[f[0]] = scored[0].i;
      if (scored.length > 1 && scored[0].s - scored[1].s < 2) ambiguous.push(f[0]);
    });
    if (map.erv === map.rent || map.erv === map.sc) map.erv = -1;
    ['contractual', 'review', 'steps', 'rentFree', 'breakCol'].forEach(function (k) {
      if (map[k] === map.rent || map[k] === map.start) map[k] = -1;
    });
    const period = detectPeriod(headers, map.rent);
    return { map: map, ambiguous: ambiguous, period: period, needsMap: map.rent < 0 || ambiguous.indexOf('rent') >= 0 };
  }

  function detectPeriod(headers, rentCol) {
    const h = norm(rentCol >= 0 ? headers[rentCol] : '');
    if (/pcm|per month|monthly|p m|per calendar/.test(h)) return 'pcm';
    if (/\bpw\b|per week|weekly/.test(h)) return 'pw';
    if (/\bpa\b|per annum|annual|p a|yearly/.test(h)) return 'pa';
    return 'pcm';
  }

  function parseMoney(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number' && isFinite(v)) return v;
    const t = String(v).replace(/,/g, '').replace(/£/g, '').trim();
    if (!t || /^-|n\/a|tbc|vacant|void/i.test(t)) {
      const n = t.match(/-?\d+(?:\.\d+)?/);
      if (!n || /vacant|void|tbc|n\/a/i.test(t)) return /^-?\d/.test(t) ? Number(n[0]) : null;
    }
    const n = t.replace(/[^0-9.-]/g, '');
    if (!n || n === '-' || n === '.') return null;
    const num = Number(n);
    return isFinite(num) ? num : null;
  }

  function cellPeriod(v, fallback) {
    const t = String(v || '').toLowerCase();
    if (/pcm|per month|p\.?m/.test(t)) return 'pcm';
    if (/per week|p\.?w\b|\bpw\b/.test(t)) return 'pw';
    if (/per annum|p\.?a\b|\bpa\b|annual/.test(t)) return 'pa';
    return fallback;
  }

  function toAnnual(amount, period) {
    if (amount == null) return 0;
    if (period === 'pcm') return amount * 12;
    if (period === 'pw') return amount * 52;
    return amount;
  }

  function isVoid(status, rent, tenant) {
    const s = String(status || '').toLowerCase();
    if (/void|vacant|empty|unlet|available/.test(s)) return true;
    if (/let|occupied|ast|in situ/.test(s)) return false;
    if ((rent == null || rent === 0) && !String(tenant || '').trim()) return true;
    return false;
  }

  function noteRows(grid, headerAt) {
    const notes = [];
    for (let r = headerAt + 1; r < grid.length; r++) {
      const cells = grid[r] || [];
      if (!filledCells(cells).length) continue;
      if (looksLikeNote(cells)) notes.push({ index: r, text: filledCells(cells).join(' ').slice(0, 180) });
    }
    return notes;
  }

  function analyse(grid) {
    const headerAt = headerRowIndex(grid);
    const headers = grid[headerAt] || [];
    const detected = detectMap(headers);
    const notes = noteRows(grid, headerAt);
    const skip = {};
    notes.forEach(function (n) { skip[n.index] = n.text; });
    return { headerAt: headerAt, headers: headers, map: detected.map, ambiguous: detected.ambiguous, period: detected.period, needsMap: detected.needsMap, notes: notes, skip: skip };
  }

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  function isoDate(y, m, d) {
    if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return dt.toISOString().slice(0, 10);
  }

  function parseDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      const dt = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
      return dt.toISOString().slice(0, 10);
    }
    const t = String(v).trim();
    let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return isoDate(+m[1], +m[2], +m[3]);
    m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (m) {
      let y = +m[3];
      if (y < 100) y += 2000;
      const a = +m[1], b = +m[2];
      if (a > 12) return isoDate(y, b, a);
      if (b > 12) return isoDate(y, a, b);
      return isoDate(y, b, a);
    }
    m = t.match(/^(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})$/i);
    if (m) return isoDate(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
    return null;
  }

  function shiftIso(iso, days) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function addMonthsIso(iso, n) {
    const d = new Date(iso + 'T00:00:00Z');
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + n);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return d.toISOString().slice(0, 10);
  }

  function addYearsIso(iso, n) {
    return addMonthsIso(iso, n * 12);
  }

  function datesInText(text) {
    const out = [];
    const re = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})|(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})/gi;
    let m;
    while ((m = re.exec(text))) {
      const iso = m[1] ? parseDate(m[1] + '/' + m[2] + '/' + m[3]) : parseDate(m[4] + ' ' + m[5] + ' ' + m[6]);
      if (iso) out.push({ iso: iso, index: m.index, length: m[0].length });
    }
    return out;
  }

  function poundsInText(text) {
    const out = [];
    const re = /£\s*([0-9][0-9,]*(?:\.\d+)?)(?:\s*(?:pa|p\.a\.|per annum))?/gi;
    let m;
    while ((m = re.exec(text))) out.push({ pa: Number(m[1].replace(/,/g, '')), index: m.index, length: m[0].length });
    return out;
  }

  function nearestDate(dates, index) {
    let best = null, dist = 48;
    dates.forEach(function (d) {
      const gap = Math.abs(d.index - index);
      if (gap < dist) { dist = gap; best = d.iso; }
    });
    return best;
  }

  function parseLeaseText(text) {
    const src = String(text || '');
    const lease = { steps: [], reviewDates: [], breaks: [], omr: [], rentFreeMonths: null, rentFreeFrom: null, commencement: null, index: null, indexRate: null, upwardsOnly: false, annual: false, notes: [] };
    if (!src.trim()) return lease;
    if (/\brpi\b/i.test(src)) lease.index = 'RPI';
    else if (/\bcpi\b/i.test(src) || /index[-\s]?linked/i.test(src)) lease.index = 'CPI';
    if (/upwards?\s*-?\s*only/i.test(src)) lease.upwardsOnly = true;
    if (lease.index && /annually|annual|each year|every year/i.test(src)) lease.annual = true;
    const stated = src.match(/(?:rpi|cpi|index(?:ation)?)[^.%]{0,24}(\d+(?:\.\d+)?)\s*%/i);
    if (stated) lease.indexRate = Number(stated[1]);
    const dates = datesInText(src);
    const pounds = poundsInText(src);
    const freeMonths = src.match(/(\d+)\s*months?\s*(?:of\s*)?rent[\s-]*free/i) || src.match(/rent[\s-]*free[^.]{0,30}?(\d+)\s*months?/i);
    if (freeMonths) lease.rentFreeMonths = Number(freeMonths[1]);
    const freeFrom = src.match(/rent[\s-]*free[^.]{0,40}?from\s+(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{1,2}\s+[A-Za-z]+\s+\d{4})/i);
    if (freeFrom) lease.rentFreeFrom = parseDate(freeFrom[1]);
    const commence = src.match(/rent commencement[^.]{0,20}?(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{1,2}\s+[A-Za-z]+\s+\d{4})/i);
    if (commence) lease.commencement = parseDate(commence[1]);
    src.replace(/(?:fixed\s+)?review\s+to\s+£\s*([0-9,]+(?:\.\d+)?)(?:\s*(?:pa|per annum))?[^.]{0,30}?(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{1,2}\s+[A-Za-z]+\s+\d{4})/gi, function (_, amt, dt) {
      const iso = parseDate(dt);
      if (iso) lease.steps.push({ date: iso, pa: Number(String(amt).replace(/,/g, '')), kind: 'fixed' });
      return _;
    });
    function addStep(date, pa, kind) {
      if (!date || pa == null || !isFinite(pa)) return;
      if (lease.steps.some(function (s) { return s.date === date && Math.abs(s.pa - pa) < 1; })) return;
      lease.steps.push({ date: date, pa: pa, kind: kind || 'step' });
    }
    const dateTok = '(\\d{1,2}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{2,4}|\\d{1,2}\\s+[A-Za-z]+\\s+\\d{4})';
    const amtTok = '£\\s*([0-9,]+(?:\\.\\d+)?)';
    src.replace(new RegExp('until\\s+' + dateTok + '\\s*(?:,|then)\\s*' + amtTok, 'gi'), function (_, dt, amt) {
      const iso = parseDate(dt);
      if (iso) addStep(shiftIso(iso, 1), Number(String(amt).replace(/,/g, '')), 'step');
      return _;
    });
    src.replace(new RegExp(amtTok + '(?:\\s*(?:pa|per annum))?\\s*(?:from|on|starting)\\s+' + dateTok, 'gi'), function (_, amt, dt) {
      addStep(parseDate(dt), Number(String(amt).replace(/,/g, '')), 'step');
      return _;
    });
    src.replace(new RegExp('(?:from|on)\\s+' + dateTok + '[^£]{0,24}' + amtTok, 'gi'), function (_, dt, amt) {
      addStep(parseDate(dt), Number(String(amt).replace(/,/g, '')), 'step');
      return _;
    });
    if (/open[\s-]*market/i.test(src)) {
      const iso = nearestDate(dates, src.search(/open[\s-]*market/i));
      lease.omr.push({ date: iso, note: 'Open-market review. No new rent is stated, so the last known rent is held.' });
    }
    if (lease.index) {
      const at = src.search(/next review|review date|reviews?/i);
      dates.forEach(function (d) {
        if (at >= 0 && Math.abs(d.index - at) < 40) lease.reviewDates.push(d.iso);
      });
      if (!lease.reviewDates.length && dates.length === 1) lease.reviewDates.push(dates[0].iso);
    }
    const breakAt = src.search(/\bbreak\b/i);
    if (breakAt >= 0) {
      const iso = nearestDate(dates, breakAt);
      if (iso) lease.breaks.push(iso);
      else lease.notes.push('A break is mentioned but no date could be read.');
    }
    lease.steps.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    return lease;
  }

  function leaseBlob(cells, map) {
    const skip = {};
    ['rent', 'tenant', 'unit', 'start', 'end', 'sc', 'erv', 'other', 'status'].forEach(function (k) { if (map[k] >= 0) skip[map[k]] = 1; });
    const parts = [];
    (cells || []).forEach(function (c, i) {
      if (skip[i]) return;
      const t = String(c == null ? '' : c).trim();
      if (!t || /^[\d.,£\s]+$/.test(t)) return;
      if (/rpi|cpi|index|step|rent[\s-]*free|commencement|break|open market|review|until|headline/i.test(t)) parts.push(t);
    });
    return parts.join('\n');
  }

  function attachLease(line, cells, map, period) {
    const lease = parseLeaseText(leaseBlob(cells, map));
    if (map.breakCol >= 0) {
      const iso = parseDate(cells[map.breakCol]);
      if (iso && lease.breaks.indexOf(iso) < 0) lease.breaks.push(iso);
    }
    if (map.rentFree >= 0 && lease.rentFreeMonths == null && !lease.commencement) {
      const raw = String(cells[map.rentFree] == null ? '' : cells[map.rentFree]);
      const months = raw.match(/(\d+)/);
      const iso = parseDate(raw);
      if (iso) lease.commencement = iso;
      else if (months) lease.rentFreeMonths = Number(months[1]);
    }
    const contractual = map.contractual >= 0 ? parseMoney(cells[map.contractual]) : null;
    lease.basePa = contractual != null ? toAnnual(contractual, cellPeriod(cells[map.contractual], period)) : (line.rentPa || 0);
    lease.start = parseDate(line.start);
    lease.end = parseDate(line.end);
    if (lease.rentFreeMonths && !lease.commencement) {
      const from = lease.rentFreeFrom || lease.start;
      if (from) lease.commencement = addMonthsIso(from, lease.rentFreeMonths);
    }
    if (lease.index && lease.annual && lease.reviewDates.length) {
      const seed = lease.reviewDates.slice().sort()[0];
      const horizon = lease.end || addYearsIso(seed, 30);
      let d = seed;
      const seen = {};
      lease.reviewDates.forEach(function (x) { seen[x] = 1; });
      while (d < horizon && Object.keys(seen).length < 40) {
        seen[d] = 1;
        d = addYearsIso(d, 1);
      }
      lease.reviewDates = Object.keys(seen).sort();
    }
    line.lease = lease;
    if (lease.breaks.length) line.flag = (line.flag ? line.flag + ' ' : '') + 'Break ' + lease.breaks.join(', ') + '. Not assumed to be exercised.';
    if (lease.omr.length) line.flag = (line.flag ? line.flag + ' ' : '') + 'Open-market review with no amount. Rent held at the last stated figure.';
    return line;
  }

  function rentRateOn(lease, iso, indexPct) {
    const info = { pa: 0, facts: [], assumptions: [], certain: true, needsIndex: false };
    if (!lease) return info;
    if (lease.start && iso < lease.start) {
      info.facts.push('Before the lease start.');
      return info;
    }
    if (lease.end && iso >= lease.end) {
      info.facts.push('Lease ended ' + lease.end + '. No renewal is assumed.');
      return info;
    }
    const commence = lease.commencement;
    if (commence && iso < commence) {
      info.pa = 0;
      info.facts.push('Rent-free until ' + commence + '.');
      return info;
    }
    let pa = lease.basePa || 0;
    info.facts.push('Starting rent £' + Math.round(pa).toLocaleString('en-GB') + ' a year from the sheet.');
    const events = [];
    (lease.reviewDates || []).forEach(function (d) { events.push({ date: d, type: 'index' }); });
    (lease.steps || []).forEach(function (s) { events.push({ date: s.date, type: 'step', pa: s.pa, kind: s.kind }); });
    events.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.type === 'index' ? -1 : 1;
    });
    events.forEach(function (ev) {
      if (ev.date > iso) return;
      if (ev.type === 'step') {
        pa = ev.pa;
        info.facts.push((ev.kind === 'fixed' ? 'Fixed review' : 'Stepped rent') + ' £' + Math.round(ev.pa).toLocaleString('en-GB') + ' a year from ' + ev.date + '.');
        return;
      }
      const rate = lease.indexRate != null ? lease.indexRate : indexPct;
      if (rate == null || !isFinite(+rate)) {
        info.needsIndex = true;
        info.assumptions.push((lease.index || 'Index') + ' review on ' + ev.date + ' is in the sheet, but no rate is entered, so the rent is not increased.');
        return;
      }
      const applied = lease.upwardsOnly ? Math.max(0, +rate) : +rate;
      const before = pa;
      pa = pa * (1 + applied / 100);
      const label = lease.indexRate != null ? 'Fact' : 'Assumption';
      const sentence = (lease.index || 'Index') + ' ' + (lease.upwardsOnly ? 'upwards only ' : '') + 'on ' + ev.date + ' at ' + applied + '%.';
      if (label === 'Fact') info.facts.push(sentence + ' Stated in the sheet.');
      else info.assumptions.push(sentence + ' The rate is the single assumption entered for this schedule.');
      if (lease.upwardsOnly && +rate < 0) info.facts.push('Upwards-only clause kept the rent at £' + Math.round(before).toLocaleString('en-GB') + '.');
    });
    (lease.omr || []).forEach(function (o) {
      if (!o.date || o.date <= iso) info.assumptions.push(o.note || 'Open-market review. Amount unknown, so the rent is unchanged.');
    });
    (lease.breaks || []).forEach(function (b) {
      if (iso >= b) {
        info.certain = false;
        info.facts.push('After the break on ' + b + '. The break is not assumed to be exercised, so the rent still runs. It is not term-certain.');
      }
    });
    info.pa = pa;
    return info;
  }

  function monthSlice(lines, iso, indexPct) {
    const slice = { rent: 0, certain: 0, facts: [], assumptions: [], needsIndex: false };
    (lines || []).forEach(function (line) {
      if (!line || line.kind === 'void' || line.kind === 'unknown') return;
      const rate = rentRateOn(line.lease || { basePa: line.rentPa || 0, steps: [], reviewDates: [], breaks: [], omr: [] }, iso, indexPct);
      const month = rate.pa / 12;
      slice.rent += month;
      if (rate.certain) slice.certain += month;
      if (rate.needsIndex) slice.needsIndex = true;
      rate.facts.forEach(function (f) { slice.facts.push(line.unit + ': ' + f); });
      rate.assumptions.forEach(function (f) { slice.assumptions.push(line.unit + ': ' + f); });
    });
    slice.rent = Math.round(slice.rent * 100) / 100;
    slice.certain = Math.round(slice.certain * 100) / 100;
    return slice;
  }

  function modelDate(start, m) {
    if (typeof UW !== 'undefined' && typeof UW.date === 'function') return UW.date(start, m);
    return addMonthsIso(start, m);
  }

  function cashflowYears(lines, state, indexPct, years) {
    const rows = [];
    const n = years || (state && state.holdYears) || 3;
    for (let y = 0; y < n; y++) {
      let rent = 0, certain = 0, needsIndex = false;
      const facts = {}, assumptions = {};
      for (let i = 0; i < 12; i++) {
        const m = Number(state.completionMonth || 0) + 1 + y * 12 + i;
        const iso = modelDate(state.startDate, m);
        const slice = monthSlice(lines, iso, indexPct);
        rent += slice.rent;
        certain += slice.certain;
        if (slice.needsIndex) needsIndex = true;
        slice.facts.forEach(function (f) { facts[f] = 1; });
        slice.assumptions.forEach(function (f) { assumptions[f] = 1; });
      }
      rows.push({
        year: y + 1,
        rent: Math.round(rent * 100) / 100,
        certain: Math.round(certain * 100) / 100,
        needsIndex: needsIndex,
        facts: Object.keys(facts),
        assumptions: Object.keys(assumptions)
      });
    }
    return rows;
  }

  function installLeaseHook() {
    if (typeof UW === 'undefined') return;
    UW.monthRent = function (s, m, fallbackAnnual, yearIndex) {
      const growth = 1 + (Number(s && s.rentGrowth) || 0) / 100;
      const plain = (Number(fallbackAnnual) || 0) / 12 * Math.pow(growth, yearIndex || 0);
      if (!s || !s.leaseDriven || !UW.rentRoll || !UW.rentRoll.lines || !UW.rentRoll.lines.length) return plain;
      const iso = modelDate(s.startDate, m);
      return monthSlice(UW.rentRoll.lines, iso, UW.rentRoll.indexPct).rent;
    };
  }

  function buildRoll(grid, mapping, period) {
    const headerAt = mapping.headerAt;
    const headers = grid[headerAt] || [];
    const col = mapping.map;
    const skip = mapping.skip || {};
    const lines = [];
    const skipped = [];
    for (let r = headerAt + 1; r < grid.length; r++) {
      const cells = grid[r] || [];
      if (!filledCells(cells).length) continue;
      if (skip[r] || looksLikeNote(cells)) { skipped.push(filledCells(cells).join(' ').slice(0, 180)); continue; }
      const get = function (k) { return col[k] >= 0 ? cells[col[k]] : ''; };
      const rentRaw = get('rent');
      const rentNum = parseMoney(rentRaw);
      const rowPeriod = cellPeriod(rentRaw, period);
      const status = String(get('status') || '');
      const tenant = String(get('tenant') || '').trim();
      const unit = String(get('unit') || '').trim() || ('Row ' + (r + 1));
      const textVacant = /vacant|void|empty|unlet/i.test(String(rentRaw || '')) && !/\d{2,}/.test(String(rentRaw || ''));
      const vacant = isVoid(status, rentNum, tenant) || textVacant;
      const unknown = !vacant && (unknownRentText(rentRaw) || (rentNum == null && !!tenant));
      const kind = vacant ? 'void' : unknown ? 'unknown' : 'let';
      const ervNum = parseMoney(get('erv'));
      const scNum = parseMoney(get('sc'));
      const otherNum = parseMoney(get('other'));
      lines.push({
        unit: unit,
        tenant: tenant,
        vacant: kind === 'void',
        kind: kind,
        flag: kind === 'unknown' ? 'Rent not stated. Not counted as a let at £0.' : (kind === 'let' && rentNum === 0 ? 'Rent is stated as £0. Check the lease.' : ''),
        rentInput: kind === 'let' ? rentNum : null,
        period: rowPeriod,
        rentPa: kind === 'let' ? toAnnual(rentNum || 0, rowPeriod) : 0,
        ervPa: ervNum == null ? null : toAnnual(ervNum, cellPeriod(get('erv'), period)),
        scPa: scNum == null ? 0 : toAnnual(scNum, cellPeriod(get('sc'), 'pcm')),
        otherPa: otherNum == null ? 0 : toAnnual(otherNum, cellPeriod(get('other'), 'pa')),
        start: String(get('start') || '').trim(),
        end: String(get('end') || '').trim(),
        status: String(status || (kind === 'void' ? 'Vacant' : kind === 'unknown' ? 'Rent not stated' : 'Let')).trim()
      });
      attachLease(lines[lines.length - 1], cells, col, rowPeriod);
    }
    return { headers: headers, lines: lines, period: period, skipped: skipped };
  }

  function summarise(lines) {
    const kindOf = function (r) { return r.kind || (r.vacant ? 'void' : 'let'); };
    const letRows = lines.filter(function (r) { return kindOf(r) === 'let'; });
    const voidRows = lines.filter(function (r) { return kindOf(r) === 'void'; });
    const unknownRows = lines.filter(function (r) { return kindOf(r) === 'unknown'; });
    const passing = letRows.reduce(function (a, r) { return a + r.rentPa; }, 0);
    const sc = lines.reduce(function (a, r) { return a + (r.scPa || 0); }, 0);
    const other = lines.reduce(function (a, r) { return a + (r.otherPa || 0); }, 0);
    const ervColumnUsed = lines.some(function (r) { return r.ervPa != null; });
    const ervMissing = !ervColumnUsed || voidRows.some(function (r) { return r.ervPa == null; });
    const erv = ervMissing ? null : letRows.reduce(function (a, r) { return a + (r.ervPa != null ? r.ervPa : r.rentPa); }, 0) + voidRows.reduce(function (a, r) { return a + r.ervPa; }, 0);
    const avg = letRows.length ? passing / letRows.length : null;
    return {
      homes: lines.length,
      letHomes: letRows.length,
      voidHomes: voidRows.length,
      unknownHomes: unknownRows.length,
      occupancy: lines.length ? letRows.length / lines.length : null,
      passingPa: passing,
      avgLetPa: avg,
      servicePa: sc,
      otherPa: other,
      ervStabilisedPa: erv,
      estimatedStabilisedPa: avg == null ? null : passing + avg * voidRows.length
    };
  }

  function loadXlsx() {
    if (typeof XLSX !== 'undefined') return Promise.resolve();
    return new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = 'assets/vendor/xlsx.full.min.js';
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Excel parser failed to load.')); };
      document.head.appendChild(s);
    });
  }

  async function gridFromFile(file) {
    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.csv') || name.endsWith('.txt')) return parseCsv(await file.text());
    await loadXlsx();
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  }

  function templateRows() {
    return parseCsv(TEMPLATE);
  }

  const TEMPLATE = 'Unit,Tenant,Rent PCM,Lease start,Lease end,Status,Service charge PCM,Other income PA\nFlat 1,Example tenant A,850,2024-06-01,2026-05-31,Let,40,0\nFlat 2,Example tenant B,900,2025-01-15,2026-01-14,Let,40,0\nFlat 3,,0,,,Vacant,0,0\n';

  function downloadTemplate(kind) {
    if (kind === 'csv') {
      const a = document.createElement('a');
      a.href = 'assets/rent-roll-template.csv';
      a.download = 'laurito-rent-roll-template.csv';
      a.click();
      return;
    }
    loadXlsx().then(function () {
      const grid = templateRows();
      const ws = XLSX.utils.aoa_to_sheet(grid);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Rent roll');
      XLSX.writeFile(wb, 'laurito-rent-roll-template.xlsx');
    }).catch(function (e) { alert(e.message); });
  }

  function applyToModel(roll, useEstimate) {
    if (typeof UW === 'undefined' || !UW.state) return;
    const s = summarise(roll.lines);
    const revenue = useEstimate && s.estimatedStabilisedPa != null ? s.estimatedStabilisedPa : s.passingPa;
    const homes = s.homes || 1;
    UW.state.income_mode = 'direct';
    UW.state.rent_status = 'Quoted';
    UW.state.rows = [{ tenure: 'Rent', units: homes, beds: '', omv: UW.state.rows && UW.state.rows[0] ? (+UW.state.rows[0].omv || 0) : 0, annualRent: homes ? revenue / homes : 0 }];
    const unknownNote = s.unknownHomes ? ' ' + s.unknownHomes + ' home' + (s.unknownHomes === 1 ? ' has' : 's have') + ' rent not stated and ' + (s.unknownHomes === 1 ? 'is' : 'are') + ' excluded from the total, not entered as £0.' : '';
    UW.state.prefill_note = (useEstimate
      ? 'Rental revenue starts from the uploaded schedule, with vacant homes at the average passing rent. That fill-in is an estimate, not an ONS figure.'
      : 'Rental revenue follows the uploaded tenancy schedule. Vacant homes stay at £0. Service charge is not included. Not an ONS or LHA figure.') + unknownNote + ' Where the sheet states a step, a rent-free period or an index review, that term changes the rent year by year. The single growth percentage is not applied on top.';
    UW.state.leaseDriven = true;
    UW.rentRoll = { file: roll.file, summary: s, lines: roll.lines, period: roll.period, useEstimate: !!useEstimate, indexPct: UW.rentRoll && UW.rentRoll.indexPct != null ? UW.rentRoll.indexPct : null };
    installLeaseHook();
    const path = cashflowYears(roll.lines, UW.state, UW.rentRoll.indexPct, 1);
    if (path[0] && homes) UW.state.rows[0].annualRent = path[0].rent / homes;
    if (typeof uwUnitRows === 'function') uwUnitRows();
    const mode = document.getElementById('uw_income_mode');
    if (mode) mode.value = 'direct';
    const status = document.getElementById('uw_rent_status');
    if (status) status.value = 'Quoted';
    if (typeof uwStore === 'function') uwStore();
    if (typeof uwUpdate === 'function') uwUpdate();
    drawBridge();
  }

  function compsMedian(pc) {
    const line = typeof lcPpdLine === 'function' ? lcPpdLine(pc) : '';
    const stat = typeof lcPpdFlat === 'function' ? lcPpdFlat(pc) : null;
    return Promise.resolve({ text: line, median: stat && stat.median, n: stat && stat.n, year: stat && stat.year });
  }

  function leaseSummary(line) {
    const lease = line.lease;
    if (!lease) return 'Passing rent only.';
    const bits = [];
    if (lease.commencement) bits.push('Rent starts ' + lease.commencement + (lease.rentFreeMonths ? ' after ' + lease.rentFreeMonths + ' months rent-free' : '') + '.');
    lease.steps.forEach(function (s) { bits.push((s.kind === 'fixed' ? 'Fixed review' : 'Step') + ' to £' + Math.round(s.pa).toLocaleString('en-GB') + ' on ' + s.date + '.'); });
    if (lease.index) {
      const assumed = (typeof UW !== 'undefined' && UW.rentRoll && UW.rentRoll.indexPct != null) ? UW.rentRoll.indexPct : null;
      const rateBit = lease.indexRate != null ? ', rate ' + lease.indexRate + '% stated in the sheet' : (assumed != null ? ', assumed ' + assumed + '% a year (not stated in the sheet)' : ', rate not in the sheet');
      bits.push(lease.index + (lease.upwardsOnly ? ', upwards only' : '') + (lease.annual ? ', annual' : '') + (lease.reviewDates.length ? ', first review ' + lease.reviewDates[0] : '') + rateBit + '.');
    }
    lease.omr.forEach(function (o) { bits.push('Open-market review' + (o.date ? ' on ' + o.date : '') + '. Amount not stated.'); });
    if (lease.breaks.length) bits.push('Break ' + lease.breaks.join(', ') + '. Not treated as exercised.');
    if (!bits.length) bits.push('No step, review, rent-free or break was read. Rent stays at the stated figure until expiry. The growth box is not applied.');
    return bits.join(' ');
  }

  function uniqueLines(list) {
    const seen = {}, out = [];
    (list || []).forEach(function (item) {
      const key = item.replace(/^[^:]+:\s*/, '');
      if (seen[key]) return;
      seen[key] = 1;
      out.push(key);
    });
    return out.slice(0, 6);
  }

  function leaseCashflowHtml(roll) {
    const state = (typeof UW !== 'undefined' && UW.state) || { startDate: new Date().toISOString().slice(0, 7) + '-01', completionMonth: 0, holdYears: 3 };
    const years = cashflowYears(roll.lines, state, roll.indexPct, Math.min(10, Number(state.holdYears) || 3));
    const needs = years.some(function (y) { return y.needsIndex; });
    const rateValue = roll.indexPct == null ? '' : String(roll.indexPct);
    return '<h3>Rent path from the schedule</h3><p class="foot">Each operating year is the twelve months after completion. Fact is something the sheet states. Assumption is a rate you type, or a review with no amount, where the last stated rent is held. A break is flagged and is not assumed to be exercised. Income after the break is still in the rent column, and is left out of term-certain.</p>' +
      (needs ? '<label class="dlf"><small>Assumed annual RPI / CPI %</small><input id="rr_index" type="number" step="0.1" value="' + esc(rateValue) + '" placeholder="Enter one rate"></label><p class="foot">The sheet links at least one rent to an index and does not give the rate. This one figure is applied to every such review. It is an assumption, not a forecast from the sheet. Leave it blank and those rents stay flat.</p>' : '') +
      '<div class="scroll"><table><thead><tr><th>Operating year</th><th>Rent</th><th>Term-certain</th><th class="l">Fact</th><th class="l">Assumption</th></tr></thead><tbody>' +
      years.map(function (y) {
        return '<tr><td>' + y.year + '</td><td>' + money(y.rent) + '</td><td>' + money(y.certain) + '</td><td class="l">' + esc(uniqueLines(y.facts).join(' ') || '—') + '</td><td class="l">' + esc(uniqueLines(y.assumptions).join(' ') || '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="foot">The deal summary uses this path for year-one rent, NOI, the NIY bid, the exit NOI and the monthly cash flow. The annual growth percentage on the deal sheet is not added on top.</p>';
  }

  function wireIndex() {
    const input = document.getElementById('rr_index');
    if (!input || input.dataset.wired) return;
    input.dataset.wired = '1';
    input.addEventListener('change', function () {
      if (typeof UW === 'undefined' || !UW.rentRoll) return;
      const raw = String(input.value).trim();
      UW.rentRoll.indexPct = raw === '' ? null : Number(raw);
      if (UW.state && UW.state.leaseDriven && UW.state.rows && UW.state.rows[0]) {
        const path = cashflowYears(UW.rentRoll.lines, UW.state, UW.rentRoll.indexPct, 1);
        const homes = UW.state.rows[0].units || 1;
        UW.state.rows[0].annualRent = path[0] ? path[0].rent / homes : 0;
        if (typeof uwUnitRows === 'function') uwUnitRows();
      }
      if (typeof uwStore === 'function') uwStore();
      if (typeof uwUpdate === 'function') uwUpdate();
    });
  }

  function drawBridge() {
    const host = document.getElementById('rr_bridge');
    const roll = typeof UW !== 'undefined' && UW.rentRoll;
    if (!host) return;
    if (!roll) { host.innerHTML = ''; return; }
    const s = roll.summary;
    const pc = (typeof UW !== 'undefined' && UW.state && UW.state.pc) || '';
    const model = (typeof UW !== 'undefined' && UW.result && !(UW.result.errors && UW.result.errors.length)) ? UW.result : null;
    host.innerHTML = '<div class="card"><h3>Pricing bridge from the uploaded schedule</h3><p class="foot">File: ' + esc(roll.file) + '. Figures below the schedule line are estimates. Nothing here is an ONS average.</p>' +
      '<p><span class="lc-k">Fact</span> <b>Passing rent</b> ' + money(s.passingPa) + ' a year from ' + s.letHomes + ' let home' + (s.letHomes === 1 ? '' : 's') + '. ' + s.voidHomes + ' vacant. Occupancy ' + (s.occupancy == null ? 'Unknown' : Math.round(s.occupancy * 100) + '%') + '.' + (s.unknownHomes ? ' ' + s.unknownHomes + ' home' + (s.unknownHomes === 1 ? ' has' : 's have') + ' rent not stated and ' + (s.unknownHomes === 1 ? 'is' : 'are') + ' not counted as a let at £0.' : '') + '</p>' +
      '<p><span class="lc-k">Fact</span> Service charge ' + money(s.servicePa) + ' a year and other income ' + money(s.otherPa) + ' a year are <b>not</b> in the rent the model is using.</p>' +
      '<p><span class="lc-k">' + (s.ervStabilisedPa == null ? 'Estimate' : 'Fact') + '</span> <b>Stabilised rent</b> ' + (roll.useEstimate ? money(s.estimatedStabilisedPa) + ' a year, by putting the average passing rent on vacant homes. This is an estimate, not a new letting.' : (s.ervStabilisedPa == null ? 'Unknown. The sheet has no ERV for every vacant home, and the estimate is not switched on.' : money(s.ervStabilisedPa) + ' a year, using ERV on the sheet for vacant homes and passing rent for let homes.')) + '</p>' +
      '<p><span class="lc-k">Unknown</span> <b>Break-up value</b> is unknown. A rent roll does not value selling the homes separately.</p>' +
      '<p id="rr_as_is"><span class="lc-k">Estimate</span> <b>As-is value</b> is loading from Price Paid where the deal has a postcode.</p>' +
      '<p><span class="lc-k">Estimate</span> <b>Maximum bid</b> ' + (model ? money(model.bid) + ' at the target entry yield on the rent now in the model (' + money(model.annualRent) + ' a year, NOI ' + money(model.noi) + '). This is the model, not a valuation. Exit yield stays an assumption.' : 'Enter the remaining underwriting inputs (OPEX margin and the rest). The bid appears when the model can run.') + '</p>' +
      leaseCashflowHtml(roll) +
      '<div class="scroll" style="max-height:280px"><table><thead><tr><th class="l">Unit</th><th class="l">Tenant</th><th>Status</th><th>Passing / year</th><th>Terms read from the sheet</th><th>Start</th><th>End</th></tr></thead><tbody>' +
      roll.lines.map(function (r) {
        return '<tr><td class="l">' + esc(r.unit) + '</td><td class="l">' + esc(r.tenant || '—') + '</td><td>' + esc(r.status) + '</td><td>' + (r.kind === 'unknown' ? 'Not stated' : money(r.rentPa)) + (r.flag ? '<div class="foot">' + esc(r.flag) + '</div>' : '') + '</td><td class="l">' + esc(leaseSummary(r)) + '</td><td>' + esc(r.start || '—') + '</td><td>' + esc(r.end || '—') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
    const box = document.getElementById('rr_as_is');
    if (box && pc) {
      compsMedian(pc).then(function (c) {
        if (!c.median) {
          box.innerHTML = '<span class="lc-k">Estimate</span> <b>As-is value</b> Unknown from these comps. ' + esc(c.text || 'No sector median for this postcode.');
          return;
        }
        const gross = s.passingPa / (c.median * s.homes);
        box.innerHTML = '<span class="lc-k">Estimate</span> <b>As-is</b> sector flat median ' + money(c.median) + (c.year ? ' (' + esc(c.year) + ', n=' + c.n + ')' : '') + '. ' + s.homes + ' homes × that median = ' + money(c.median * s.homes) + '. That is not a survey. Implied gross yield on that figure, using passing rent only, is ' + (gross * 100).toFixed(1) + '%. ' + esc(c.text || '');
      });
    } else if (box) box.innerHTML = '<span class="lc-k">Unknown</span> <b>As-is value</b> needs a postcode on the deal. No yield is calculated.';
    wireIndex();
  }

  function mappingForm(grid, detected) {
    const headerAt = detected.headerAt;
    const headers = (grid[headerAt] || []).map(function (h, i) { return { i: i, h: String(h || '').trim() || ('Column ' + (i + 1)) }; });
    const opts = '<option value="-1">Not in this sheet</option>' + headers.map(function (h) { return '<option value="' + h.i + '">' + esc(h.h) + '</option>'; }).join('');
    const noteList = (detected.notes || []).map(function (n) { return '<li>' + esc(n.text) + '</li>'; }).join('');
    return '<div id="rr_map"><p><b>Cleaner suggestion, on this device.</b> Header is row ' + (detected.headerAt + 1) + '. ' + (detected.needsMap ? 'The rent column is missing or ambiguous, so choose it before the model uses the sheet.' : 'Check the columns, then confirm once. Nothing is sent off this browser unless you use the optional model below.') + '</p>' +
      (noteList ? '<p class="foot">These rows look like titles, totals or notes and will be left out:</p><ul class="foot">' + noteList + '</ul>' : '') +
      '<div class="dlgrid">' + FIELDS.map(function (f) {
        return '<label class="dlf"><small>' + esc(f[1]) + '</small><select data-field="' + f[0] + '">' + opts + '</select></label>';
      }).join('') +
      '<label class="dlf"><small>Rent amounts are</small><select id="rr_period"><option value="pcm">£ per month</option><option value="pa">£ per year</option><option value="pw">£ per week</option></select></label></div>' +
      '<label class="foot"><input type="checkbox" id="rr_stab"> Estimate stabilised rent by applying the average passing rent to vacant homes. Leave this off unless you want that estimate in the model. Homes whose rent is “not stated” stay out of that estimate.</label>' +
      '<div class="ctl"><button class="btn" id="rr_apply" type="button">Confirm and use these rents</button><button class="btn sec" id="rr_ai" type="button">Auto-fix with AI</button><button class="btn sec" id="rr_clear" type="button">Remove schedule</button></div>' +
      '<details class="foot"><summary>Optional model key</summary><p>Leave this blank and the cleaner stays on this device. If you add a key, only column headings and whether each column looks like a number, a date or text are sent. Tenant names and rent amounts are not sent. You still confirm before anything reaches the model.</p><label class="dlf"><small>API key, stored only in this browser</small><input id="rr_key" type="password" autocomplete="off"></label><label class="dlf"><small>Endpoint</small><input id="rr_endpoint" type="url" value="https://api.openai.com/v1/chat/completions"></label><p id="rr_ai_note"></p></details></div>';
  }

  function readMapping() {
    const map = {};
    document.querySelectorAll('#rr_map select[data-field]').forEach(function (sel) { map[sel.dataset.field] = +sel.value; });
    return { map: map, period: document.getElementById('rr_period').value, useEstimate: document.getElementById('rr_stab').checked, headerAt: window.RR.headerAt };
  }

  function columnSketch(grid, headerAt) {
    const headers = grid[headerAt] || [];
    return headers.map(function (h, i) {
      const kinds = { number: 0, date: 0, unknown: 0, text: 0, blank: 0 };
      for (let r = headerAt + 1; r < Math.min(grid.length, headerAt + 9); r++) {
        const cell = (grid[r] || [])[i];
        const t = String(cell == null ? '' : cell).trim();
        if (!t) kinds.blank++;
        else if (unknownRentText(t)) kinds.unknown++;
        else if (/^\d{4}-\d{2}-\d{2}/.test(t) || /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(t)) kinds.date++;
        else if (parseMoney(t) != null) kinds.number++;
        else kinds.text++;
      }
      return { index: i, header: String(h || '').slice(0, 80), shapes: kinds };
    }).filter(function (c) { return c.header; });
  }

  async function autoFixWithAi(grid, proposal) {
    const keyEl = document.getElementById('rr_key');
    const note = document.getElementById('rr_ai_note');
    const key = (keyEl && keyEl.value) || '';
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('lc_rr_ai_key') || '' : '';
    const useKey = key || stored;
    if (!useKey) {
      if (note) note.textContent = 'No key. The suggestion on screen is from the cleaner in this browser. Tenant names and rents have not been sent anywhere.';
      return proposal;
    }
    if (key && typeof localStorage !== 'undefined') localStorage.setItem('lc_rr_ai_key', key);
    const endpoint = (document.getElementById('rr_endpoint') || {}).value || 'https://api.openai.com/v1/chat/completions';
    const sketch = columnSketch(grid, proposal.headerAt);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + useKey },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0,
          messages: [{ role: 'user', content: 'Reply with JSON only: {"rentColumn":number,"period":"pa"|"pcm"|"pw","unitColumn":number,"tenantColumn":number,"startColumn":number,"endColumn":number,"statusColumn":number}. Use -1 if absent. Columns: ' + JSON.stringify(sketch) }]
        })
      });
      if (!res.ok) throw new Error('Model returned ' + res.status);
      const data = await res.json();
      const text = (((data.choices || [])[0] || {}).message || {}).content || '';
      const json = JSON.parse(text.replace(/^```json\s*|```$/g, ''));
      const map = Object.assign({}, proposal.map);
      if (Number.isInteger(json.rentColumn)) map.rent = json.rentColumn;
      if (Number.isInteger(json.unitColumn)) map.unit = json.unitColumn;
      if (Number.isInteger(json.tenantColumn)) map.tenant = json.tenantColumn;
      if (Number.isInteger(json.startColumn)) map.start = json.startColumn;
      if (Number.isInteger(json.endColumn)) map.end = json.endColumn;
      if (Number.isInteger(json.statusColumn)) map.status = json.statusColumn;
      if (note) note.textContent = 'The model suggested a column map from headings and cell types only. Check it, then confirm. Rent amounts were not sent.';
      return Object.assign({}, proposal, { map: map, period: json.period || proposal.period, fromModel: true });
    } catch (e) {
      if (note) note.textContent = 'The model was not used (' + e.message + '). The on-page suggestion is unchanged.';
      return proposal;
    }
  }

  function paintMap(host, detected) {
    FIELDS.forEach(function (f) {
      const sel = host.querySelector('select[data-field="' + f[0] + '"]');
      if (sel) sel.value = String(detected.map[f[0]] >= 0 ? detected.map[f[0]] : -1);
    });
    const period = host.querySelector('#rr_period');
    if (period && detected.period) period.value = detected.period;
  }

  function showParsed(grid, fileName) {
    const detected = analyse(grid);
    window.RR.headerAt = detected.headerAt;
    window.RR.skip = detected.skip;
    window.RR.grid = grid;
    window.RR.file = fileName;
    const host = document.getElementById('rr_work');
    host.innerHTML = '<p class="foot">' + esc(fileName) + '. Suggested header is row ' + (detected.headerAt + 1) + (detected.notes.length ? '. ' + detected.notes.length + ' note or total row' + (detected.notes.length === 1 ? '' : 's') + ' will be skipped.' : '.') + '</p>' + mappingForm(grid, detected);
    paintMap(host, detected);
    const key = document.getElementById('rr_key');
    if (key && typeof localStorage !== 'undefined' && localStorage.getItem('lc_rr_ai_key')) key.placeholder = 'Key saved in this browser';
    host.querySelector('#rr_apply').onclick = function () {
      const chosen = readMapping();
      const roll = buildRoll(grid, { map: chosen.map, headerAt: detected.headerAt, skip: detected.skip }, chosen.period);
      roll.file = fileName;
      if (!roll.lines.length) { host.insertAdjacentHTML('beforeend', '<p>No tenancy rows under that header.</p>'); return; }
      applyToModel(roll, chosen.useEstimate);
    };
    host.querySelector('#rr_ai').onclick = function () {
      autoFixWithAi(grid, detected).then(function (next) {
        paintMap(host, next);
      });
    };
    host.querySelector('#rr_clear').onclick = clearRoll;
  }

  function clearRoll() {
    if (typeof UW !== 'undefined') {
      UW.rentRoll = null;
      if (UW.state) UW.state.leaseDriven = false;
    }
    const host = document.getElementById('rr_work');
    if (host) host.innerHTML = '<p class="foot">No schedule in this session. The underwrite below still uses whatever rent you type, or LHA if you explicitly choose that.</p>';
    const bridge = document.getElementById('rr_bridge');
    if (bridge) bridge.innerHTML = '';
  }

  function mount() {
    const body = document.getElementById('deal_body');
    if (!body || document.getElementById('rr_card')) return;
    const card = document.createElement('div');
    card.id = 'rr_card';
    card.className = 'card';
    card.innerHTML = '<h2>Tenancy schedule</h2><p class="lead">Drop the rent roll you already keep. Those rents become the rental revenue for this deal. ONS averages are not used. The file stays in this browser.</p>' +
      '<div class="ctl"><label class="btn">Upload Excel or CSV<input id="rr_file" type="file" accept=".xlsx,.xls,.csv,application/vnd.ms-excel,text/csv" hidden></label>' +
      '<button class="btn sec" id="rr_tpl_csv" type="button">Download template (CSV)</button>' +
      '<button class="btn sec" id="rr_tpl_xlsx" type="button">Download template (Excel)</button></div>' +
      '<p class="foot">Title rows and notes are ignored on this device. “Not stated”, “n/a” and a blank rent are not treated as a let at £0. Steps, rent-free periods, RPI or CPI reviews and break dates in the sheet are read into the yearly rent. A break is flagged and is not assumed to be exercised. Preferred columns: unit, tenant, rent (pcm, pa or pw), lease start, lease end, review, stepped rent, rent-free, break.</p>' +
      '<div id="rr_work"><p class="foot">No schedule in this session. The underwrite below still uses whatever rent you type, or LHA if you explicitly choose that.</p></div><div id="rr_bridge"></div>';
    body.insertBefore(card, body.firstChild);
    card.querySelector('#rr_tpl_csv').onclick = function () { downloadTemplate('csv'); };
    card.querySelector('#rr_tpl_xlsx').onclick = function () { downloadTemplate('xlsx'); };
    card.querySelector('#rr_file').onchange = function (e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      document.getElementById('rr_work').innerHTML = '<p class="foot">Reading ' + esc(file.name) + '…</p>';
      gridFromFile(file).then(function (grid) { showParsed(grid, file.name); }).catch(function (err) {
        document.getElementById('rr_work').innerHTML = '<p>Could not read that file. Save it as .xlsx or .csv and try again. ' + esc(err.message) + '</p>';
      });
    };
    if (typeof UW !== 'undefined' && UW.rentRoll) drawBridge();
  }

  if (typeof uwUpdate === 'function' && !uwUpdate._rr) {
    const prevUpdate = uwUpdate;
    const wrapped = function () {
      if (typeof UW !== 'undefined' && UW.state && UW.state.leaseDriven && UW.rentRoll && UW.rentRoll.lines && UW.state.rows && UW.state.rows[0]) {
        const path = cashflowYears(UW.rentRoll.lines, UW.state, UW.rentRoll.indexPct, 1);
        const homes = Number(UW.state.rows[0].units) || 1;
        if (path[0]) UW.state.rows[0].annualRent = path[0].rent / homes;
      } else if (typeof UW !== 'undefined' && UW.state && UW.state.leaseDriven && !UW.rentRoll) {
        UW.state.leaseDriven = false;
      }
      const out = prevUpdate();
      if (typeof UW !== 'undefined' && UW.rentRoll) drawBridge();
      return out;
    };
    wrapped._rr = true;
    uwUpdate = wrapped;
  }

  const prevStart = typeof uwStart === 'function' ? uwStart : null;
  if (prevStart) {
    uwStart = async function () {
      await prevStart();
      mount();
    };
  }

  installLeaseHook();
  const api = { parseCsv: parseCsv, detectMap: detectMap, headerRowIndex: headerRowIndex, analyse: analyse, buildRoll: buildRoll, summarise: summarise, parseMoney: parseMoney, isVoid: isVoid, toAnnual: toAnnual, looksLikeNote: looksLikeNote, unknownRentText: unknownRentText, parseLeaseText: parseLeaseText, cashflowYears: cashflowYears, monthSlice: monthSlice, parseDate: parseDate };
  if (typeof globalThis !== 'undefined') globalThis.RR = api;
  if (typeof document !== 'undefined' && document.getElementById('deal_body') && document.getElementById('deal_body').childElementCount) mount();
})();
