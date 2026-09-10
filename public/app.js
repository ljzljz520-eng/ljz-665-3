/* ============================================================
   消防器材管理 · 前端逻辑（原生 JS，无框架依赖）
   ============================================================ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  view: 'equipment',
  query: { page: 1, pageSize: 10 },
  stats: { total: 0 },
  types: [],
  editingId: null,
  detailId: null,
  transition: null, // { id, toStatus }
};

// ---------------------------------------------------------------------------
// 通用
// ---------------------------------------------------------------------------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function operator() { return $('#global-operator').value.trim() || '管理员'; }

function toast(msg, type = 'success') {
  const wrap = $('#toast-wrap');
  const icons = {
    success: '✓', error: '✕', warning: '!',
  };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span style="font-weight:700">${icons[type] || ''}</span><span>${esc(msg)}</span>`;
  wrap.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, 3200);
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    ...opts,
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* 非 JSON */ }
  if (!res.ok) {
    const msg = (data && data.message) || `请求失败（${res.status}）`;
    const err = new Error(msg);
    err.data = data;
    throw err;
  }
  return data;
}

const STATUS_BADGE = {
  normal: '<span class="badge success">在用</span>',
  disabled: '<span class="badge warning">停用</span>',
  scrapped: '<span class="badge danger">报废</span>',
  overdue: '<span class="badge info">超期未检</span>',
};
const ACTION_LABELS = {
  create: ['新建台账', 'create'],
  update: ['信息编辑', 'update'],
  delete: ['台账删除', 'delete'],
  status_change: ['状态变更', 'status_change'],
  import_create: ['导入新增', 'import_create'],
  import_update: ['导入更新', 'import_update'],
  file_upload: ['照片上传', 'file_upload'],
  file_delete: ['照片删除', 'file_delete'],
};

// ---------------------------------------------------------------------------
// 模态框
// ---------------------------------------------------------------------------
function openModal(id) { $(`#${id}`).classList.add('show'); }
function closeModal(id) { $(`#${id}`).classList.remove('show'); }

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-mask')) e.target.classList.remove('show');
  const closeBtn = e.target.closest('[data-close]');
  if (closeBtn) closeBtn.closest('.modal-mask').classList.remove('show');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $$('.modal-mask.show').forEach((m) => m.classList.remove('show'));
});

// ---------------------------------------------------------------------------
// 视图切换
// ---------------------------------------------------------------------------
$$('.nav-item[data-view]').forEach((item) => {
  item.addEventListener('click', () => {
    state.view = item.dataset.view;
    $$('.nav-item').forEach((n) => n.classList.remove('active'));
    item.classList.add('active');
    $('#view-equipment').classList.toggle('hidden', state.view !== 'equipment');
    $('#view-logs').classList.toggle('hidden', state.view !== 'logs');
    $('#breadcrumb-current').textContent = state.view === 'equipment' ? '器材台账' : '操作记录';
    if (state.view === 'logs') loadLogs();
  });
});

// ---------------------------------------------------------------------------
// 元数据
// ---------------------------------------------------------------------------
async function loadMeta() {
  const meta = await api('/api/meta');
  state.types = meta.types;
  const opts = meta.types.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  $('#f-type').insertAdjacentHTML('beforeend', opts);
  $('#ef-type').innerHTML = opts;
}

// ---------------------------------------------------------------------------
// 列表加载
// ---------------------------------------------------------------------------
function buildQuery() {
  const q = {
    keyword: $('#f-keyword').value.trim(),
    type: $('#f-type').value,
    building: $('#f-building').value,
    floor: $('#f-floor').value.trim(),
    owner: $('#f-owner').value.trim(),
    status: $('#f-status').value,
    inspectStart: $('#f-date-start').value,
    inspectEnd: $('#f-date-end').value,
    page: state.query.page,
    pageSize: state.query.pageSize,
  };
  return q;
}

