# Banana ResNet-50 UNet (sidecar development)

This folder is Banana’s **owned** copy of the HyunchanAn/Dental_001 ResNet-50
UNet heatmap landmark model. Change architecture, mapping, and training here.

The AI service (`xray-ai-service/ceph/unet.py`) only loads this package.
Auto landmarks still POSTs `/ceph/landmarks`. The published 1502 library is
never written by this tree.

| File | Role |
| --- | --- |
| `model.py` | `UNetHeatmapModel` + legacy `HeatmapModel` |
| `config.py` | Aariz 29 order, ISBI-19 map, extras U1a / L1a / Pn |
| `infer.py` | weight load, heatmap argmax, detect |
| `dataset.py` | Aariz-layout heatmap dataset |
| `train.py` | Banana training entry |
| `verify.py` | mapping + home checks (no weights required) |

## Weights

Looked up in order:

1. `ceph/unet/weights/` (this tree)
2. `xray-ai-service/ceph/weights/` (clinic install already on the PC)

Put `best_unet_transfer_model_512px.pth` in either folder, or train your own
`banana_unet.pth`. `*.pth` stays out of git.

## Train

Use the clinic venv (not BioTime 3.7):

```
%LOCALAPPDATA%\cs-xray-ai\venv\Scripts\python.exe train.py --dataset PATH\Aariz --epochs 20
```

Dataset folders must match `dataset.py` (train/valid Cephalograms + senior/junior JSON).

## Check

```
python verify.py
```
