// BackEnd/src/services/calc.js
export function normalizeSex(value) {
  if (!value && value !== 0) return null;
  const v = String(value).trim().toLowerCase();
  if (['m', 'male', 'ชาย', 'ผู้ชาย'].includes(v)) return 'male';
  if (['f', 'female', 'หญิง', 'ผู้หญิง'].includes(v)) return 'female';
  return null;
}

// ตัวอย่างฟังก์ชันอื่น ๆ (เผื่อถูก import ใช้งาน)
export function activityFromExercise(exercise, override) {
  const o = Number(override);
  if (o && o >= 1.2 && o <= 2.5) return o;
  const m = String(exercise || '').toLowerCase();
  if (['low', 'น้อย', 'เบา'].includes(m)) return 1.2;
  if (['medium', 'ปานกลาง'].includes(m)) return 1.55;
  if (['high', 'หนัก', 'มาก'].includes(m)) return 1.725;
  return 1.2;
}

export function calcBMR({ sex, weightKg, heightCm, ageYears }) {
  const s = sex === 'female' ? -161 : 5;
  return 10 * weightKg + 6.25 * heightCm - 5 * ageYears + s; // Mifflin–St Jeor
}

export function calcTDEE({ bmr, activityFactor }) {
  return bmr * activityFactor;
}

export function adjustForGoal(tdee, goal) {
  const g = String(goal || '').toLowerCase();
  if (['lose', 'ลด'].includes(g)) return tdee - 300;
  if (['gain', 'เพิ่ม'].includes(g)) return tdee + 300;
  return tdee; // maintain
}

export function calcMacros({ targetCalories, weightKg, proteinPerKg = 1, fatPerKg = 1 }) {
  const proteinG = proteinPerKg * weightKg;
  const fatG = fatPerKg * weightKg;
  const remainingKcal = Math.max(0, targetCalories - (proteinG * 4 + fatG * 9));
  const carbsG = remainingKcal / 4;
  return { proteinG, fatG, carbsG };
}
