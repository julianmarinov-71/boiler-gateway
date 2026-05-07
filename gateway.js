require('dotenv').config({ path: '/home/julian/.env' });
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccount.json');

// Firebase инициализация
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DB_URL
});

const db = admin.database();

// Конфигурация
const MAX_FLOW_KGH = parseFloat(process.env.MAX_FLOW_KGH) || 7000;
const PRESSURE_BAR = parseFloat(process.env.PRESSURE_BAR) || 8;
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS) || 5000;

// Енталпия на наситена пара при различни налягания (kJ/kg)
function getEnthalpy(bar) {
  const table = {1:2769, 2:2799, 4:2800, 6:2785, 8:2769, 10:2778, 12:2784, 14:2788, 16:2794};
  return table[Math.round(bar)] || 2769;
}

// Симулация на Modbus данни (замени с реален код след свързване на 7110M)
function readFromDevice() {
  // TODO: Замени с реално четене от 7110M RS485/WiFi конвертор
  const flow_kgh = Math.random() * MAX_FLOW_KGH * 0.8;
  const temperature = 170 + Math.random() * 10;
  const pressure = PRESSURE_BAR + Math.random() * 0.5;
  return { flow_kgh, temperature, pressure };
}

async function writeToFirebase(data) {
  const { flow_kgh, temperature, pressure } = data;

  // Изчисления
  const flow_th = flow_kgh / 1000;
  const enthalpy = getEnthalpy(pressure);
  const power_kw = (flow_kgh / 3600) * enthalpy;

  const payload = {
    flow_kgh: +flow_kgh.toFixed(1),
    flow_th: +flow_th.toFixed(3),
    power_kw: +power_kw.toFixed(1),
    temperature: +temperature.toFixed(1),
    pressure: +pressure.toFixed(2),
    timestamp: Date.now()
  };

  try {
    // Запис в /latest (презапис)
    await db.ref('latest').set(payload);

    // Запис в /readings (история)
    await db.ref('readings').push(payload);

    console.log(`[${new Date().toLocaleTimeString()}] Flow: ${payload.flow_th} t/h | Power: ${payload.power_kw} kW | Temp: ${payload.temperature}°C`);
  } catch (err) {
    console.error('Firebase грешка:', err.message);
  }
}

// Главен цикъл
console.log('🚀 Boiler Gateway стартиран');
console.log(`📊 Интервал: ${INTERVAL_MS}ms | Max дебит: ${MAX_FLOW_KGH} kg/h | Налягане: ${PRESSURE_BAR} bar`);

setInterval(async () => {
  const data = readFromDevice();
  await writeToFirebase(data);
}, INTERVAL_MS);

// Изтрива записи по-стари от 60 дни
async function cleanOldData() {
  const cutoff = Date.now() - (60 * 24 * 60 * 60 * 1000);
  const snap = await db.ref('readings')
    .orderByChild('timestamp')
    .endAt(cutoff)
    .limitToLast(500)
    .once('value');
  
  const updates = {};
  snap.forEach(child => { updates[child.key] = null; });
  
  if (Object.keys(updates).length > 0) {
    await db.ref('readings').update(updates);
    console.log(`Изтрити ${Object.keys(updates).length} записа по-стари от 60 дни`);
  }
}

// Веднъж на ден
setInterval(cleanOldData, 24 * 60 * 60 * 1000);
