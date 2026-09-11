/**
 * 消防器材管理模块 —— 后端服务
 * Express 5 + JSON 文件持久化 + multer 附件上传
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const store = require('./lib/store');
const { seed } = require('./lib/seed');
const { toCsv, parseCsv } = require('./lib/csv');

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

store.load();
seed();

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------
const TYPES = ['灭火器', '消火栓', '水带', '喷淋头', '烟感探测器', '温感探测器',
  '火灾报警按钮', '应急照明', '疏散指示', '防火门', '消防斧', '消防铲', '其他'];

const STATUS_MAP = {
  normal: { label: '在用', tone: 'success' },
  disabled: { label: '停用', tone: 'warning' },
  scrapped: { label: '报废', tone: 'danger' },
  overdue: { label: '超期未检', tone: 'info' },
};
// 台账中显式允许人工设置/流转的状态（overdue 由检查日期派生展示，导入仍兼容）
const FLOW_STATUS = ['normal', 'disabled', 'scrapped'];
const STATUS_LABELS = Object.fromEntries(Object.entries(STATUS_MAP).map(([k, v]) => [k, v.label]));

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
function today() {
  return new Date().toISOString().slice(0, 10);
}

function normalize(payload, partial = false) {
  const out = {};
  const fields = ['code', 'type', 'building', 'floor', 'location', 'model', 'inspectDate', 'owner', 'status', 'remark'];
  for (const f of fields) {
    if (f in payload) out[f] = payload[f] === null || payload[f] === undefined ? '' : String(payload[f]).trim();
  }
  if (!partial || 'status' in out) {
    if (out.status && !FLOW_STATUS.includes(out.status)) out.status = 'normal';
    if (!out.status) out.status = partial ? out.status : 'normal';
  }
  return out;
}

function validate(rec, partial = false) {
  const errors = [];
  if (!partial || 'code' in rec) {
    if (!rec.code) errors.push('器材编号不能为空');
    else if (!/^[A-Za-z0-9][A-Za-z0-9\-_/]*$/.test(rec.code)) errors.push('器材编号只能包含字母、数字、-、_、/，且以字母或数字开头');
  }
  if (!partial || 'type' in rec) {
    if (!rec.type) errors.push('请选择器材类型');
    else if (!TYPES.includes(rec.type)) errors.push('器材类型不合法');
  }
  if (!partial || 'building' in rec) {
    if (!rec.building) errors.push('请填写楼栋');
  }
  if (!partial || 'inspectDate' in rec) {
    if (!rec.inspectDate) errors.push('请选择检查日期');
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(rec.inspectDate)) errors.push('检查日期格式应为 YYYY-MM-DD');
  }
  if (rec.owner !== undefined && rec.owner.length > 20) errors.push('责任人长度不能超过 20 个字符');
  return errors;
}

/** 派生状态：检查日期超过 12 个月 -> 超期未检（仅展示用，不覆盖停用/报废） */
function decorate(e) {
  const d = { ...e };
  d.statusLabel = STATUS_LABELS[d.status] || d.status;
  d.derivedOverdue = false;
  if (d.status === 'normal' && d.inspectDate) {
    const due = new Date(d.inspectDate);
    due.setFullYear(due.getFullYear() + 1);
    if (due < new Date()) {
      d.derivedOverdue = true;
      d.displayStatus = 'overdue';
      d.statusLabel = STATUS_MAP.overdue.label;
    } else {
      d.displayStatus = 'normal';
    }
  } else {
    d.displayStatus = d.status;
  }
  d.files = store.listFiles(e.id);
  return d;
}

function logChange({ equipmentId, equipmentCode, action, fromStatus, toStatus, reason, operator, detail }) {
  return store.addLog({
    equipmentId, equipmentCode, action,
    fromStatus: fromStatus || '', toStatus: toStatus || '',
    reason: reason || '', operator: operator || '系统', detail: detail || '',
  });
}

const STATUS_CN = (s) => STATUS_LABELS[s] || s || '空';

// ---------------------------------------------------------------------------
// 元数据
// ---------------------------------------------------------------------------
app.get('/api/meta', (req, res) => {
  res.json({ types: TYPES, statusMap: STATUS_MAP });
});

