# Sample art datasets

Two zips for demoing and judging Paillette: on-camera demos, and for judges
to download and re-upload themselves to test the app end to end. Both are
built from the same public-domain source, verified image-by-image, and are
small enough to upload over hotel wifi.

- `sample-art-100.zip` — 100 images + a `metadata.csv` sidecar. Demonstrates
  the metadata-aware ingest path.
- `sample-art-25-no-metadata.zip` — 25 images, no CSV. Demonstrates that
  metadata is optional — the app still ingests and indexes plain images.

The two sets do not overlap (125 distinct artworks total, 111 distinct
artists/attributions).

## Provenance: National Gallery of Art (Washington), Open Access

Every image is a "primary" open-access image from the National Gallery of
Art's public collection, sourced two ways:

1. **Collection metadata** — NGA's Open Data GitHub repository
   (`objects.csv` and `published_images.csv`), fetched from:
   - https://raw.githubusercontent.com/NationalGalleryOfArt/opendata/main/data/objects.csv
   - https://raw.githubusercontent.com/NationalGalleryOfArt/opendata/main/data/published_images.csv
   - Repo: https://github.com/NationalGalleryOfArt/opendata
   - Licence: **CC0 1.0 (public domain dedication)**. Quoting the repo's
     `README.md` (fetched 2026-09-03): "the National Gallery of Art waives
     any copyright or related rights that it might have in this dataset and
     is releasing this dataset under the Creative Commons Zero designation."
     https://creativecommons.org/publicdomain/zero/1.0/

