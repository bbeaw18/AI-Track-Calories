import multer from 'multer';
// โฟลเดอร์เก็บรูป
const uploadsDir = path.join(backendRoot, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const ext = path.extname(file.originalname || '');
    cb(null, `meal_${ts}${ext || '.jpg'}`);
  },
});
const upload = multer({ storage });
