import csv
import sys
from pathlib import Path

import torch
from torchvision import models, transforms
from torchvision.models import EfficientNet_B0_Weights
from PIL import Image

ROOT = Path("D:/thai-food-ai")
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"✅ Using device: {device}")


class_map_candidates = [
    ROOT / "class_map_thfood50_min.csv",  
    ROOT / "class_map_thfood50.csv",     
]
class_map_file = next((p for p in class_map_candidates if p.exists()), None)
if class_map_file is None:
    sys.exit("❌ ไม่พบ class map (ลองหา class_map_thfood50_min.csv หรือ class_map_thfood50.csv)")

thai_names, eng_names = [], []
with open(class_map_file, "r", encoding="utf-8") as f:
    r = csv.DictReader(f)
    headers = [h.lower() for h in r.fieldnames]

    
    has_th_thai   = ("ชื่อไทย" in r.fieldnames) or ("thai" in headers) or ("th" in headers)
    has_en_english= ("ชื่ออังกฤษ" in r.fieldnames) or ("english" in headers) or ("en" in headers)

    
    def key_for_th(row):
        for k in ["ชื่อภาษาไทย", "thai", "th"]:
            if k in row: return row[k]
        return None

    def key_for_en(row):
        for k in ["ชื่อภาษาอังกฤษ", "english", "en"]:
            if k in row: return row[k]
        return None

    for row in r:
        th = key_for_th(row)
        en = key_for_en(row)
        
        if th is None and "th" in row: th = row["th"]
        if en is None and "en" in row: en = row["en"]
        if th is None: th = en if en is not None else "N/A"
        if en is None: en = th if th is not None else "N/A"

        thai_names.append(th.strip())
        eng_names.append(en.strip())

num_classes = len(thai_names)
print(f"📄 Loaded class map: {class_map_file.name} ({num_classes} classes)")


model_candidates = [

    ROOT / "best_model_thfood50.pth",   
]
model_file = next((p for p in model_candidates if p.exists()), None)
if model_file is None:
    sys.exit("❌ ไม่พบไฟล์โมเดล (ลองหา best_model_thfood50.pth)")
print(f"🧠 Using model: {model_file.name}")


weights = EfficientNet_B0_Weights.IMAGENET1K_V1
model = models.efficientnet_b0(weights=weights)
model.classifier[1] = torch.nn.Linear(model.classifier[1].in_features, num_classes)
state = torch.load(model_file, map_location=device)
model.load_state_dict(state, strict=True)
model.to(device).eval()


mean=[0.485,0.456,0.406]; std=[0.229,0.224,0.225]
preprocess = transforms.Compose([
    transforms.Resize((224,224)),
    transforms.ToTensor(),
    transforms.Normalize(mean,std),
])


img_path = ROOT / "Pic-test" / "ผัดฉ่า.jpg"
if not img_path.exists():
    sys.exit(f"❌ ไม่พบรูปทดสอบ: {img_path}")
img = Image.open(img_path).convert("RGB")
x = preprocess(img).unsqueeze(0).to(device)

with torch.no_grad():
    probs = torch.softmax(model(x), dim=1)[0]

topk = min(5, num_classes)
top_p, top_i = torch.topk(probs, k=topk)

print("\n🔍 Top-{}:".format(topk))
for p, i in zip(top_p.tolist(), top_i.tolist()):
    print(f"- {thai_names[i]} / {eng_names[i]}  ({p:.2f})")

best_i = top_i[0].item()
print(f"\n🍛 Predict: {thai_names[best_i]} / {eng_names[best_i]}  {top_p[0].item():.2f}")
