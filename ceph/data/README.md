# Lateral cephalometric datasets (do not commit patient images)

Banana’s `/ceph` sidecar uses the **ISBI 2015** 19-landmark vocabulary. The X-ray images themselves are not in this repo.

## Primary: ISBI 2015 Grand Challenge

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

Each annotation file is 19 lines of `x,y` (or `x y`) in ISBI order (Sella … Articulare). See `isbi2015.json`.

## Extra (more devices / more points)

| Set | Images | Landmarks | Where |
|---|---:|---:|---|
| Aariz / CEPHA29 | 1000 | 29 | MICCAI CL-Detection / Kaggle “Aariz” |
| DentalCepha | 102 | 19 | see CephTrace paper |
| ISBI 2023 | 700 train | 29 (use the shared 19) | challenge site |

CephTrace research (ONNX, not shipped here — ~277 MB): https://github.com/sidwiz/cephtrace-research

## Analysis web apps (GitHub)

Used as the clinical checklist for this sidecar (not iframed — PHI stays on Banana):

- [alexcorvi/cephalometric](https://github.com/alexcorvi/cephalometric) (MIT) — Steiner, Downs, Tweed, Wits, Mills-Eastman
- [tjandrayana/ortho-cephalometry](https://github.com/tjandrayana/ortho-cephalometry) (MIT) — same analyses, iframe protocol
- [forabi/WebCeph](https://github.com/forabi/WebCeph) (GPL-3) — tracing wizard; not vendored