async function loadList() {
  const q = buildQuery();
  const params = new URLSearchParams();
  Object.entries(q).forEach(([k, v]) => { if (v !== '' && v != null) params.set(k, v); });
  const data = await api(`/api/equipment?${params}`);

  // 统计
  $('#stat-total').textContent = data.stats.total;
  $('#stat-normal').textContent = data.stats.normal;
  $('#stat-disabled').textContent = data.stats.disabled;
  $('#stat-scrapped').textContent = data.stats.scrapped;
  $('#stat-overdue').textContent = data.stats.overdue;
  state.stats = data.stats;

  // 楼栋下拉
  const curBuilding = $('#f-building').value;
  $('#f-building').innerHTML = '<option value="">全部楼栋</option>' +
    data.buildings.map((b) => `<option value="${esc(b)}" ${b === curBuilding ? 'selected' : ''}>${esc(b)}</option>`).join('');

  // 表格
  const tbody = $('#equipment-tbody');
  if (!data.items.length) {
    tbody.innerHTML = '';
    $('#table-empty').classList.remove('hidden');
  } else {
    $('#table-empty').classList.add('hidden');
    tbody.innerHTML = data.items.map(renderRow).join('');
  }
  $('#result-count').textContent = data.total;
  $('#result-hint').textContent = q.status ? `已按状态筛选：${({ normal: '在用', overdue: '超期未检', disabled: '停用', scrapped: '报废' })[q.status]}` : '';

  renderPagination(data);
}

function renderRow(e) {
  const photoCell = e.files.length
    ? `<img src="${esc(e.files[0].url)}" class="photo-thumb" data-preview="${esc(e.files[0].url)}" alt=""><span class="photo-count">×${e.files.length}</span>`
    : '<span class="text-muted">—</span>';

  let actions = '';
  actions += `<button class="btn-text" data-act="detail" data-id="${e.id}">详情</button>`;
  if (e.status !== 'scrapped') {
    actions += `<button class="btn-text" data-act="edit" data-id="${e.id}">编辑</button>`;
  }
  if (e.status === 'normal') {
    actions += `<button class="btn-text warning" data-act="disable" data-id="${e.id}">停用</button>`;
    actions += `<button class="btn-text danger" data-act="scrap" data-id="${e.id}">报废</button>`;
  } else if (e.status === 'disabled') {
    actions += `<button class="btn-text" data-act="enable" data-id="${e.id}">启用</button>`;
    actions += `<button class="btn-text danger" data-act="scrap" data-id="${e.id}">报废</button>`;
  }
  if (e.status !== 'scrapped') {
    actions += `<button class="btn-text danger" data-act="delete" data-id="${e.id}">删除</button>`;
  }

  return `
  <tr>
    <td class="col-code">${esc(e.code)}</td>
    <td>${esc(e.type)}</td>
    <td class="muted">${esc(e.model || '—')}</td>
    <td>${esc(e.building)} <span class="text-muted">${esc(e.floor || '')}</span></td>
    <td>${esc(e.location || '—')}</td>
    <td>${esc(e.inspectDate)}${e.displayStatus === 'overdue' ? '<div class="text-danger" style="font-size:11.5px;margin-top:2px">检查已超期</div>' : ''}</td>
    <td>${esc(e.owner || '—')}</td>
    <td>${STATUS_BADGE[e.displayStatus] || esc(e.statusLabel)}</td>
    <td>${photoCell}</td>
    <td class="col-actions"><span class="row-actions">${actions}</span></td>
  </tr>`;
}

function renderPagination(data) {
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const start = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const end = Math.min(data.total, data.page * data.pageSize);
  $('#page-info').textContent = `显示第 ${start}-${end} 条 / 共 ${data.total} 条`;

  const ctl = $('#page-controls');
  let html = `<button class="page-btn" data-page="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>上一页</button>`;

  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - data.page) <= 1) pages.push(i);
    else if (pages[pages.length - 1] !== '...') pages.push('...');
  }
  pages.forEach((p) => {
    if (p === '...') html += '<span style="padding:0 4px;color:#9ca3af">…</span>';
    else html += `<button class="page-btn ${p === data.page ? 'active' : ''}" data-page="${p}">${p}</button>`;
  });
  html += `<button class="page-btn" data-page="${data.page + 1}" ${data.page >= totalPages ? 'disabled' : ''}>下一页</button>`;
  ctl.innerHTML = html;

  ctl.querySelectorAll('button[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = parseInt(btn.dataset.page, 10);
      if (!isNaN(p)) { state.query.page = p; loadList(); }
    });
  });
}