// ---------------------------------------------------------------------------
// 器材：列表 / 搜索 / 统计
// ---------------------------------------------------------------------------
app.get('/api/equipment', (req, res) => {
  const {
    keyword = '', type = '', building = '', floor = '',
    status = '', owner = '', inspectStart = '', inspectEnd = '', page = '1', pageSize = '10',
  } = req.query;

  let rows = store.listEquipment().map(decorate);

  if (keyword) {
    const kw = String(keyword).trim().toLowerCase();
    rows = rows.filter((e) =>
      [e.code, e.type, e.building, e.floor, e.location, e.model, e.owner, e.remark]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(kw))
    );
  }
  if (type) rows = rows.filter((e) => e.type === type);
  if (building) rows = rows.filter((e) => e.building === building);
  if (floor) rows = rows.filter((e) => e.floor === floor);
  if (owner) rows = rows.filter((e) => (e.owner || '').includes(owner));
  if (status) rows = rows.filter((e) => (e.displayStatus || e.status) === status);
  if (inspectStart) rows = rows.filter((e) => e.inspectDate >= inspectStart);
  if (inspectEnd) rows = rows.filter((e) => e.inspectDate <= inspectEnd);

  rows.sort((a, b) => (a.code > b.code ? 1 : -1));

  // 统计基于筛选后的全集（导出时口径一致）
  const stats = {
    total: rows.length,
    normal: rows.filter((e) => e.displayStatus === 'normal').length,
    disabled: rows.filter((e) => e.displayStatus === 'disabled').length,
    scrapped: rows.filter((e) => e.displayStatus === 'scrapped').length,
    overdue: rows.filter((e) => e.displayStatus === 'overdue').length,
  };

  const p = Math.max(1, parseInt(page, 10) || 1);
  const ps = Math.min(200, Math.max(1, parseInt(pageSize, 10) || 10));
  const start = (p - 1) * ps;

  res.json({
    total: rows.length,
    page: p,
    pageSize: ps,
    stats,
    items: rows.slice(start, start + ps),
    buildings: [...new Set(store.listEquipment().map((e) => e.building).filter(Boolean))].sort(),
  });
});

app.get('/api/equipment/:id', (req, res) => {
  const e = store.getEquipment(req.params.id);
  if (!e) return res.status(404).json({ message: '器材不存在' });
  res.json({ item: decorate(e), logs: store.listLogs({ equipmentId: e.id }) });
});

// ---------------------------------------------------------------------------
// 器材：新增 / 编辑
// ---------------------------------------------------------------------------
app.post('/api/equipment', (req, res) => {
  const rec = normalize(req.body || {});
  const errors = validate(rec);
  if (errors.length) return res.status(400).json({ message: errors.join('；') });
  if (store.getEquipmentByCode(rec.code)) return res.status(409).json({ message: `器材编号 ${rec.code} 已存在` });

  const created = store.insertEquipment(rec);
  logChange({
    equipmentId: created.id, equipmentCode: created.code, action: 'create',
    toStatus: created.status, reason: '新增器材台账',
    operator: created.owner || '系统',
    detail: `建档：${created.type} / ${created.building}${created.floor}${created.location ? ' ' + created.location : ''}`,
  });
  res.status(201).json({ item: decorate(created) });
});

app.put('/api/equipment/:id', (req, res) => {
  const current = store.getEquipment(req.params.id);
  if (!current) return res.status(404).json({ message: '器材不存在' });
  if (current.status === 'scrapped') {
    return res.status(400).json({ message: '已报废器材不可编辑，请先在操作记录中说明并启用（如为误判）' });
  }

  const patch = normalize(req.body || {}, true);
  const merged = { ...current, ...patch };
  const errors = validate(merged, true);
  if (errors.length) return res.status(400).json({ message: errors.join('；') });

  if (patch.code && patch.code !== current.code && store.getEquipmentByCode(patch.code)) {
    return res.status(409).json({ message: `器材编号 ${patch.code} 已存在` });
  }

  const updated = store.updateEquipment(current.id, patch);

  const changedFields = [];
  const labelMap = { code: '编号', type: '类型', building: '楼栋', floor: '楼层', location: '位置', model: '规格型号', inspectDate: '检查日期', owner: '责任人', status: '状态', remark: '备注' };
  for (const k of Object.keys(patch)) {
    if (String(current[k] ?? '') !== String(patch[k] ?? '')) {
      changedFields.push(`${labelMap[k] || k}：${current[k] || '空'} → ${patch[k] || '空'}`);
    }
  }
  if (changedFields.length) {
    logChange({
      equipmentId: updated.id, equipmentCode: updated.code, action: 'update',
      fromStatus: current.status, toStatus: updated.status,
      reason: req.body?.changeReason || '台账信息变更',
      operator: req.body?.operator || updated.owner || '系统',
      detail: changedFields.join('；'),
    });
  }
  res.json({ item: decorate(updated) });
});

