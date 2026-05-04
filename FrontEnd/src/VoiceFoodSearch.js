// FrontEnd/src/VoiceFoodSearch.js
import React, { useRef, useState, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  FlatList,
  Alert,
  Animated,
  Easing,
} from "react-native";
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  setAudioModeAsync,
  AudioModule,
} from "expo-audio";
import { Ionicons } from "@expo/vector-icons";
import { BASE_URL as API_BASE } from "./services/api";

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
  for (let attempt = 0; attempt <= retries; attempt++) {
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
      if (attempt < retries) continue;
    }
  }
  throw lastErr;
}

function normKeyName(s = "") {
  return String(s).normalize("NFC").replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, "").replace(/\s+/g, "").toLowerCase();
}
function getThaiName(it) {
  return it?.NameTH || it?.name_th || it?.name || "";
}
function mergeWithRich(searchItems = [], richItems = []) {
  if (!Array.isArray(searchItems)) searchItems = [];
  if (!Array.isArray(richItems)) richItems = [];
  const byId = new Map();
  const byName = new Map();
  for (const r of richItems) {
    const id = r?.id ?? r?.FoodID ?? r?.food_id;
    if (id != null) byId.set(String(id), r);
    const nk = normKeyName(getThaiName(r));
    if (nk) byName.set(nk, r);
  }
  const out = searchItems.map((s) => {
    const id = s?.id ?? s?.FoodID ?? s?.food_id;
    let match = null;
    if (id != null) match = byId.get(String(id));
    if (!match) {
      const nk = normKeyName(getThaiName(s));
      if (nk) match = byName.get(nk);
    }
    return match ? { ...s, ...match } : s;
  });
  if (out.length === 0 && richItems.length) return richItems;
  return out;
}


export function VoiceFoodButton({
  onResult,
  autoSearch = true,
  style,
  labelIdle = "แตะไมโครโฟนเพื่อพูด",
  labelRec = "กำลังบันทึก… แตะเพื่อหยุด",
  compact = false,              
  size = 72,                    
}) {
  const [loading, setLoading] = React.useState(false);
  const [errMsg, setErrMsg] = React.useState("");
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recState = useAudioRecorderState(recorder);
  const fileUriRef = React.useRef(null);

  const S = compact ? Math.min(size, 48) : size;      
  const R = S / 2;

  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (recState.isRecording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.08, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1.0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulse.stopAnimation(() => pulse.setValue(1));
    }
  }, [recState.isRecording]);

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
      const sttItems = Array.isArray(j?.items) ? j.items : [];
      return { text, sttItems };
    } finally {
      setLoading(false);
    }
  };

  const search = async (q) => {
    const cleaned = collapseRepeats(fixCommonThai(q)).slice(0, 60);
    const j = await fetchJSON(
      `${API_BASE}/foods/search?q=${encodeURIComponent(cleaned)}`,
      {},
      { timeoutMs: 20000, retries: 1 }
    );
    if ((!j.items || j.items.length === 0) && j.didYouMean?.text) {
      const j2 = await fetchJSON(
        `${API_BASE}/foods/search?q=${encodeURIComponent(j.didYouMean.text)}`,
        {},
        { timeoutMs: 20000, retries: 0 }
      );
      return {
        items: Array.isArray(j2.items) && j2.items.length ? j2.items : (j.items || []),
        usedQuery: j2.usedQuery || j.didYouMean.text || j.usedQuery,
        didYouMean: j.didYouMean || null,
      };
    }
    return { items: j.items || [], usedQuery: j.usedQuery || cleaned, didYouMean: j.didYouMean || null };
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
          items = mergeWithRich(r.items || [], sttItems || []);
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

  // UI
  const MicButton = (
    <Animated.View style={{ transform: [{ scale: pulse }] }}>
      <Pressable
        onPress={handlePress}
        android_ripple={{ color: "rgba(255,255,255,0.2)", borderless: true, radius: R }}
        style={[
          {
            height: S,
            width: S,
            borderRadius: R,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: recState.isRecording ? "#ef4444" : "#22c55e",
            shadowColor: "#000",
            shadowOpacity: 0.2,
            shadowOffset: { width: 0, height: 6 },
            shadowRadius: 12,
            elevation: 6,
            position: "relative",
          },
          style,
        ]}
      >
        <View
          style={{
            position: "absolute",
            inset: -6,
            borderRadius: R + 6,
            borderWidth: 2,
            borderColor: recState.isRecording ? "rgba(239,68,68,0.35)" : "rgba(34,197,94,0.35)",
          }}
        />
        <Ionicons name="mic" size={compact ? 20 : 30} color="#fff" />
        {recState.isRecording ? (
          <View
            style={{
              position: "absolute",
              right: 6,
              top: 6,
              height: compact ? 8 : 10,
              width: compact ? 8 : 10,
              borderRadius: 999,
              backgroundColor: "#fff",
              opacity: 0.9,
            }}
          />
        ) : null}
      </Pressable>
    </Animated.View>
  );

  if (compact) return MicButton;

  return (
    <View style={{ alignItems: "center", gap: 10 }}>
      {MicButton}
      <Text style={{ color: recState.isRecording ? "#ef4444" : "#475569", fontWeight: "700" }}>
        {recState.isRecording ? labelRec : labelIdle}
      </Text>
      {loading ? <ActivityIndicator style={{ marginTop: 2 }} /> : null}
      {errMsg ? <Text style={{ color: "red" }}>{errMsg}</Text> : null}
    </View>
  );
}

