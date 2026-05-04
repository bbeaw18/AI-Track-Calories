// FrontEnd/src/components/VoiceMicButton.js
import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, ActivityIndicator, Alert } from "react-native";
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  setAudioModeAsync,
  AudioModule,
} from "expo-audio";
import { BASE_URL as API_BASE } from "../services/api";

/** ---------- Utilities (Thai normalize + clean STT) ---------- */
const THAI_DIAC = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g;
const THAI_NUM = { "๐":"0","๑":"1","๒":"2","๓":"3","๔":"4","๕":"5","๖":"6","๗":"7","๘":"8","๙":"9" };
const toArabic = (s) => String(s).replace(/[๐-๙]/g, ch => THAI_NUM[ch] ?? ch);

function collapseRepeats(s = "") {
  const w = String(s).trim().split(/\s+/);
  const out = [];
  for (let i = 0; i < w.length; i++) if (i === 0 || w[i] !== w[i - 1]) out.push(w[i]);
  return out.join(" ");
}
function fixCommonThai(s = "") {
  return String(s)
    .replace(/เกียววาน/g, "เขียวหวาน")
    .replace(/เขียวหวาย|เขียวหวัง|ขียวหวาน/g, "เขียวหวาน")
    .replace(/ผัดซิอิ้ว|ผัดสิอิ้ว|ผัดซีอิ้ว/g, "ผัดซีอิ๊ว")
    .replace(/กระเพรา|กระเพราะ|กะเพราะ|กระเผรา|กะเผรา/g, "กะเพรา")
    .trim();
}
async function fetchJSON(url, opts = {}, { timeoutMs = 25000, retries = 1 } = {}) {
  let lastErr;
  for (let a = 0; a <= retries; a++) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(url, { ...opts, signal: controller.signal });
      clearTimeout(id);
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error(`HTTP ${r.status}: ${txt || r.statusText}`);
      }
      return await r.json();
    } catch (e) {
      clearTimeout(id);
      lastErr = e;
      if (a < retries) continue;
    }
  }
  throw lastErr;
}

/**
 * VoiceMicButton
 * props:
 * - onResult({ text, items, usedQuery, didYouMean }): callback เมื่อได้ข้อความ/ผลค้นหา
 * - autoSearch (default: true): ให้ยิง /foods/search อัตโนมัติหลังถอดเสียง
 * - style: ปรับสไตล์ปุ่ม
 * - labelIdle / labelRec: เปลี่ยนข้อความบนปุ่ม
 */
export default function VoiceMicButton({
  onResult,
  autoSearch = true,
  style,
  labelIdle = "กดเพื่อพูด",
  labelRec = "หยุดพูด & ถอดเสียง",
}) {
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recState = useAudioRecorderState(recorder);
  const fileUriRef = useRef(null);

  // init audio
  useEffect(() => {
    (async () => {
      try {
        const status = await AudioModule.getRecordingPermissionsAsync();
        if (!status.granted) {
          const ask = await AudioModule.requestRecordingPermissionsAsync();
          if (!ask.granted) {
            setErrMsg("ไม่ได้รับสิทธิ์ไมโครโฟน");
            Alert.alert("ต้องการสิทธิ์ไมโครโฟน", "กรุณาอนุญาตการใช้งานไมโครโฟน");
            return;
          }
        }
        await setAudioModeAsync({
          playsInSilentMode: true,
          allowsRecording: true,
          staysActiveInBackground: false,
        });
      } catch (e) {
        setErrMsg(String(e?.message || e));
      }
    })();
  }, []);

  const startRecording = async () => {
    try {
      setErrMsg("");
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (e) {
      setErrMsg(String(e?.message || e));
      Alert.alert("เริ่มอัดเสียงไม่สำเร็จ", String(e?.message || e));
    }
  };

  const stopRecording = async () => {
    try {
      await recorder.stop();
      const uri = recorder.uri || null;
      fileUriRef.current = uri;
      return uri;
    } catch (e) {
      setErrMsg(String(e?.message || e));
      Alert.alert("หยุดอัดเสียงไม่สำเร็จ", String(e?.message || e));
      return null;
    }
  };

  const transcribe = async (uri) => {
    setLoading(true);
    try {
      if (!uri) throw new Error("ไม่มีไฟล์เสียง");
      const fd = new FormData();
      fd.append("audio", { uri, name: "audio.m4a", type: "audio/m4a" });
      const resp = await fetch(`${API_BASE}/stt/local`, { method: "POST", body: fd });
      const raw = await resp.text();
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${raw}`);
      const j = JSON.parse(raw);
      const text = (j?.text || "").trim();
      return { text, sttItems: Array.isArray(j?.items) ? j.items : [] };
    } finally {
      setLoading(false);
    }
  };

  const search = async (q) => {
    const cleaned = collapseRepeats(fixCommonThai(q)).slice(0, 60);
    const j = await fetchJSON(`${API_BASE}/foods/search?q=${encodeURIComponent(cleaned)}`, {}, { timeoutMs: 20000, retries: 1 });
    // ถ้าผลลัพธ์ว่างแต่มี did you mean ลองอีกรอบ
    if ((!j.items || j.items.length === 0) && j.didYouMean?.text) {
      const j2 = await fetchJSON(`${API_BASE}/foods/search?q=${encodeURIComponent(j.didYouMean.text)}`, {}, { timeoutMs: 20000, retries: 0 });
      return {
        items: Array.isArray(j2.items) && j2.items.length ? j2.items : (j.items || []),
        usedQuery: j2.usedQuery || j.didYouMean.text || j.usedQuery,
        didYouMean: j.didYouMean || null,
      };
    }
    return {
      items: j.items || [],
      usedQuery: j.usedQuery || cleaned,
      didYouMean: j.didYouMean || null,
    };
  };

  const handlePress = async () => {
    if (loading) return;
    if (!recState.isRecording) {
      const perm = await AudioModule.getRecordingPermissionsAsync();
      if (!perm.granted) {
        const ask = await AudioModule.requestRecordingPermissionsAsync();
        if (!ask.granted) {
          setErrMsg("ไม่ได้รับสิทธิ์ไมโครโฟน");
          Alert.alert("ต้องการสิทธิ์ไมโครโฟน", "กรุณาอนุญาตการใช้งานไมโครโฟน");
          return;
        }
      }
      await startRecording();
    } else {
      const uri = await stopRecording();
      if (!uri) return;
      try {
        const { text, sttItems } = await transcribe(uri);
        let items = sttItems;
        let usedQuery = text;
        let didYouMean = null;

        if (autoSearch) {
          const r = await search(text);
          items = r.items;
          usedQuery = r.usedQuery;
          didYouMean = r.didYouMean;
        }

        onResult?.({ text, items, usedQuery, didYouMean });
      } catch (e) {
        setErrMsg(String(e?.message || e));
        Alert.alert("ถอดเสียง/ค้นหาไม่สำเร็จ", String(e?.message || e));
      }
    }
  };

  return (
    <View style={{ gap: 6 }}>
      <Pressable
        onPress={handlePress}
        style={[
          {
            backgroundColor: recState.isRecording ? "#ef4444" : "#22c55e",
            padding: 14,
            borderRadius: 12,
            alignItems: "center",
          },
          style,
        ]}
      >
        <Text style={{ color: "white", fontWeight: "700" }}>
          {recState.isRecording ? labelRec : labelIdle}
        </Text>
      </Pressable>
      {loading ? <ActivityIndicator /> : null}
      {errMsg ? <Text style={{ color: "red" }}>{errMsg}</Text> : null}
    </View>
  );
}
