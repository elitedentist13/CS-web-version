"""Banana ResNet-50 UNet heatmap (29 Aariz channels).

Cloned from HyunchanAn/Dental_001 `src/landmark/model.py` for Banana
sidecar development. Encoder is ImageNet ResNet-50; decoder is a 4-block
ConvTranspose UNet with skip connections. Output is 29 heatmaps at 256×256
for a 512×512 input. Edit this file — it is the Banana copy, not a remote
import of Dental_001.
"""
from __future__ import annotations

import torch
import torch.nn as nn
from torchvision import models

try:
    from .config import NUM_LANDMARKS
except ImportError:
    from config import NUM_LANDMARKS


def _resnet50(pretrained=False):
    try:
        weights = models.ResNet50_Weights.DEFAULT if pretrained else None
        return models.resnet50(weights=weights)
    except TypeError:
        return models.resnet50(pretrained=bool(pretrained))


class UNetHeatmapModel(nn.Module):
    """Dental_001 ResNet-50 UNet heatmap head (29 Aariz channels)."""

    def __init__(self, num_landmarks=NUM_LANDMARKS, pretrained=False):
        super().__init__()
        resnet = _resnet50(pretrained)
        self.enc0 = nn.Sequential(resnet.conv1, resnet.bn1, resnet.relu)
        self.maxpool = resnet.maxpool
        self.layer1 = resnet.layer1
        self.layer2 = resnet.layer2
        self.layer3 = resnet.layer3
        self.layer4 = resnet.layer4
        self.up_conv4 = self._upsample_block(2048, 1024)
        self.up_conv3 = self._upsample_block(1024 + 1024, 512)
        self.up_conv2 = self._upsample_block(512 + 512, 256)
        self.up_conv1 = self._upsample_block(256 + 256, 128)
        self.final_layer = nn.Conv2d(128, num_landmarks, kernel_size=1)
        if pretrained:
            self.freeze_backbone()

    def _upsample_block(self, in_channels, out_channels):
        return nn.Sequential(
            nn.ConvTranspose2d(in_channels, out_channels, kernel_size=4, stride=2, padding=1),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
        )

    def forward(self, x):
        x0 = self.enc0(x)
        x1 = self.layer1(self.maxpool(x0))
        x2 = self.layer2(x1)
        x3 = self.layer3(x2)
        x4 = self.layer4(x3)
        u4 = self.up_conv4(x4)
        u3 = self.up_conv3(torch.cat([u4, x3], 1))
        u2 = self.up_conv2(torch.cat([u3, x2], 1))
        u1 = self.up_conv1(torch.cat([u2, x1], 1))
        return self.final_layer(u1)

    def freeze_backbone(self):
        for layer in (self.enc0, self.layer1, self.layer2, self.layer3, self.layer4):
            for param in layer.parameters():
                param.requires_grad = False

    def unfreeze_backbone(self):
        for layer in (self.enc0, self.layer1, self.layer2, self.layer3, self.layer4):
            for param in layer.parameters():
                param.requires_grad = True


class HeatmapModel(nn.Module):
    """Older Dental_001 upsampling head (for leftover checkpoints)."""

    def __init__(self, num_landmarks=NUM_LANDMARKS, pretrained=False):
        super().__init__()
        resnet = _resnet50(pretrained)
        self.backbone = nn.Sequential(*list(resnet.children())[:-2])
        self.upsampling_head = nn.Sequential(
            nn.ConvTranspose2d(2048, 256, kernel_size=4, stride=2, padding=1),
            nn.BatchNorm2d(256),
            nn.ReLU(inplace=True),
            nn.ConvTranspose2d(256, 128, kernel_size=4, stride=2, padding=1),
            nn.BatchNorm2d(128),
            nn.ReLU(inplace=True),
            nn.ConvTranspose2d(128, 64, kernel_size=4, stride=2, padding=1),
            nn.BatchNorm2d(64),
            nn.ReLU(inplace=True),
        )
        self.final_layer = nn.Conv2d(64, num_landmarks, kernel_size=1)

    def forward(self, x):
        return self.final_layer(self.upsampling_head(self.backbone(x)))
