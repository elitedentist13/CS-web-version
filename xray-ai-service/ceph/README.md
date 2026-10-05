# Cephalometric landmark service (optional)

The Banana `/ceph` sidecar works without this service: it fits the empirical ISBI 2015 + Aariz / CEPHA29 mean to the film. `POST /ceph/landmarks` prefers the Dental_001 ResNet-50 UNet when `best_unet_transfer_model_512px.pth` is in `weights/`; otherwise it returns the 1502 image-mean. The published 1502 library is never overwritten.

## Dataset (not in git)

See `ceph/data/README.md` in the web root.

1. Download ISBI 2015 from https://figshare.com/s/37ec464af8e81ae6ebbf
2. Unpack into `xray-ai-service/ceph/dataset/` as documented there
3. Train with any of: CEPHMark-Net, CephTrace, or `detect.py --train` (template baseline only)

Do not commit `dataset/` or weight files.

## Landmarks (Banana UNet in the sidecar)

The ResNet-50 UNet **lives in** `ceph/unet/` (Banana-owned clone of HyunchanAn/Dental_001 `src/landmark`). Edit `model.py` / `train.py` there. This service file only imports that tree.

`POST /ceph/landmarks` runs that UNet (29 Aariz channels) and maps them to Banana’s 19 ISBI ids plus extras U1a / L1a / Pn. Missing or insane output falls back to the 1502 mean so Auto landmarks always returns 19 points.

Put `best_unet_transfer_model_512px.pth` in `ceph/unet/weights/` or `xray-ai-service/ceph/weights/` (Hugging Face `chemahc94/Cephalometric-Landmark-CVM`). Staff can still drag and Adopt either of the two sets.

## CVM (Dental_001 fork)

`POST /ceph/cvm` classifies Baccetti / Aariz **CS1–CS6** from a **C2–C4 crop**, not from the 19 ISBI points. Pipeline is the HyunchanAn/Dental_001 two-stage fork: YOLO ROI (optional) + EfficientNet-B0 CORAL classifier.

Put weights in `xray-ai-service/ceph/weights/` (gitignored):

- `best_cvm_v2_768px.pth` — required (Hugging Face `chemahc94/Cephalometric-Landmark-CVM`)
- `best.pt` or `yolov8m_custom.pt` — optional C2–C4 detector; without it the service crops from Po/Ar/Go or a posterior heuristic

The sidecar Child bar has **Auto CVM**; staff can still override CS1–CS6. Missing weights return HTTP 503 and the picker stays manual.
