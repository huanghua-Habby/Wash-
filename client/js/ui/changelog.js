/** Player-facing update notes, newest first (UI_MANAGEMENT.md 更新内容). `version` matches the application-version meta in
 * client/index.html; the newest entry auto-opens once per browser when that version is new to it. Text is the Chinese
 * source (written by the user, 2026-10-21); English lives in client/js/i18n/en.js like every other string. */
export const CHANGELOG = Object.freeze([
  {
    version: '0.5',
    title: '更新到版本 0.5！',
    sections: [
      { title: '新增模式：', items: ['对抗模式！现在开始你们有正当的理由对着其他人喷水枪了！'] },
      { title: '新增交互点：', items: ['终端！可以通过使用它来骇入对方的车辆，让他们发生故障！'] },
      { title: '新成员增加：', items: [
        '松鼠。闪电般迅猛，还能攀墙！同时比较娇小，不容易被打中！',
        '加拿大鹅。暴躁的打手，可以光速出拳，而且能在天空中飞行一段时间！',
        '袋鼠。沉稳的打手，拳拳到肉，可以把人打飞的更远！',
      ] },
      { title: '新增BOT系统：', items: ['有一群超级聪明（阿巴阿巴）的队友随时帮你填满空缺！现在你可以跟你的AI队友一起玩游戏了（仅限对抗模式），可不要小看他们哦！'] },
      { title: '新增表情系统：', items: ['按下U+WSAD可以选择各种可爱的表情，表达你当前的心情！'] },
      { title: '新增规则：', items: [
        '新增操作：打人！在空手时按下J/K可以进行攻击！',
        '新增操作：踩头！在空中跳到其他玩家时可以像马里奥一样再次跳跃！',
        '新增异常状态：眩晕！打架的时候打累了睡觉不是很正常的事情吗？',
      ] },
      { title: '已有机制更新：', groups: [
        { title: '加强：', items: [
          '鹈鹕新增能力：飞行。现在鹈鹕在没吞人的情况下保持滑翔！',
          '猫猫的复活时间加强：原先面板复活时间降低60%，但是会只吃50%，现在正常了！',
          '狗狗的工作效率加强：进度条加速幅度从50%提升到60%！',
        ] },
        { title: '削弱：', items: [
          '鹈鹕的L技能削弱：现在在鹈鹕的肚子里按下任何键位都可以试图挣脱它！',
          '大象的水枪能力削弱：充能速度降低到原先的75%！',
        ] },
        { title: '调整：', items: [
          '水枪的手感重新调整：现在水枪的发射位置从小到大的幅度变大了，可以达到更多的东西了！',
          '大象的水枪能力削弱：我们发现大象有点太强了，大象的水枪冲能时间降低到现在的75%',
          '肥皂的重新设计：肥皂现在会给周围玩家留下泡沫，让他们的脚持续打滑！',
        ] },
      ] },
      { title: '优化已存在问题：', items: [
        '服务器交互优化：更低的交互包，更流畅的游戏体验，支持8人同时联机！',
        '表现兼容：现在开始会根据电脑的帧数自动适配游戏清晰度！你的配置好他当然会自动适配成更强！',
        '语音优化：语音现在支持静音检测，降低包体交互量！',
        '新的UI适配兼容：现在根据对抗模式，带出全新的UI交互！',
      ] },
    ],
  },
]);
