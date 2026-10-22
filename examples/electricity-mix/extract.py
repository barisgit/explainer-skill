"""Builds data.js, the small extract the page needs, from OWID's owid-energy-data.csv.

Usage: python3 extract.py owid-energy-data.csv
Source: https://github.com/owid/energy-data (CC BY 4.0), electricity columns by Ember and the Energy Institute.
"""
import json
import sys

import pandas as pd

YEARS = range(2000, 2025)  # 2025 is partial in the release: 106 places, no 2025 for most countries
SOURCES = ["coal", "gas", "oil", "nuclear", "hydro", "wind", "solar", "biofuel", "other_renewable_exc_biofuel"]
REGIONS = ["World", "Africa", "Asia", "Europe", "North America", "South America", "Oceania", "European Union (27)"]

df = pd.read_csv(sys.argv[1])
df = df[df.year.isin(YEARS) & df.electricity_generation.notna()]
# Countries carry an ISO code; Kosovo has none in this release but is a place readers look for.
keep = df[df.iso_code.notna() | df.country.isin(["Kosovo", *REGIONS])]

def number(value):
    """A rounded float, or None where the release leaves the cell blank (kept as missing, never as zero)."""
    return None if pd.isna(value) else round(float(value), 3)


places = []
for name, rows in keep.groupby("country"):
    by_year = rows.set_index("year")

    def column(col):
        return [number(by_year.at[y, col]) if y in by_year.index else None for y in YEARS]

    series = [column(f"{s}_electricity") for s in SOURCES]
    places.append({"name": name, "region": name in REGIONS, "total": column("electricity_generation"), "twh": series})
places.sort(key=lambda p: (not p["region"], REGIONS.index(p["name"]) if p["region"] else 0, p["name"]))

out = {"years": [YEARS[0], YEARS[-1]], "places": places}
with open("data.js", "w") as f:
    f.write("window.MIX = " + json.dumps(out, separators=(",", ":"), allow_nan=False) + ";\n")