2. **Images** — fetched directly from NGA's public IIIF image API using the
   `iiifurl` column in `published_images.csv`
   (`https://api.nga.gov/iiif/<image-uuid>/full/!1200,1200/0/default.jpg`),
   resizing to a 1200px longest edge at request time (IIIF `!w,h` = "no
   larger than", never upscaled). Confirmed CORS-open at fetch time:
   `access-control-allow-origin: *` on the image response.
   - Licence for the images themselves: NGA's own **Open Access Policy**,
     https://www.nga.gov/open-access-images.html — quoting the page
     (fetched via the Wayback Machine snapshot dated 2025-04-28, since
     nga.gov blocks direct scripted fetches): "The National Gallery of Art
     has an open access policy for images of works of art in our permanent
     collection which the Gallery believes to be in the public domain.
     Images of these works are available for download free of charge for
     any use, whether commercial or non-commercial." and "Users may
     download—free of charge and without seeking authorization from the
     Gallery—any image of a work in the Gallery's collection that the
     Gallery believes is in the public domain and is free of other known
     restrictions."

Selection criteria applied to both CSVs: `published_images.openaccess == 1`,
`viewtype == "primary"`, joined to `objects` on
`depictstmsobjectid == objectid`, with `title`, `attribution` (artist) and
`medium` all present and native resolution ≥ 1000px on each side. From the
~43,500 candidates that passed those filters, 125 were picked with a fixed
random seed (deterministic, reproducible), stratified across classification
(Painting/Drawing/Print/Sculpture/Photograph/Decorative Art) and capped at 3
works per artist for visual variety in the demo.

This is the same NGA open-access dataset this branch (`deploy-nga-open-access`)
already ingests in bulk — see `scripts/lib/open-access-art.mjs` and
`docs/open-access-art-ingest-plan.md` for the production ingest path. These
sample zips are a separate, hand-picked, small extract for demo/judging use,
not a byproduct of that pipeline.

### Classification mix

- `sample-art-100.zip`: 45 Painting, 20 Print, 15 Drawing, 10 Sculpture,
  8 Photograph, 2 Decorative Art.
- `sample-art-25-no-metadata.zip`: 12 Painting, 5 Print, 4 Drawing,
  2 Sculpture, 2 Photograph.

## `metadata.csv` column format (inside `sample-art-100.zip`)

Matches the sidecar format the app's own CSV parser expects
(`apps/web/app/lib/indexing-client.ts`, `parseMetadataCsv` /
`COLUMN_ALIASES`), keyed by filename (case-insensitive, folder prefix
ignored):

- `filename` — matches the `.jpg` entry name in the zip exactly, e.g.
  `nga-30230.jpg`.
- `title` — NGA object title.
- `artist` — NGA `attribution` (may be a named artist, a workshop/circle
  attribution, or a nationality+century when the maker is unrecorded — this
  is NGA's own cataloguing, not simplified).
- `year` — human-readable date text (NGA `displaydate`, e.g. `1860/1865`,
  `c. 1820`). Where `displaydate` has no parseable digits (e.g. "18th
  century"), NGA's `beginyear` is appended in parentheses so the app's
  `year` extraction (`firstYear` regex) always resolves a numeric year —
  verified against the app's own parser, see Verification below.
- `medium` — NGA medium/materials text.
- `classification` — NGA classification (Painting, Drawing, Print,
  Sculpture, Photograph, Decorative Art).
- `credit_line`, `accession_number` — NGA creditline and accession number
  (also app-recognized columns, included for authenticity/audit).
- `nga_object_id`, `source_url` — not app-recognized columns (ignored by the
  parser), kept so every row traces back to its NGA collection page, e.g.
  `https://www.nga.gov/collection/art-object-page.30230.html`.

## Provenance of the 25 no-metadata images

`sample-art-25-no-metadata.zip` intentionally ships **no** metadata file —
that's the point of the sample. Their provenance is recorded here instead:

- `nga-46173.jpg` — *Don Antonio Noriega*, Francisco Goya (1801). Oil on canvas. Painting. Accession 1961.9.74. https://www.nga.gov/collection/art-object-page.46173.html
- `nga-50692.jpg` — *Christ on the Road to Emmaus*, American 18th Century (c. 1725/1730). Oil on canvas. Painting. Accession 1966.13.6. https://www.nga.gov/collection/art-object-page.50692.html
- `nga-121344.jpg` — *People by the Blue Lake*, August Macke (1913). Oil on canvas. Painting. Accession 2020.112.10. https://www.nga.gov/collection/art-object-page.121344.html
- `nga-54131.jpg` — *Murnau*, Alexej von Jawlensky (1910). Oil on hardboard. Painting. Accession 1973.69.1. https://www.nga.gov/collection/art-object-page.54131.html
- `nga-1232.jpg` — *Filippo Cattaneo*, Sir Anthony van Dyck (1623). Oil on canvas. Painting. Accession 1942.9.93. https://www.nga.gov/collection/art-object-page.1232.html
- `nga-214115.jpg` — *Red Cherries*, Robert Spear Dunning (1866). Oil on canvas. Painting. Accession 2018.44.140. https://www.nga.gov/collection/art-object-page.214115.html
- `nga-45863.jpg` — *Aphia Salisbury Rich and Baby Edward*, Milton W. Hopkins (c. 1833). Oil on wood. Painting. Accession 1958.9.12. https://www.nga.gov/collection/art-object-page.45863.html
- `nga-50295.jpg` — *Peaceful Valley*, Alexander Helwig Wyant (c. 1872). Oil on canvas. Painting. Accession 1965.10.1. https://www.nga.gov/collection/art-object-page.50295.html
- `nga-50328.jpg` — *Distinguished Crow Indians*, George Catlin (1861/1869). Oil on card mounted on paperboard. Painting. Accession 1965.16.20. https://www.nga.gov/collection/art-object-page.50328.html
- `nga-205977.jpg` — *Trompe l'Oeil of an Etching by Ferdinand Bol*, Dutch or Flemish 17th Century (c. 1675). Oil on panel. Painting. Accession 2016.3.1. https://www.nga.gov/collection/art-object-page.205977.html
- `nga-43435.jpg` — *Allegory of Freedom*, American 19th Century (1863 or after). Oil on canvas. Painting. Accession 1955.11.4. https://www.nga.gov/collection/art-object-page.43435.html
- `nga-50613.jpg` — *A Sepibo Village*, George Catlin (1854/1869). Oil on card mounted on paperboard. Painting. Accession 1965.16.305. https://www.nga.gov/collection/art-object-page.50613.html
- `nga-143887.jpg` — *A Gondola Passing Under a Bridge in Venice*, Hercules Brabazon Brabazon (1821). Watercolor and gouache over graphite on wove paper. Drawing. Accession 2009.70.58. https://www.nga.gov/collection/art-object-page.143887.html
- `nga-140010.jpg` — *A Promenade in the Park at Sanssouci*, Franz Skarbina (1885). Watercolor and gouache over graphite on wove paper. Drawing. Accession 2008.52.1. https://www.nga.gov/collection/art-object-page.140010.html
- `nga-76138.jpg` — *The Foot Bath (Drying Out)*, Thomas Rowlandson (1756). Pen and brown ink with watercolor on wove paper. Drawing. Accession 1995.52.156. https://www.nga.gov/collection/art-object-page.76138.html
- `nga-139242.jpg` — *The Madonna Enthroned with Saint John the Baptist and Saint John the Evangelist*, Hans von Aachen (1589). Pen and brown ink with brown wash over traces of graphite, heightened with white gouache, on laid paper. Drawing. Accession 2007.111.45. https://www.nga.gov/collection/art-object-page.139242.html
- `nga-215369.jpg` — *Unidentified Man*, Charles B. J. Févret de Saint-Mémin (1798-1803). Mezzotint and engraving on wove paper. Print. Accession 2015.19.1584.55.13. https://www.nga.gov/collection/art-object-page.215369.html
- `nga-40502.jpg` — *William Herbert, Third Earl of Pembroke*, Simon de Passe after Paulus van Somer I (1595). Engraving. Print. Accession 1951.11.220. https://www.nga.gov/collection/art-object-page.40502.html
- `nga-37794.jpg` — *Sir Francis Bacon, Lord Chancellor*, William Walker (1791). Engraving. Print. Accession 1950.14.156. https://www.nga.gov/collection/art-object-page.37794.html
- `nga-226454.jpg` — *Archetypa studiaque patris Georgii Hoefnagelii [Part 4, Titlepage]*, Jacob Hoefnagel after Joris Hoefnagel (1592). Engraving on laid paper. Print. Accession 2023.45.3. https://www.nga.gov/collection/art-object-page.226454.html
- `nga-881.jpg` — *Mill near the Grand Chartreuse*, Joseph Mallord William Turner and Henry Edward Dawe (published 1816). Etching and mezzotint. Print. Accession 1941.4.21. https://www.nga.gov/collection/art-object-page.881.html
- `nga-177979.jpg` — *Walking Wolf*, Antoine-Louis Barye (cast c. 1870/1873). Bronze. Sculpture. Accession 2015.19.3861. https://www.nga.gov/collection/art-object-page.177979.html
- `nga-45075.jpg` — *Thunderbolt Issuing from a Cloud [reverse]*, Danese Cattaneo (before 1546). Bronze. Sculpture. Accession 1957.14.1011.b. https://www.nga.gov/collection/art-object-page.45075.html
- `nga-167057.jpg` — *Plate Number 639. "Daisy" jumping a hurdle, saddled*, Eadweard Muybridge (1887). Collotype. Photograph. Accession 2014.79.606. https://www.nga.gov/collection/art-object-page.167057.html
- `nga-227038.jpg` — *Portrait of a Woman*, Thomas S. Walsh (c. 1850). Daguerreotype with applied color. Photograph. Accession 2023.39.20. https://www.nga.gov/collection/art-object-page.227038.html

## How to use

**In the app UI** (recommended for the live demo and for judges): go to
"New collection" (or an existing collection's upload page), drop either zip
in the uploader. The uploader's defaults
(`apps/web/app/components/upload/zip-uploader.tsx`) are a 500-image cap and
a 10MB-per-file cap — both zips are far under both (100 images max, ~600KB
largest single JPEG).

**Via an agent, through the `index_zip` WebMCP tool**: works for either zip,
but note the anonymous WebMCP sandbox caps a job at
`INDEXING_CAPS.maxFilesPerJob = 40` images
(`apps/api/src/routes/indexing.ts`). `sample-art-25-no-metadata.zip` (25
images) fits entirely within one job. `sample-art-100.zip` will hit that cap
if handed to `index_zip` directly — the tool will process the first 40 and
report the rest as not accepted rather than failing silently. For a full
100-image `index_zip` demo, either raise the cap for the demo environment or
split the zip; for demoing the CSV-metadata path specifically, a smaller
slice of `sample-art-100.zip` (≤ 40 images, keeping matching `metadata.csv`
rows) also works. This cap does not apply to the direct UI upload path
above.

## Sizes (verified)

- `sample-art-100.zip`: 29,365,195 bytes (~28.0 MiB / 100 JPEGs + 1 CSV).
- `sample-art-25-no-metadata.zip`: 7,629,617 bytes (~7.3 MiB / 25 JPEGs).
- Combined: ~35.3 MiB — comfortably uploadable over hotel wifi.
- Both are committed as binaries directly (no generator script) since the
  combined size is well under the repo-bloat threshold this was scoped to
  (50MB). The exact selection is reproducible: seeded random sample (seed
  42 for the 100-set, seed 43 for the 25-set) over the filtered NGA
  candidate pool described above — re-derivable from the two source CSVs
  and the filter/quota rules in this document if the pipeline is ever
  needed again, but no script is checked in for it.

## Verification performed (2026-09-03)

- Both zips opened and every entry counted: exactly 100 `.jpg` + 1
  `metadata.csv` in `sample-art-100.zip`; exactly 25 `.jpg` and no CSV or
  other file in `sample-art-25-no-metadata.zip`. No `__MACOSX/` or dotfile
  junk entries in either.
- `unzip -t` integrity check passed on both archives (no CRC errors).
- Every image decoded with Pillow (`Image.load()`) after extraction from
  the zip; all are valid baseline JPEGs; longest edge is exactly 1200px on
  every image (none upscaled, none exceed 1200px).
- `metadata.csv` filenames cross-checked against the zip's actual `.jpg`
  entries: exact set match, no missing/extra rows either direction.
- `metadata.csv` was parsed with the app's real, unmodified
  `parseMetadataCsv` from `apps/web/app/lib/indexing-client.ts` (via `tsx`,
  not a reimplementation): 100/100 rows parsed, matched to their image
  file, and every row resolved non-empty `title`, `artist`, numeric `year`,
  `medium`, and `classification` — zero incomplete rows.
- The NGA Open Access Policy quote above was fetched from a Wayback Machine
  snapshot because `nga.gov` returns HTTP 403 to scripted fetches directly;
  the CC0 licence quote for the metadata CSVs was fetched directly from
  `raw.githubusercontent.com` (HTTP 200). The IIIF image CORS header
  (`access-control-allow-origin: *`) was confirmed with a live `curl -I`
  against `api.nga.gov` at build time.

## Not verified / known gaps

- The Wayback Machine snapshot of the NGA policy page is dated 2025-04-28,
  not today — it was the closest available capture; the live page could not
  be fetched directly (403) to confirm the text is unchanged since. The
  wording matches NGA's long-standing, widely-cited open access policy.
- No live smoke test was run of the actual upload flow (`/collections/new`,
  `/collections/:id/upload`) or `index_zip` in a running instance of the
  app against these exact zips — verification above is at the file/CSV
  level (decoding, structure, and the app's own parser function), not an
  end-to-end UI/API run.
