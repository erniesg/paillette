#!/usr/bin/env python3
"""Build real small/large image levels, never upscale the sample JPEGs."""
import json,urllib.request,concurrent.futures,io
from pathlib import Path
from PIL import Image
import argparse,csv
parser=argparse.ArgumentParser(description='Download NGA open-access image levels for an existing local gallery fixture. Requires Pillow.')
parser.add_argument('--preview-root',type=Path,required=True)
args=parser.parse_args()
root=args.preview_root
works=json.loads((root/'works.json').read_text())
with urllib.request.urlopen('https://raw.githubusercontent.com/NationalGalleryOfArt/opendata/main/data/published_images.csv',timeout=30) as source:
 rows={r['depictstmsobjectid']:r for r in csv.DictReader(io.StringIO(source.read().decode('utf-8-sig'))) if r['viewtype']=='primary' and r['openaccess']=='1'}
def fetch(work):
 id=work['artworkId'].split(':')[-1];row=rows.get(id)
 if not row:return id,False
 # Bound longer side, preserving source pixels; no invented detail or upscaling.
 with urllib.request.urlopen(row['iiifurl']+'/full/!1800,1800/0/default.jpg',timeout=15) as r: data=r.read()
 image=Image.open(io.BytesIO(data)).convert('RGB');aspect=image.width/image.height
 near=1400 if aspect>=1 else max(64,round(1400*aspect))
 for width in [384,near]:
  copy=image.copy();copy.thumbnail((width,round(width/aspect)),Image.Resampling.LANCZOS)
  folder=root/'public'/'art'/'iiif'/id/'full'/f'{width},'/'0';folder.mkdir(parents=True,exist_ok=True);copy.save(folder/'default.jpg',quality=94)
 work['imageUrl']=f'/art/iiif/{id}/full/{near},/0/default.jpg'
 return id,(image.width,image.height)
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
 for result in pool.map(fetch,works):print(result,flush=True)
(root/'works.json').write_text(json.dumps(works,indent=2))
