// BackEnd/src/services/calc.js
export function normalizeSex(value) {
  if (!value && value !== 0) return null;
  const v = String(value).trim().toLowerCase();
  if (['m', 'male', 'ชาย', 'ผู้ชาย'].includes(v)) return 'male';
  if (['f', 'female', 'หญิง', 'ผู้หญิง'].includes(v)) return 'female';
  return null;
}

export function activityFromExercise(exercise, override) {
  const rawNum = Number(override ?? exercise);
  const allowed = [1.2, 1.375, 1.55, 1.725, 1.9];

  if (Number.isFinite(rawNum)) {
    const fixed = Number(rawNum.toFixed(3));
    if (allowed.includes(fixed)) return fixed;

    if (rawNum >= 1.2 && rawNum <= 1.9) {
      const nearest = allowed.reduce((a, b) =>
        Math.abs(b - rawNum) < Math.abs(a - rawNum) ? b : a
      );
      return nearest;
    }
    return 1.2;
  }

  const m = String(exercise || '').trim().toLowerCase();

  const matchAny = (needles) => needles.some((k) => m.includes(k));

  if (
    matchAny([
      'sedentary', 'ไม่ออก', 'แทบไม่', 'นั่งทั้งวัน', 'เบามาก', 'พักผ่อน',
      'no exercise', 'little to no'
    ])
  ) return 1.2;

  if (
    matchAny([
      'light', 'เล็กน้อย', 'เบา', '1-3 วัน', '1–3 วัน', '1 to 3',
      'lightly active'
    ])
  ) return 1.375;

  if (
    matchAny([
      'moderate', 'ปานกลาง', '3-5 วัน', '3–5 วัน', '3 to 5', 'moderately active'
    ])
  ) return 1.55;

  if (
    matchAny([
      'heavy', 'หนัก', 'มาก', '6-7 วัน', '6–7 วัน', '6 to 7', 'very hard'
    ])
  ) return 1.725;

  if (
    matchAny([
      'very active', 'นักกีฬา', 'ทำงานหนัก', 'แรงงานกลางแจ้ง', 'athlete',
      'งานใช้แรงมาก', 'extremely active'
    ])
  ) return 1.9;

  
  return 1.2;
}

export function calcBMR({ sex, weightKg, heightCm, ageYears }) {
  const s = sex === 'female' ? -161 : 5;
  return 10 * weightKg + 6.25 * heightCm - 5 * ageYears + s; 
}

export function calcTDEE({ bmr, activityFactor }) {
  return bmr * activityFactor;
}

export function adjustForGoal(tdee, goal) {
  const g = String(goal || '').toLowerCase();
  if (['lose', 'ลด'].includes(g)) return tdee - 300;
  if (['gain', 'เพิ่ม'].includes(g)) return tdee + 300;
  return tdee; 
}

export function calcMacros({ targetCalories, weightKg, proteinPerKg = 1, fatPerKg = 1 }) {
  const proteinG = proteinPerKg * weightKg;
  const fatG = fatPerKg * weightKg;
  const remainingKcal = Math.max(0, targetCalories - (proteinG * 4 + fatG * 9));
  const carbsG = remainingKcal / 4;
  return { proteinG, fatG, carbsG };
}
export function waterExtraFromMinutesPerDay(minutesPerDay) {
  const m = Math.max(0, Number(minutesPerDay || 0));
  const extra = (m / 60) * 0.6;
  return Number(extra.toFixed(2));
}

/** ช่วงปริมาณน้ำที่ควรดื่ม (ลิตร/วัน) จากน้ำหนักและนาทีออกกำลังกายต่อวัน */
export function calcWaterRange(weightKg, minutesPerDay = 0) {
  const min = weightKg * 0.033;             // พื้นฐาน 33 ml/กก.
  const extra = (minutesPerDay / 30) * 0.2; // เพิ่ม 0.2 ลิตรต่อ 30 นาทีออกกำลังกาย
  const max = min + extra;

  return {
    min: Number(min.toFixed(2)),
    max: Number(max.toFixed(2)),
    extra: Number(extra.toFixed(2))
  };
}
