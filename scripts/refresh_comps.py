#!/usr/bin/env python3
"""Refresh open comps for Manchester, Cheltenham and Bristol.

Streams HM Land Registry Price Paid yearly files (Open Government Licence).
Writes summaries and slim sale files under comps/. Also copies the auction
lots already in this repo where a public page states both a sold price and a
rent, and optionally re-checks saved listing URLs.

Does not download Rightmove, Zoopla or other portal databases.

  python3 scripts/refresh_comps.py
  python3 scripts/refresh_comps.py --from-year 2016 --to-year 2026
  python3 scripts/refresh_comps.py --check-listings
"""
from __future__ import annotations

import argparse
import csv
import json
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "comps"
CACHE = Path("/tmp/ppd-cache")
PPD_URL = "http://prod.publicdata.landregistry.gov.uk.s3-website-eu-west-1.amazonaws.com/pp-{year}.csv"
DISTRICTS = {
    "MANCHESTER": "Manchester",
    "CHELTENHAM": "Cheltenham",
    "CITY OF BRISTOL": "Bristol",
}
TYPES = {"D": "Detached", "S": "Semi-detached", "T": "Terraced", "F": "Flat"}
UA = "LauritoCapital-comps/1.0 (public Price Paid refresh; OGL)"


def sector_of(pc: str) -> str:
    parts = (pc or "").upper().strip().split()
    if len(parts) == 2 and parts[1]:
        return parts[0] + " " + parts[1][0]
    return ""


def district_of(pc: str) -> str:
    parts = (pc or "").upper().strip().split()
    return parts[0] if parts else ""


def quantile(sorted_prices, p):
    n = len(sorted_prices)
    if n == 0:
        return None
    if n == 1:
        return int(sorted_prices[0])
    idx = (n - 1) * p
    lo = int(idx)
    hi = min(lo + 1, n - 1)
    frac = idx - lo
    return int(round(sorted_prices[lo] * (1 - frac) + sorted_prices[hi] * frac))


def summarise(prices):
    if not prices:
        return None
    s = sorted(prices)
    n = len(s)
    out = {"n": n}
    if n >= 5:
        out["median"] = quantile(s, 0.5)
        out["p25"] = quantile(s, 0.25)
        out["p75"] = quantile(s, 0.75)
    else:
        out["median"] = None
        out["withheld"] = "fewer than 5 sales"
    if n < 20:
        out["thin"] = True
    return out


def download(year: int) -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    dest = CACHE / f"pp-{year}.csv"
    if dest.exists() and dest.stat().st_size > 1_000_000:
        print(f"cache {dest.name} {dest.stat().st_size}", flush=True)
        return dest
    url = PPD_URL.format(year=year)
    print(f"download {url}", flush=True)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=180) as resp, dest.open("wb") as fh:
        while True:
            chunk = resp.read(1024 * 256)
            if not chunk:
                break
            fh.write(chunk)
    print(f"saved {dest.name} {dest.stat().st_size}", flush=True)
    return dest


def load_yields():
    rows = []
    seen = set()
    for name in ("map_manchester.json", "map_cheltenham.json", "map_bristol.json"):
        path = ROOT / name
        if not path.exists():
            continue
        data = json.loads(path.read_text())
        city = {"map_manchester.json": "Manchester", "map_cheltenham.json": "Cheltenham", "map_bristol.json": "Bristol"}[name]
        for y in data.get("ycomps") or []:
            price = y.get("sold_price")
            rent = y.get("rent_pa")
            if not isinstance(price, (int, float)) or not isinstance(rent, (int, float)) or price <= 0 or rent <= 0:
                continue
            key = (y.get("url"), price, rent)
            if key in seen:
                continue
            seen.add(key)
            rows.append({
                "city": city,
                "address": y.get("address"),
                "postcode": y.get("pc"),
                "type": y.get("type"),
                "sold_price": int(price),
                "sold_date": y.get("sold_date"),
                "rent_pa": int(rent),
                "rent_text": y.get("rent_text"),
                "rent_basis": y.get("rent_basis") or "as stated on the lot",
                "gross_yield": round(rent / price, 4),
                "auctioneer": y.get("auctioneer"),
                "url": y.get("url"),
                "evidence": "Price and income are both stated for this lot. One lot is not a market yield. Not a surveyor valuation.",
            })
    rows.sort(key=lambda r: (r["city"], r.get("sold_date") or ""), reverse=True)
    return rows


