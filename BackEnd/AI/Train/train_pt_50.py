# ===================== Train EfficientNet-B0 on THFOOD-50 =====================
import os, contextlib
from pathlib import Path

import torch
from torch import nn, optim
from torch.utils.data import DataLoader
from torchvision import models, transforms, datasets
from torchvision.models import EfficientNet_B0_Weights
from PIL import ImageFile
from tqdm import tqdm

ImageFile.LOAD_TRUNCATED_IMAGES = True

# ----------------- Config -----------------
ROOT = Path("D:/thai-food-ai")
DATASET = "THFOOD-50"
train_dir = ROOT / DATASET / "train"
val_dir   = ROOT / DATASET / "val"

IMG_SIZE = 224
BATCH_TRAIN = 16
BATCH_VAL   = 32
EPOCHS_S1   = 10
EPOCHS_S2   = 60
USE_AMP     = True
LABEL_SMOOTH = 0.05
WEIGHT_DECAY = 2e-4
NUM_CLASSES = 50

BEST_MODEL_NAME = "best_model_thfood50.pth"
CLASS_MAP_CSV   = "class_map_thfood50.csv"
CKPT_NAME       = "checkpoint_thfood50.pth"

torch.backends.cudnn.benchmark = True   # ใช้ cudnn.benchmark เพื่อให้เลือก kernel ที่เร็วที่สุดอัตโนมัติ
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"✅ Using device: {device}")

# ----------------- AMP helper -----------------
try:
    from torch.amp import GradScaler, autocast
    _AMP_IS_NEW = True
except Exception:
    from torch.cuda.amp import GradScaler, autocast
    _AMP_IS_NEW = False

def make_scaler():
    if not (USE_AMP and device.type == "cuda"):
        return None
    try:
        return GradScaler(device_type="cuda")  # AMP GradScaler: ป้องกันปัญหา gradient underflow เมื่อใช้ FP16
    except TypeError:
        return GradScaler()

def amp_cast(enabled: bool):
    if not enabled:
        return contextlib.nullcontext()
    if _AMP_IS_NEW:
        try:
            return autocast(device_type="cuda", enabled=True)  # AMP autocast: ใช้ precision แบบผสม (FP16/FP32) เพื่อให้ train เร็วขึ้น
        except TypeError:
            return autocast(enabled=True)
    else:
        return autocast(enabled=True)

# ----------------- Transforms -----------------
mean=[0.485,0.456,0.406]; std=[0.229,0.224,0.225]

train_tf = transforms.Compose([
    transforms.Resize((IMG_SIZE, IMG_SIZE)),
    transforms.RandomHorizontalFlip(),       # Data augmentation: พลิกภาพแนวนอน
    transforms.RandomVerticalFlip(p=0.1),    # Data augmentation: พลิกภาพแนวตั้งเล็กน้อย
    transforms.RandomRotation(30),           # Data augmentation: หมุนภาพ
    transforms.ColorJitter(brightness=0.3),  # Data augmentation: ปรับความสว่าง
    transforms.RandomResizedCrop(IMG_SIZE, scale=(0.8, 1.0)),  # Data augmentation: ครอปแบบสุ่ม
    transforms.ToTensor(),
    transforms.Normalize(mean, std),         # Normalize ด้วยค่า mean/std ของ ImageNet
])
val_tf = transforms.Compose([
    transforms.Resize((IMG_SIZE, IMG_SIZE)),
    transforms.ToTensor(),
    transforms.Normalize(mean, std),
])

# ----------------- Dataset / Loader -----------------
train_ds = datasets.ImageFolder(train_dir, transform=train_tf)
val_ds   = datasets.ImageFolder(val_dir,   transform=val_tf)

if len(train_ds.classes) != NUM_CLASSES:
    print(f"⚠️ Warning: พบ {len(train_ds.classes)} คลาสในโฟลเดอร์ (คาดว่า 50)")

train_loader = DataLoader(train_ds, batch_size=BATCH_TRAIN, shuffle=True,
                          num_workers=0, pin_memory=True, persistent_workers=False)  # ใช้ pin_memory เพื่อเร่งการ copy ไปยัง GPU
val_loader   = DataLoader(val_ds,   batch_size=BATCH_VAL,   shuffle=False,
                          num_workers=0, pin_memory=True, persistent_workers=False)

# ----------------- Model -----------------
weights = EfficientNet_B0_Weights.IMAGENET1K_V1
model = models.efficientnet_b0(weights=weights)  # EfficientNet-B0 ใช้เทคนิค: MBConv, Depthwise Separable Conv, SE Block, Swish(SiLU)

# แก้ classifier สุดท้ายให้ตรงกับจำนวนคลาสใหม่
model.classifier[1] = nn.Linear(model.classifier[1].in_features, NUM_CLASSES)  # Classifier มี Dropout ภายใน → ช่วยลด overfitting

model = model.to(device).to(memory_format=torch.channels_last)  # ใช้ memory_format=channels_last เพื่อเร่งบน Tensor Core

# ----------------- Loss / Optimizer / Scheduler -----------------
criterion = nn.CrossEntropyLoss(label_smoothing=LABEL_SMOOTH)  
# ↑ Label smoothing: กระจายความน่าจะเป็นของ target → ลดความมั่นใจเกินไปของโมเดล ป้องกัน overfitting

