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
| [实现要点](#实现要点) | 稳定布局、InstancedMesh、连续时钟、径向错峰 |
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
| 拖动 / 点击时间轴 | 停到任意位置（可停在两个 commit 中间），城市精确渲染在该中间态；播放中拖动会自动暂停 |
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
| 变化时机 | 播放时逐块径向错峰，从城市中心向外扩散 |

时间轴下方的面积图是每个 commit 的总行数，已播放的部分以蓝→橙渐变高亮，高亮边界随播放位置连续移动。

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
│  ├─ App.tsx              # 场景生命周期、连续播放位置、自动播放调度、空格快捷键
│  ├─ types.ts             # Snapshot / FileEntry，与 Rust 模型一一对应
│  ├─ mock.ts              # Phase 0 演示仓库（8 个 commit 的增删改）
│  ├─ format.ts            # 日期、数字、短 SHA
│  ├─ three/
│  │  ├─ CityScene.ts      # 渲染器、相机、灯光、阴影、地面、网格、Bloom；开放 onTick 帧循环
│  │  ├─ BlockField.ts     # 单个 InstancedMesh 承载全部文件；按快照身份缓存目标数组
│  │  ├─ layout.ts         # path → 稳定网格坐标
│  │  ├─ morph.ts          # 快照 → 目标数组；两目标集之间的小数位置混合与错峰
│  │  └─ palette.ts        # 语言色板与场景配色
│  └─ components/
│     ├─ CommitBar.tsx     # 顶部：提交信息卡 + 文件 / 行数 / 进度
│     ├─ Legend.tsx        # 语言占比条与图例
│     ├─ Timeline.tsx      # 时间轴、刻度、双层面积图、任意位置停靠
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
<summary><b>时间不是离散的，是一条连续坐标</b></summary>

播放位置 `posRef` 是一个**浮点数**，`3.5` 表示「在 commit 3 和 4 的正中间」。它同时喂给三处：3D 城市按 `floor`/`ceil` 取两个快照再按小数部分混合、时间轴游标直接用它算百分比、顶部信息用 `floor` 选 commit。

因此不存在「吸附到最近 commit」这回事，鼠标可以停在任意位置，松手后 3D 就精确渲染在那个中间态。

早期版本把位置当成整数 commit 索引，于是拖动必然被 `Math.round` 吸附；而且从中间位置按播放时，前半步因为没有 commit 跨越而完全静止。

</details>

<details>
<summary><b>Morph 没有内部补间，时钟归调用方</b></summary>

`Morph` 只剩一个 `blend(a, b, f, staggered)`，没有计时器、没有 `retarget`、没有 `step`。位置由外部时钟直接写入，于是「停住」和「播放中」不再是两套需要互相等待的机制 —— 这正是任意位置停靠能成立的前提。

播放时每帧调用 `BlockField.showAt`，目标数组按**快照身份**缓存（`bakedA`/`bakedB`），只有跨 commit 才重建，所以每帧的代价只是一次 blend 加一次 instance 上传。

</details>

<details>
<summary><b>涟漪：逐块径向错峰 + 速度连续缓动</b></summary>

`staggered` 为真时，每个槽位按到城市中心的距离取一个延迟（`0.76 * r^0.65`，再混一点路径 hash 抖动让波前不是完美圆环），最大延迟为段长的 55%。于是一次提交读起来像涟漪从中心向外扩散，而不是全城同时跳一下。

缓动用 `flow(t) = t + (smoothstep(t) - t) * 0.32`：起点与终点的斜率相同，所以运动能跨过 commit 边界而不停顿。停靠时 `staggered` 为假，直接应用精确小数，此时城市必须严格落在你选的位置上。

</details>

<details>
<summary><b>命令式接管 DOM，React 不要插手</b></summary>

时间轴的游标位置和图表染色完全由 `requestAnimationFrame` 直接写 DOM，**JSX 上不保留任何对应的内联样式**。否则每次 React 重渲染都会把 `left` 重写回整数位置，下一帧再拉回来 —— 净效果是每个 commit 边界猛跳一下。

图表拆成上下两层 canvas：底层画「未来」是静态的，上层画「已播放」叠在上面并用 `clip-path: inset()` 裁剪。这样移动游标每帧只写一个 style，完全不重画 `Path2D`。

</details>

<details>
<summary><b>只有一个渲染循环</b></summary>

`CityScene.onTick(dt)` 把已有的 rAF 循环开放给上层，播放时钟和时间轴游标都挂在上面，不会出现两个循环各自漂移。播放与渲染共用同一个 `now`，过渡从当帧开始而不是下一帧，因此没有一帧的卡顿。

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

本项目由 AI 生成，分两个阶段：

| 阶段 | 模型 | 承担的工作 |
| --- | --- | --- |
| Phase 0 主体 | **Claude Fable 5** | 工程脚手架、Tauri 配置、布局算法、InstancedMesh 渲染、视觉设计、时间轴与自动播放 |
| 动效与时间轴重构 | **space bunny** | 连续播放时钟、径向错峰、速度连续缓动、时间轴命令式渲染与任意位置停靠 |

第二阶段修掉了首版动效的三个问题：过渡只占每步 900ms 中的 300ms 导致城市三分之二时间静止、`easeOutCubic` 把运动压在开头导致每个 commit 边界速度归零、以及进度条无法停在任意位置。详见[实现要点](#实现要点)。

[回到顶部](#top)
