/* One A/B/C grade for a single asset, using the same tests as the big-block map. */
(function () {
  const COLOR = { A: '#c62828', B: '#6a1b9a', C: '#b26a00', '': '#5b6472' };
  const LABEL = {
    A: 'A · Live insolvency',
    B: 'B · Lender or receiver sale',
    C: 'C · Watchlist',
    '': 'Ungraded'
  };
  const RANK = { A: 0, B: 1, C: 2, '': 3 };

  function owner(o) {
    const level = o && o.A && o.A.level;
    if (level === 'd') return 'A';
    if (level === 's') return 'C';
    return '';
  }

  function lot(l) {
    if (!l || typeof sellerOf !== 'function') return '';
    return sellerOf(l).k === 'c' ? 'B' : '';
  }

  function building(b) {
    if (!b || typeof owByNo !== 'function') return '';
    let watch = '';
    const nos = []
      .concat(b.company_freeholds || [], b.company_owners || [])
      .map(function (x) { return x && x.company_no; })
      .filter(Boolean);
    for (let i = 0; i < nos.length; i++) {
      const band = owner(owByNo(nos[i]));
      if (band === 'A') return 'A';
      if (band === 'C') watch = 'C';
    }
    return watch;
  }

  function site(s) {
    if (!s) return '';
    if (s.kind === 'd') return 'A';
    if (s.kind === 'lot') return lot(s.l) || ((s.sl && s.sl.k === 'c') ? 'B' : '');
    if (s.kind === 'pre' || s.kind === 's' || s.kind === 'pre2') return 'C';
    return '';
  }

  function sort(list, gradeOf) {
    return list.slice().sort(function (a, b) {
      const d = (RANK[gradeOf(a)] == null ? 3 : RANK[gradeOf(a)]) - (RANK[gradeOf(b)] == null ? 3 : RANK[gradeOf(b)]);
      if (d) return d;
      return String(a.addr || a.address || a.name || '').localeCompare(String(b.addr || b.address || b.name || ''));
    });
  }

  function legendHtml() {
    return '<div class="grade-legend"><span class="lvl d">A</span> Live insolvency <span class="lvl b">B</span> Lender or receiver sale <span class="lvl s">C</span> Watchlist <span class="lvl x">Ungraded</span>' +
      '<details><summary>Details</summary><p>Same bands as the big-block map, applied to one asset. <b>A</b>: the company that owns this title or building is in a live insolvency or receivership. <b>B</b>: this asset is being sold by a lender, receiver, administrator or liquidator. <b>C</b>: the owner is on the watchlist, and this asset is not in a forced sale. <b>Ungraded</b>: nothing in the company file and not a forced sale. A blank is not proof the owner is healthy. Private individuals are not in that file.</p></details></div>';
  }

  function paint() {
    const html = legendHtml();
    const box = document.getElementById('asset_grade_legend');
    if (box && !box.dataset.ready) { box.innerHTML = html; box.dataset.ready = '1'; }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paint);
  else paint();
  window.lcAssetGrade = {
    owner: owner,
    lot: lot,
    building: building,
    site: site,
    color: function (g) { return COLOR[g] || COLOR['']; },
    label: function (g) { return LABEL[g] || LABEL['']; },
    rank: function (g) { return RANK[g] == null ? 3 : RANK[g]; },
    sort: sort,
    legendHtml: legendHtml
  };
})();
