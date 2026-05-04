// FrontEnd/src/UploadFood.js
import React, { useEffect, useState } from 'react';
import {
  View, Text, Image, TextInput, StyleSheet, Alert,
  ActivityIndicator, TouchableOpacity, ScrollView, Modal,
  FlatList, Pressable, KeyboardAvoidingView, Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import { api, getNutritionByNameLegacy, getNutritionByName, setAuthToken, addMeal, upsertNfsFood } from './services/api';
import { VoiceFoodButton } from './VoiceFoodSearch';

/* ---------- MealRecord DB ---------- */
let _dbPromise = null;
function getDb() {
  if (!_dbPromise) _dbPromise = SQLite.openDatabaseAsync('MealRecord.sqlite');
  return _dbPromise;
}
function n(v){
  if (v===null||v===undefined) return null;
  if (typeof v==='number') return isFinite(v)?v:null;
  const cleaned = String(v).trim().replace(/[^0-9.\-]/g,'');
  if (!cleaned) return null;
  const num = Number(cleaned);
  return isFinite(num)?num:null;
}

/** runAsync ทีละคำสั่ง (กัน NPE) */
async function ensureSchema(){
  const db = await getDb();
  await db.runAsync(`
    CREATE TABLE IF NOT EXISTS meal_record(
      MealRecordID INTEGER PRIMARY KEY AUTOINCREMENT,
      UserID INTEGER NOT NULL,
      FoodID INTEGER NOT NULL,
      FoodImage TEXT,
      FoodQuantity REAL,
      MealType TEXT,
      Date TEXT NOT NULL,
      Time TEXT NOT NULL,
      EnergyKcal REAL,
      ProteinG REAL,
      FatG REAL,
      CarbohydrateG REAL,
      PortionMultiplier REAL DEFAULT 1,
      FoodName TEXT
    );
  `);
  const cols = await db.getAllAsync(`PRAGMA table_info('meal_record')`);
  const have = new Set((cols||[]).map(c=>c.name));
  if (!have.has('PortionMultiplier')) { try{ await db.runAsync(`ALTER TABLE meal_record ADD COLUMN PortionMultiplier REAL DEFAULT 1;`);}catch{} }
  if (!have.has('FoodName'))        { try{ await db.runAsync(`ALTER TABLE meal_record ADD COLUMN FoodName TEXT;`);}catch{} }
}
async function resolveCurrentUserId(){
  const raw = await AsyncStorage.getItem('userId');
  if (raw){
    const id = Number(raw);
    if (Number.isFinite(id) && id>0) return id;
  }
  throw new Error('no_user_id_in_storage');
}
function guessMimeFromName(name=''){
  const nn = name.toLowerCase();
  if (nn.endsWith('.png')) return 'image/png';
  if (nn.endsWith('.webp')) return 'image/webp';
  if (nn.endsWith('.heic')) return 'image/heic';
  if (nn.endsWith('.heif')) return 'image/heif';
  if (nn.endsWith('.jpg')||nn.endsWith('.jpeg')) return 'image/jpeg';
  return 'image/jpeg';
}
async function ensureFileUri(uri, preferredName=`upload_${Date.now()}.jpg`){
  if(!uri) return null;
  if(uri.startsWith('file://')) return uri;
  try{
    const target = FileSystem.cacheDirectory + preferredName;
    await FileSystem.copyAsync({from:uri, to:target});
    return target;
  }catch{
    try{
      const target = FileSystem.cacheDirectory + preferredName;
      const base64 = await FileSystem.readAsStringAsync(uri,{encoding:FileSystem.EncodingType.Base64});
      await FileSystem.writeAsStringAsync(target, base64, {encoding:FileSystem.EncodingType.Base64});
      return target;
    }catch{ return uri; }
  }
}
function todayThailandISO(){
  const now=new Date();
  const utc=now.getTime()+now.getTimezoneOffset()*60000;
  const th=new Date(utc+7*60*60*1000);
  const y=th.getFullYear();
  const m=String(th.getMonth()+1).padStart(2,'0');
  const d=String(th.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}
function timeThailandHHMMSS(){
  const now=new Date();
  const utc=now.getTime()+now.getTimezoneOffset()*60000;
  const th=new Date(utc+7*60*60*1000);
  const hh=String(th.getHours()).padStart(2,'0');
  const mm=String(th.getMinutes()).padStart(2,'0');
  const ss=String(th.getSeconds()).padStart(2,'0');
  return `${hh}:${mm}:${ss}`;
}

/* ---------- Utils from candidates ---------- */
const nameFrom = it => (it?.NameTH ?? it?.name_th ?? it?.name ?? it?.NameEng ?? it?.name_en ?? '').toString().trim();
const kcalFrom = it => n(it?.EnergyKcal ?? it?.calories ?? it?.kcal ?? it?.energy_kcal ?? it?.energyKcal ?? it?.energy);
const pFrom    = it => n(it?.ProteinG ?? it?.protein ?? it?.protein_g ?? it?.ProtG ?? it?.Protein ?? it?.proteinGram);
const fFrom    = it => n(it?.FatG ?? it?.fat ?? it?.fat_g ?? it?.Fat ?? it?.LipidG ?? it?.fatGram);
const cFrom    = it => n(it?.CarbohydrateG ?? it?.carb ?? it?.carbs ?? it?.carb_g ?? it?.carbohydrate ?? it?.CarbG ?? it?.carbGram);
const serveFrom= it => n(it?.ServingSizeGram ?? it?.ServingSizeG ?? it?.ServingSize ?? it?.serving_size_g ?? it?.serving ?? it?.PortionGram ?? it?.portion_g ?? it?.portion);
const scoreFrom= it => typeof it?.score==='number'?it.score:null;

/* ---------- NutritionFromScratch (local debug) ---------- */
let _scratchPromise = null;
function getScratchDb(){ if(!_scratchPromise) _scratchPromise = SQLite.openDatabaseAsync('NutritionFromScratch.sqlite'); return _scratchPromise; }
let _ensuringScratch = null;
async function ensureSchemaScratch(){
  if (_ensuringScratch) return _ensuringScratch;
  _ensuringScratch = (async ()=>{
    const db = await getScratchDb();
    await db.runAsync(`
      CREATE TABLE IF NOT EXISTS foods(
        FoodID INTEGER PRIMARY KEY AUTOINCREMENT,
        Name TEXT,
        NormalizedKey TEXT,
        DefaultQuantityG REAL,
        EnergyKcal REAL,
        ProteinG REAL,
        FatG REAL,
        CarbohydrateG REAL,
        Source TEXT,
        CreatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
        UpdatedAt TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
  })().finally(()=>{ _ensuringScratch = null; });
  return _ensuringScratch;
}
async function listLastFoods(limit=20){
  await ensureSchemaScratch();
  const db = await getScratchDb();
  return db.getAllAsync(
    `SELECT FoodID, Name, DefaultQuantityG, EnergyKcal, ProteinG, FatG, CarbohydrateG, Source, UpdatedAt
     FROM foods ORDER BY FoodID DESC LIMIT ?`, [limit]
  );
}

/* ---------- Component ---------- */
export default function UploadFood({ navigation, route }) {
  const mealType = route?.params?.mealType || 'other';
  const [imageUri, setImageUri]   = useState(null);
  const [fileMeta, setFileMeta]   = useState(null);
  const [predName, setPredName]   = useState('');
  const [conf, setConf]           = useState(null);
  const [kcal, setKcal]           = useState('');
  const [protein, setProtein]     = useState('');
  const [fat, setFat]             = useState('');
  const [carb, setCarb]           = useState('');
  const [quantity, setQuantity]   = useState('');
  const [loading, setLoading]     = useState(false);

  const [heard, setHeard]         = useState('');
  const [candidates, setCandidates]= useState([]);

  // DEBUG modal
  const [showDebug, setShowDebug]  = useState(false);
  const [debugRows, setDebugRows]  = useState([]);

  useEffect(()=>{ (async()=>{
    try{
      const token = await AsyncStorage.getItem('accessToken');
      if(!token){
        Alert.alert('ต้องล็อกอิน','กรุณาเข้าสู่ระบบอีกครั้ง',[{text:'ไปหน้า Login', onPress:()=>navigation.navigate('Login')}]);
        throw new Error('no_token_in_storage');
      }
      setAuthToken(token);
    } finally {
      await ensureSchema();
      await ensureSchemaScratch();
    }
  })(); },[]);

  async function pickImage(){
    const res = await ImagePicker.launchImageLibraryAsync({quality:0.9});
    if(!res.canceled){
      const uri = res.assets[0].uri;
      const name = uri.split('/').pop() || `gallery_${Date.now()}.jpg`;
      setImageUri(uri); setFileMeta({name, type: guessMimeFromName(name)});
    }
  }
  async function takePhoto(){
    const res = await ImagePicker.launchCameraAsync({quality:0.9});
    if(!res.canceled){
      const uri = res.assets[0].uri;
      const name = uri.split('/').pop() || `camera_${Date.now()}.jpg`;
      setImageUri(uri); setFileMeta({name, type: guessMimeFromName(name)});
    }
  }
  async function pickFromDrive(){
    try{
      const res = await DocumentPicker.getDocumentAsync({type:['image/*'], multiple:false, copyToCacheDirectory:true});
      if(res.canceled) return;
      const asset = Array.isArray(res.assets)?res.assets[0]:res;
      const rawUri = asset.fileCopyUri || asset.uri;
      const name = asset.name || `drive_${Date.now()}.jpg`;
      const type = asset.mimeType || guessMimeFromName(name);
      setImageUri(rawUri); setFileMeta({name, type});
    }catch(e){ Alert.alert('Drive Error', e.message); }
  }
  async function appendImageToFormData(fd){
    if(!imageUri) return;
    const name = fileMeta?.name || imageUri.split('/').pop() || `photo_${Date.now()}.jpg`;
    const type = fileMeta?.type || guessMimeFromName(name);
    const safeUri = await ensureFileUri(imageUri, name);
    fd.append('image', {uri:safeUri, name, type: type || 'image/jpeg'});
  }

  /* ===== วิเคราะห์ด้วย AI → ใช้ NutritionDB ผ่าน /foods/by-name-legacy ===== */
  async function onPredict(){
    if(!imageUri) return Alert.alert('เลือกรูปก่อน');
    let fd;
    try{
      const token = await AsyncStorage.getItem('accessToken');
      if(!token) throw new Error('no_token_in_storage');
      setAuthToken(token);
      setLoading(true);

      fd = new FormData();
      await appendImageToFormData(fd);

      const { data } = await api.post('/ai/predict', fd, {
        headers:{'Content-Type':'multipart/form-data'},
        transformRequest:d=>d, maxBodyLength:Infinity, maxContentLength:Infinity,
      });

      setPredName(data.label || '');
      setConf(data.confidence ?? null);

      if (data.label){
        const q0 = String(data.label||'').trim().replace(/\s+/g,' ');
        try{
          let nut = await getNutritionByNameLegacy(q0);
          if(!nut){
            const q1 = q0.replace(/[\u{1F300}-\u{1FAFF}]/gu,'').replace(/\(.*?\)|\[.*?\]/g,'').trim();
            if(q1 && q1!==q0) nut = await getNutritionByNameLegacy(q1);
          }
          if(nut){
            setKcal(n(nut.kcal)?.toString()??'');
            setProtein(n(nut.protein)?.toString()??'');
            setFat(n(nut.fat)?.toString()??'');
            setCarb(n(nut.carb)?.toString()??'');
            if(n(nut?.serving)) setQuantity(String(n(nut.serving)));
          }
        }catch(e){
          const status=e?.response?.status; const code=e?.response?.data?.error;
          if(!(status===404 || code==='not_found')) console.log('[nutrition lookup error]', status, code, e?.message);
        }
      }
    }catch(e){
      const msg = e?.response?.data?.error || e?.message || 'Network Error';
      if(msg==='Network Error' && fd){
        try{
          const res = await fetch(`${api.defaults.baseURL}/ai/predict`, {method:'POST', headers:{Authorization:api.defaults.headers.common.Authorization}, body:fd});
          const txt = await res.text();
          if(!res.ok) throw new Error(txt || `HTTP ${res.status}`);
          const j = JSON.parse(txt);
          setPredName(j.label||'');
          setConf(j.confidence??null);
          return;
        }catch(e2){ return Alert.alert('Predict Error', String(e2?.message||msg)); }
      }
      Alert.alert('Predict Error', String(msg));
    }finally{ setLoading(false); }
  }

  async function chooseCandidate(it){
    try{
      const name = nameFrom(it);
      if(!name) return;
      let kcal0=kcalFrom(it), p0=pFrom(it), f0=fFrom(it), c0=cFrom(it), serve=serveFrom(it);

      if (kcal0==null || p0==null || f0==null || c0==null || serve==null){
        try{
          const nut = await getNutritionByName(name);
          if(nut){
            if(kcal0==null && nut.kcal!=null) kcal0=n(nut.kcal);
            if(p0==null && nut.protein!=null) p0=n(nut.protein);
            if(f0==null && nut.fat!=null) f0=n(nut.fat);
            if(c0==null && nut.carb!=null) c0=n(nut.carb);
            if(serve==null && nut.serving!=null) serve=n(nut.serving);
          }
        }catch{}
      }

      setPredName(name);
      if(kcal0!=null) setKcal(String(kcal0));
      if(p0!=null) setProtein(String(p0));
      if(f0!=null) setFat(String(f0));
      if(c0!=null) setCarb(String(c0));
      if(serve!=null) setQuantity(String(serve));
    }catch(e){ Alert.alert('เลือกเมนูล้มเหลว', e?.message||'unknown'); }
  }

  /* ===== ปุ่มบันทึก ===== */
  async function onSave(){
    if(!predName) return Alert.alert('ยังไม่ทราบชื่อเมนู');

    const qtyG = n(quantity);
    const kcalNum = n(kcal), pNum=n(protein), fNum=n(fat), cNum=n(carb);
    if(qtyG==null) return Alert.alert('กรอกปริมาณ (g) ด้วยนะ');

    try{
      setLoading(true);
      await ensureSchema();
      await ensureSchemaScratch();

      // 1) อัปเดต NutritionFromScratch (SERVER)
      const up = await upsertNfsFood({
        name: predName,
        qtyG: qtyG,
        kcal: kcalNum,
        protein: pNum,
        fat: fNum,
        carb: cNum,
      });
      const foodId = up?.foodId;
      if (!foodId) throw new Error('upsert_nfs_failed');

      // 2) บันทึกลง MealRecord (local)
      const db = await getDb();
      const userId = await resolveCurrentUserId();
      const dateStr = todayThailandISO();
      const timeStr = timeThailandHHMMSS();

      await db.runAsync(
        `INSERT INTO meal_record
          (UserID, FoodID, FoodImage, FoodQuantity, MealType, Date, Time,
           EnergyKcal, ProteinG, FatG, CarbohydrateG, PortionMultiplier, FoodName)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [ userId, foodId, imageUri||null, qtyG??0, mealType, dateStr, timeStr,
          kcalNum??0, pNum??0, fNum??0, cNum??0, 1, predName||null ]
      );

      // (optional) sync ไป backend /meals
      try{
        const token = await AsyncStorage.getItem('accessToken');
        if(token){
          await addMeal({ date:dateStr, mealType, name:predName, quantity:qtyG??0, unit:'g',
            kcal:kcalNum, protein:pNum, fat:fNum, carb:cNum, foodId });
        }
      }catch(e){ console.log('[UploadFood] addMeal API error:', e?.response?.data || e?.message); }

      Alert.alert('บันทึกแล้ว','เพิ่มเมนูลงไปในแฟ้มอาหารสำเร็จ');
      navigation.goBack();
    }catch(e){
      Alert.alert('Save Error', e?.message||'DB Error');
    }finally{ setLoading(false); }
  }

  async function openDebug(){
    try{
      const rows = await listLastFoods(20);
      setDebugRows(rows||[]);
      setShowDebug(true);
    }catch(e){
      Alert.alert('DEBUG Error', e?.message||'อ่าน DB ไม่ได้');
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{flex:1}}>
      <View style={styles.header}>
        <View style={styles.headLeft}>
          <View style={styles.headIconWrap}>
            <Ionicons name="nutrition-outline" size={18} color="#1E40AF" />
          </View>
          <View>
            <Text style={styles.headTitle}>บันทึกอาหาร</Text>
            <Text style={styles.headSub}>มื้อ: <Text style={styles.mealChip}>{mealType}</Text></Text>
          </View>
        </View>

        <TouchableOpacity style={styles.headSoftBtn} onPress={openDebug}>
          <Ionicons name="bug-outline" size={18} color="#334155" />
        </TouchableOpacity>
      </View>

      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.scroll}>
          {loading && (
            <View style={styles.overlay}>
              <ActivityIndicator size="large" />
              <Text style={{color:'#fff', marginTop:8}}>กำลังประมวลผล...</Text>
            </View>
          )}

          <VoiceFoodButton
            style={styles.voiceBtn}
            onResult={({text, items})=>{
              setHeard(text||'');
              const sorted=[...(items||[])].sort((a,b)=>(scoreFrom(b)??-1)-(scoreFrom(a)??-1));
              setCandidates(sorted.slice(0,2));
              setPredName(''); setKcal(''); setProtein(''); setFat(''); setCarb(''); setQuantity('');
            }}
          />
          {heard ? <Text style={styles.heardText}>ได้ยินว่า: <Text style={{fontWeight:'700'}}>{heard}</Text></Text> : null}

          {candidates?.length ? (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Ionicons name="sparkles-outline" size={18} color="#111827" />
                <Text style={styles.cardTitle}>ตัวเลือกที่ใกล้เคียง</Text>
              </View>
              {candidates.map((it, idx)=>{
                const name=nameFrom(it)||'(ไม่มีชื่อ)';
                const en=it?.NameEng||it?.name_en||null;
                const sc=scoreFrom(it); const pct=sc!=null?Math.round(sc*100):null;
                const kcal0=kcalFrom(it), p0=pFrom(it), f0=fFrom(it), c0=cFrom(it);
                return (
                  <Pressable key={String(it?.id ?? it?.FoodID ?? name+idx)} onPress={()=>chooseCandidate(it)} style={styles.candidateBox}>
                    <Text style={styles.candidateName}>{idx+1}. {name}</Text>
                    {en ? <Text style={styles.candidateEn}>{en}</Text> : null}
                    <View style={{marginTop:4}}>
                      {pct!=null ? <Text style={styles.confText}>ความมั่นใจ ~ {pct}%</Text> : null}
                      {(kcal0!=null||p0!=null||f0!=null||c0!=null) && (
                        <Text style={styles.candidateNutri}>
                          {kcal0!=null?`${kcal0} kcal`:'- kcal'} · โปรตีน {p0??'-'}g · ไขมัน {f0??'-'}g · คาร์บ {c0??'-'}g
                        </Text>
                      )}
                    </View>
                    <Text style={styles.chooseHint}>แตะเพื่อเลือกเมนูนี้</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="image-outline" size={18} color="#111827" />
              <Text style={styles.cardTitle}>รูปภาพอาหาร</Text>
            </View>

            {!imageUri ? (
              <View style={styles.placeholder}>
                <Ionicons name="fast-food-outline" size={56} color="#B0BEC5" />
                <Text style={styles.placeholderText}>ยังไม่มีรูป</Text>
                <View style={styles.rowButtons}>
                  <TouchableOpacity style={styles.primaryBtn} onPress={takePhoto}>
                    <Ionicons name="camera" size={18} color="#fff" />
                    <Text style={styles.primaryBtnText}>ถ่ายรูป</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.secondaryBtn} onPress={pickImage}>
                    <Ionicons name="image" size={18} color="#2563EB" />
                    <Text style={styles.secondaryBtnText}>แกลเลอรี</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.softBtn} onPress={pickFromDrive}>
                    <Ionicons name="cloud-upload-outline" size={20} color="#334155" />
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <>
                <Image source={{uri:imageUri}} style={styles.image}/>
                <View style={styles.rowBetween}>
                  <TouchableOpacity style={styles.analyzeBtn} onPress={onPredict}>
                    <Ionicons name="sparkles" size={18} color="#fff" />
                    <Text style={styles.analyzeText}>วิเคราะห์ด้วย AI</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.softBtn} onPress={()=>setImageUri(null)}>
                    <Ionicons name="trash-outline" size={20} color="#D32F2F" />
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="leaf-outline" size={18} color="#111827" />
              <Text style={styles.cardTitle}>กรอก/แก้ไขโภชนาการ</Text>
            </View>

            <View style={styles.badgeRow}>
              <View style={styles.badge}>
                <Ionicons name="pricetag-outline" size={14} color="#4338CA" />
                <Text style={styles.badgeText}>{predName || 'ยังไม่ได้ตั้งชื่อเมนู'}</Text>
              </View>
              {conf!=null && (
                <View style={[styles.badge, { backgroundColor:'#EEF2FF', borderColor:'#C7D2FE' }]}>
                  <Ionicons name="shield-checkmark" size={14} color="#3730A3" />
                  <Text style={[styles.badgeText, { color:'#3730A3' }]}>
                    เชื่อมั่น {(conf*100).toFixed(1)}%
                  </Text>
                </View>
              )}
            </View>



        

            <Text style={styles.label}>เมนู</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="pricetag-outline" size={18} color="#9CA3AF" style={{marginRight:8}} />
              <TextInput style={styles.inputBare} value={predName} onChangeText={setPredName} placeholder="เช่น หมู หรือ ข้าวผัด" placeholderTextColor="#9CA3AF"/>
            </View>

            <Text style={styles.label}>ปริมาณ (g)</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="scale-outline" size={18} color="#9CA3AF" style={{marginRight:8}} />
              <TextInput style={styles.inputBare} keyboardType="numeric" value={quantity} onChangeText={setQuantity} placeholder="เช่น 300" placeholderTextColor="#9CA3AF"/>
              <Text style={styles.suffix}>g</Text>
            </View>

            <Text style={styles.label}>สารอาหารต่อปริมาณที่กรอก</Text>
            <View style={styles.grid}>
              <View style={styles.gridBox}><Text style={styles.gridLabel}>Kcal</Text><TextInput style={styles.gridInput} keyboardType="numeric" value={kcal} onChangeText={setKcal}/></View>
              <View style={styles.gridBox}><Text style={styles.gridLabel}>Protein (g)</Text><TextInput style={styles.gridInput} keyboardType="numeric" value={protein} onChangeText={setProtein}/></View>
              <View style={styles.gridBox}><Text style={styles.gridLabel}>Fat (g)</Text><TextInput style={styles.gridInput} keyboardType="numeric" value={fat} onChangeText={setFat}/></View>
              <View style={styles.gridBox}><Text style={styles.gridLabel}>Carb (g)</Text><TextInput style={styles.gridInput} keyboardType="numeric" value={carb} onChangeText={setCarb}/></View>
            </View>
          </View>
        </ScrollView>

        <TouchableOpacity style={[styles.fab, loading && { opacity: 0.7 }]} onPress={onSave} disabled={loading}>
          <Ionicons name="save-outline" size={22} color="#fff" />
          <Text style={styles.fabText}>บันทึก ({mealType} - {predName || '...'})</Text>
        </TouchableOpacity>

        {/* DEBUG Modal */}
        <Modal visible={showDebug} transparent animationType="slide" onRequestClose={()=>setShowDebug(false)}>
          <View style={{flex:1, backgroundColor:'rgba(0,0,0,0.4)', justifyContent:'flex-end'}}>
            <View style={{backgroundColor:'#fff', padding:16, borderTopLeftRadius:16, borderTopRightRadius:16, maxHeight:'70%'}}>
              <View style={{flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginBottom:8}}>
                <Text style={{fontWeight:'800', fontSize:16}}>รายการใน NutritionFromScratch (ล่าสุด - local)</Text>
                <TouchableOpacity onPress={()=>setShowDebug(false)}><Ionicons name="close" size={22} /></TouchableOpacity>
              </View>
              <FlatList
                data={debugRows}
                keyExtractor={(it)=>String(it.FoodID)}
                ItemSeparatorComponent={()=> <View style={{height:1, backgroundColor:'#E5E7EB'}}/>}
                renderItem={({item})=>(
                  <View style={{paddingVertical:8}}>
                    <Text style={{fontWeight:'700'}}>#{item.FoodID} {item.Name}</Text>
                    <Text style={{color:'#475569'}}>Kcal {item.EnergyKcal??0} · P{item.ProteinG??0} F{item.FatG??0} C{item.CarbohydrateG??0}</Text>
                    <Text style={{color:'#94a3b8', fontSize:12}}>Source: {item.Source} · {item.UpdatedAt}</Text>
                  </View>
                )}
                ListEmptyComponent={<Text style={{paddingVertical:12}}>ยังไม่มีข้อมูล</Text>}
              />
            </View>
          </View>
        </Modal>
      </View>
    </KeyboardAvoidingView>
  );
}

/* ---------- styles ---------- */
const styles = StyleSheet.create({
  screen:{ flex:1, backgroundColor:'#F7F7FB' },
  scroll:{ padding:16, paddingBottom:140 },
  overlay:{ ...StyleSheet.absoluteFillObject, backgroundColor:'rgba(0,0,0,0.65)', alignItems:'center', justifyContent:'center', zIndex:10 },

  header:{
    backgroundColor:'#0F172A',
    paddingTop: Platform.OS === 'ios' ? 52 : 24,
    paddingBottom: 16,
    paddingHorizontal: 16,
    flexDirection:'row',
    alignItems:'center',
    justifyContent:'space-between'
  },
  headLeft:{ flexDirection:'row', alignItems:'center', gap:10 },
  headIconWrap:{ width:38, height:38, borderRadius:10, backgroundColor:'#E0EAFF', borderWidth:1, borderColor:'#BFDBFE', alignItems:'center', justifyContent:'center' },
  headTitle:{ color:'#fff', fontSize:18, fontWeight:'800' },
  headSub:{ color:'#CBD5E1', fontSize:12, marginTop:2 },
  mealChip:{ color:'#93C5FD', fontWeight:'800' },
  headSoftBtn:{ backgroundColor:'#E5E7EB', paddingHorizontal:10, paddingVertical:8, borderRadius:10, borderWidth:1, borderColor:'#CBD5E1' },

  tipCard:{ flexDirection:'row', alignItems:'center', gap:8, backgroundColor:'#EFF6FF', borderColor:'#DBEAFE', borderWidth:1, padding:12, borderRadius:12, marginBottom:12 },
  tipText:{ color:'#1D4ED8', fontSize:13, flex:1 },

  voiceBtn:{ marginBottom:10 },
  heardText:{ color:'#475569', marginBottom:8 },

  card:{ backgroundColor:'#fff', borderRadius:16, padding:16, marginBottom:16, shadowColor:'#0F172A', shadowOffset:{width:0,height:6}, shadowOpacity:0.06, shadowRadius:12, elevation:3 },
  cardHeader:{ flexDirection:'row', alignItems:'center', marginBottom:8 },
  cardTitle:{ marginLeft:8, fontSize:16, fontWeight:'800', color:'#111827' },

  placeholder:{ alignItems:'center', justifyContent:'center', height:210, borderRadius:12, borderWidth:2, borderStyle:'dashed', borderColor:'#CBD5E1', backgroundColor:'#F8FAFC' },
  placeholderText:{ color:'#64748B', marginTop:8, marginBottom:12, fontWeight:'600' },
  rowButtons:{ flexDirection:'row', gap:10, marginTop:6 },

  primaryBtn:{ backgroundColor:'#2563EB', flexDirection:'row', alignItems:'center', paddingHorizontal:14, paddingVertical:10, borderRadius:10 },
  primaryBtnText:{ color:'#fff', marginLeft:8, fontWeight:'700' },
  secondaryBtn:{ backgroundColor:'#EEF2FF', flexDirection:'row', alignItems:'center', paddingHorizontal:14, paddingVertical:10, borderRadius:10, borderWidth:1, borderColor:'#C7D2FE' },
  secondaryBtnText:{ color:'#2563EB', marginLeft:8, fontWeight:'700' },
  softBtn:{ height:44, width:44, borderRadius:10, backgroundColor:'#F8FAFC', alignItems:'center', justifyContent:'center', borderWidth:1, borderColor:'#E5E7EB' },

  image:{ width:'100%', height:210, borderRadius:12, marginBottom:12, backgroundColor:'#F1F5F9' },
  rowBetween:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between' },

  analyzeBtn:{ backgroundColor:'#FF9500', flexDirection:'row', alignItems:'center', paddingHorizontal:14, paddingVertical:10, borderRadius:10 },
  analyzeText:{ color:'#fff', marginLeft:8, fontWeight:'700' },

  label:{ fontSize:13, color:'#6B7280', fontWeight:'700', marginTop:6, marginBottom:6 },
  inputWrap:{ flexDirection:'row', alignItems:'center', borderWidth:1, borderColor:'#E5E7EB', backgroundColor:'#fff', borderRadius:12, paddingHorizontal:12, height:48, marginBottom:8 },
  inputBare:{ flex:1, fontSize:16, color:'#111827' },
  suffix:{ marginLeft:8, color:'#6B7280', fontWeight:'700' },

  badgeRow:{ flexDirection:'row', flexWrap:'wrap', gap:8, marginTop:4 },
  badge:{ flexDirection:'row', alignItems:'center', gap:6, paddingHorizontal:10, paddingVertical:6, borderRadius:999, backgroundColor:'#F1F5F9', borderWidth:1, borderColor:'#E2E8F0' },
  badgeText:{ fontSize:12, color:'#0F172A', fontWeight:'700' },

  infoChip:{ alignSelf:'flex-start', marginTop:4, marginBottom:8, flexDirection:'row', alignItems:'center', gap:6, backgroundColor:'#EEF2FF', borderColor:'#C7D2FE', borderWidth:1, paddingHorizontal:10, paddingVertical:6, borderRadius:999 },
  infoChipText:{ fontSize:12, fontWeight:'700', color:'#3730A3' },

  grid:{ flexDirection:'row', justifyContent:'space-between', marginTop:4 },
  gridBox:{ flex:1, marginHorizontal:4, backgroundColor:'#F8FAFC', borderRadius:12, padding:10, borderWidth:1, borderColor:'#E5E7EB' },
  gridLabel:{ fontSize:12, color:'#64748B', marginBottom:6, fontWeight:'700' },
  gridInput:{ backgroundColor:'#fff', borderWidth:1, borderColor:'#E5E7EB', borderRadius:10, paddingHorizontal:10, height:44, fontSize:16, color:'#111827' },

  candidateBox:{ padding:12, borderRadius:10, borderWidth:1, borderColor:'#E5E7EB', marginBottom:8, backgroundColor:'#F8FAFC' },
  candidateName:{ fontWeight:'700' },
  candidateEn:{ opacity:0.8 },
  candidateNutri:{ color:'#475569', marginTop:2 },
  confText:{ color:'#2563EB' },
  chooseHint:{ marginTop:4, color:'#059669' },

  fab:{ position:'absolute', left:20, right:20, bottom:24, backgroundColor:'#22C55E', flexDirection:'row', alignItems:'center', justifyContent:'center', paddingVertical:14, borderRadius:18, shadowColor:'#000', shadowOffset:{width:0,height:8}, shadowOpacity:0.2, shadowRadius:16, elevation:6 },
  fabText:{ color:'#fff', fontSize:16, fontWeight:'900' },
});
