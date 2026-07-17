"""Train the chess tile classifier on the synthetic corpus.

  .tmp/venv-img2pos/bin/python tools/tile-classifier/train.py

Reads shards from .tmp/scan-corpus/, trains a small CNN, exports ONNX
(softmax baked in, input [N,1024] float 0..1, output [N,13]) to
.tmp/tile-model/tilenet.onnx.

Class order matches packages/fenshot/src/fen.ts: "1KQRBNPkqrbnp".
"""

import glob
import json
import os
import sys
import time

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

CORPUS = os.environ.get("CORPUS", ".tmp/scan-corpus")
OUT = os.environ.get("OUT", ".tmp/tile-model")
EPOCHS_ENV = int(os.environ.get("EPOCHS", "8"))
LABELS = "1KQRBNPkqrbnp"
CHAR_TO_IDX = {c: i for i, c in enumerate(LABELS)}
EPOCHS = EPOCHS_ENV
BATCH = 2048
LR = 2e-3
VAL_FRACTION = 0.05
SEED = 42


def load_corpus():
    tiles_parts, labels_parts = [], []
    shard_paths = []
    for corpus_dir in CORPUS.split(":"):
        shard_paths.extend(sorted(glob.glob(os.path.join(corpus_dir, "shard-*.bin"))))
    for bin_path in shard_paths:
        with open(bin_path, "rb") as f:
            raw = np.frombuffer(f.read(), dtype=np.uint8)
        tiles_parts.append(raw.reshape(-1, 1024))
        label_path = bin_path.replace(".bin", ".labels")
        with open(label_path) as f:
            for line in f:
                line = line.strip()
                if line:
                    labels_parts.append(np.array([CHAR_TO_IDX[c] for c in line], dtype=np.int64))
    tiles = np.concatenate(tiles_parts)
    labels = np.concatenate(labels_parts)
    assert tiles.shape[0] == labels.shape[0], f"{tiles.shape} vs {labels.shape}"
    return tiles, labels


class TileNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv1 = nn.Conv2d(1, 32, 3, padding=1)
        self.bn1 = nn.BatchNorm2d(32)
        self.conv2 = nn.Conv2d(32, 64, 3, padding=1)
        self.bn2 = nn.BatchNorm2d(64)
        self.conv3 = nn.Conv2d(64, 64, 3, padding=1)
        self.bn3 = nn.BatchNorm2d(64)
        self.fc1 = nn.Linear(64 * 4 * 4, 256)
        self.drop = nn.Dropout(0.2)
        self.fc2 = nn.Linear(256, 13)

    def forward(self, x):
        x = x.reshape(-1, 1, 32, 32)
        x = F.max_pool2d(F.relu(self.bn1(self.conv1(x))), 2)
        x = F.max_pool2d(F.relu(self.bn2(self.conv2(x))), 2)
        x = F.max_pool2d(F.relu(self.bn3(self.conv3(x))), 2)
        x = x.flatten(1)
        x = self.drop(F.relu(self.fc1(x)))
        return self.fc2(x)


class ExportNet(nn.Module):
    def __init__(self, net):
        super().__init__()
        self.net = net

    def forward(self, x):
        return F.softmax(self.net(x), dim=1)


def augment(x, gen):
    """Cheap on-device jitter on top of baked-in corpus degradations."""
    n = x.shape[0]
    gain = 1.0 + (torch.rand(n, 1, device=x.device, generator=gen) - 0.5) * 0.3
    bias = (torch.rand(n, 1, device=x.device, generator=gen) - 0.5) * 0.12
    noise = torch.randn(x.shape, device=x.device, generator=gen) * 0.015
    return (x * gain + bias + noise).clamp(0, 1)


def evaluate(model, x_val, y_val, device):
    model.eval()
    correct = 0
    per_class_correct = np.zeros(13)
    per_class_total = np.zeros(13)
    with torch.no_grad():
        for i in range(0, len(x_val), BATCH):
            xb = torch.from_numpy(x_val[i : i + BATCH]).float().div_(255).to(device)
            preds = model(xb).argmax(1).cpu().numpy()
            yb = y_val[i : i + BATCH]
            correct += (preds == yb).sum()
            for c in range(13):
                mask = yb == c
                per_class_total[c] += mask.sum()
                per_class_correct[c] += (preds[mask] == c).sum()
    acc = correct / len(y_val)
    return acc, per_class_correct, per_class_total


def main():
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"device: {device}")

    tiles, labels = load_corpus()
    n_boards = len(tiles) // 64
    print(f"corpus: {n_boards} boards, {len(tiles)} tiles")

    board_perm = np.random.permutation(n_boards)
    n_val_boards = max(1, int(n_boards * VAL_FRACTION))
    val_boards = set(board_perm[:n_val_boards].tolist())
    tile_board = np.arange(len(tiles)) // 64
    val_mask = np.isin(tile_board, list(val_boards))
    x_train, y_train = tiles[~val_mask], labels[~val_mask]
    x_val, y_val = tiles[val_mask], labels[val_mask]
    print(f"train {len(x_train)} / val {len(x_val)} tiles")

    model = TileNet().to(device)
    n_params = sum(p.numel() for p in model.parameters())
    print(f"params: {n_params}")
    opt = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=1e-4)
    steps_per_epoch = (len(x_train) + BATCH - 1) // BATCH
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=EPOCHS * steps_per_epoch)
    loss_fn = nn.CrossEntropyLoss(label_smoothing=0.05)
    gen = torch.Generator(device=device)
    gen.manual_seed(SEED)

    best_acc = 0.0
    os.makedirs(OUT, exist_ok=True)
    for epoch in range(EPOCHS):
        model.train()
        perm = np.random.permutation(len(x_train))
        t0 = time.time()
        total_loss = 0.0
        for i in range(0, len(perm), BATCH):
            idx = perm[i : i + BATCH]
            xb = torch.from_numpy(x_train[idx]).float().div_(255).to(device)
            xb = augment(xb, gen)
            yb = torch.from_numpy(y_train[idx]).to(device)
            opt.zero_grad()
            loss = loss_fn(model(xb), yb)
            loss.backward()
            opt.step()
            sched.step()
            total_loss += loss.item() * len(idx)

        acc, pcc, pct = evaluate(model, x_val, y_val, device)
        print(f"epoch {epoch + 1}/{EPOCHS} loss {total_loss / len(perm):.4f} val_acc {acc:.5f} ({time.time() - t0:.0f}s)")
        if acc > best_acc:
            best_acc = acc
            torch.save(model.state_dict(), os.path.join(OUT, "tilenet.pt"))

    print(f"best val_acc: {best_acc:.5f}")
    print("per-class accuracy (last epoch):")
    for c in range(13):
        name = LABELS[c]
        total = int(pct[c])
        acc_c = pcc[c] / pct[c] if pct[c] > 0 else 0
        print(f"  {name}: {acc_c:.5f} ({total})")

    model.load_state_dict(torch.load(os.path.join(OUT, "tilenet.pt")))
    model.eval().cpu()
    export = ExportNet(model)
    dummy = torch.zeros(64, 1024)
    torch.onnx.export(
        export,
        dummy,
        os.path.join(OUT, "tilenet.onnx"),
        input_names=["tiles"],
        output_names=["probs"],
        dynamic_axes={"tiles": {0: "n"}, "probs": {0: "n"}},
        opset_version=17,
        external_data=False,
    )
    size = os.path.getsize(os.path.join(OUT, "tilenet.onnx"))
    print(f"exported {OUT}/tilenet.onnx ({size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