app.delete('/api/equipment/:id', (req, res) => {
  const current = store.getEquipment(req.params.id);
  if (!current) return res.status(404).json({ message: '器材不存在' });
  if (current.status === 'scrapped') {
    return res.status(400).json({ message: '已报废器材不能删除台账，报废记录需永久保留' });
  }
  store.deleteEquipment(current.id);
  logChange({
    equipmentId: 0, equipmentCode: current.code, action: 'delete',
    fromStatus: current.status, reason: (req.body && req.body.reason) || '删除台账',
    operator: (req.body && req.body.operator) || '系统',
    detail: `删除器材：${current.type} / ${current.building}${current.floor}`,
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// 状态流转：停用 / 启用 / 报废（强制留痕）
// ---------------------------------------------------------------------------
app.post('/api/equipment/:id/transition', (req, res) => {
  const current = store.getEquipment(req.params.id);
  if (!current) return res.status(404).json({ message: '器材不存在' });

  const { toStatus, reason, operator, detail } = req.body || {};
  if (!FLOW_STATUS.includes(toStatus)) return res.status(400).json({ message: '目标状态不合法' });
  if (!reason || !String(reason).trim()) return res.status(400).json({ message: '请填写操作原因，停用/报废必须留存操作记录' });
  if (!operator || !String(operator).trim()) return res.status(400).json({ message: '请填写操作人' });
  if (current.status === toStatus) return res.status(400).json({ message: `当前已是「${STATUS_CN(toStatus)}」状态` });

  // 合法流转校验
  const rules = {
    disabled: ['normal'],          // 在用 -> 停用
    normal: ['disabled'],           // 停用 -> 启用（报废不可直接启用，须新建台账）
    scrapped: ['normal', 'disabled'],
  };
  if (!rules[toStatus].includes(current.status)) {
    return res.status(400).json({
      message: `不允许从「${STATUS_CN(current.status)}」变更为「${STATUS_CN(toStatus)}」`,
    });
  }

  const updated = store.updateEquipment(current.id, { status: toStatus });
  const actionText = { disabled: '停用', normal: '重新启用', scrapped: '报废' }[toStatus];
  const log = logChange({
    equipmentId: updated.id, equipmentCode: updated.code, action: 'status_change',
    fromStatus: current.status, toStatus,
    reason: String(reason).trim(), operator: String(operator).trim(),
    detail: detail ? String(detail).trim() : `${actionText}操作：${STATUS_CN(current.status)} → ${STATUS_CN(toStatus)}`,
  });
  res.json({ item: decorate(updated), log });
});

// ---------------------------------------------------------------------------
// 操作记录
// ---------------------------------------------------------------------------
app.get('/api/logs', (req, res) => {
  const rows = store.listLogs(req.query).map((l) => ({
    ...l,
    fromStatusLabel: l.fromStatus ? STATUS_CN(l.fromStatus) : '',
    toStatusLabel: l.toStatus ? STATUS_CN(l.toStatus) : '',
  }));
  res.json({ total: rows.length, items: rows });
});

// ---------------------------------------------------------------------------
// 附件照片
// ---------------------------------------------------------------------------
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '').toLowerCase();
    const safe = Buffer.from(file.originalname, 'latin1').toString('utf8').replace(/[\\/:*?"<>|\s]+/g, '_');
    cb(null, `equip_${req.params.id}_${Date.now()}_${safe.replace(/[^A-Za-z0-9._\-一-龥]/g, '')}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 9 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) return cb(new Error('仅支持 jpg / jpeg / png / gif / webp / bmp 格式图片'));
    cb(null, true);
  },
});

app.post('/api/equipment/:id/files', (req, res) => {
  const equipment = store.getEquipment(req.params.id);
  if (!equipment) return res.status(404).json({ message: '器材不存在' });
  upload.array('files', 9)(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.message });
    const files = (req.files || []).map((f) =>
      store.addFile({
        equipmentId: equipment.id,
        originalName: Buffer.from(f.originalname, 'latin1').toString('utf8'),
        storedName: f.filename,
        url: `/uploads/${f.filename}`,
        size: f.size,
        mimeType: f.mimetype,
        uploader: (req.body && req.body.uploader) || '系统',
        caption: (req.body && req.body.caption) || '',
      })
    );
    if (files.length) {
      logChange({
        equipmentId: equipment.id, equipmentCode: equipment.code, action: 'file_upload',
        toStatus: equipment.status, operator: files[0].uploader,
        reason: '上传附件照片',
        detail: `上传 ${files.length} 张照片：${files.map((f) => f.originalName).join('、')}`,
      });
    }
    res.status(201).json({ files });
  });
});

app.delete('/api/files/:fileId', (req, res) => {
  const f = store.getFile(req.params.fileId);
  if (!f) return res.status(404).json({ message: '附件不存在' });
  const equipment = store.getEquipment(f.equipmentId);
  store.deleteFile(f.id);
  try { fs.unlinkSync(path.join(UPLOAD_DIR, f.storedName)); } catch (_) { /* 忽略文件残留 */ }
  if (equipment) {
    logChange({
      equipmentId: equipment.id, equipmentCode: equipment.code, action: 'file_delete',
      toStatus: equipment.status, operator: (req.body && req.body.operator) || '系统',
      reason: '删除附件照片', detail: `删除照片：${f.originalName}`,
    });
  }
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// 导出 CSV（按当前筛选条件）
// ---------------------------------------------------------------------------
app.get('/api/export', (req, res) => {
  const rows = store.listEquipment().map(decorate).filter((e) => {
    const q = req.query;
    if (q.keyword) {
      const kw = String(q.keyword).trim().toLowerCase();
      const hit = [e.code, e.type, e.building, e.floor, e.location, e.model, e.owner, e.remark]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(kw));
      if (!hit) return false;
    }
    if (q.type && e.type !== q.type) return false;
    if (q.building && e.building !== q.building) return false;
    if (q.floor && e.floor !== q.floor) return false;
    if (q.status && (e.displayStatus || e.status) !== q.status) return false;
    if (q.owner && !(e.owner || '').includes(q.owner)) return false;
    if (q.inspectStart && e.inspectDate < q.inspectStart) return false;
    if (q.inspectEnd && e.inspectDate > q.inspectEnd) return false;
    return true;
  }).sort((a, b) => (a.code > b.code ? 1 : -1));

  const headers = [
    { label: '器材编号', get: (e) => e.code },
    { label: '类型', get: (e) => e.type },
    { label: '规格型号', get: (e) => e.model },
    { label: '楼栋', get: (e) => e.building },
    { label: '楼层', get: (e) => e.floor },
    { label: '位置', get: (e) => e.location },
    { label: '检查日期', get: (e) => e.inspectDate },
    { label: '责任人', get: (e) => e.owner },
    { label: '状态', get: (e) => (e.displayStatus === 'overdue' ? '超期未检' : STATUS_CN(e.status)) },
    { label: '照片数', get: (e) => e.files.length },
    { label: '备注', get: (e) => e.remark },
  ];
  const csv = toCsv(headers, rows);
  const fname = `消防器材台账_${today()}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`);
  res.send(csv);
});

// 导入模板
app.get('/api/template', (req, res) => {
  const headers = [
    { label: '器材编号', get: (r) => r[0] },
    { label: '类型', get: (r) => r[1] },
    { label: '规格型号', get: (r) => r[2] },
    { label: '楼栋', get: (r) => r[3] },
    { label: '楼层', get: (r) => r[4] },
    { label: '位置', get: (r) => r[5] },
    { label: '检查日期', get: (r) => r[6] },
    { label: '责任人', get: (r) => r[7] },
    { label: '状态', get: (r) => r[8] },
    { label: '备注', get: (r) => r[9] },
  ];
  const sample = [
    ['XF-MH-0099', '灭火器', 'MFZ/ABC4 干粉 4kg', '1号楼', '1F', '示例位置（导入时请删除本行）', today(), '张三', '在用', ''],
  ];
  const csv = toCsv(headers, sample);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('消防器材导入模板.csv')}`);
  res.send(csv);
});

// ---------------------------------------------------------------------------
// 导入 CSV（编号存在则更新，不存在则新增）
// ---------------------------------------------------------------------------
app.post('/api/import', (req, res) => {
  const { csv = '', operator = '系统', mode = 'upsert' } = req.body || {};
  if (!csv.trim()) return res.status(400).json({ message: '导入内容为空' });

  let parsed;
  try {
    parsed = parseCsv(csv);
  } catch (e) {
    return res.status(400).json({ message: 'CSV 解析失败：' + e.message });
  }
  if (!parsed.length) return res.status(400).json({ message: '未解析到有效数据行（首行需为表头）' });

  const alias = {
    '器材编号': 'code', '编号': 'code', 'code': 'code',
    '类型': 'type', 'type': 'type',
    '规格型号': 'model', '型号': 'model', '规格': 'model',
    '楼栋': 'building', '楼号': 'building',
    '楼层': 'floor', '层数': 'floor',
    '位置': 'location', '具体位置': 'location',
    '检查日期': 'inspectDate', '日期': 'inspectDate',
    '责任人': 'owner', '负责人': 'owner',
    '状态': 'status',
    '备注': 'remark',
  };
  const cnStatus = { '在用': 'normal', '正常': 'normal', '停用': 'disabled', '报废': 'scrapped', '超期未检': 'normal' };

  const result = { inserted: 0, updated: 0, failed: 0, errors: [] };

  parsed.forEach((raw, i) => {
    const row = {};
    for (const [k, v] of Object.entries(raw)) {
      const key = alias[k.trim()] || alias[String(k).toLowerCase().trim()];
      if (key) row[key] = v;
    }
    // 日期兼容 2026/9/1 -> 2026-09-01
    if (row.inspectDate) {
      const m = row.inspectDate.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
      if (m) row.inspectDate = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    }
    // 状态校验：不识别的值必须逐行报错，不能静默落库为「在用」
    if (row.status) {
      const rawStatus = row.status;
      row.status = cnStatus[rawStatus] || rawStatus;
      if (!FLOW_STATUS.includes(row.status)) {
        result.failed++;
        result.errors.push(`第 ${i + 2} 行（${row.code || '无编号'}）：状态「${rawStatus}」无法识别，请填写：在用 / 停用 / 报废`);
        return;
      }
    }

    const rec = normalize(row);
    const errs = validate(rec);
    if (errs.length) {
      result.failed++;
      result.errors.push(`第 ${i + 2} 行（${rec.code || '无编号'}）：${errs.join('；')}`);
      return;
    }

    const exist = store.getEquipmentByCode(rec.code);
    if (exist) {
      if (mode === 'insert-only') {
        result.failed++;
        result.errors.push(`第 ${i + 2} 行：编号 ${rec.code} 已存在（当前模式为仅新增）`);
        return;
      }
      if (exist.status === 'scrapped') {
        result.failed++;
        result.errors.push(`第 ${i + 2} 行：${rec.code} 已报废，台账锁定不可导入更新`);
        return;
      }
      const old = { ...exist };
      const patch = {};
      ['type', 'model', 'building', 'floor', 'location', 'inspectDate', 'owner', 'remark', 'status'].forEach((k) => {
        if (k in rec && rec[k] !== '') patch[k] = rec[k];
      });
      const updated = store.updateEquipment(exist.id, patch);
      result.updated++;
      const changes = [];
      const labelMap = { type: '类型', model: '规格型号', building: '楼栋', floor: '楼层', location: '位置', inspectDate: '检查日期', owner: '责任人', status: '状态', remark: '备注' };
      for (const k of Object.keys(patch)) {
        if (String(old[k] ?? '') !== String(patch[k] ?? '')) {
          changes.push(`${labelMap[k] || k}：${old[k] || '空'}→${patch[k] || '空'}`);
        }
      }
      logChange({
        equipmentId: updated.id, equipmentCode: updated.code,
        action: 'import_update', fromStatus: old.status, toStatus: updated.status,
        reason: 'CSV 批量导入更新', operator,
        detail: changes.join('；') || '无字段变化',
      });
    } else {
      const created = store.insertEquipment(rec);
      result.inserted++;
      logChange({
        equipmentId: created.id, equipmentCode: created.code, action: 'import_create',
        toStatus: created.status, reason: 'CSV 批量导入新增', operator,
        detail: `导入建档：${created.type} / ${created.building}${created.floor}`,
      });
    }
  });

  res.json(result);
});

// 健康检查
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// 错误处理
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: err.message || '服务器内部错误' });
});

app.listen(PORT, () => {
  console.log(`消防器材管理服务已启动: http://localhost:${PORT}`);
});
