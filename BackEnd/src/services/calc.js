// src/services/calc.js
export function normalizeSex(sexRaw) {
  const s = String(sexRaw || '').toLowerCase();
  if (['male', 'm'].includes(s)) return 'male';
  if (['female', 'f'].includes(s)) return 'female';
  return null;
}

export function activityFromExercise(exerciseRaw, overrideAF) {
  if (overrideAF != null) {
    const n = Number(overrideAF);
    if (Number.isFinite(n) && n >= 1.1 && n <= 2.2) return n;
  }
  const e = String(exerciseRaw || '').toLowerCase();
  if (['sedentary', 'none'].includes(e)) return 1.2;
  if (['low', 'light', 'น้อย'].includes(e)) return 1.375;
  if (['medium', 'moderate', 'ปานกลาง'].includes(e)) return 1.55;
  if (['high', 'heavy', 'หนัก'].includes(e)) return 1.725;
  if (['very', 'athlete'].includes(e)) return 1.9;
  return 1.55;
}

export function calcBMR({ sex, weightKg, heightCm, ageYears }) {
  if (!sex || !Number.isFinite(weightKg) || !Number.isFinite(heightCm) || !Number.isFinite(ageYears)) {
    throw new Error('missing-required: sex, weight, height, age');
  }
  // Mifflin–St Jeor
  return 10 * weightKg + 6.25 * heightCm - 5 * ageYears + (sex === 'male' ? 5 : -161);
}

export function calcTDEE({ bmr, activityFactor }) {
  return bmr * activityFactor;
}

export function adjustForGoal(tdee, goal) {
  const g = String(goal || '').toLowerCase();
  if (['lose', 'cut', 'ลด'].includes(g))  return tdee - 300;
  if (['gain', 'bulk', 'เพิ่ม'].includes(g)) return tdee + 300;
  return tdee; // maintain
}

export function calcMacros({ targetCalories, weightKg, proteinPerKg = 1.0, fatPerKg = 1.0 }) {
  const proteinG = proteinPerKg * weightKg; // โปรตีน 0.8–1.2 g/kg → default 1.0
  const fatG     = fatPerKg * weightKg;     // ไขมัน 1 g/kg
  const proteinKcal = proteinG * 4;
  const fatKcal     = fatG * 9;
  const carbsKcal   = Math.max(0, targetCalories - (proteinKcal + fatKcal));
  const carbsG      = carbsKcal / 4;
  return { proteinG, fatG, carbsG, proteinPerKg, fatPerKg };
}

// src/services/calc.js
export function normalizeSex(sexRaw) {
  const s = String(sexRaw || '').toLowerCase();
  if (['male', 'm'].includes(s)) return 'male';
  if (['female', 'f'].includes(s)) return 'female';
  return null;
}

export function activityFromExercise(exerciseRaw, overrideAF) {
  if (overrideAF != null) {
    const n = Number(overrideAF);
    if (Number.isFinite(n) && n >= 1.1 && n <= 2.2) return n;
  }
  const e = String(exerciseRaw || '').toLowerCase();
  if (['sedentary', 'none'].includes(e)) return 1.2;
  if (['low', 'light', 'น้อย'].includes(e)) return 1.375;
  if (['medium', 'moderate', 'ปานกลาง'].includes(e)) return 1.55;
  if (['high', 'heavy', 'หนัก'].includes(e)) return 1.725;
  if (['very', 'athlete'].includes(e)) return 1.9;
  return 1.55;
}

export function calcBMR({ sex, weightKg, heightCm, ageYears }) {
  if (!sex || !Number.isFinite(weightKg) || !Number.isFinite(heightCm) || !Number.isFinite(ageYears)) {
    throw new Error('missing-required: sex, weight, height, age');
  }
  // Mifflin–St Jeor
  return 10 * weightKg + 6.25 * heightCm - 5 * ageYears + (sex === 'male' ? 5 : -161);
}

export function calcTDEE({ bmr, activityFactor }) {
  return bmr * activityFactor;
}

export function adjustForGoal(tdee, goal) {
  const g = String(goal || '').toLowerCase();
  if (['lose', 'cut', 'ลด'].includes(g))  return tdee - 300;
  if (['gain', 'bulk', 'เพิ่ม'].includes(g)) return tdee + 300;
  return tdee; // maintain
}

export function calcMacros({ targetCalories, weightKg, proteinPerKg = 1.0, fatPerKg = 1.0 }) {
  const proteinG = proteinPerKg * weightKg; // โปรตีน 0.8–1.2 g/kg → default 1.0
  const fatG     = fatPerKg * weightKg;     // ไขมัน 1 g/kg
  const proteinKcal = proteinG * 4;
  const fatKcal     = fatG * 9;
  const carbsKcal   = Math.max(0, targetCalories - (proteinKcal + fatKcal));
  const carbsG      = carbsKcal / 4;
  return { proteinG, fatG, carbsG, proteinPerKg, fatPerKg };
}
