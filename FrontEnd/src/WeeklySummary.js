// FrontEnd/src/WeeklySummary.js
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { useWindowDimensions } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { getMyNutrition, getMeals } from './services/api';
import { Ionicons } from '@expo/vector-icons';
import * as Progress from 'react-native-progress';
import Svg, { G, Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

const dayNamesThai = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
const monthNamesThai = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];


function nowTH() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 7 * 60 * 60 * 1000); 
}
const pad2 = (n) => String(n).padStart(2, '0');
function toISO_TH(dTH) {
  return `${dTH.getFullYear()}-${pad2(dTH.getMonth() + 1)}-${pad2(dTH.getDate())}`;
}

function getMondayOfThisWeekTH() {
  const todayTH = nowTH();
  const dow = todayTH.getDay(); 
  const monday = new Date(todayTH);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(todayTH.getDate() - ((dow + 6) % 7));
  return monday;
}

export default function WeeklySummary() {
  const [weeklySummary, setWeeklySummary] = useState(null);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [targetCalories, setTargetCalories] = useState(null);
  const { width } = useWindowDimensions();
  const isFocused = useIsFocused();
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const loadTargets = useCallback(async () => {
    try {
      const data = await getMyNutrition();
      const rawKcal = data?.energy?.target_calories_kcal;
      const kcal = Number(rawKcal);
      if (aliveRef.current && Number.isFinite(kcal) && kcal > 0) setTargetCalories(kcal);
    } catch (e) {
      console.log('[WeeklySummary] fetchTargetCalories error:', e?.message);
    }
  }, []);

  const loadWeekly = useCallback(async () => {
    try {
      setWeeklyLoading(true);

      const mondayTH = getMondayOfThisWeekTH();
      const datesTH = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(mondayTH);
        d.setDate(mondayTH.getDate() + i);
        d.setHours(0, 0, 0, 0);
        return d;
      });

      const dayResults = await Promise.all(
        datesTH.map(async (dObj, i) => {
          const dateStr = toISO_TH(dObj);
          try {
            const res = await getMeals(dateStr); 
            const items = Array.isArray(res?.items) ? res.items : [];

            const sums = items.reduce(
              (acc, it) => {
                acc.kcal += Number(it.kcal || 0);
                acc.protein += Number(it.protein || 0);
                acc.fat += Number(it.fat || 0);
                acc.carb += Number(it.carb || 0);
                return acc;
              },
              { kcal: 0, protein: 0, fat: 0, carb: 0 }
            );

            const thaiDate = `${dObj.getDate()} ${monthNamesThai[dObj.getMonth()]} ${dObj.getFullYear() + 543}`;

            return {
              date: dateStr,
              display: `${dayNamesThai[i]} ${thaiDate}`,
              kcal: Math.round(sums.kcal),
              protein: Math.round(sums.protein),
              fat: Math.round(sums.fat),
              carb: Math.round(sums.carb),
            };
          } catch (e) {
            console.log('[WeeklySummary] getMeals error for', dateStr, e?.message);
            const thaiDate = `${dObj.getDate()} ${monthNamesThai[dObj.getMonth()]} ${dObj.getFullYear() + 543}`;
            return {
              date: dateStr,
              display: `${dayNamesThai[i]} ${thaiDate}`,
              kcal: 0, protein: 0, fat: 0, carb: 0,
            };
          }
        })
      );

      const totals = dayResults.reduce(
        (acc, cur) => ({
          kcal: acc.kcal + (cur.kcal || 0),
          protein: acc.protein + (cur.protein || 0),
          fat: acc.fat + (cur.fat || 0),
          carb: acc.carb + (cur.carb || 0),
        }),
        { kcal: 0, protein: 0, fat: 0, carb: 0 }
      );

      if (aliveRef.current) setWeeklySummary({ days: dayResults, totals });
    } catch (e) {
      console.log('[WeeklySummary] fetchWeeklySummary error', e?.message || e);
      if (aliveRef.current) setWeeklySummary(null);
    } finally {
      if (aliveRef.current) setWeeklyLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWeekly();
    loadTargets();
  }, [loadWeekly, loadTargets]);

  useEffect(() => {
    if (isFocused) {
      loadWeekly();
      loadTargets();
    }
  }, [isFocused, loadWeekly, loadTargets]);

  const onRefresh = useCallback(async () => {
    try {
      setRefreshing(true);
      await Promise.all([loadWeekly(), loadTargets()]);
    } finally {
      setRefreshing(false);
    }
  }, [loadWeekly, loadTargets]);

  const { totalKcal, totalTarget, progressPct, donutSize } = useMemo(() => {
    if (!weeklySummary || !targetCalories)
      return { totalKcal: 0, totalTarget: 0, progressPct: 0, donutSize: 0 };

    const totalKcal = weeklySummary.totals.kcal || 0;
    const totalTarget = targetCalories * 7;
    const progressPct = Math.min(totalKcal / Math.max(totalTarget, 1), 1);
    const donutSize = Math.min(width - 60, 260);

    return { totalKcal, totalTarget, progressPct, donutSize };
  }, [weeklySummary, targetCalories, width]);

  const RADIUS = (donutSize || 200) * 0.42;
  const STROKE = 26;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const dashOffset = CIRCUMFERENCE * (1 - progressPct);

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#4f46e5" />
      }
    >
      <Text style={styles.title}>📅 สรุปรายสัปดาห์</Text>

      {weeklyLoading ? (
        <ActivityIndicator size="large" color="#4f46e5" style={{ marginTop: 30 }} />
      ) : weeklySummary ? (
        <View style={styles.card}>
          <View style={styles.summaryHeader}>
            <Ionicons name="flame" size={22} color="#ef4444" />
            <Text style={styles.headline}>
              รวม: {weeklySummary.totals.kcal.toLocaleString()} kcal
            </Text>
          </View>
          <Text style={styles.sub}>
            โปรตีน: {weeklySummary.totals.protein} g • ไขมัน: {weeklySummary.totals.fat} g • คาร์บ:{' '}
            {weeklySummary.totals.carb} g
          </Text>

          <View style={{ marginTop: 16 }}>
            <Text style={styles.sectionTitle}>สรุปพลังงานรวม 7 วัน</Text>

            {targetCalories ? (
              <View style={styles.donutWrap}>
                <Svg width={donutSize} height={donutSize}>
                  <Defs>
                    <LinearGradient id="gradMain" x1="0" y1="0" x2="1" y2="1">
                      <Stop offset="0" stopColor="#6366F1" />
                      <Stop offset="1" stopColor="#818CF8" />
                    </LinearGradient>
                  </Defs>
                  <G x={donutSize / 2} y={donutSize / 2} rotation={-90}>
                    <Circle cx={0} cy={0} r={RADIUS} stroke="#E5E7EB" strokeWidth={STROKE} fill="none" />
                    <Circle
                      cx={0}
                      cy={0}
                      r={RADIUS}
                      stroke="url(#gradMain)"
                      strokeWidth={STROKE}
                      strokeDasharray={CIRCUMFERENCE}
                      strokeDashoffset={dashOffset}
                      strokeLinecap="round"
                      fill="none"
                    />
                  </G>
                </Svg>

                <View style={styles.donutCenter}>
                  <Text style={styles.centerKcal}>{totalKcal.toLocaleString()}</Text>
                  <Text style={styles.centerLabel}>kcal สัปดาห์นี้</Text>
                  <Text style={styles.centerSub}>
                    {Math.round(progressPct * 100)}% ของเป้าหมาย ({totalTarget.toLocaleString()} kcal)
                  </Text>
                </View>
              </View>
            ) : (
              <Text style={styles.noDataText}>ยังไม่มีค่าเป้าหมายพลังงาน</Text>
            )}
          </View>

          <Text style={styles.sectionTitleDay}>สรุปรายวัน</Text>

          {targetCalories && (
            <Text style={styles.targetText}>
              🎯 เป้าหมายพลังงานรายวัน {targetCalories.toLocaleString()} kcal
            </Text>
          )}

          <View style={{ marginTop: 16 }}>
            {weeklySummary.days.map((d, i) => {
              const ratio = targetCalories ? Math.min(d.kcal / Math.max(targetCalories, 1), 1) : 0;
              const diff = targetCalories ? d.kcal - targetCalories : 0;
              const status =
                targetCalories == null
                  ? '—'
                  : diff > 50
                  ? `🔴 เกิน ${diff.toLocaleString()} kcal`
                  : diff < -50
                  ? `🟢 ขาด ${Math.abs(diff).toLocaleString()} kcal`
                  : `🟡 พอดีใกล้เคียง`;

              return (
                <View key={i} style={styles.dayCard}>
                  <View style={styles.dayHeader}>
                    <Text style={styles.dayDate}>{d.display}</Text>
                    <Text style={styles.dayKcal}>{d.kcal.toLocaleString()} kcal</Text>
                  </View>
                  {targetCalories !== null && (
                    <Progress.Bar
                      progress={ratio}
                      width={null}
                      height={8}
                      color={ratio >= 1 ? '#ef4444' : '#4f46e5'}
                      unfilledColor="#e5e7eb"
                      borderWidth={0}
                      style={{ marginTop: 4, borderRadius: 4 }}
                    />
                  )}
                  <Text style={styles.dayMacro}>
                    โปรตีน: {d.protein} g • ไขมัน: {d.fat} g • คาร์บ: {d.carb} g
                  </Text>
                  <Text style={styles.statusText}>{status}</Text>
                </View>
              );
            })}
          </View>
        </View>
      ) : (
        <Text style={{ color: '#777', textAlign: 'center' }}>ไม่มีข้อมูลสัปดาห์นี้</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb', padding: 16 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 12, color: '#111827' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, elevation: 3 },
  summaryHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headline: { fontSize: 18, fontWeight: '700', color: '#111' },
  sub: { color: '#6b7280', marginTop: 4 },
  sectionTitle: {
    fontSize: 16, fontWeight: '700', marginBottom: 8, color: '#111827', textAlign: 'center',
  },
  sectionTitleDay: {
    fontSize: 16, fontWeight: '700', marginTop: 16, marginBottom: 8,
    color: '#111827', borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 16,
  },
  donutWrap: { alignItems: 'center', justifyContent: 'center', position: 'relative' },
  donutCenter: { position: 'absolute', alignSelf: 'center', alignItems: 'center' },
  centerKcal: { fontSize: 24, fontWeight: '800', color: '#111827' },
  centerLabel: { fontSize: 12, color: '#6B7280', marginTop: -2 },
  centerSub: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  noDataText: { textAlign: 'center', color: '#9ca3af', marginTop: 12 },
  targetText: { textAlign: 'center', marginTop: 6, color: '#ef4444', fontWeight: '600' },
  dayCard: {
    backgroundColor: '#f9fafb', borderRadius: 8, padding: 10, marginBottom: 10,
    borderWidth: 1, borderColor: '#e5e7eb',
  },
  dayHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  dayDate: { fontWeight: '600', color: '#374151' },
  dayKcal: { fontWeight: '700', color: '#111827' },
  dayMacro: { marginTop: 6, fontSize: 13, color: '#4b5563' },
  statusText: { marginTop: 4, fontSize: 13, color: '#374151', fontStyle: 'italic' },
});