// ---------------------------------------------------------------------------
// 筛选交互
// ---------------------------------------------------------------------------
$('#btn-search').addEventListener('click', () => { state.query.page = 1; loadList(); });
$('#btn-reset').addEventListener('click', () => {
  ['f-keyword', 'f-floor', 'f-owner', 'f-date-start', 'f-date-end'].forEach((id) => $('#' + id).value = '');
  $('#f-type').value = ''; $('#f-building').value = ''; $('#f-status').value = '';
  state.statFilter = '';
  $$('.stat-card').forEach((c) => c.classList.toggle('active', c.dataset.status === ''));
  state.query.page = 1;
  loadList();
});
['f-keyword', 'f-floor', 'f-owner'].forEach((id) => {
  $('#' + id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { state.query.page = 1; loadList(); } });
});
$('#f-type').addEventListener('change', () => { state.query.page = 1; loadList(); });

// 统计卡片点击筛选
$$('.stat-card').forEach((card) => {
  card.addEventListener('click', () => {
    const s = card.dataset.status;
    $('#f-status').value = s;
    $$('.stat-card').forEach((c) => c.classList.remove('active'));
    card.classList.add('active');
    state.query.page = 1;
    loadList();
  });
});

// ---------------------------------------------------------------------------
// 新增 / 编辑
// ---------------------------------------------------------------------------
function openCreate() {
  state.editingId = null;
  $('#form-title').textContent = '新增消防器材';
  $('#ef-status-wrap').style.display = '';
  ['ef-code', 'ef-model', 'ef-building', 'ef-floor', 'ef-location', 'ef-owner', 'ef-remark', 'ef-change-reason'].forEach((id) => $('#' + id).value = '');
  $('#ef-type').value = state.types[0] || '';
  $('#ef-status').value = 'normal';
  $('#ef-inspect-date').value = new Date().toISOString().slice(0, 10);
  clearFormErrors();
  openModal('modal-form');
  $('#ef-code').focus();
}

async function openEdit(id) {
  const { item } = await api(`/api/equipment/${id}`);
  state.editingId = id;
  $('#form-title').textContent = `编辑器材 · ${item.code}`;
  $('#ef-code').value = item.code;
  $('#ef-type').value = item.type;
  $('#ef-model').value = item.model || '';
  $('#ef-building').value = item.building;
  $('#ef-floor').value = item.floor || '';
  $('#ef-location').value = item.location || '';
  $('#ef-inspect-date').value = item.inspectDate;
  $('#ef-owner').value = item.owner || '';
  $('#ef-remark').value = item.remark || '';
  $('#ef-status').value = item.status === 'scrapped' ? 'normal' : item.status;
  $('#ef-change-reason').value = '';
  $('#ef-status-wrap').style.display = item.status === 'disabled' ? 'none' : '';
  clearFormErrors();
  openModal('modal-form');
}

function clearFormErrors() {
  $$('#modal-form .invalid').forEach((el) => el.classList.remove('invalid'));
  $$('#modal-form .error-text').forEach((el) => el.remove());
}

function markError(fieldId, msg) {
  const input = $('#' + fieldId);
  input.classList.add('invalid');
  const span = document.createElement('span');
  span.className = 'error-text';
  span.textContent = msg;
  input.closest('.form-item').appendChild(span);
}

$('#btn-create').addEventListener('click', openCreate);

