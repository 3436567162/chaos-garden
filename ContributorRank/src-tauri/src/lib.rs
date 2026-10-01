use chrono::Utc;
use reqwest::{header, Client};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sqlx::{sqlite::SqliteConnectOptions, sqlite::SqlitePoolOptions, Row, SqlitePool};
use std::{collections::HashMap, fs, path::{Path, PathBuf}, process::Command};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Weights { pub commits: f64, pub loc: f64, pub prs: f64, pub merged_prs: f64, pub closed_issues: f64, pub reviews: f64 }

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TrendPoint { pub date: String, pub additions: i64, pub deletions: i64, pub commits: i64 }

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEvent { pub date: String, pub r#type: String, pub title: String, pub url: Option<String> }

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ContributorMetrics {
  pub login: String, pub name: String, pub avatar_url: Option<String>, pub commits: i64, pub additions: i64, pub deletions: i64,
  pub prs: i64, pub merged_prs: i64, pub closed_issues: i64, pub reviews: i64, pub timeline: Vec<TimelineEvent>, pub trend: Vec<TrendPoint>
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributorRank { #[serde(flatten)] pub metrics: ContributorMetrics, pub score: f64, pub rank: usize }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSnapshot { pub provider: String, pub repository: String, pub fetched_at: String, pub contributors: Vec<ContributorMetrics> }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings { pub provider: String, pub repository: String, pub token: String, pub weights: Weights }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchRepoRequest { pub provider: String, pub repository: String, pub token: Option<String>, pub force_refresh: Option<bool> }

#[derive(Default)]
struct Aggregate { metrics: ContributorMetrics, trends: HashMap<String, TrendPoint> }

impl Aggregate {
  fn new(login: String, name: String, avatar_url: Option<String>) -> Self { Self { metrics: ContributorMetrics { login, name, avatar_url, ..Default::default() }, trends: HashMap::new() } }
  fn trend(&mut self, date: &str, additions: i64, deletions: i64) { let key = date.get(0..7).unwrap_or(date).to_string(); let point = self.trends.entry(key.clone()).or_insert_with(|| TrendPoint { date: key, ..Default::default() }); point.additions += additions; point.deletions += deletions; point.commits += 1; }
  fn finish(mut self) -> ContributorMetrics { let mut trend: Vec<_> = self.trends.into_values().collect(); trend.sort_by(|a, b| a.date.cmp(&b.date)); self.metrics.trend = trend; self.metrics }
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> { app.path().app_data_dir().map_err(|e| e.to_string()) }

async fn cache_pool(app: &AppHandle) -> Result<SqlitePool, String> {
  let dir = app_data_dir(app)?; fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let path = dir.join("cache.sqlite");
  let options = SqliteConnectOptions::new().filename(path).create_if_missing(true);
  let pool = SqlitePoolOptions::new().max_connections(2).connect_with(options).await.map_err(|e| e.to_string())?;
  sqlx::query("CREATE TABLE IF NOT EXISTS repo_cache (cache_key TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, payload TEXT NOT NULL)").execute(&pool).await.map_err(|e| e.to_string())?;
  Ok(pool)
}

async fn read_cache(app: &AppHandle, key: &str) -> Result<Option<RepoSnapshot>, String> { let pool = cache_pool(app).await?; let row = sqlx::query("SELECT payload FROM repo_cache WHERE cache_key = ?").bind(key).fetch_optional(&pool).await.map_err(|e| e.to_string())?; row.map(|r| serde_json::from_str(r.get::<String, _>("payload").as_str()).map_err(|e| e.to_string())).transpose() }
async fn write_cache(app: &AppHandle, key: &str, value: &RepoSnapshot) -> Result<(), String> { let pool = cache_pool(app).await?; let payload = serde_json::to_string(value).map_err(|e| e.to_string())?; sqlx::query("INSERT INTO repo_cache(cache_key, fetched_at, payload) VALUES(?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET fetched_at=excluded.fetched_at, payload=excluded.payload").bind(key).bind(&value.fetched_at).bind(payload).execute(&pool).await.map_err(|e| e.to_string())?; Ok(()) }

#[tauri::command]
fn greet(name: &str) -> String { format!("你好，{}！", name) }

#[tauri::command]
async fn fetch_repo_data(app: AppHandle, request: FetchRepoRequest) -> Result<RepoSnapshot, String> {
  if request.repository.trim().is_empty() { return Err("请先配置仓库地址或本地路径".into()); }
  let key = format!("{}:{}", request.provider, request.repository);
  if !request.force_refresh.unwrap_or(false) { if let Some(snapshot) = read_cache(&app, &key).await? { return Ok(snapshot); } }
  let snapshot = match request.provider.as_str() {
    "github" => fetch_github(&request.repository, request.token.as_deref()).await?,
    "gitlab" => fetch_gitlab(&request.repository, request.token.as_deref()).await?,
    "local" => fetch_local(Path::new(&request.repository))?,
    _ => return Err("不支持的数据源".into())
  };
  write_cache(&app, &key, &snapshot).await?;
  Ok(snapshot)
}

#[tauri::command]
fn calculate_rankings(snapshot: RepoSnapshot, weights: Weights) -> Vec<ContributorRank> {
  let max = |f: fn(&ContributorMetrics) -> f64| snapshot.contributors.iter().map(f).fold(1.0, f64::max);
  let max_commits = max(|c| c.commits as f64); let max_loc = max(|c| (c.additions + c.deletions) as f64); let max_prs = max(|c| c.prs as f64); let max_merged = max(|c| c.merged_prs as f64); let max_issues = max(|c| c.closed_issues as f64); let max_reviews = max(|c| c.reviews as f64);
  let mut ranked: Vec<_> = snapshot.contributors.into_iter().map(|metrics| { let score = weights.commits * metrics.commits as f64 / max_commits + weights.loc * (metrics.additions + metrics.deletions) as f64 / max_loc + weights.prs * metrics.prs as f64 / max_prs + weights.merged_prs * metrics.merged_prs as f64 / max_merged + weights.closed_issues * metrics.closed_issues as f64 / max_issues + weights.reviews * metrics.reviews as f64 / max_reviews; ContributorRank { metrics, score, rank: 0 } }).collect();
  ranked.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal)); for (i, item) in ranked.iter_mut().enumerate() { item.rank = i + 1; } ranked
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> { let dir = app_data_dir(&app)?; fs::create_dir_all(&dir).map_err(|e| e.to_string())?; let path = dir.join("settings.json"); let text = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?; fs::write(path, text).map_err(|e| e.to_string()) }

#[tauri::command]
fn load_settings(app: AppHandle) -> Result<Option<Settings>, String> { let path = app_data_dir(&app)?.join("settings.json"); if !path.exists() { return Ok(None); } let text = fs::read_to_string(path).map_err(|e| e.to_string())?; serde_json::from_str(&text).map(Some).map_err(|e| e.to_string()) }

#[derive(Deserialize)] struct GhUser { login: String, name: Option<String>, avatar_url: Option<String> }
#[derive(Deserialize)] struct GhCommitMeta { author: Option<GhAuthor>, message: String }
#[derive(Deserialize)] struct GhAuthor { name: String, email: Option<String>, date: Option<String> }
#[derive(Deserialize)] struct GhCommit { sha: String, author: Option<GhUser>, commit: GhCommitMeta, stats: Option<GhStats>, html_url: Option<String> }
#[derive(Deserialize)] struct GhStats { additions: i64, deletions: i64 }
#[derive(Deserialize)] struct GhPr { number: u64, user: Option<GhUser>, title: String, created_at: String, merged_at: Option<String>, html_url: Option<String> }
#[derive(Deserialize)] struct GhReviewComment { user: Option<GhUser>, created_at: Option<String>, body: Option<String>, html_url: Option<String> }
#[derive(Deserialize)] struct GhIssue { user: Option<GhUser>, title: String, closed_at: Option<String>, html_url: Option<String>, pull_request: Option<serde_json::Value> }

async fn get_json<T: DeserializeOwned>(client: &Client, url: &str, token: Option<&str>) -> Result<T, String> { let mut req = client.get(url).header(header::ACCEPT, "application/vnd.github+json").header(header::USER_AGENT, "ContributorRank/0.1"); if let Some(token) = token.filter(|t| !t.is_empty()) { req = req.bearer_auth(token); } let response = req.send().await.map_err(|e| e.to_string())?; if !response.status().is_success() { return Err(format!("远程 API 返回 {}：{}", response.status(), url)); } response.json().await.map_err(|e| e.to_string()) }

async fn fetch_github(repo: &str, token: Option<&str>) -> Result<RepoSnapshot, String> {
  let client = Client::new(); let base = format!("https://api.github.com/repos/{}", repo.trim_matches('/')); let mut map: HashMap<String, Aggregate> = HashMap::new();
  let commits: Vec<GhCommit> = get_json(&client, &format!("{base}/commits?per_page=100"), token).await?;
  for summary in commits { let sha = summary.sha.clone(); let commit = if summary.stats.is_some() { summary } else { get_json::<GhCommit>(&client, &format!("{base}/commits/{sha}"), token).await.unwrap_or(summary) }; let user = commit.author; let login = user.as_ref().map(|u| u.login.clone()).unwrap_or_else(|| commit.commit.author.as_ref().map(|a| a.name.clone()).unwrap_or_else(|| "unknown".into())); let name = user.as_ref().and_then(|u| u.name.clone()).unwrap_or_else(|| login.clone()); let avatar = user.as_ref().and_then(|u| u.avatar_url.clone()); let entry = map.entry(login.clone()).or_insert_with(|| Aggregate::new(login, name, avatar)); let stats = commit.stats.unwrap_or(GhStats { additions: 0, deletions: 0 }); entry.metrics.commits += 1; entry.metrics.additions += stats.additions; entry.metrics.deletions += stats.deletions; let date = commit.commit.author.as_ref().and_then(|a| a.date.clone()).unwrap_or_else(|| Utc::now().to_rfc3339()); entry.trend(&date, stats.additions, stats.deletions); entry.metrics.timeline.push(TimelineEvent { date, r#type: "Commit".into(), title: commit.commit.message.lines().next().unwrap_or("Commit").into(), url: commit.html_url }); }
  let prs: Vec<GhPr> = get_json(&client, &format!("{base}/pulls?state=all&per_page=100"), token).await.unwrap_or_default(); for pr in prs { if let Some(user) = pr.user { let entry = map.entry(user.login.clone()).or_insert_with(|| Aggregate::new(user.login.clone(), user.name.clone().unwrap_or_else(|| user.login.clone()), user.avatar_url.clone())); entry.metrics.prs += 1; if pr.merged_at.is_some() { entry.metrics.merged_prs += 1; } entry.metrics.timeline.push(TimelineEvent { date: pr.created_at, r#type: "PR".into(), title: pr.title, url: pr.html_url }); } let comments: Vec<GhReviewComment> = get_json(&client, &format!("{base}/pulls/{}/comments?per_page=100", pr.number), token).await.unwrap_or_default(); for comment in comments { if let Some(user) = comment.user { let entry = map.entry(user.login.clone()).or_insert_with(|| Aggregate::new(user.login.clone(), user.name.clone().unwrap_or_else(|| user.login.clone()), user.avatar_url.clone())); entry.metrics.reviews += 1; entry.metrics.timeline.push(TimelineEvent { date: comment.created_at.unwrap_or_else(|| Utc::now().to_rfc3339()), r#type: "Review".into(), title: comment.body.unwrap_or_else(|| "Code review comment".into()).lines().next().unwrap_or("Code review comment").into(), url: comment.html_url }); } } }
  let issues: Vec<GhIssue> = get_json(&client, &format!("{base}/issues?state=closed&per_page=100"), token).await.unwrap_or_default(); for issue in issues.into_iter().filter(|x| x.pull_request.is_none()) { if let Some(user) = issue.user { let entry = map.entry(user.login.clone()).or_insert_with(|| Aggregate::new(user.login.clone(), user.name.clone().unwrap_or_else(|| user.login.clone()), user.avatar_url.clone())); entry.metrics.closed_issues += 1; entry.metrics.timeline.push(TimelineEvent { date: issue.closed_at.unwrap_or_else(|| Utc::now().to_rfc3339()), r#type: "Issue".into(), title: issue.title, url: issue.html_url }); } }
  let mut contributors: Vec<_> = map.into_values().map(Aggregate::finish).collect(); contributors.sort_by(|a, b| b.commits.cmp(&a.commits)); Ok(RepoSnapshot { provider: "github".into(), repository: repo.into(), fetched_at: Utc::now().to_rfc3339(), contributors })
}

#[derive(Deserialize)] struct GlCommit { id: String, author_name: String, author_email: String, created_at: String, title: String, web_url: Option<String>, stats: Option<GlStats> }
#[derive(Deserialize)] struct GlStats { additions: i64, deletions: i64 }
#[derive(Deserialize, Clone)] struct GlUser { username: String, name: String, avatar_url: Option<String> }
#[derive(Deserialize)] struct GlMr { iid: u64, author: Option<GlUser>, title: String, created_at: String, merged_at: Option<String>, web_url: Option<String> }
#[derive(Deserialize)] struct GlNote { author: Option<GlUser>, created_at: Option<String>, body: Option<String>, web_url: Option<String>, system: Option<bool> }
#[derive(Deserialize)] struct GlIssue { author: Option<GlUser>, title: String, closed_at: Option<String>, web_url: Option<String> }

async fn get_gitlab<T: DeserializeOwned>(client: &Client, url: &str, token: Option<&str>) -> Result<T, String> { let mut req = client.get(url); if let Some(token) = token.filter(|t| !t.is_empty()) { req = req.header("PRIVATE-TOKEN", token); } let response = req.send().await.map_err(|e| e.to_string())?; if !response.status().is_success() { return Err(format!("GitLab API 返回 {}", response.status())); } response.json().await.map_err(|e| e.to_string()) }
async fn fetch_gitlab(repo: &str, token: Option<&str>) -> Result<RepoSnapshot, String> { let client = Client::new(); let project = urlencoding::encode(repo.trim_matches('/')); let base = format!("https://gitlab.com/api/v4/projects/{project}"); let mut map: HashMap<String, Aggregate> = HashMap::new(); let commits: Vec<GlCommit> = get_gitlab(&client, &format!("{base}/repository/commits?per_page=100&with_stats=true"), token).await?; for commit in commits { let login = commit.author_email.clone(); let entry = map.entry(login.clone()).or_insert_with(|| Aggregate::new(login.clone(), commit.author_name.clone(), None)); let stats = commit.stats.unwrap_or(GlStats { additions: 0, deletions: 0 }); entry.metrics.commits += 1; entry.metrics.additions += stats.additions; entry.metrics.deletions += stats.deletions; entry.trend(&commit.created_at, stats.additions, stats.deletions); entry.metrics.timeline.push(TimelineEvent { date: commit.created_at, r#type: "Commit".into(), title: commit.title, url: commit.web_url }); } let mrs: Vec<GlMr> = get_gitlab(&client, &format!("{base}/merge_requests?state=all&per_page=100"), token).await.unwrap_or_default(); for mr in mrs { if let Some(user) = mr.author.clone() { let entry = map.entry(user.username.clone()).or_insert_with(|| Aggregate::new(user.username.clone(), user.name.clone(), user.avatar_url.clone())); entry.metrics.prs += 1; if mr.merged_at.is_some() { entry.metrics.merged_prs += 1; } entry.metrics.timeline.push(TimelineEvent { date: mr.created_at.clone(), r#type: "MR".into(), title: mr.title, url: mr.web_url }); } let notes: Vec<GlNote> = get_gitlab(&client, &format!("{base}/merge_requests/{}/notes?per_page=100", mr.iid), token).await.unwrap_or_default(); for note in notes.into_iter().filter(|n| !n.system.unwrap_or(false)) { if let Some(user) = note.author { let entry = map.entry(user.username.clone()).or_insert_with(|| Aggregate::new(user.username.clone(), user.name.clone(), user.avatar_url.clone())); entry.metrics.reviews += 1; entry.metrics.timeline.push(TimelineEvent { date: note.created_at.unwrap_or_else(|| Utc::now().to_rfc3339()), r#type: "Review".into(), title: note.body.unwrap_or_else(|| "Merge request comment".into()).lines().next().unwrap_or("Merge request comment").into(), url: note.web_url }); } } } let issues: Vec<GlIssue> = get_gitlab(&client, &format!("{base}/issues?state=closed&per_page=100"), token).await.unwrap_or_default(); for issue in issues { if let Some(user) = issue.author { let entry = map.entry(user.username.clone()).or_insert_with(|| Aggregate::new(user.username.clone(), user.name.clone(), user.avatar_url.clone())); entry.metrics.closed_issues += 1; entry.metrics.timeline.push(TimelineEvent { date: issue.closed_at.unwrap_or_else(|| Utc::now().to_rfc3339()), r#type: "Issue".into(), title: issue.title, url: issue.web_url }); } } let contributors = map.into_values().map(Aggregate::finish).collect(); Ok(RepoSnapshot { provider: "gitlab".into(), repository: repo.into(), fetched_at: Utc::now().to_rfc3339(), contributors }) }

fn fetch_local(path: &Path) -> Result<RepoSnapshot, String> { if !path.exists() { return Err(format!("本地路径不存在：{}", path.display())); } let output = Command::new("git").args(["-C", path.to_str().unwrap_or("."), "log", "--numstat", "--date=short", "--pretty=format:__CR__%an%x1f%ae%x1f%ad%x1f%H"]).output().map_err(|e| format!("无法执行 git：{e}"))?; if !output.status.success() { return Err(String::from_utf8_lossy(&output.stderr).to_string()); } let text = String::from_utf8_lossy(&output.stdout); let mut map: HashMap<String, Aggregate> = HashMap::new(); let mut current: Option<(String, String, String, i64, i64)> = None; for line in text.lines() { if let Some(meta) = line.strip_prefix("__CR__") { if let Some((login, name, date, adds, dels)) = current.take() { let entry = map.entry(login.clone()).or_insert_with(|| Aggregate::new(login, name, None)); entry.metrics.commits += 1; entry.metrics.additions += adds; entry.metrics.deletions += dels; entry.trend(&date, adds, dels); entry.metrics.timeline.push(TimelineEvent { date, r#type: "Commit".into(), title: "本地提交".into(), url: None }); } let mut parts = meta.split('\u{1f}'); let name = parts.next().unwrap_or("unknown").to_string(); let email = parts.next().unwrap_or(&name).to_string(); let date = parts.next().unwrap_or("").to_string(); current = Some((email, name, date, 0, 0)); } else if let Some((_, _, _, adds, dels)) = current.as_mut() { let cols: Vec<_> = line.split('\t').collect(); if cols.len() >= 2 { *adds += cols[0].parse::<i64>().unwrap_or(0); *dels += cols[1].parse::<i64>().unwrap_or(0); } } } if let Some((login, name, date, adds, dels)) = current { let entry = map.entry(login.clone()).or_insert_with(|| Aggregate::new(login, name, None)); entry.metrics.commits += 1; entry.metrics.additions += adds; entry.metrics.deletions += dels; entry.trend(&date, adds, dels); entry.metrics.timeline.push(TimelineEvent { date, r#type: "Commit".into(), title: "本地提交".into(), url: None }); } let contributors = map.into_values().map(Aggregate::finish).collect(); Ok(RepoSnapshot { provider: "local".into(), repository: path.display().to_string(), fetched_at: Utc::now().to_rfc3339(), contributors }) }

pub fn run() { tauri::Builder::default().plugin(tauri_plugin_dialog::init()).invoke_handler(tauri::generate_handler![greet, fetch_repo_data, calculate_rankings, save_settings, load_settings]).run(tauri::generate_context!()).expect("error while running ContributorRank"); }