def check_listings():
    props = json.loads((ROOT / "property_status.json").read_text())
    urls = []
    for p in props.get("properties") or []:
        if p.get("url"):
            urls.append({"url": p["url"], "address": p.get("address"), "city": p.get("city"), "status_on_file": p.get("status")})
    out = []
    for item in urls:
        rec = {"url": item["url"], "address": item["address"], "city": item["city"], "status_on_file": item["status_on_file"], "checked_at": date.today().isoformat()}
        req = urllib.request.Request(item["url"], headers={"User-Agent": UA}, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=12) as resp:
                rec["http"] = resp.status
                rec["final_url"] = resp.geturl()
                rec["note"] = "HTTP check only. A 200 does not prove the lot is still for sale."
        except urllib.error.HTTPError as e:
            rec["http"] = e.code
            rec["note"] = "The saved snapshot still stands. This status is not a new instruction and not proof of a withdrawal."
        except Exception as e:
            rec["http"] = None
            rec["error"] = type(e).__name__
            rec["note"] = "Could not re-check this URL. Do not treat that as a change in the listing."
        print(rec["http"], item["url"][:80], flush=True)
        out.append(rec)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-year", type=int, default=2016)
    ap.add_argument("--to-year", type=int, default=date.today().year)
    ap.add_argument("--check-listings", action="store_true")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)

    # tree[city][level][geo][year][type] -> prices
    # level is la / district / sector. geo is '' for la.
    prices = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: defaultdict(list)))))
    counts = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    writers = {}
    files = {}
    for city, slug in (("Manchester", "manchester"), ("Cheltenham", "cheltenham"), ("Bristol", "bristol")):
        path = OUT / f"sales_{slug}.csv"
        fh = path.open("w", newline="", encoding="utf-8")
        w = csv.writer(fh)
        w.writerow(["id", "date", "price", "postcode", "sector", "type", "tenure", "paon", "saon", "street", "local_authority"])
        writers[city] = w
        files[city] = fh

    years = []
    try:
        for year in range(args.from_year, args.to_year + 1):
            path = download(year)
            years.append(year)
            kept = 0
            with path.open(newline="", encoding="utf-8", errors="replace") as fh:
                for row in csv.reader(fh):
                    if len(row) < 15:
                        continue
                    la = DISTRICTS.get(row[12].upper())
                    if not la:
                        continue
                    cat = row[14]
                    new = row[5]
                    ptype = row[4]
                    y = row[2][:4]
                    counts[la][y]["all"] += 1
                    if cat != "A":
                        counts[la][y]["category_b"] += 1
                        continue
                    if new == "Y":
                        counts[la][y]["new_build"] += 1
                        continue
                    if ptype not in TYPES:
                        counts[la][y]["other_type"] += 1
                        continue
                    try:
                        price = int(row[1])
                    except ValueError:
                        continue
                    if price <= 0:
                        continue
                    pc = row[3].upper().strip()
                    sec = sector_of(pc)
                    dist = district_of(pc)
                    day = row[2][:10]
                    tenure = "freehold" if row[6] == "F" else "leasehold" if row[6] == "L" else row[6]
                    prices[la]["la"][""][y]["all"].append(price)
                    prices[la]["la"][""][y][ptype].append(price)
                    if dist:
                        prices[la]["district"][dist][y]["all"].append(price)
                        prices[la]["district"][dist][y][ptype].append(price)
                    if sec:
                        prices[la]["sector"][sec][y]["all"].append(price)
                        prices[la]["sector"][sec][y][ptype].append(price)
                    tid = row[0].strip("{}")
                    writers[la].writerow([tid, day, price, pc, sec, ptype, tenure, row[7], row[8], row[9], la])
                    kept += 1
            print(f"{year} kept {kept}", flush=True)
    finally:
        for fh in files.values():
            fh.close()

    places = {}
    for la in DISTRICTS.values():
        place = {"local_authority": {}, "postcode_districts": {}, "postcode_sectors": {}, "excluded": counts[la]}
        for year, types in prices[la]["la"][""].items():
            place["local_authority"][year] = {t: summarise(v) for t, v in types.items() if v}
        for dist, years_d in prices[la]["district"].items():
            place["postcode_districts"][dist] = {
                year: {t: summarise(v) for t, v in types.items() if v} for year, types in years_d.items()
            }
        for sec, years_d in prices[la]["sector"].items():
            place["postcode_sectors"][sec] = {
                year: {t: summarise(v) for t, v in types.items() if v} for year, types in years_d.items()
            }
        places[la] = place

    summary = {
        "retrieved": date.today().isoformat(),
        "source": "HM Land Registry Price Paid Data",
        "licence": "Contains HM Land Registry data © Crown copyright and database right 2026. Licensed under the Open Government Licence v3.0.",
        "source_url": "https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads",
        "files": [f"pp-{y}.csv" for y in years],
        "rules": "Medians use standard category A sales of existing homes (not new-build), types detached, semi-detached, terraced and flat. Category B, new-build and other types are counted under excluded and are not in the median. Prices are nominal recorded prices, not time-adjusted and not a surveyor valuation. A median is withheld below 5 sales. Fewer than 20 sales is a thin sample. The latest year is incomplete because of registration lag.",
        "type_labels": TYPES,
        "places": places,
    }
    (OUT / "summary.json").write_text(json.dumps(summary, separators=(",", ":")))
    yields = load_yields()
    (OUT / "yields.json").write_text(json.dumps({
        "retrieved": date.today().isoformat(),
        "rule": "Included only where the same public auction lot states both a sold or hammer price and a rent. Gross yield is rent divided by that price. It is evidence for that lot, not a sector yield, unless you group enough lots yourself. Portal asking rents are not used.",
        "rows": yields,
    }, indent=2))
    print("yield rows", len(yields), flush=True)
    if args.check_listings:
        checks = check_listings()
        (OUT / "listing_checks.json").write_text(json.dumps({"retrieved": date.today().isoformat(), "rows": checks}, indent=2))
        print("listing checks", len(checks), flush=True)
    print("done", OUT, flush=True)


if __name__ == "__main__":
    main()