optimizer = optim.AdamW(model.parameters(), lr=1e-3, weight_decay=WEIGHT_DECAY)  
# ↑ AdamW: Optimizer ที่ decouple weight decay ช่วย regularization ดีกว่า Adam+L2

scaler = make_scaler()  # ใช้ AMP GradScaler (mixed precision training)

from torch.optim.lr_scheduler import ReduceLROnPlateau
scheduler = ReduceLROnPlateau(optimizer, mode="max", factor=0.5, patience=3, min_lr=1e-6)  
# ↑ ReduceLROnPlateau: ลด learning rate อัตโนมัติเมื่อ val_acc ไม่ดีขึ้น

# ----------------- Utils -----------------
def validate():
    model.eval()
    correct, total, vloss = 0, 0, 0.0
    with torch.no_grad():  # ปิด gradient → ประเมินเร็วขึ้น/ประหยัดแรม
        for x, y in val_loader:
            x = x.to(device, non_blocking=True)  # ใช้ non_blocking copy เพื่อเร่งการส่งข้อมูลไป GPU
            y = y.to(device, non_blocking=True)
            with amp_cast(scaler is not None):   # ใช้ AMP ในการ inference เช่นเดียวกับ training
                out = model(x)
                loss = criterion(out, y)
            vloss += loss.item() * x.size(0)
            pred = out.argmax(1)
            correct += (pred == y).sum().item()
            total += y.size(0)
    return correct / total, vloss / total

# ----------------- Train -----------------
if __name__ == "__main__":
    try:
        # Stage 1: Freeze backbone → ฝึกเฉพาะ classifier ก่อน (Fine-tuning step แรก)
        for p in model.features.parameters():
            p.requires_grad = False

        for ep in range(EPOCHS_S1):
            model.train()
            correct = 0
            for x, y in tqdm(train_loader, desc=f"S1 {ep+1}/{EPOCHS_S1}"):
                x = x.to(device, non_blocking=True); y = y.to(device, non_blocking=True)
                optimizer.zero_grad(set_to_none=True)  # set_to_none=True ช่วยลด memory fragmentation
                with amp_cast(scaler is not None):     # AMP mixed precision
                    out = model(x); loss = criterion(out, y)
                if scaler:
                    scaler.scale(loss).backward(); scaler.step(optimizer); scaler.update()
                else:
                    loss.backward(); optimizer.step()
                correct += (out.argmax(1) == y).sum().item()

            train_acc = correct / len(train_ds)
            val_acc, vloss = validate()
            scheduler.step(val_acc)  # ReduceLROnPlateau ปรับ LR
            print(f"[S1 {ep+1}] train_acc={train_acc:.4f} | val_acc={val_acc:.4f} | val_loss={vloss:.4f}")

        # Stage 2: Unfreeze ~70% ของ backbone → Fine-tune ลึกขึ้น
        feat = list(model.features)
        freeze_until = int(len(feat) * 0.3)
        for i, layer in enumerate(feat):
            for p in layer.parameters():
                p.requires_grad = i >= freeze_until

        # ใช้ AdamW อีกครั้ง แต่ลด learning rate ลงเพื่อ fine-tune อย่างระมัดระวัง
        optimizer = optim.AdamW(filter(lambda p: p.requires_grad, model.parameters()),
                                lr=1e-4, weight_decay=WEIGHT_DECAY)

        best, patience, wait = 0.0, 10, 0  # ใช้ Early stopping ด้วย patience=10
        for ep in range(EPOCHS_S2):
            model.train()
            correct = 0
            for x, y in tqdm(train_loader, desc=f"S2 {ep+1}/{EPOCHS_S2}"):
                x = x.to(device, non_blocking=True); y = y.to(device, non_blocking=True)
                optimizer.zero_grad(set_to_none=True)
                with amp_cast(scaler is not None):
                    out = model(x); loss = criterion(out, y)
                if scaler:
                    scaler.scale(loss).backward(); scaler.step(optimizer); scaler.update()
                else:
                    loss.backward(); optimizer.step()
                correct += (out.argmax(1) == y).sum().item()

            train_acc = correct / len(train_ds)
            val_acc, vloss = validate()
            scheduler.step(val_acc)  # ReduceLROnPlateau ปรับ LR อัตโนมัติ
            print(f"[S2 {ep+1}] train_acc={train_acc:.4f} | val_acc={val_acc:.4f} | val_loss={vloss:.4f}")

            if val_acc > best:
                best = val_acc; wait = 0
                torch.save(model.state_dict(), ROOT / BEST_MODEL_NAME)  # Save best model
                with open(ROOT / CLASS_MAP_CSV, "w", encoding="utf-8") as f:
                    for idx, name in enumerate(train_ds.classes):
                        f.write(f"{idx},{name},{name}\n")
                print(f"💾 saved: {BEST_MODEL_NAME}, {CLASS_MAP_CSV}")
            else:
                wait += 1
                if wait >= patience:
                    print("⏹️ early stop"); break  # Early stopping: หยุด train ถ้าไม่ดีขึ้น

        print(f"✅ DONE. Best val_acc={best:.4f}")

    except KeyboardInterrupt:
        torch.save(model.state_dict(), ROOT / CKPT_NAME)  # Save checkpoint กรณีหยุดเอง
        print(f"💾 Saved {CKPT_NAME} (interrupted)")
        raise
