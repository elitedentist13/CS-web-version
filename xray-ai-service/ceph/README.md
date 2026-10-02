# Cephalometric landmark service (optional)

The Banana `/ceph` sidecar works without this service: it fits the empirical ISBI 2015 + Aariz / CEPHA29 mean to the film. When this folder later holds a trained model, `POST /ceph/landmarks` can replace that first pass.

## Dataset (not in git)

See `ceph/data/README.md` in the web root.

1. Download ISBI 2015 from https://figshare.com/s/37ec464af8e81ae6ebbf
2. Unpack into `xray-ai-service/ceph/dataset/` as documented there
3. Train with any of: CEPHMark-Net, CephTrace, or `detect.py --train` (template baseline only)

Do not commit `dataset/` or weight files.
