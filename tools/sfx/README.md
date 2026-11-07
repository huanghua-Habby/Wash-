# 游戏音效制作（真实录音剪辑）

`client/assets/audio/*.wav` 全部剪自真实录音，不含合成音。除 `road_sign_hit` 使用用户提供的素材（存于 `tools/sfx/user/`）外，素材来自 [BigSoundBank](https://bigsoundbank.com)（Joseph Sardin），**CC0 公有领域**，可商用、可修改、无需署名。处理只做剪辑类操作：裁切/对齐起音、变速变调（含音高滑动）、EQ、叠层、淡入淡出、尾部降噪门、循环接缝与响度归一，最后加 TPDF 抖动导出 48 kHz/16-bit WAV（无损，无 MP3 首尾补零，循环可以精确接缝）。

## 重新生成

```sh
python3 -m venv /tmp/sfxvenv && /tmp/sfxvenv/bin/pip install numpy scipy soundfile matplotlib
tools/sfx/fetch_sources.sh /tmp/sfxwork/src                      # 下载原始录音（需要 ffmpeg）
SFX_SRC=/tmp/sfxwork/src /tmp/sfxvenv/bin/python tools/sfx/build.py   # 写入 client/assets/audio（解码 tools/sfx/user 的 mp3 也需要 ffmpeg）
/tmp/sfxvenv/bin/python tools/sfx/qa.py client/assets/audio          # 峰值/响度/首尾爆音/循环接缝
/tmp/sfxvenv/bin/python tools/sfx/harsh.py 'client/assets/audio/*.wav' # 刺耳度：2–5 kHz 占比、啸叫
/tmp/sfxvenv/bin/python tools/sfx/viz.py out.png client/assets/audio/jump_1.wav   # 波形+响度+频谱图
```

同样的源文件重新构建，结果逐字节一致。`onsets.py` 可以列出多段录音里每个事件的起止时间和电平，用来找剪切点。

## 声音与来源

| 文件 | 游戏事件 | 来源（BigSoundBank 编号） | 处理要点 |
| --- | --- | --- | --- |
| jump_1..3 | 起跳 | 1074 嘴弹泡泡 + 1799 木片挥动 | 泡泡 "bloop" 减速并向上滑音（约 350→600 Hz） |
| land_1..3 / drop | 落地 / 放下 | 1045 气球弹地、1825 / 1826 气球撞墙 | 4.5 kHz 低通，补 180 Hz 厚度，去掉响铃般的余音 |
| fall_hit / fall_bounce_1..2 / mew | 摔到马路 / 回弹 / 猫叫 | 2453 人体倒地 + 1045；1473 小猫叫 | 两层按峰值对齐；整体柔化 |
| step_1..4 | 走路（很轻） | 0373 拖鞋踩木地板 | 只取每步开头 75 ms 的轻拍，升调到猫爪大小，2.8 kHz 低通，−24 LUFS |
| pickup_1 / throw / dash / slip | 拿起 / 投掷 / 冲刺 / 滑倒 | 0648 香槟塞；1796、1795 绳子挥动；2280 竖琴 | 柔化 |
| spray_start + spray_loop | 水枪出水 | 0326 水枪长射 | 4.5 kHz 陡峭低通，3.2 kHz 压 5 dB |
| splash_ground_loop | 水落在马路上 | 0171 淋浴 | 硬地面的哗哗声，3.5 kHz 陡峭低通 |
| splash_truck_loop | 水打在车身上 | 1293 车顶上的雨 | 空腔金属的鼓点感，320 Hz 加 4 dB，几乎没有 2 kHz 以上 |
| splash_stain_loop | 水冲污渍 | 1514 慢划水 + 0652 水龙头 | 低沉湿润的泥水哗啦声 |
| splash_cat_loop | 水喷到猫身上 | 0171 淋浴 | 2.2 kHz 四阶低通，像水淋在毛上一样发闷 |
| soap_loop | 打肥皂 | 0778 海绵挤压 + 0183 吸管吹泡泡 | 环形缓冲排布，4.5 kHz 低通 |
| wipe_loop | 毛巾擦拭 | 0663 搓手 + 1104 布料摩擦 | **没有吱吱声**，2.2 kHz 四阶低通，400 Hz 加厚，听起来是柔和的"沙沙"声 |
| rinse_loop | 洗毛巾 | 0652 厨房水龙头 | 柔化 |
| progress_bubble_1..6 | 进度上涨：连续冒泡，音高随进度升高 | 1074 中音高的嘴弹泡泡（约 840–1020 Hz） | 游戏每 0.09–0.14 秒触发一个，播放速率按污渍总进度从 0.6 升到约 1.48（约 550→1350 Hz） |
| pop_1..3 | 污渍完成一步 | 1074 双泡泡 | |
| clean | 污渍洗净 | 1336 香槟杯碰杯（单次） | 短促清脆的高频“叮”，0.32 s，600 Hz 高通、12 kHz 以上去掉 |
| order_complete | 订单完成 | 1865 / 1867 / 1869 / 1874 八音盒 | 降 A 大调上行琶音，所有音都低于 1.1 kHz |
| round_end | 回合结束 | 1553 派对喇叭 + 2363 掌声 | 沿用最初的版本 |
| ui_click | 按钮 | 1074 泡泡 | |
| road_sign_whoosh | 路牌呼啸而过 | 2987 汽车 50 km/h 驶过 + 1801 挥动声 | 驶过录音 5 倍变速压成 1.2 s，多普勒涌起峰值约 0.4 s；减速的挥动声叠在峰值处当破风，5.5 kHz 低通 |
| road_sign_hit | 被路牌拍扁 | 用户提供 `user/heavy_player_hit_2.mp3` | 裁到起音，mp3 解码超满幅峰值先缩到 0.9 再进限幅器，45 Hz 高通、9 kHz 柔化、110 Hz 轻补厚度，0.7 s |
| vehicle_arrive | 订单车飞入 | 2033 飞船驶过 + 0257 汽车喇叭 | 取驶过录音的接近段（2.55 s 涌起），结尾双响喇叭（升调 1.08、2 kHz 压 4 dB） |
| vehicle_leave | 订单车离开 | 2033 + 0257 | 一声喇叭后接驶过录音峰值后的远去段，1.2 倍速 |
| electric_loop | 水洼带电（刺啦刺啦） | 0950 电焊长焊 + 2006 功放接地不良的 50 Hz 交流哼声 + 0134 音箱电击噼啪 | 焊弧 0.8 倍速（100 Hz 弧光嗡嗡变粗），两层底噪各自响度对齐后哼声低 10 dB，三段噼啪声放在环形缓冲里；先滤波再接缝，5 kHz 低通、3.2 kHz 压 10 dB，2.6 s，−26 LUFS |
| shock_zap | 角色触电 | 1252 电围栏放电 + 0134 + 0952 电焊短焊 | 电围栏的一声脆响起音，接音箱电击的断续嗡嗡和电焊噼啪并逐渐熄灭，5 kHz 四阶低通，1.0 s |
| short_explosion | 短路爆炸 | 1252 + 1808 驱鸟炮近距离爆炸 + 1023 远处爆炸 + 0134 | 电火花脆响后接 0.42 倍速的驱鸟炮（1.8 kHz 低通，变成柔和的“嘭”），远处爆炸的滚动余音当作冒烟尾巴，几声零星噼啪，1.7 s |
| plug_pop | 充电插头被崩飞 | 0274 酒瓶塑料塞 + 1355 9 mm 弹壳落地 + 1801 | 塞子“啵”一声，叠半速的弹壳金属叮当（插脚），接金属管挥动的呼啸，0.43 s |

### 二次剪辑（`tools/sfx/derive.py`）

BigSoundBank 下载现被 Cloudflare 拦截（403），以下音效从仓库里已发布的 wav（它们本身就是上表真实录音的剪辑）再剪辑得到，同样只做变速、EQ、叠层、淡入淡出与响度；只读已发布文件，结果确定：`/tmp/sfxvenv/bin/python tools/sfx/derive.py`。

| 文件 | 游戏事件 | 来源 | 处理要点 |
| --- | --- | --- | --- |
| slap_swing | 拍打挥爪（打中打空都有） | dash（1795）+ throw（1796）绳子挥动 | 1.35 / 1.7 倍速叠成 0.28 s 的短促“嗖”，320 Hz 高通，1.2 kHz 加 3 dB 提亮，−11（比原 dash 响约 6 dB） |
| slap_hit | 拍打命中 | road_sign_hit（用户素材）+ fall_hit + land_1 | 重击起音 1.22 倍速提脆，叠人体倒地与气球拍击、一声落地闷响，110 Hz 加厚、2.6 kHz 轻提，0.24 s，−8 |
| order_complete_rival | 对抗中对方车洗完 | order_complete（八音盒）+ drop | 0.84 倍速（降约小三度、放慢），前置一声闷响，2.6 kHz 四阶低通变暗，−17 |
| wing_flap | 加拿大鹅空中扑腾 | throw（1796） | 0.82 倍速、2.4 kHz 四阶低通，两下相隔 85 ms 的“呼呼”翅膀拍击，−15 |

## 舒适度检查

`harsh.py` 会统计每个音效有多少能量落在 2–5 kHz（耳朵最敏感、"刮黑板"声集中的频段）和 6 kHz 以上，并标出窄带音调尖峰（啸叫）。ASMR 版本里，所有循环音效的 2–5 kHz 占比都不超过 16%：毛巾从原来的吱吱声（谐波尖锐）改成了 15.6%，订单完成音从 98.9% 降到 0.1%。泡泡、碰杯、八音盒这类本来就有音调的声音会被标出"音调突出"，那是设计如此。

## 背景音乐

原曲由用户提供（Suno 生成）：`Lazy Sunday Swing`（主界面）和 `Swinging with the Band`（局内）。

```sh
/tmp/sfxvenv/bin/pip install pyloudnorm
/tmp/sfxvenv/bin/python tools/sfx/loopfind.py menu.wav 120 136.5 60   # 找循环点：节拍、整小节、频谱相似度
/tmp/sfxvenv/bin/python tools/sfx/music.py "<主界面.mp3>" "<游戏中.mp3>" client/assets/music
```

`music.py` 做三件事：在循环点前做好交叉淡化，去掉原曲结尾（只在 loopEnd 后留 1 秒内容作缓冲，避免解码器的首尾补零影响循环），响度统一到 −18 LUFS，再用 LAME V2 编码。频率避让不写进文件，而是在运行时的音乐总线上做（见 `client/js/audio/sounds.js` 的 `MUSIC_EQ`），这样以后还能随时调整。
