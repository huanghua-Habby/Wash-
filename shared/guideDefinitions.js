/** Shared page counts/text. UI registers image assets for these stable ids before preparation. */
export const GUIDE_DEFINITIONS = Object.freeze({
  'basic-controls': { pages: ['WASD移动，Space跳跃，J交互，K放下/投掷，L技能。'] },
  'tools-water': { pages: ['轻点J拿起毛巾，按住J擦拭；毛巾会逐渐变脏，拿回洗面台按住J恢复耐久。拿起水枪后按住J冲洗泥渍，再用毛巾擦净。水管会限制距离，注意队友。轻点K放下，长按K蓄力投掷。'] },
  'tools-soap': { pages: ['从肥皂箱取肥皂，按住J处理油污，再用水冲洗、毛巾擦净。掉落的肥皂会让人打滑。'] },
  'tools-charging': { pages: ['轻点J拿起充电头，靠近订单车插口按J连接，约6秒充满。充满后进度条变紫，当前有效且未结算的场上订单得分增加50%，不叠加、不影响后来车辆。充电可选，洗净即可完成订单。电线自动收卷且有长度限制，J可拔下；回充电桩可用J召回无人持有的充电头。接地充电头接触积水会使相连湿区带电，踩入会短暂触电麻痹、只能缓慢移动且不能操作。已插接的充电口进水会短路爆炸，弹出插头并击飞附近玩家；留意积水，安全移开电源再取回。电线本体不导电。'] },
  'hazard-road-sign': { pages: ['公告牌出现前2秒会预警危险侧。赶快转移到主车或安全区域，被扫中会死亡并复活。'] },
  // Versus, before the countdown: what the terminal does. Closes when everyone presses J, or by itself after `timeoutSeconds`.
  'versus-terminal': { pages: ['驾驶舱顶的终端：空手站在旁边按住J骇入，充满后对方停靠中的车会被打乱。骇入时会被拍走，守住终端！'], timeoutSeconds: 15 },
});
