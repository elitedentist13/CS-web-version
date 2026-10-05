"""Aariz-style heatmap dataset for Banana UNet training.

Cloned from HyunchanAn/Dental_001 `src/landmark/dataset.py`. Folder layout:

  <root>/{train,valid,test}/Cephalograms/
  <root>/{train,valid,test}/Annotations/Cephalometric Landmarks/Senior Orthodontists/
  <root>/{train,valid,test}/Annotations/Cephalometric Landmarks/Junior Orthodontists/

Heatmap output defaults to 256×256 to match `UNetHeatmapModel` (Dental_001
dataset.py defaulted to 64×64). Albumentations is imported only when a
dataset is constructed so infer/verify stay lightweight.
"""
from __future__ import annotations

import json
import os

import numpy as np

try:
    from .config import NUM_LANDMARKS
except ImportError:
    from config import NUM_LANDMARKS


class HeatmapDataset:
    def __init__(self, dataset_folder_path, mode, image_size, output_size=(256, 256), sigma=2):
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
        heatmaps = self._generate_heatmaps(landmarks)
        t = self._torch
        return image, t.tensor(heatmaps, dtype=t.float32), t.tensor(landmarks, dtype=t.float32)

    def _generate_heatmaps(self, landmarks):
        heatmaps = np.zeros((NUM_LANDMARKS, self.output_size[0], self.output_size[1]), dtype=np.float32)
        scale_x = self.output_size[1] / self.image_size[1]
        scale_y = self.output_size[0] / self.image_size[0]
        for i, (x, y) in enumerate(landmarks):
            hm_x = int(x * scale_x)
            hm_y = int(y * scale_y)
            if 0 <= hm_x < self.output_size[1] and 0 <= hm_y < self.output_size[0]:
                heatmaps[i] = self._create_gaussian_heatmap(hm_x, hm_y)
        return heatmaps

    def _create_gaussian_heatmap(self, center_x, center_y):
        heatmap = np.zeros((self.output_size[0], self.output_size[1]), dtype=np.float32)
        tmp_size = self.sigma * 3
        size = 2 * tmp_size + 1
        x = np.arange(0, size, 1, np.float32)
        y = x[:, np.newaxis]
        x0 = y0 = size // 2
        g = np.exp(-((x - x0) ** 2 + (y - y0) ** 2) / (2 * self.sigma ** 2))
        left = min(center_x, tmp_size)
        right = min(self.output_size[1] - center_x, tmp_size + 1)
        top = min(center_y, tmp_size)
        bottom = min(self.output_size[0] - center_y, tmp_size + 1)
        cropped_g = g[y0 - top:y0 + bottom, x0 - left:x0 + right]
        paste_y1, paste_y2 = center_y - top, center_y + bottom
        paste_x1, paste_x2 = center_x - left, center_x + right
        heatmap[paste_y1:paste_y2, paste_x1:paste_x2] = cropped_g
        return heatmap

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
            landmarks[i, 0] = np.ceil(0.5 * (junior[i][0] + senior[i][0]))
            landmarks[i, 1] = np.ceil(0.5 * (junior[i][1] + senior[i][1]))
        return landmarks

    def __len__(self):
        return len(self.images_list)