$('#btn-form-save').addEventListener('click', async () => {
  clearFormErrors();
  const payload = {
    code: $('#ef-code').value.trim(),
    type: $('#ef-type').value,
    model: $('#ef-model').value.trim(),
    building: $('#ef-building').value.trim(),
    floor: $('#ef-floor').value.trim(),
    location: $('#ef-location').value.trim(),
    inspectDate: $('#ef-inspect-date').value,
    owner: $('#ef-owner').value.trim(),
    remark: $('#ef-remark').value.trim(),
    operator: operator(),
    changeReason: $('#ef-change-reason').value.trim(),
  };
  if (!state.editingId) payload.status = $('#ef-status').value;

  const btn = $('#btn-form-save');
  btn.disabled = true;
  try {
    if (state.editingId) {
      await api(`/api/equipment/${state.editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
      toast('器材信息已更新');
    } else {
      await api('/api/equipment', { method: 'POST', body: JSON.stringify(payload) });
      toast('器材已建档');
    }
    closeModal('modal-form');
    loadList();
  } catch (err) {
    toast(err.message, 'error');
    const msg = err.message;
    if (msg.includes('编号')) markError('ef-code', msg);
    if (msg.includes('类型')) markError('ef-type', msg);
    if (msg.includes('楼栋')) markError('ef-building', msg);
    if (msg.includes('检查日期')) markError('ef-inspect-date', msg);
  } finally {
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// 行操作（事件委托）
// ---------------------------------------------------------------------------
$('#equipment-tbody').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;

  if (act === 'detail') openDetail(id);
  else if (act === 'edit') { try { await openEdit(id); } catch (err) { toast(err.message, 'error'); } }
  else if (act === 'disable') openTransition(id, 'disabled');
  else if (act === 'enable') openTransition(id, 'normal');
  else if (act === 'scrap') openTransition(id, 'scrapped');
  else if (act === 'delete') {
    const item = (await api(`/api/equipment/${id}`)).item;
    const reason = prompt(`删除器材「${item.code}」将移除台账（操作会被记录）。\n请输入删除原因：`, '台账信息录入错误');
    if (reason === null) return;
    if (!reason.trim()) { toast('请填写删除原因', 'warning'); return; }
    try {
      await api(`/api/equipment/${id}`, { method: 'DELETE', body: JSON.stringify({ reason: reason.trim(), operator: operator() }) });
      toast('台账已删除');
      loadList();
    } catch (err) { toast(err.message, 'error'); }
  }
});

// 缩略图预览
$('#equipment-tbody').addEventListener('click', (e) => {
  const img = e.target.closest('img[data-preview]');
  if (img) showLightbox(img.dataset.preview);
});

// ---------------------------------------------------------------------------
// 状态流转（停用 / 启用 / 报废）
// ---------------------------------------------------------------------------
const TR_CONF = {
  disabled: {
    title: '停用器材',
    btn: '确认停用', cls: 'btn-warning',
    warning: '',
  },
  normal: {
    title: '重新启用器材',
    btn: '确认启用', cls: 'btn-primary',
    warning: '',
  },
  scrapped: {
    title: '器材报废',
    btn: '确认报废', cls: 'btn-danger',
    warning: '报废后器材台账将被锁定：不可编辑、不可删除、不可通过导入覆盖。请确认器材已物理处置并完成回收登记。',
  },
};

async function openTransition(id, toStatus) {
  const { item } = await api(`/api/equipment/${id}`);
  state.transition = { id, toStatus };
  const conf = TR_CONF[toStatus];

  $('#tr-title').textContent = conf.title;
  $('#tr-target-info').innerHTML = `
    <div><b>器材编号：</b><span class="col-code">${esc(item.code)}</span></div>
    <div><b>器材类型：</b>${esc(item.type)} ${esc(item.model || '')}</div>
    <div><b>安装位置：</b>${esc(item.building)} ${esc(item.floor || '')} ${esc(item.location || '')}</div>
    <div><b>当前状态：</b>${STATUS_BADGE[item.displayStatus] || item.statusLabel}</div>`;
  const fromLabel = item.status === 'normal' ? '在用' : '停用';
  const toLabel = { normal: '在用', disabled: '停用', scrapped: '报废' }[toStatus];
  $('#tr-flow').innerHTML = `${STATUS_BADGE[item.status === 'normal' ? 'normal' : 'disabled']}
    <span style="margin:0 8px;color:#9ca3af">→</span> ${STATUS_BADGE[toStatus === 'normal' ? 'normal' : toStatus]}
    <span class="text-muted" style="font-weight:400;font-size:12.5px;margin-left:8px">${esc(fromLabel)} → ${esc(toLabel)}</span>`;
  $('#tr-reason').value = '';
  $('#tr-detail').value = '';
  $('#tr-operator').value = operator();
  const warn = $('#tr-warning');
  if (conf.warning) { warn.textContent = conf.warning; warn.style.display = 'block'; } else { warn.style.display = 'none'; }
  const confirmBtn = $('#btn-tr-confirm');
  confirmBtn.textContent = conf.btn;
  confirmBtn.className = 'btn ' + conf.cls;
  openModal('modal-transition');
  $('#tr-reason').focus();
}

$('#btn-tr-confirm').addEventListener('click', async () => {
  const { id, toStatus } = state.transition;
  const reason = $('#tr-reason').value.trim();
  const op = $('#tr-operator').value.trim();
  const detail = $('#tr-detail').value.trim();
  if (!reason) { toast('必须填写操作原因，以便留存记录', 'warning'); $('#tr-reason').focus(); return; }
  if (!op) { toast('请填写操作人', 'warning'); return; }
  const btn = $('#btn-tr-confirm');
  btn.disabled = true;
  try {
    await api(`/api/equipment/${id}/transition`, {
      method: 'POST',
      body: JSON.stringify({ toStatus, reason, operator: op, detail }),
    });
    toast(`操作成功，已记录${toStatus === 'scrapped' ? '报废' : toStatus === 'disabled' ? '停用' : '启用'}信息`);
    closeModal('modal-transition');
    loadList();
    if ($('#modal-detail').classList.contains('show')) openDetail(id, true);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// 详情 + 照片 + 时间线
// ---------------------------------------------------------------------------
async function openDetail(id, silentSwitch) {
  state.detailId = id;
  const data = await api(`/api/equipment/${id}`);
  const e = data.item;
  const logs = data.logs;

  $('#detail-title').textContent = `器材详情 · ${e.code}`;
  $('#detail-status').innerHTML = STATUS_BADGE[e.displayStatus] || e.statusLabel;

  const rows = [
    ['器材编号', e.code, true],
    ['器材类型', e.type],
    ['状态', e.displayStatus === 'overdue' ? '超期未检（基础状态：在用）' : e.statusLabel],
    ['规格型号', e.model || '—'],
    ['责任人', e.owner || '—'],
    ['检查日期', e.inspectDate + (e.derivedOverdue ? '（已超过 12 个月）' : '')],
    ['楼栋', e.building],
    ['楼层', e.floor || '—'],
    ['具体位置', e.location || '—'],
    ['建档时间', formatDate(e.createdAt)],
    ['最近更新', formatDate(e.updatedAt)],
    ['备注', e.remark || '—'],
  ];
  $('#detail-desc').innerHTML = rows.map(([k, v, mono]) =>
    `<div class="desc-item"><dt>${esc(k)}</dt><dd ${mono ? 'class="col-code"' : ''}>${esc(v)}</dd></div>`).join('');

  $('#tab-photo-count').textContent = e.files.length ? `(${e.files.length})` : '';
  $('#tab-log-count').textContent = logs.length ? `(${logs.length})` : '';
  renderPhotos(e.files);
  renderTimeline(logs);

  // 底部操作按钮
  const footer = $('#detail-footer');
  let btns = '<button class="btn" data-close>关闭</button>';
  if (e.status === 'normal') {
    btns += `<button class="btn btn-warning" data-dtr="disable" data-id="${e.id}">停用</button>
             <button class="btn btn-danger" data-dtr="scrap" data-id="${e.id}">报废</button>`;
  } else if (e.status === 'disabled') {
    btns += `<button class="btn btn-success" data-dtr="enable" data-id="${e.id}">启用</button>
             <button class="btn btn-danger" data-dtr="scrap" data-id="${e.id}">报废</button>`;
  }
  footer.innerHTML = btns;

  if (!silentSwitch) switchDetailTab('info');
  openModal('modal-detail');
}

function switchDetailTab(name) {
  $$('#modal-detail .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $('#tab-info').classList.toggle('hidden', name !== 'info');
  $('#tab-photos').classList.toggle('hidden', name !== 'photos');
  $('#tab-timeline').classList.toggle('hidden', name !== 'timeline');
}
$$('#modal-detail .tab').forEach((t) => t.addEventListener('click', () => switchDetailTab(t.dataset.tab)));

$('#detail-footer').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-dtr]');
  if (!btn) return;
  closeModal('modal-detail');
  openTransition(btn.dataset.id, btn.dataset.dtr);
});

function renderPhotos(files) {
  const grid = $('#photo-grid');
  $('#photo-empty').classList.toggle('hidden', files.length > 0);
  grid.innerHTML = files.map((f) => `
    <div class="photo-card">
      <img src="${esc(f.url)}" data-preview="${esc(f.url)}" alt="${esc(f.originalName)}">
      <div class="photo-meta">
        <div class="photo-name" title="${esc(f.originalName)}">${esc(f.originalName)}</div>
        <div class="photo-sub">
          <span>${esc(f.uploader || '')} · ${fmtSize(f.size)}</span>
          <button class="photo-del" data-del-file="${f.id}">删除</button>
        </div>
      </div>
    </div>`).join('');
}

$('#photo-grid').addEventListener('click', (e) => {
  const img = e.target.closest('img[data-preview]');
  if (img) return showLightbox(img.dataset.preview);
  const del = e.target.closest('[data-del-file]');
  if (del) {
    if (!confirm('确定删除该照片？删除操作会写入操作记录。')) return;
    api(`/api/files/${del.dataset.delFile}`, { method: 'DELETE', body: JSON.stringify({ operator: operator() }) })
      .then(() => { toast('照片已删除'); openDetail(state.detailId, true); })
      .catch((err) => toast(err.message, 'error'));
  }
});

function renderTimeline(logs) {
  const tl = $('#detail-timeline');
  if (!logs.length) { tl.innerHTML = '<li class="text-muted" style="font-size:13px">暂无操作记录</li>'; return; }
  tl.innerHTML = logs.map((l) => {
    const [label, cls] = ACTION_LABELS[l.action] || [l.action, 'update'];
    let flow = '';
    if (l.action === 'status_change' && l.fromStatus && l.toStatus) {
      const fb = STATUS_BADGE[l.fromStatus] || `<span class="badge neutral">${esc(l.fromStatusLabel)}</span>`;
      const tb = STATUS_BADGE[l.toStatus] || `<span class="badge neutral">${esc(l.toStatusLabel)}</span>`;
      flow = `<div class="status-flow" style="margin:4px 0">${fb}<span style="color:#9ca3af">→</span>${tb}</div>`;
    }
    return `
    <li>
      <span class="tl-dot ${cls} ${l.toStatus === 'scrapped' ? 'scrapped' : ''}"></span>
      <div class="tl-head">
        <span class="tl-action">${esc(label)}</span>
        <span class="tl-time">${formatDate(l.createdAt)}</span>
      </div>
      <div class="tl-body">
        ${flow}
        ${l.detail ? esc(l.detail) : ''}
        ${l.reason ? `<div class="reason"><b>原因：</b>${esc(l.reason)}</div>` : ''}
        <div class="tl-meta">操作人：${esc(l.operator || '—')}${l.equipmentCode ? ' · 器材：' + esc(l.equipmentCode) : ''}</div>
      </div>
    </li>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// 照片上传（点击 + 拖拽）
// ---------------------------------------------------------------------------
const drop = $('#upload-drop');
const fileInput = $('#photo-input');
drop.addEventListener('click', () => fileInput.click());
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('dragover'); });
drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
drop.addEventListener('drop', (e) => {
  e.preventDefault(); drop.classList.remove('dragover');
  if (e.dataTransfer.files.length) uploadPhotos(e.dataTransfer.files);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) uploadPhotos(fileInput.files);
  fileInput.value = '';
});

async function uploadPhotos(files) {
  const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'));
  if (!imgs.length) { toast('请选择图片文件', 'warning'); return; }
  if (imgs.length > 9) { toast('单次最多上传 9 张', 'warning'); return; }
  const fd = new FormData();
  imgs.forEach((f) => fd.append('files', f));
  fd.append('uploader', operator());
  try {
    await api(`/api/equipment/${state.detailId}/files`, { method: 'POST', body: fd });
    toast(`已上传 ${imgs.length} 张照片`);
    openDetail(state.detailId, true);
  } catch (err) { toast(err.message, 'error'); }
}

// ---------------------------------------------------------------------------
// Lightbox
// ---------------------------------------------------------------------------
function showLightbox(src) {
  $('#lightbox-img').src = src;
  $('#lightbox').classList.add('show');
}
$('#lightbox').addEventListener('click', (e) => {
  if (e.target.id === 'lightbox' || e.target.classList.contains('lb-close')) {
    $('#lightbox').classList.remove('show');
  }
});

// ---------------------------------------------------------------------------
// 操作记录页
// ---------------------------------------------------------------------------
async function loadLogs() {
  const params = new URLSearchParams();
  const kw = $('#log-keyword').value.trim();
  const act = $('#log-action').value;
  if (kw) params.set('keyword', kw);
  if (act) params.set('action', act);
  const data = await api(`/api/logs?${params}`);
  const tbody = $('#logs-tbody');
  $('#logs-empty').classList.toggle('hidden', data.items.length > 0);
  tbody.innerHTML = data.items.map((l) => {
    const [label] = ACTION_LABELS[l.action] || [l.action];
    let flow = '—';
    if (l.action === 'status_change' && l.fromStatus && l.toStatus) {
      flow = `<div class="status-flow">${STATUS_BADGE[l.fromStatus] || esc(l.fromStatusLabel)}<span style="color:#9ca3af">→</span>${STATUS_BADGE[l.toStatus] || esc(l.toStatusLabel)}</div>`;
    }
    const detail = l.detail ? `<div>${esc(l.detail)}</div>` : '';
    const reason = l.reason ? `<div class="text-warning" style="margin-top:3px">原因：${esc(l.reason)}</div>` : '';
    return `
    <tr>
      <td class="text-muted">${formatDate(l.createdAt)}</td>
      <td>${l.equipmentCode ? `<a href="javascript:void(0)" data-goto-equip="${l.equipmentId}">${esc(l.equipmentCode)}</a>` : '<span class="text-muted">（已删除）</span>'}</td>
      <td><span class="badge neutral">${esc(label)}</span></td>
      <td>${flow}</td>
      <td style="max-width:420px">${detail}${reason}</td>
      <td>${esc(l.operator || '—')}</td>
    </tr>`;
  }).join('');
}

$('#btn-log-search').addEventListener('click', loadLogs);
$('#log-keyword').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadLogs(); });
$('#log-action').addEventListener('change', loadLogs);
$('#logs-tbody').addEventListener('click', async (e) => {
  const link = e.target.closest('[data-goto-equip]');
  if (!link) return;
  const id = link.dataset.gotoEquip;
  if (!id || id === '0') return;
  // 切到台账视图并打开详情
  $('.nav-item[data-view="equipment"]').click();
  try { await openDetail(id); } catch (_) { toast('该器材台账可能已被删除', 'warning'); }
});

