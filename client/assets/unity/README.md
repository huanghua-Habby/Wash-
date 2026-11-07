# 复用的 Unity 水枪

`watergun.glb` 来源于原 Unity Wash 项目目录：

- Mesh：`Assets/Recovered/downloadablecontent/dlc02/dlc_assets/models/shared kitchen/m_dlc2_watergun_01.asset`。
- 贴图：同目录 `textures/t_dlc2_watergun_01_d.tga`。
- 参照：`Assets/Wash/Prefabs/Playable/WaterGun.prefab` 与 `WaterSpray.prefab`、`Assets/Wash/Scripts/WashNozzle.cs`。

导出保留原 mesh 的 3103 个顶点和三个子网格，将朝向调整到当前游戏的 +X，贴图缩至不超过 512×512 并内嵌，无外部贴图链接。玻璃材质用网页材质适配。

复现命令（Python + Pillow）：

```bash
python3 tools/export_unity_watergun.py /path/to/Unitygame/Wash
```

原 Unity ParticleSystem 未直接运行于网页；喷流用轻量粒子表现，命中沿简化曲线判定。服务器仅使用共享规则与占位几何，不加载本 GLB。

`water-puff.json` 直接提取原喷流及碰撞子发射器使用的 `Assets/Recovered/particles/meshes/RunPuff.asset`（GUID `2236f5775ca3e3146a4090798e0f0dc0`），保留 220 个顶点、274 个三角形，归一化尺寸并转换坐标。网页参考主喷流大小曲线、`collision_fill` 的 0.3 秒快速鼓起/缩小，以及 `collision_smokespread` 的 12 粒子、约 0.2 秒宽角散射。

三层各一次 GPU instancing 绘制；飞行、散射、旋转、生长和消散由 shader 根据出生参数与时间计算。CPU 只在发射时写入出生记录，不逐帧移动粒子。

```bash
python3 tools/export_unity_water_puff.py /path/to/Unitygame/Wash
```
