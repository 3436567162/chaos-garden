<a id="top"></a>

# chronoscope

> 把一个 Git 仓库变成一座可以拖着时间轴看它长大的城市。

每个文件是一栋楼：**高度 = 代码行数**，**颜色 = 编程语言**，**位置 = 文件路径**（整个历史中不跳变）。拖动时间轴或按下播放，城市就从空地上长出来、扩张、拆迁、重建。用来回答三个问题：陌生代码库里哪块是核心、哪块是历史遗留；某个变化是哪次提交带来的；这个项目是怎么一步步长成今天的样子的。

完全离线的本地桌面应用：没有登录、没有网络请求、没有后端服务。

**返回** [`chaos-garden`](../README.md)

## 导航

| 章节 | 内容 |
| :--- | :--- |
| [当前进度](#当前进度) | 分阶段交付，现在在哪一步 |
| [快速开始](#快速开始) | 安装与运行 |
| [操作](#操作) | 鼠标与键盘 |
| [视觉编码](#视觉编码) | 高度、颜色、位置分别代表什么 |
| [技术栈](#技术栈) | 选型 |
| [目录结构](#目录结构) | 每个文件管什么 |
| [实现要点](#实现要点) | 稳定布局、InstancedMesh、可打断的过渡 |
| [已知限制](#已知限制) | 尚未完成与需要注意的地方 |

---

## 当前进度

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| Phase 0 | Tauri + React + Three.js 骨架，假数据驱动的 3D 城市、时间轴、自动播放 | ✅ 完成 |
| Phase 1 | `git2` 真实扫描器：blob 去重缓存、≤200 采样点、按需扫描、HEAD 增量失效 | ⏳ 下一步 |
| Phase 2 | 悬停 tooltip、键盘逐 commit 步进、搜索、射线拾取 + 文件详情与修改史、入场生长动画 | 计划中 |
| Phase 3 | 10000 方块 60fps 实测、空态 / 错误态、细节打磨 | 计划中 |
| Phase 4 | `git bisect` 二分查找可视化（可选） | 计划中 |

目前打开应用看到的是内置的演示仓库 `lighthouse`（8 个手写 commit、最多 79 个文件），还不能选择真实仓库。

---

## 快速开始

```bash
cd chronoscope
npm install
npm run tauri dev      # 桌面开发窗口
npm run tauri build    # 构建当前平台安装包
```

依赖：Node.js 20+、Rust stable、以及对应平台的 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)。首次 `tauri dev` 需要编译 Rust 依赖，约 2 分钟。

只看前端画面也可以 `npm run dev`，再用浏览器打开 <http://localhost:1420/>。

检查命令：

```bash
npm run typecheck                                       # tsc --noEmit
cd src-tauri && cargo clippy --all-targets -- -D warnings
```

---

## 操作

| 操作 | 效果 |
| --- | --- |
| 左键拖拽 | 环绕旋转（不会自动旋转） |
| 右键拖拽 | 平移 |
| 滚轮 | 缩放 |
| 拖动 / 点击时间轴 | 跳到对应 commit，城市跟手变形；播放中拖动会自动暂停 |
| 播放按钮 / `空格` | 自动播放 / 暂停；在最后一个 commit 按播放会从头重播 |
| `0.5×` `1×` `2×` `4×` | 播放速率；1× 每个 commit 停留约 0.9 秒 |

---

## 视觉编码

| 维度 | 含义 |
| --- | --- |
| 高度 | `log1p(行数)`，有上限——否则一个上万行的 vendored 文件会压扁整座城 |
| 占地 | 同样按对数随行数放大，留出街道 |
| 颜色 | 编程语言。源码用饱和色（TypeScript 蓝、Rust 珊瑚橙、CSS 紫……），配置与文档用浅瓷色，让真正的代码先跳出来 |
| 前后（Z） | 目录深度：根目录文件离镜头最近，越深越远 |
| 左右（X） | 同一深度内按路径字典序排列，同目录的文件挨在一起 |
| 出现 / 消失 | 新文件从暗处升起，删除的文件变暗并沉入地面 |

时间轴下方的面积图是每个 commit 的总行数，已播放的部分以蓝→橙渐变高亮。

---

## 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面壳 | Tauri 2.12（Rust） |
| 前端 | React 18 + TypeScript 5.9 + Vite 6 |
| 3D | three 0.186（唯一 3D 依赖）：InstancedMesh、OrbitControls、UnrealBloom 后处理 |
| 图表 | 时间轴面积图用 Canvas 2D 手绘，无图表库 |
| 样式 | 原生 CSS，无组件库 |
| Git（Phase 1） | `git2` 直接读本地 `.git`，完全离线 |
| 缓存（Phase 1） | JSON 文件：缓存只按仓库整读整写，不需要查询；路径表 + 每个快照存索引数组，200 个采样点 × 1 万文件也只有几 MB，且省掉 SQLite 的 C 编译 |

---

## 目录结构

```text
chronoscope/
├─ src-tauri/
│  ├─ src/
│  │  ├─ main.rs           # 入口
│  │  └─ lib.rs            # Tauri builder，注册 dialog 插件（Phase 1 加 commands）
│  ├─ capabilities/        # 权限：core:default、dialog:default
│  └─ tauri.conf.json      # 生产环境 CSP 只允许本地与 IPC
├─ src/
│  ├─ App.tsx              # 场景生命周期、当前 commit、自动播放调度、空格快捷键
│  ├─ types.ts             # Snapshot / FileEntry，与 Rust 模型一一对应
│  ├─ mock.ts              # Phase 0 演示仓库（8 个 commit 的增删改）
│  ├─ format.ts            # 日期、数字、短 SHA
│  ├─ three/
│  │  ├─ CityScene.ts      # 渲染器、相机、灯光、阴影、地面、网格、Bloom
│  │  ├─ BlockField.ts     # 单个 InstancedMesh 承载全部文件
│  │  ├─ layout.ts         # path → 稳定网格坐标
│  │  ├─ morph.ts          # 快照 → 目标数组，以及 A → B 的缓动插值
│  │  └─ palette.ts        # 语言色板与场景配色
│  └─ components/
│     ├─ CommitBar.tsx     # 顶部：提交信息卡 + 文件 / 行数 / 进度
│     ├─ Legend.tsx        # 语言占比条与图例
│     ├─ Timeline.tsx      # 时间轴、刻度、面积图、拖动
│     └─ Playback.tsx      # 播放 / 暂停与速率
└─ package.json
```

---

## 实现要点

<details>
<summary><b>布局对整个历史只算一次</b></summary>

`computeLayout` 吃的是所有快照里出现过的路径的**并集**，所以每个文件从出生到删除都占着同一块地：还没出现的文件留着空地，删掉的文件留下空洞。按目录深度分带、带内字典序（按 code unit 比较，不受系统语言影响）、固定列数折行，让城市保持接近正方形。

</details>

<details>
<summary><b>一万个文件也只有一次 draw call</b></summary>

所有方块共用一个 `InstancedMesh`，每帧直接写 `instanceMatrix`（只有缩放 + 平移，手写列主序矩阵，不走 `Matrix4.compose`）和 `instanceColor`。方块几何体的顶点色里烘了一条竖向渐变——墙脚暗、楼顶亮——与实例颜色相乘，不加任何额外 pass 就有接地感和发光的屋顶，再交给 Bloom 晕开。

</details>

<details>
<summary><b>过渡可以随时被打断</b></summary>

每个文件槽位存 `[高度, 占地, r, g, b]` 五个浮点数。切换 commit 时，新的过渡总是**从屏幕上此刻的值**出发，而不是从上一个目标出发，所以快速拖动或高速播放时不会跳帧。过渡 300ms、easeOutCubic、requestAnimationFrame 驱动；高速播放时过渡时长自动缩短到步长的 80%，保证每一步都能走完。

</details>

<details>
<summary><b>地面没有硬边</b></summary>

地面和城市下方的光池都是径向透明渐变贴图，网格线的亮度按到中心的距离衰减并用加色混合，天空是 Canvas 生成的靛蓝渐变加一层暖色地平线薄雾。整座城像浮在暮色里，而不是放在一块方板上。

</details>

---

## 已知限制

- 还没有接入真实 Git 仓库（Phase 1）；目前只有内置演示数据
- Bloom 与软阴影有额外开销，10000 方块下的帧率尚未实测（Phase 3）
- 生产包约 730 kB（three 未拆包），对本地桌面应用影响不大
- 当前一个 commit 只记录提交信息首行

---

## AI 辅助

本项目由 **Claude Fable 5** 生成：工程脚手架、Tauri 配置、布局算法、InstancedMesh 渲染与过渡、视觉设计、时间轴与自动播放均由该模型产出。

[回到顶部](#top)
