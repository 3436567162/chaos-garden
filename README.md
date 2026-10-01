# chaos-garden

> Where my half-baked ideas get baked.

个人实验场 / 半成品收容所。这里放着我用 AI 辅助写的一些小项目，每个项目一个独立文件夹，没有统一的构建体系，按需单独安装依赖、单独运行。

## 导航

| 项目 | 一句话 | 技术栈 | 运行 |
| :--- | :--- | :--- | :--- |
| [ContributorRank](#contributorrank) | 跨平台开源贡献度分析桌面应用，透明加权评分 | Tauri 2.8 · Rust · React 18 · TypeScript | `npm install && npm run tauri dev` |
| [house_game · 禅庭](#house_game--禅庭) | 可走进去的日式枯山水庭院，全程序化生成 | Three.js 0.170 · GLSL · WebAudio | `python -m http.server 8000` |

<details>
<summary><b>目录结构</b></summary>

```text
chaos-garden/
├─ ContributorRank/        # 开源贡献度分析桌面应用（Tauri + Rust + React）
└─ house_game/             # 禅庭 · Three.js 枯山水互动场景（零构建，无依赖安装）
```

</details>

---

<a id="contributorrank"></a>

## ContributorRank

一个跨平台的**开源贡献度分析工具**：抓取 GitHub / GitLab / 本地 Git 仓库的提交数据，用可配置权重把 Commit、LoC、PR、Issue、Review 汇总成一份透明的贡献排行榜。

<details>
<summary><b>技术栈</b></summary>

| 层 | 选型 |
| --- | --- |
| 桌面壳 | Tauri 2.8 |
| 后端 | Rust（`reqwest` + `serde` + SQLite 缓存） |
| 前端 | React 18 + TypeScript + Vite 6 |
| 样式 | Tailwind CSS 3 + shadcn/ui 风格组件 |
| 状态 / 图表 / 路由 | Zustand · Recharts · React Router |
| 图标 | lucide-react |

</details>

<details>
<summary><b>核心能力</b></summary>

- **三数据源**：GitHub REST API、GitLab REST API、本地 `git log --numstat`（离线可用）
- **六项指标**：`commits`、`loc`（增删行数）、`prs`、`mergedPrs`、`closedIssues`、`reviews`
- **透明评分**：`score = Σ(weight_i × metric_i / max(metric_i))`，权重滑块实时重算，不重复请求远端
- **身份归并**：同一 contributor 的多平台账号合并为一条记录
- **本地优先**：Token 与设置只存在本机 `settings.json`，远端快照缓存在 `cache.sqlite`
- **可视化**：排行榜表格/卡片、贡献趋势、指标占比饼图、事件时间线

</details>

<details>
<summary><b>评分公式</b></summary>

```text
score = Σ( weight_i × metric_i / max(metric_i) )
```

权重范围 `0 ~ 2`，`0` 表示忽略该指标。调整权重只触发本地重排序，不触发重新抓取。

</details>

<details>
<summary><b>运行</b></summary>

```bash
cd ContributorRank
npm install
npm run tauri dev      # 桌面开发窗口
npm run tauri build    # 构建当前平台安装包
```

依赖：Node.js 20+、Rust stable、以及对应平台的 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)。

</details>

更详细的设计说明、目录职责与后续迭代计划，见 [`ContributorRank/README.md`](ContributorRank/README.md)。

---

<a id="house_game--禅庭"></a>

## house_game · 禅庭

一座可以走进去的**日式枯山水庭院**：白砂、石组、五重宝塔、盘旋青龙，四个季节与一整套可交互器物，**全部程序化生成**——没有模型文件、没有贴图素材、没有音频文件。

<details>
<summary><b>技术栈</b></summary>

| 层 | 选型 |
| --- | --- |
| 渲染 | Three.js 0.170（WebGLRenderer、ACESFilmic、PCFSoft 阴影） |
| 相机 | OrbitControls（阻尼 / 环游 / 跟随龙） |
| 着色 | GLSL ES 3.0（砂面、天空、水面、积雪 patch） |
| 贴图 | 运行时 Canvas 生成（砂纹高度图、光晕、噪声） |
| 音频 | WebAudio 实时合成 |
| 模块 | 原生 ESM + importmap，无打包器 |

</details>

<details>
<summary><b>核心玩法</b></summary>

- **耙砂**：拖动即在白砂上耙出砂纹，耙砂僧会同步跟着耙
- **投石**：点击白砂泛起同心涟漪
- **四季**：`1`–`4` 切换春樱 / 夏雨 / 秋枫 / 冬雪，环境色连续插值过渡
- **昼夜**：`N` 切换，灯笼自动点亮；`F` 跟随青龙飞行
- **器物**：宝塔风铃可撞响、青龙会喷火、石灯笼可点灭、鹿威蹲踞会流水、屋顶有猫

</details>

<details>
<summary><b>运行</b></summary>

```bash
cd house_game
python -m http.server 8000     # ES Module 需经 HTTP 打开，file:// 会被 CORS 拦截
```

无 `npm install`，无构建步骤。`three` 由 importmap 指向 CDN，改版本只需动 `index.html` 一行。

</details>

场景架构、几何算法、着色器、交互系统与模块拆分详见 [`house_game/README.md`](house_game/README.md)。

---

<a id="使用的-ai"></a>

## 使用的 AI

本仓库项目由 AI 辅助生成。

| 项目 | 模型 | 承担的工作 |
| --- | --- | --- |
| ContributorRank | **GLM-5.3 flash** | 主要产出：工程脚手架、前后端实现、UI 与交互 |
| ContributorRank | **GLM-5.3** | 算法设计：多平台数据聚合、身份归并、归一化加权评分模型 |
| house_game | **Claude Opus 5.5** | 全部产出：场景架构、程序化几何、着色器、交互系统、模块拆分 |

<details>
<summary><b>分工说明</b></summary>

评分模型的设计思路（指标选取、max-normalization 的取舍、权重语义）由 **GLM-5.3** 敲定，具体工程落地由 **GLM-5.3 flash** 完成。

禅庭场景（`house_game`）由 **Claude Opus 5.5** 独立完成，涵盖砂纹高度图算法、破面屋顶曲面、龙的脊线扫掠、四季环境插值与积雪 shader patch 等全部实现。

</details>

---

## 说明

- 各子项目互相独立，没有 monorepo 工具链，请进入对应目录单独安装依赖。
- `node_modules/`、`dist/`、`src-tauri/target/` 等构建产物与依赖均已被 `.gitignore` 排除。
