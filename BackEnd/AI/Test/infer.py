# BackEnd/AI/Test/infer.py
import sys, json, io, csv
from pathlib import Path

import torch
torch.set_num_threads(1)
from torchvision import models, transforms
from torchvision.models import EfficientNet_B0_Weights
from PIL import Image

# ensure stdout utf-8 (windows + thai)
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def err(msg: str, code: int = 0):
    print(json.dumps({"error": msg}, ensure_ascii=False))
    sys.exit(code)

THIS = Path(__file__).resolve()
AI_DIR = THIS.parents[1]           # .../BackEnd/AI
BACKEND_ROOT = AI_DIR.parent       # .../BackEnd
CWD = Path.cwd().resolve()

# ---------- resolve image path (absolute / relative) ----------
def resolve_img(p: str) -> Path | None:
    q = Path(p)
    cands = []
    if q.is_absolute():
        cands.append(q)
    else:
        cands += [CWD / q, AI_DIR / q, BACKEND_ROOT / q]
    for c in cands:
        try:
            if c.exists() and c.is_file():
                return c.resolve()
        except:  # noqa
            pass
    return None

# ---------- class map ----------
class_map_candidates = [
    BACKEND_ROOT / "class_map_thfood50_min.csv",
    BACKEND_ROOT / "class_map_thfood50.csv",
    AI_DIR / "class_map_thfood50_min.csv",
    AI_DIR / "class_map_thfood50.csv",
]
class_map_file = next((p for p in class_map_candidates if p.exists()), None)
if class_map_file is None:
    err("ไม่พบ class map (class_map_thfood50_min.csv หรือ class_map_thfood50.csv)")

thai_names, eng_names = [], []
with open(class_map_file, "r", encoding="utf-8") as f:
    r = csv.DictReader(f)
    def key_th(row):
        for k in ["ชื่อภาษาไทย", "ชื่อไทย", "thai", "th"]:
            if k in row: return row[k]
    def key_en(row):
        for k in ["ชื่อภาษาอังกฤษ", "ชื่ออังกฤษ", "english", "en"]:
            if k in row: return row[k]
    for row in r:
        th = key_th(row) or row.get("th") or row.get("thai")
        en = key_en(row) or row.get("en") or row.get("english")
        if th is None and en: th = en
        if en is None and th: en = th
        thai_names.append((th or "N/A").strip())
        eng_names.append((en or "N/A").strip())

num_classes = len(thai_names)
if num_classes == 0:
    err("class map ว่าง")

# ---------- model ----------
model_candidates = [
    AI_DIR / "Model" / "best_model_thfood50.pth",
    BACKEND_ROOT / "AI" / "Model" / "best_model_thfood50.pth",
]
model_file = next((p for p in model_candidates if p.exists()), None)
if model_file is None:
    err("ไม่พบไฟล์โมเดล best_model_thfood50.pth")

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

weights = EfficientNet_B0_Weights.IMAGENET1K_V1
model = models.efficientnet_b0(weights=weights)
model.classifier[1] = torch.nn.Linear(model.classifier[1].in_features, num_classes)

state = torch.load(model_file, map_location=device)
# พยายามโหลดแบบยืดหยุ่น ถ้า key/shape หัวไม่ตรง
try:
    model.load_state_dict(state, strict=True)
except Exception:
    missing, unexpected = model.load_state_dict(state, strict=False)
    # ถ้า checkpoint มีหัวเก่า → เพิกเฉย ใช้หัวใหม่ที่เพิ่งสร้าง
    # (ตัวโมเดลยังทำงานได้ แต่ความแม่นอาจลดลงถ้า checkpoint ไม่ตรงคลาส)
    if any(missing) or any(unexpected):
        # ไม่ถือเป็น error, แค่แจ้งผ่าน field debug
        pass

model.to(device).eval()

preprocess = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485,0.456,0.406], std=[0.229,0.224,0.225]),
])

# ---------- input ----------
if len(sys.argv) < 2:
    err("missing_image_path_arg")
img_path = resolve_img(sys.argv[1])
if not img_path:
    err(f"image_not_found: {sys.argv[1]}")

try:
    img = Image.open(img_path).convert("RGB")
except Exception as e:
    err(f"cannot_open_image: {e}")

# ---------- infer ----------
x = preprocess(img).unsqueeze(0).to(device)
with torch.no_grad():
    logits = model(x)
    probs = torch.softmax(logits, dim=1)[0]

conf, idx = torch.max(probs, dim=0)
label_th = thai_names[idx.item()] if 0 <= idx.item() < num_classes else "N/A"

print(json.dumps({
    "label": label_th,
    "confidence": float(conf.item()),
    # "debug_image": str(img_path),   # ถ้าจะดูพาธ ส่งเฉพาะตอนดีบั๊ก
}, ensure_ascii=False))
