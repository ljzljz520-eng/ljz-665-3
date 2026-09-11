/**
 * 首次启动时写入演示数据（仅在台账为空时执行）。
 */
const store = require('./store');

/** 取 n 个月前的日期（YYYY-MM-DD），用于构造长期有效的超期样例 */
function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

function seed() {
  if (store.listEquipment().length > 0) return;

  const samples = [
    { code: 'XF-MH-0001', type: '灭火器', building: '1号楼', floor: '1F', location: '大厅东侧', model: 'MFZ/ABC4 干粉 4kg', inspectDate: '2026-08-28', owner: '张伟', status: 'normal' },
    { code: 'XF-MH-0002', type: '灭火器', building: '1号楼', floor: '2F', location: '电梯口右侧', model: 'MFZ/ABC4 干粉 4kg', inspectDate: '2026-08-28', owner: '张伟', status: 'normal' },
    { code: 'XF-MH-0003', type: '灭火器', building: '2号楼', floor: '3F', location: '走廊西端', model: 'MT/3 二氧化碳 3kg', inspectDate: '2026-07-15', owner: '李娜', status: 'disabled' },
    { code: 'XF-XHS-0001', type: '消火栓', building: '1号楼', floor: '1F', location: '楼梯间', model: 'SN65 室内消火栓', inspectDate: '2026-09-01', owner: '王强', status: 'normal' },
    { code: 'XF-XHS-0002', type: '消火栓', building: '2号楼', floor: '2F', location: '楼梯间', model: 'SN65 室内消火栓', inspectDate: '2026-06-20', owner: '李娜', status: 'scrapped' },
    { code: 'XF-SB-0001', type: '应急照明', building: '1号楼', floor: 'B1', location: '车库入口', model: '消防应急灯（双头）', inspectDate: '2026-08-10', owner: '王强', status: 'normal' },
    { code: 'XF-SS-0001', type: '疏散指示', building: '2号楼', floor: '1F', location: '大厅通道', model: '安全出口标志灯', inspectDate: '2026-08-10', owner: '赵敏', status: 'normal' },
    // 超期样例：基础状态仍为「在用」，检查日期超过 12 个月，由系统派生展示为「超期未检」
    { code: 'XF-SP-0001', type: '喷淋头', building: '3号楼', floor: '5F', location: '办公区吊顶', model: 'ZSTX-15 下垂型 68℃', inspectDate: monthsAgo(14), owner: '陈刚', status: 'normal' },
    { code: 'XF-JB-0001', type: '火灾报警按钮', building: '1号楼', floor: '3F', location: '电梯厅', model: 'J-SAP-M 手动报警按钮', inspectDate: '2026-09-02', owner: '张伟', status: 'normal' },
    { code: 'XF-MH-0004', type: '灭火器', building: '3号楼', floor: '1F', location: '前台旁', model: 'MFZ/ABC4 干粉 4kg', inspectDate: '2026-09-05', owner: '陈刚', status: 'normal' },
  ];

  for (const s of samples) {
    store.insertEquipment({ ...s });
  }

  const disabled = store.getEquipmentByCode('XF-MH-0003');
  store.addLog({
    equipmentId: disabled.id, equipmentCode: disabled.code, action: 'status_change',
    fromStatus: 'normal', toStatus: 'disabled',
    reason: '压力表指针进入红区，压力不足，待充装', operator: '张伟',
    detail: '月度检查发现失压，现场停用并挂警示牌',
  });

  const scrapped = store.getEquipmentByCode('XF-XHS-0002');
  store.addLog({
    equipmentId: scrapped.id, equipmentCode: scrapped.code, action: 'status_change',
    fromStatus: 'disabled', toStatus: 'scrapped',
    reason: '箱体锈蚀严重、阀件损坏，维修成本超过重置成本', operator: '王强',
    detail: '已联系供应商回收，同位置新设备 XF-XHS-0003 待安装',
  });
}

module.exports = { seed };
