# ContributorRank

ContributorRank 是一个基于 Tauri 2.8、Rust 和 React 18 的跨平台开源贡献分析工具。它支持 GitHub / GitLab API 及本地 Git 仓库，使用可配置权重把 Commit、LoC、PR、Issue 和 Review 汇总为透明的贡献分数。

## 1. 环境搭建

### 依赖

- Node.js 20+
- Rust stable（`rustup`）
- Tauri 系统依赖：按照 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) 安装 Linux / macOS / Windows 的 WebView2 或 WebKitGTK

### 初始化与运行

```bash
npm install
npm run dev                 # 仅启动 Vite 浏览器预览
npm run tauri dev           # 启动桌面开发窗口
npm run tauri build         # 构建当前平台安装包
```

如果从零开始，可先执行：

```bash
npm create vite@latest contributor-rank -- --template react-ts
cd contributor-rank
npm install @tauri-apps/api react-router-dom zustand recharts lucide-react
npm install -D tailwindcss postcss autoprefixer @vitejs/plugin-react
npx tailwindcss init -p
npx tauri init
```

然后用本仓库的 `src-tauri`、`src` 和配置文件替换生成内容。

## 2. 项目目录

```text
ContributorRank/
├─ src/                         # React + TypeScript 前端
│  ├─ components/ui.tsx         # shadcn/ui 风格基础组件（Button/Card/Input/...）
│  ├─ lib/tauri.ts              # invoke 封装与浏览器 mock
│  ├─ store/appStore.ts         # Zustand 全局状态、loading/error 生命周期
│  ├─ pages/
│  │  ├─ DashboardPage.tsx      # 表格/卡片排行榜
│  │  ├─ ContributorDetailPage.tsx # 趋势、饼图、时间线
│  │  └─ SettingsPage.tsx       # Token、仓库、权重设置
│  ├─ App.tsx                   # Router、导航和 ErrorBoundary
│  └─ index.css
├─ src-tauri/
│  ├─ src/lib.rs                # Tauri commands、API、SQLite、评分算法
│  ├─ src/main.rs
│  ├─ Cargo.toml
│  └─ tauri.conf.json
├─ components.json              # shadcn/ui 配置
├─ tailwind.config.ts
└─ package.json
```

## 3. 核心实现说明

### Tauri Commands

前端通过 `src/lib/tauri.ts` 调用以下命令：

| Command | 作用 |
| --- | --- |
| `greet` | 健康检查/示例命令 |
| `fetch_repo_data` | GitHub、GitLab 或本地 Git 数据抓取；默认读取 SQLite 缓存 |
| `calculate_rankings` | 对六项指标做 max-normalization 并按权重求和 |
| `save_settings` / `load_settings` | 在应用数据目录读写 `settings.json` |

评分公式为：

```text
score = Σ(weight_i × metric_i / max(metric_i))
```

当权重滑块变化时，前端调用 `calculate_rankings` 重新排序，不需要重新请求远端数据。远端缓存位于应用数据目录的 `cache.sqlite`，key 为 `provider:repository`。

### 数据源

- GitHub：读取最近 100 个 commit（含 stats）、PR、已关闭 Issue；Token 通过 `Authorization: Bearer` 发送。
- GitLab：读取最近 100 个 commit、Merge Request、已关闭 Issue；Token 通过 `PRIVATE-TOKEN` 发送。
- Local：执行 `git log --numstat`，离线计算 Commit、LoC 和趋势，PR/Issue/Review 在离线模式下为 0。

生产环境建议继续加上分页游标、速率限制退避，以及更细粒度的 Review API 聚合。

## 4. 后续迭代建议

1. **可审计导出**：将快照、权重和排名导出为 CSV/JSON/PDF，并保留“计算时使用的 commit 范围”，方便发布项目季度报告。
2. **团队对比与时间窗口**：支持多个仓库/组织、按周/月/版本对比，增加贡献趋势同比和团队健康度指标。
3. **身份归并与高级质量指标**：允许配置 `.mailmap`、GitHub/GitLab 用户映射，并加入 review 响应时间、PR 生命周期、测试覆盖变化等质量维度。