// ---------------------------------------------------------------------------
// 导出（携带当前筛选条件）
// ---------------------------------------------------------------------------
$('#btn-export').addEventListener('click', () => {
  const q = buildQuery();
  delete q.page; delete q.pageSize;
  const params = new URLSearchParams();
  Object.entries(q).forEach(([k, v]) => { if (v !== '' && v != null) params.set(k, v); });
  toast('正在导出当前筛选结果…');
  window.location.href = `/api/export?${params}`;
});

// ---------------------------------------------------------------------------
// 导入
// ---------------------------------------------------------------------------
$('#btn-import-open').addEventListener('click', () => {
  $('#import-result').classList.add('hidden');
  openModal('modal-import');
});
$('#nav-import').addEventListener('click', () => {
  $('#import-result').classList.add('hidden');
  openModal('modal-import');
});

const importDz = $('#import-dropzone');
const importInput = $('#import-input');
importDz.addEventListener('click', () => importInput.click());
importDz.addEventListener('dragover', (e) => { e.preventDefault(); importDz.classList.add('dragover'); });
importDz.addEventListener('dragleave', () => importDz.classList.remove('dragover'));
importDz.addEventListener('drop', (e) => {
  e.preventDefault(); importDz.classList.remove('dragover');
  if (e.dataTransfer.files[0]) handleImportFile(e.dataTransfer.files[0]);
});
importInput.addEventListener('change', () => {
  if (importInput.files[0]) handleImportFile(importInput.files[0]);
  importInput.value = '';
});

async function handleImportFile(file) {
  if (!/\.csv$/i.test(file.name)) { toast('请选择 CSV 文件', 'warning'); return; }
  const text = await file.text();
  try {
    const result = await api('/api/import', {
      method: 'POST',
      body: JSON.stringify({ csv: text, operator: $('#import-operator').value.trim() || operator() }),
    });
    $('#import-result').classList.remove('hidden');
    $('#ir-insert').textContent = result.inserted;
    $('#ir-update').textContent = result.updated;
    $('#ir-fail').textContent = result.failed;
    const errBox = $('#ir-errors');
    if (result.errors.length) {
      errBox.classList.remove('hidden');
      errBox.innerHTML = result.errors.map((m) => `<div>· ${esc(m)}</div>`).join('');
    } else {
      errBox.classList.add('hidden');
    }
    toast(`导入完成：新增 ${result.inserted}，更新 ${result.updated}，失败 ${result.failed}`, result.failed ? 'warning' : 'success');
    loadList();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------------------------------------------------------------------------
// 初始化
// ---------------------------------------------------------------------------
(async function init() {
  try {
    await loadMeta();
    await loadList();
  } catch (err) {
    toast('初始化失败：' + err.message, 'error');
  }
})();