export default function VoiceFoodSearch() {
  const [loading, setLoading] = useState(false);
  const [heard, setHeard] = useState("");
  const [items, setItems] = useState([]);
  const [errMsg, setErrMsg] = useState("");
  const [didYouMean, setDidYouMean] = useState(null);
  const [usedQuery, setUsedQuery] = useState("");
  const fileUriRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/healthz`);
        const j = await r.json();
        console.log("[PING] /healthz =", j);
      } catch (e) {
        console.log("[PING] /healthz failed:", e);
      }
    })();
  }, []);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recState = useAudioRecorderState(recorder);

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
      setHeard("");
      setItems([]);
      setDidYouMean(null);
      setUsedQuery("");
      await recorder.prepareToRecordAsync();
      recorder.record();
      setTimeout(() => console.log("[rec] isRecording =", recState.isRecording), 120);
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
      const r = await fetch(`${API_BASE}/stt/local`, { method: "POST", body: fd });
      const raw = await r.text();
      console.log("[stt:fetch raw]", raw);
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${raw}`);
      const j = JSON.parse(raw);
      const text = (j?.text || "").trim();
      setHeard(text || "(ไม่มีผลลัพธ์)");
      if (Array.isArray(j?.items)) setItems(j.items);
      return text;
    } catch (e) {
      console.log("[stt:final] error:", e?.message || e);
      Alert.alert("ถอดเสียงไม่สำเร็จ", String(e?.message || e));
      return "";
    } finally {
      setLoading(false);
    }
  };

  const search = async (q) => {
    try {
      if (!q) {
        setItems([]);
        setDidYouMean(null);
        setUsedQuery("");
        return;
      }
      const cleaned = collapseRepeats(fixCommonThai(q));
      const safeQ = cleaned.slice(0, 60);
      const j = await fetchJSON(
        `${API_BASE}/foods/search?q=${encodeURIComponent(safeQ)}`,
        {},
        { timeoutMs: 20000, retries: 1 }
      );
      setItems(Array.isArray(j.items) ? j.items : []);
      setUsedQuery(j.usedQuery || safeQ);
      setDidYouMean(j.didYouMean || null);
      if ((!j.items || j.items.length === 0) && j.didYouMean?.text) {
        const j2 = await fetchJSON(
          `${API_BASE}/foods/search?q=${encodeURIComponent(j.didYouMean.text)}`,
          {},
          { timeoutMs: 20000, retries: 0 }
        );
        if (Array.isArray(j2.items) && j2.items.length) {
          setItems(j2.items);
          setUsedQuery(j2.usedQuery || j.didYouMean.text);
        }
      }
    } catch (e) {
      console.log("[search] error:", e);
      setErrMsg(String(e?.message || e));
    }
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
      if (uri) {
        const text = await transcribe(uri);
        if (text) {
          const q = collapseRepeats(fixCommonThai(text));
          if (!items?.length) {
            await search(q);
          }
        }
      }
    }
  };

  const renderHeader = () => (
    <View style={{ gap: 4, marginBottom: 6 }}>
      <Text style={{ fontWeight: "700" }}>ได้ยินว่า:</Text>
      <Text selectable>{heard || "—"}</Text>
      {usedQuery ? (
        <Text style={{ opacity: 0.8 }}>
          ใช้คำค้น: <Text style={{ fontWeight: "700" }}>{usedQuery}</Text>
        </Text>
      ) : null}
      {didYouMean?.text ? (
        <Pressable
          onPress={() => search(didYouMean.text)}
          style={{
            alignSelf: "flex-start",
            backgroundColor: "#fef3c7",
            borderColor: "#f59e0b",
            borderWidth: 1,
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 8,
            marginTop: 6,
          }}
        >
          <Text>
            หมายถึง <Text style={{ fontWeight: "700" }}>{didYouMean.text}</Text> ใช่ไหม?
          </Text>
          <Text style={{ fontSize: 12, opacity: 0.7 }}>
            ความมั่นใจ ~ {Math.round((didYouMean.confidence ?? 0) * 100)}%
          </Text>
        </Pressable>
      ) : null}
    </View>
  );

  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (recState.isRecording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.08, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1.0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulse.stopAnimation(() => pulse.setValue(1));
    }
  }, [recState.isRecording]);

  return (
    <View style={{ flex: 1, padding: 16, gap: 12 }}>
      <View style={{ alignItems: "center", marginBottom: 4 }}>
        <Animated.View style={{ transform: [{ scale: pulse }] }}>
          <Pressable
            onPress={handlePress}
            android_ripple={{ color: "rgba(255,255,255,0.2)", borderless: true, radius: 36 }}
            style={{
              height: 72,
              width: 72,
              borderRadius: 36,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: recState.isRecording ? "#ef4444" : "#22c55e",
              shadowColor: "#000",
              shadowOpacity: 0.2,
              shadowOffset: { width: 0, height: 6 },
              shadowRadius: 12,
              elevation: 6,
              position: "relative",
            }}
          >
            <View
              style={{
                position: "absolute",
                inset: -6,
                borderRadius: 42,
                borderWidth: 2,
                borderColor: recState.isRecording ? "rgba(239,68,68,0.35)" : "rgba(34,197,94,0.35)",
              }}
            />
            <Ionicons name="mic" size={30} color="#fff" />
            {recState.isRecording ? (
              <View
                style={{
                  position: "absolute",
                  right: 8,
                  top: 8,
                  height: 10,
                  width: 10,
                  borderRadius: 5,
                  backgroundColor: "#fff",
                  opacity: 0.9,
                }}
              />
            ) : null}
          </Pressable>
        </Animated.View>
        <Text
          style={{
            marginTop: 10,
            color: recState.isRecording ? "#ef4444" : "#475569",
            fontWeight: "700",
          }}
        >
          {recState.isRecording ? "กำลังบันทึก… แตะเพื่อหยุด" : "แตะไมโครโฟนเพื่อพูด"}
        </Text>
      </View>

      <Text>isRecording: {String(recState.isRecording)}</Text>
      <Text>isPrepared: {String(recState.isPrepared)}</Text>
      <Text>canRecord: {String(recState.canRecord)}</Text>
      {errMsg ? <Text style={{ color: "red" }}>{errMsg}</Text> : null}
      {loading ? <ActivityIndicator /> : null}

      {renderHeader()}

      <Text style={{ fontWeight: "700", marginTop: 4 }}>ผลการค้นหา:</Text>
      <FlatList
        data={items}
        keyExtractor={(it, idx) => String(it?.id ?? it?.FoodID ?? idx)}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        ListEmptyComponent={
          <Text style={{ opacity: 0.6, marginTop: 8 }}>
            ไม่พบรายการ ลองพูดใหม่ให้สั้น/ชัดขึ้น เช่น “หมูปิ้ง ข้าวเหนียว”
          </Text>
        }
        renderItem={({ item }) => {
          const title =
            item.name_th || item.NameTH || item.name_en || item.NameEng || item.name || "(ไม่มีชื่อ)";
          const kcal =
            typeof item.calories === "number"
              ? item.calories
              : typeof item.kcal === "number"
              ? item.kcal
              : typeof item.EnergyKcal === "number"
              ? item.EnergyKcal
              : null;
          return (
            <View style={{ padding: 12, borderRadius: 10, borderWidth: 1, borderColor: "#ddd" }}>
              <Text style={{ fontWeight: "700" }}>{title}</Text>
              {item.name_en || item.NameEng ? <Text>{item.name_en || item.NameEng}</Text> : null}
              {kcal != null ? <Text>{kcal} kcal</Text> : null}
            </View>
          );
        }}
      />
    </View>
  );
}
