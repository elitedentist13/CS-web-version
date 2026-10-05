# Lateral cephalometric datasets (do not commit patient images)

Banana’s `/ceph` sidecar uses the **ISBI 2015** 19-landmark vocabulary. Auto-detect fits the **empirical mean of 1502 published tracings** (ISBI + Aariz + PKU/DentalCepha), picks 24 neighbour shapes on a tight crop, then snaps each point to a local edge or dark fossa. The X-ray images themselves are not in this repo.

Rebuild the catalogs after downloading new coordinate dumps:

```
python scripts/import-ceph-landmarks.py
```

## Imported (coordinates only)

| Set | Films | What we took | Where |
|---|---:|---|---|
| ISBI 2015 senior | 400 | 19-pt JSON, aligned to image space (RMSE 1.4 px vs GitHub CSV) | [Hugging Face Ceph-Biometrics-400](https://huggingface.co/datasets/YongchengYAO/Ceph-Biometrics-400) `Landmarks.zip` |
| ISBI 2015 senior train+Test1 | 300 | `train_senior.csv` + `test1_senior.csv` (cross-check) | [mariam-bebawy/SBME_CV_CephalometricLandmarks](https://github.com/mariam-bebawy/SBME_CV_CephalometricLandmarks/tree/main/data_csv) |
| Aariz / CEPHA29 | 1000 | 29-pt JSON; junior+senior average; 19 shared ISBI names | [manwaarkhd/aariz](https://github.com/manwaarkhd/aariz) loader + [Figshare 27986417](https://doi.org/10.6084/m9.figshare.27986417) (JSON only extracted) |
| PKU / DentalCepha | 102 | 19-pt txt (doctor1+doctor2 average), ISBI order | [Figshare 13265471](https://doi.org/10.6084/m9.figshare.13265471) (Zeng et al. 2020) |

Mean SNA on the imported 1502 is **81.7°**. Auto landmarks sizes the 1502 bbox from the UNet 19-point box (same 6% pad as `shapes.json`), then places the aspect-matched 24-neighbour average into that frame. Full-plate fallback still uses the ISBI image-normalized mean. `shapes.json` holds bbox-normalized shapes (no pixels).

## Primary images (gitignored)

- 400 lateral cephalograms, 1935×2400, **0.1 mm/pixel**
- 19 landmarks, two senior annotators (mean = ground truth)
- Split: 150 train / 150 Test1 / 100 Test2
- Challenge: http://www-o.ntust.edu.tw/~cweiwang/ISBI2015/challenge1/
- Download: https://figshare.com/s/37ec464af8e81ae6ebbf
- Paper: Wang et al., *Med Image Anal* / IEEE ISBI 2015

After download, drop files here (gitignored):

```
xray-ai-service/ceph/dataset/
  RawImage/TrainingData/001.bmp … 150.bmp
  RawImage/Test1Data/151.bmp … 300.bmp
  RawImage/Test2Data/301.bmp … 400.bmp
  AnnotationsByMD/400_senior/*.txt
  AnnotationsByMD/400_junior/*.txt
```

## Extra (more devices / more points — images not imported)

| Set | Images | Landmarks | Where |
|---|---:|---:|---|
| DiverseCeph19 | 1692 | 19 | Not public yet (request: rashmibe.nayak@gmail.com) |
| CephAdoAdu | 1000 | 10 | [ShanghaiTech-IMPACT/CeLDA](https://github.com/ShanghaiTech-IMPACT/CeLDA) (application required) |
| KHD 2025 | ~30k | 19 | Korean challenge; images not redistributed |

Aariz / CEPHA29 names mapped onto ISBI: S N Or Po A B Pog Me Gn Go LIT→L1 UIT→U1 Ls Li Sn Pog`→PogS PNS ANS Ar. The Figshare zip stays in `tmp-ceph-import/` (gitignored); only JSON labels are extracted.

CephTrace research (ONNX, not shipped here — ~277 MB): https://github.com/sidwiz/cephtrace-research

## Analysis web apps (GitHub)

Used as the clinical checklist for this sidecar (not iframed — PHI stays on Banana):

- [alexcorvi/cephalometric](https://github.com/alexcorvi/cephalometric) (MIT) — Steiner, Downs, Tweed, Wits, Mills-Eastman
- [tjandrayana/ortho-cephalometry](https://github.com/tjandrayana/ortho-cephalometry) (MIT) — same analyses, iframe protocol
- [forabi/WebCeph](https://github.com/forabi/WebCeph) (GPL-3) — tracing wizard; not vendored
