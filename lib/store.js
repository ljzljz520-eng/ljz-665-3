/**
 * 轻量 JSON 文件数据层（带原子写入）。
 * 表：equipment（器材台账）、logs（操作记录）、files（附件）、seq（自增序列）
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const now = () => new Date().toISOString();

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

let db = null;

function load() {
  ensureDir();
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
      const bak = DB_FILE + '.broken-' + Date.now();
      fs.copyFileSync(DB_FILE, bak);
      db = null;
    }
  }
  if (!db) {
    db = { seq: { equipment: 0, log: 0, file: 0 }, equipment: [], logs: [], files: [] };
    persist();
  }
  db.seq ||= { equipment: 0, log: 0, file: 0 };
  db.equipment ||= [];
  db.logs ||= [];
  db.files ||= [];
  return db;
}

let writeTimer = null;
let writing = false;

function persist() {
  ensureDir();
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

function getDb() {
  if (!db) load();
  return db;
}

function nextId(key) {
  getDb().seq[key] = (getDb().seq[key] || 0) + 1;
  persist();
  return db.seq[key];
}

// ---------- equipment ----------
function listEquipment() {
  return getDb().equipment;
}
function findRaw(id) {
  return getDb().equipment.find((e) => e.id === Number(id)) || null;
}
function getEquipment(id) {
  const rec = findRaw(id);
  return rec ? { ...rec } : null;
}
function getEquipmentByCode(code) {
  const rec = getDb().equipment.find((e) => e.code === code);
  return rec ? { ...rec } : null;
}
function insertEquipment(rec) {
  rec.id = nextId('equipment');
  rec.createdAt = now();
  rec.updatedAt = now();
  getDb().equipment.push(rec);
  persist();
  return { ...rec };
}
function updateEquipment(id, patch) {
  const rec = findRaw(id);
  if (!rec) return null;
  Object.assign(rec, patch, { updatedAt: now() });
  persist();
  return { ...rec };
}
function deleteEquipment(id) {
  const d = getDb();
  const idx = d.equipment.findIndex((e) => e.id === Number(id));
  if (idx === -1) return false;
  d.equipment.splice(idx, 1);
  persist();
  return true;
}

// ---------- logs ----------
function addLog(entry) {
  entry.id = nextId('log');
  entry.createdAt = now();
  getDb().logs.push(entry);
  persist();
  return entry;
}
function listLogs(filter = {}) {
  let rows = getDb().logs.slice();
  if (filter.equipmentId) rows = rows.filter((l) => l.equipmentId === Number(filter.equipmentId));
  if (filter.action) rows = rows.filter((l) => l.action === filter.action);
  if (filter.keyword) {
    const kw = filter.keyword.trim().toLowerCase();
    rows = rows.filter((l) =>
      [l.equipmentCode, l.action, l.fromStatus, l.toStatus, l.reason, l.operator, l.detail]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(kw))
    );
  }
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

// ---------- files ----------
function addFile(rec) {
  rec.id = nextId('file');
  rec.createdAt = now();
  getDb().files.push(rec);
  persist();
  return rec;
}
function getFile(id) {
  return getDb().files.find((f) => f.id === Number(id)) || null;
}
function listFiles(equipmentId) {
  return getDb()
    .files.filter((f) => f.equipmentId === Number(equipmentId))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
function deleteFile(id) {
  const d = getDb();
  const idx = d.files.findIndex((f) => f.id === Number(id));
  if (idx === -1) return null;
  const [f] = d.files.splice(idx, 1);
  persist();
  return f;
}

module.exports = {
  load,
  listEquipment,
  getEquipment,
  getEquipmentByCode,
  insertEquipment,
  updateEquipment,
  deleteEquipment,
  addLog,
  listLogs,
  addFile,
  getFile,
  listFiles,
  deleteFile,
};
