"""Aariz-style heatmap dataset for Banana UNet training.

Cloned from HyunchanAn/Dental_001 `src/landmark/dataset.py`. Folder layout:

  <root>/{train,valid,test}/Cephalograms/
  <root>/{train,valid,test}/Annotations/Cephalometric Landmarks/Senior Orthodontists/
  <root>/{train,valid,test}/Annotations/Cephalometric Landmarks/Junior Orthodontists/

Heatmap output defaults to 256×256 to match `UNetHeatmapModel` (Dental_001
dataset.py defaulted to 64×64). Gaussians are centred on the continuous
heatmap coordinate (not the truncated pixel) so the mode matches the label.
Albumentations is imported only when a dataset is constructed so infer/verify
stay lightweight.
"""
from __future__ import annotations

import json
import os

import numpy as np

try:
    from .config import HEATMAP_SIGMA, NUM_LANDMARKS
except ImportError:
    from config import HEATMAP_SIGMA, NUM_LANDMARKS


def render_heatmaps(landmarks, output_size, image_size, sigma=HEATMAP_SIGMA):
    """Float32 heatmaps (N, H, W). Landmark xy is in resized-image pixels.

    The gaussian is sampled on the grid around the fractional heatmap
    coordinate, so a label at 10.4 peaks at 10.4 rather than at floor(10.4).
    """
    out_h, out_w = int(output_size[0]), int(output_size[1])
    in_h = float(image_size[0]) or 1.0
    in_w = float(image_size[1]) or 1.0
    n = len(landmarks)
    heatmaps = np.zeros((n, out_h, out_w), dtype=np.float32)
    scale_x = out_w / in_w
    scale_y = out_h / in_h
    sigma = float(sigma) if float(sigma) > 0 else 1.0
    rad = int(np.ceil(sigma * 3.0))
    denom = 2.0 * sigma * sigma
    for i, point in enumerate(landmarks):
        cx = float(point[0]) * scale_x
        cy = float(point[1]) * scale_y
        if not (0.0 <= cx < out_w and 0.0 <= cy < out_h):
            continue
        x0 = max(int(np.floor(cx)) - rad, 0)
        x1 = min(int(np.floor(cx)) + rad + 1, out_w)
        y0 = max(int(np.floor(cy)) - rad, 0)
        y1 = min(int(np.floor(cy)) + rad + 1, out_h)
        xs = np.arange(x0, x1, dtype=np.float32)
        ys = np.arange(y0, y1, dtype=np.float32)
        g = np.exp(-((xs - np.float32(cx)) ** 2)[None, :] / denom
                   - ((ys - np.float32(cy)) ** 2)[:, None] / denom)
        heatmaps[i, y0:y1, x0:x1] = g
    return heatmaps


class HeatmapDataset:
    def __init__(self, dataset_folder_path, mode, image_size, output_size=(256, 256), sigma=HEATMAP_SIGMA):
        import cv2
        import torch
        from torch.utils.data import Dataset
        import albumentations as A
        from albumentations.pytorch import ToTensorV2

        if mode.upper() not in ("TRAIN", "VALID", "TEST"):
            raise ValueError("mode could only be TRAIN, VALID or TEST")
        self.mode = mode.lower()
        self.image_size = image_size
        self.output_size = output_size
        self.sigma = sigma
        self._cv2 = cv2
        self._torch = torch

        if self.mode == "train":
            self.transform = A.Compose([
                A.Resize(height=self.image_size[0], width=self.image_size[1]),
                A.RandomBrightnessContrast(brightness_limit=0.2, contrast_limit=0.2, p=0.7),
                A.GaussNoise(p=0.5),
                A.Affine(scale=(0.9, 1.1), translate_percent=(-0.05, 0.05), rotate=(-10, 10), p=0.7),
                A.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
                ToTensorV2(),
            ], keypoint_params=A.KeypointParams(format="xy", remove_invisible=False))
        else:
            self.transform = A.Compose([
                A.Resize(height=self.image_size[0], width=self.image_size[1]),
                A.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
                ToTensorV2(),
            ], keypoint_params=A.KeypointParams(format="xy", remove_invisible=False))

        self.images_root_path = os.path.join(dataset_folder_path, self.mode, "Cephalograms")
        labels_root = os.path.join(dataset_folder_path, self.mode, "Annotations")
        self.senior_annotations_root = os.path.join(
            labels_root, "Cephalometric Landmarks", "Senior Orthodontists")
        self.junior_annotations_root = os.path.join(
            labels_root, "Cephalometric Landmarks", "Junior Orthodontists")
        self.images_list = os.listdir(self.images_root_path)
        self._dataset_cls = Dataset

    def __getitem__(self, index):
        image_file_name = self.images_list[index]
        label_file_name = image_file_name.split(".")[0] + ".json"
        image = self._get_image(image_file_name)
        landmarks = self._get_landmarks(label_file_name)
        transformed = self.transform(image=image, keypoints=landmarks)
        image = transformed["image"]
        landmarks = transformed["keypoints"]
        heatmaps = render_heatmaps(landmarks, self.output_size, self.image_size, self.sigma)
        t = self._torch
        return image, t.tensor(heatmaps, dtype=t.float32), t.tensor(landmarks, dtype=t.float32)

    def _get_image(self, file_name):
        file_path = os.path.join(self.images_root_path, file_name)
        image = self._cv2.imread(file_path)
        image = self._cv2.cvtColor(image, self._cv2.COLOR_BGR2RGB)
        return np.array(image, dtype=np.uint8)

    def _get_landmarks(self, file_name):
        with open(os.path.join(self.senior_annotations_root, file_name), mode="r") as fh:
            senior = [[lm["value"]["x"], lm["value"]["y"]] for lm in json.load(fh)["landmarks"]]
        with open(os.path.join(self.junior_annotations_root, file_name), mode="r") as fh:
            junior = [[lm["value"]["x"], lm["value"]["y"]] for lm in json.load(fh)["landmarks"]]
        landmarks = np.zeros((NUM_LANDMARKS, 2), dtype=np.float32)
        for i in range(NUM_LANDMARKS):
            # Plain mean. ceil() shoved every label up-right by up to 1 px.
            landmarks[i, 0] = 0.5 * (float(junior[i][0]) + float(senior[i][0]))
            landmarks[i, 1] = 0.5 * (float(junior[i][1]) + float(senior[i][1]))
        return landmarks

    def __len__(self):
        return len(self.images_list)
