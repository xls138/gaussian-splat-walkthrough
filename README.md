# Company RoomTour

基于高斯泼溅（Gaussian Splatting）的第一人称漫游应用，使用 Vue 3 + TypeScript + PlayCanvas 构建。支持多房间传送、碰撞检测、多画质分级、移动端触控与 PWA 安装。

## 技术栈

- **Vue 3** — `<script setup>` SFC
- **TypeScript** — 类型安全
- **Vite** — 构建与开发服务器
- **PlayCanvas** — 3D 渲染引擎，加载 `.sog` 高斯泼溅资产
- **@playcanvas/splat-transform** — PLY 到 SOG 格式转换

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器（局域网可访问）
npm run dev

# 类型检查 + 生产构建
npm run build

# 预览生产构建
npm run preview
```

## 核心功能

- **第一人称漫游** — WASD 移动、鼠标视角（Pointer Lock）、Shift 下蹲
- **多房间传送** — 通过门触发器（Door Trigger）在房间之间传送，支持指定出生点
- **碰撞检测** — 支持盒体与圆柱碰撞体，无碰撞体时自动回退到房间边界
- **多画质分级** — Low / Medium / High 三档，对应不同 LOD 精度的 splat 资产与像素比限制
- **移动端触控** — 虚拟摇杆移动、触屏拖拽视角（带惯性）、下蹲按钮
- **小地图** — 可选的实时小地图，显示玩家位置与朝向
- **展品交互** — 靠近展品时弹出提示，查看展品详情（描述、图片、链接）
- **PWA 安装** — 支持添加到主屏幕，全屏横屏运行；iOS Safari 有安装引导
- **Splat 缓存** — 使用 Cache API 缓存 splat 资产，加速二次加载
- **加载进度** — 实时显示 splat 下载进度、大小与速度
- **设置持久化** — 画质、灵敏度、小地图、调试模式保存到 localStorage

## 控制方式

### 桌面端

| 按键 | 功能 |
|------|------|
| `W A S D` | 移动 |
| 鼠标 | 视角（点击进入 Pointer Lock） |
| `Shift` | 下蹲切换 |
| `E` | 交互（进入房间 / 查看展品） |
| `` ` `` | 打开菜单 |
| `Esc` | 关闭展品详情 / 打开菜单 |

### 移动端

- 左下虚拟摇杆 — 移动
- 屏幕拖拽 — 视角（支持惯性滑动）
- 右下按钮 — 下蹲
- 屏幕按钮 — 交互 / 进入房间

## 项目结构

```
├── public/
│   ├── content/
│   │   ├── splats/            # .sog 高斯泼溅资产（low/medium/high）
│   │   ├── rooms.json         # 房间清单（房间、门、画质分级配置）
│   │   ├── exhibits.json      # 展品数据
│   │   ├── unreal-layout.json # Unreal Engine 导出的碰撞体/门/出生点
│   │   └── map/               # 小地图布局
│   ├── manifest.webmanifest   # PWA 清单
│   └── icons                  # 应用图标
├── scripts/
│   ├── convert-splats.ps1     # PLY → SOG 批量转换脚本
│   ├── export-unreal-layout.ps1
│   ├── export_unreal_layout.py # Unreal Engine 布局导出
│   └── validate-layout.mjs    # 房间/门/出生点配置校验
├── src/
│   ├── components/            # Vue UI 组件
│   ├── composables/
│   │   └── useGame.ts         # 核心游戏逻辑（渲染、碰撞、输入、房间管理）
│   ├── types/
│   │   └── game.ts            # 类型定义
│   ├── App.vue                # 根组件
│   ├── main.ts                # 入口
│   └── style.css              # 全局样式
├── vite.config.ts
└── package.json
```

## 配置说明

### rooms.json

顶层清单文件，定义初始房间、画质分级和所有房间：

```json
{
  "initialRoom": "floor-1",
  "unrealLayout": "/content/unreal-layout.json",
  "tiers": {
    "low":    { "maxPixelRatio": 1,    "lod": "low",    "splatBudget": 1250000 },
    "medium": { "maxPixelRatio": 1.25, "lod": "medium", "splatBudget": 2500000 },
    "high":   { "maxPixelRatio": 1.75, "lod": "high",   "splatBudget": 9000000 }
  },
  "rooms": [
    {
      "id": "floor-1",
      "title": "一层",
      "splat": { "high": "...", "medium": "...", "low": "..." }
    }
  ]
}
```

### Unreal 布局

碰撞体、门触发器和出生点可通过 Unreal Engine 导出至 `unreal-layout.json`，运行时与 `rooms.json` 合并。详见 `scripts/export_unreal_layout.py`。

## 工具脚本

```bash
# 点云压缩
npm run splat:convert

# 将 PLY 转换为 SOG（Windows PowerShell）
npm run splat:convert -- -All -Tier all -Overwrite
# 虚幻引擎的x轴旋转相同,其他相反
npm run splat:convert -- -Room floor-1 -Tier low -Rotate "-2,-6,-2" -Overwrite

# 从 Unreal Engine 导出布局
npm run unreal:export-layout

# 校验房间/门/出生点配置是否完整
npm run validate:layout
```

## 调试

在 URL 中添加查询参数启用调试可视化：

| 参数 | 功能 |
|------|------|
| `?debugDoors` | 显示门触发器 AABB |
| `?debugCollision` | 显示碰撞体 |
| `?debugBounds` | 显示房间边界 |
| `?debugExhibits` | 显示展品触发范围 |
| `?debugCoordinate` | 显示实时坐标 |
| `?debugRoom=floor-2` | 直接加载指定房间 |
| `?splatSort=radial` | 强制径向排序 |
