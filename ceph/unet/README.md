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
| `infer.py` | weight load, local soft-argmax peaks, detect |
| `dataset.py` | Aariz-layout heatmap dataset (fractional gaussian centres) |
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

Peaks are gaussians with std `--sigma` (default 1.5 heatmap pixels) centred on
the junior/senior mean, not the floored pixel. The checkpoint kept is the one
with the lowest validation radial error. Dataset folders must match
`dataset.py` (train/valid Cephalograms + senior/junior JSON).

Inference reads the same soft-argmax decoder, so a deployed
`best_unet_transfer_model_512px.pth` also places points between pixels.

## Check

```
python verify.py
```
