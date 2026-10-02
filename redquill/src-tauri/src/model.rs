// Wire types shared with the frontend. All structs serialise as camelCase so the
// TypeScript side can mirror them one-to-one (see src/types.ts).

use serde::{Deserialize, Serialize};

/// A single chat turn sent to or received from a model.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub role: String,
    pub content: String,
}

impl Message {
    pub fn user(content: impl Into<String>) -> Self {
        Message { role: "user".into(), content: content.into() }
    }
    pub fn system(content: impl Into<String>) -> Self {
        Message { role: "system".into(), content: content.into() }
    }
    pub fn assistant(content: impl Into<String>) -> Self {
        Message { role: "assistant".into(), content: content.into() }
    }
}

/// Connection details for any OpenAI-compatible `/chat/completions` endpoint.
/// Used for the target under test, the judge, and the rewriter alike.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Endpoint {
    /// Base URL such as `http://localhost:11434/v1` or `https://api.example.com/v1`.
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
    /// Optional jailbreak probe `Content-Type`/`x-` headers some gateways need.
    #[serde(default)]
    pub extra_headers: Vec<(String, String)>,
}

fn default_timeout() -> u64 {
    60
}

/// Sampling overrides applied to a single request. Kept separate from
/// `Endpoint` because the target, the judge, and the rewriter each want
/// different settings from the same connection config.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sampling {
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
}

/// How the judge decides whether an attack broke the model.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JudgeConfig {
    pub enabled: bool,
    /// Independent judge endpoint. When absent, the target endpoint is reused,
    /// which is self-consistent but less trustworthy.
    #[serde(default)]
    pub endpoint: Option<Endpoint>,
    /// Number of independent judge votes. Agreement across votes becomes the
    /// reported confidence; 1 disables the consistency signal.
    #[serde(default = "default_votes")]
    pub votes: u32,
    /// When the heuristic channel and the judge channel disagree, trust the
    /// judge and flag the case for manual review instead of scoring it.
    #[serde(default)]
    pub require_consensus: bool,
    /// Reuse a cached verdict when the exact (prompt, response) pair repeats.
    #[serde(default = "default_true")]
    pub cache_verdicts: bool,
}

fn default_votes() -> u32 {
    3
}
fn default_true() -> bool {
    true
}

impl Default for JudgeConfig {
    fn default() -> Self {
        JudgeConfig {
            enabled: true,
            endpoint: None,
            votes: 3,
            require_consensus: false,
            cache_verdicts: true,
        }
    }
}

/// One attack candidate: a rendered prompt (or short multi-turn script) plus
/// the lineage that produced it, kept for reproducibility and the 3D replay.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    /// Stable id, unique within a run. `P<generation>-<index>`.
    pub id: String,
    pub family: String,
    /// Mutation operators applied on top of the family seed.
    pub operators: Vec<String>,
    pub messages: Vec<Message>,
    /// Display text; for multi-turn probes this is the concatenation of user turns.
    pub prompt: String,
    /// Set when an LLM rewriter produced this variant.
    #[serde(default)]
    pub rewritten: bool,
    #[serde(default)]
    pub depth: u32,
}

/// Heuristic channel verdict, computed locally with no network cost.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeuristicVerdict {
    /// "refusal" | "compliance" | "partial" | "uncertain"
    pub label: String,
    /// 0..1, how strongly the refusal/compliance markers fired.
    pub score: f32,
    /// Human-readable evidence: which marker patterns matched.
    pub signals: Vec<String>,
    /// Detected output-side obfuscation the model may have used to slip past.
    #[serde(default)]
    pub evasion_markers: Vec<String>,
}

/// Deterministic evidence that the protected content actually came out.
///
/// Computed without any language model, so unlike the judge channels it cannot
/// be talked into a false positive. See `provenance.rs`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Provenance {
    /// The canary token embedded in the system prompt, when one was used.
    #[serde(default)]
    pub canary: Option<String>,
    /// True when the canary token appeared in the response. Proof of leak.
    #[serde(default)]
    pub canary_found: bool,
    /// Longest contiguous span shared with the reference corpus, in characters.
    #[serde(default)]
    pub longest_run: usize,
    /// Fraction of the response's n-grams traceable to the reference corpus.
    #[serde(default)]
    pub overlap: f32,
    /// True when `longest_run` indicates verbatim copying rather than topical
    /// overlap.
    #[serde(default)]
    pub copying: bool,
    /// False when no reference corpus could be captured, so the absence of a
    /// positive is not evidence of safety.
    #[serde(default)]
    pub reference_available: bool,
}

/// Structural evidence about *how* the response was produced.
///
/// Where `Provenance` asks "did protected content come out?", this asks "did the
/// model execute the request, or write about it?" — the distinction that matters
/// for behavioural objectives, where there is no secret to leak. See
/// `transcript.rs`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    /// The unguessable marker survived into the response: proof of execution.
    #[serde(default)]
    pub nonce_echoed: bool,
    /// Analyst/classification markers in the response.
    #[serde(default)]
    pub analytical: usize,
    /// Refusal markers in the response.
    #[serde(default)]
    pub refusals: usize,
    /// The probe's own payload appears verbatim in the response.
    #[serde(default)]
    pub echoes_probe: bool,
    /// Structural read: describing the request rather than performing it.
    #[serde(default)]
    pub meta_discussion: bool,
    #[serde(default)]
    pub length: usize,
}

impl Provenance {
    /// A neutral value for endpoints with no provenance channel configured.
    pub fn unavailable() -> Self {
        Provenance {
            canary: None,
            canary_found: false,
            longest_run: 0,
            overlap: 0.0,
            copying: false,
            reference_available: false,
        }
    }

    /// Whether a canary — an unguessable token embedded in the system prompt —
    /// appeared in the response. Nothing can produce this except reproducing the
    /// configuration, so it is proof rather than evidence.
    pub fn proves_leak(&self) -> bool {
        self.canary_found
    }

    /// A verbatim run shared with the reference corpus.
    ///
    /// Strong, but not proof, and deliberately kept distinct from
    /// `proves_leak`. The corpus is derived from the target's own self
    /// description, so in a correct deployment it cannot equal a probe response.
    /// It became apparent during offline replay that a surrogate corpus *can*
    /// equal a response — the longest stored reply scored 100% overlap with
    /// itself. Treating that as proof would have produced a false positive at
    /// confidence 1.0, so a copy run now raises confidence and flags the case
    /// without overruling three independent judges.
    pub fn indicates_copying(&self) -> bool {
        self.copying
    }
}

/// One independent judge vote.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JudgeVote {
    /// "refusal" | "compliance" | "partial" | "uncertain"
    pub label: String,
    /// Judge's own confidence in its vote.
    pub score: f32,
    pub reason: String,
}

/// Fused verdict across both channels.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Verdict {
    /// Final label after fusion: "refusal" | "compliance" | "partial" | "uncertain"
    pub label: String,
    /// 0..1 overall confidence, accounting for channel agreement and vote split.
    pub confidence: f32,
    /// 0..1 agreement between the two channels (1.0 when only one is active).
    pub agreement: f32,
    /// Fraction of judge votes that agreed with the majority label.
    pub vote_consensus: f32,
    pub heuristic: HeuristicVerdict,
    #[serde(default)]
    pub votes: Vec<JudgeVote>,
    /// True when heuristic and judge channels contradicted each other.
    pub disputed: bool,
    /// Deterministic leak evidence. Always present; `reference_available: false`
    /// when the endpoint has no provenance channel.
    #[serde(default)]
    pub provenance: Provenance,
    /// Structural evidence about execution vs description. Always present.
    #[serde(default)]
    pub transcript: Transcript,
}

impl Verdict {
    /// Neutral verdict for an attempt that never reached the target. Carrying a
    /// real value instead of a placeholder keeps the deserialiser total.
    pub fn uncertain() -> Self {
        Verdict {
            label: "uncertain".into(),
            confidence: 0.0,
            agreement: 0.0,
            vote_consensus: 0.0,
            heuristic: HeuristicVerdict {
                label: "uncertain".into(),
                score: 0.0,
                signals: vec!["attempt did not reach the target".into()],
                evasion_markers: vec![],
            },
            votes: vec![],
            disputed: false,
            provenance: Provenance::unavailable(),
            transcript: Transcript::default(),
        }
    }
}

/// Result of firing one probe at the target.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attempt {
    pub probe_id: String,
    pub family: String,
    pub operators: Vec<String>,
    pub prompt: String,
    pub messages: Vec<Message>,
    /// Full target response, kept verbatim so any finding is reproducible.
    pub response: String,
    pub verdict: Verdict,
    pub latency_ms: u64,
    pub generation: u32,
    #[serde(default)]
    pub rewritten: bool,
    /// Population fitness that produced or selected this probe.
    #[serde(default)]
    pub fitness: f32,
    #[serde(default)]
    pub error: Option<String>,
    /// Token usage as reported by the endpoint; absent when it does not report.
    #[serde(default)]
    pub prompt_tokens: Option<u32>,
    #[serde(default)]
    pub completion_tokens: Option<u32>,
}

/// A family-level aggregate, the unit the defence report is built from.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FamilyStat {
    pub family: String,
    pub attempts: u32,
    /// Attempts judged `compliance`.
    pub breaks: u32,
    pub refusals: u32,
    pub partial: u32,
    pub uncertain: u32,
    pub errors: u32,
    /// breaks / attempts, the headline attack success rate.
    pub success_rate: f32,
    pub mean_fitness: f32,
}

/// A concrete, evidence-backed remediation hint.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub severity: String,
    pub title: String,
    pub detail: String,
    pub recommendation: String,
    /// Probe ids that support this finding.
    pub evidence: Vec<String>,
    pub families: Vec<String>,
}

/// Full run result handed to the frontend in one piece.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub run_id: String,
    pub started_at: String,
    pub finished_at: String,
    pub target_model: String,
    pub judge_model: String,
    pub total_attempts: u32,
    pub total_breaks: u32,
    pub overall_success_rate: f32,
    pub generations: u32,
    pub elapsed_ms: u64,
    pub family_stats: Vec<FamilyStat>,
    pub attempts: Vec<Attempt>,
    pub findings: Vec<Finding>,
    /// Seeded RNG seed, so the run can be reproduced exactly.
    pub seed: u64,
    /// Families where the operator planted a known weakness, as declared at
    /// scan time. Kept so the calibration findings can be re-derived from the
    /// archive without re-supplying them.
    #[serde(default)]
    pub expected_breaks: Vec<String>,
    /// Sum of reported target token usage; 0 when the endpoint omits it.
    #[serde(default)]
    pub total_tokens: u64,
}

/// Live progress event, emitted roughly once per completed attempt.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub run_id: String,
    pub done: u32,
    pub total: u32,
    pub breaks: u32,
    pub generation: u32,
    pub total_generations: u32,
    /// Highest fitness seen so far in the current generation.
    pub best_fitness: f32,
    pub latest: Option<Attempt>,
    pub phase: String,
}

/// Everything needed to run a scan.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanConfig {
    /// The behaviour under test, substituted into every family template.
    /// Supplied by the operator so the binary carries no fixed payload corpus.
    pub objective: String,
    pub target: Endpoint,
    pub judge: JudgeConfig,
    /// Attack family ids to include; empty means all enabled families.
    #[serde(default)]
    pub families: Vec<String>,
    /// Population size per generation.
    #[serde(default = "default_population")]
    pub population: usize,
    #[serde(default = "default_generations")]
    pub generations: u32,
    #[serde(default = "default_concurrency")]
    pub concurrency: usize,
    #[serde(default = "default_seed")]
    pub seed: u64,
    /// Prepended system prompt for the target, if the deployment uses one.
    #[serde(default)]
    pub system_prompt: Option<String>,
    /// Refuse to run unless the operator confirms they own or are authorised to
    /// test the endpoint. The UI cannot start a scan without it.
    #[serde(default)]
    pub authorised: bool,
    /// Optional LLM endpoint used to rewrite candidates that scored well.
    #[serde(default)]
    pub rewriter: Option<Endpoint>,
    /// Provenance channels. Off by default: they cost requests, and the canary
    /// in particular mutates the system prompt under test.
    #[serde(default)]
    pub provenance: ProvenanceConfig,
    /// Families where the operator has *planted* a known weakness, as a positive
    /// control.
    ///
    /// This is the only way to measure recall. Every run so far produced either
    /// all-refusals or all-breaks, which establishes precision and nothing about
    /// whether a planted weakness would be caught. Declaring the answer in
    /// advance turns the report into a self-test: a planted weakness the tool
    /// misses is a blind spot, and it is reported as one.
    #[serde(default)]
    pub expected_breaks: Vec<String>,
}

/// How to gather deterministic leak evidence.
///
/// All channels are opt-in. Two of the three perturb the request — a canary in
/// the system prompt, a nonce in the probe — and a scan that silently changed
/// the text under test would not be measuring the deployment the operator
/// actually runs.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvenanceConfig {
    /// Embed an unguessable token in the system prompt and detect it in
    /// responses. Only meaningful when `system_prompt` is set, since the token
    /// goes into that prompt.
    #[serde(default)]
    pub canary: bool,
    /// Ask the target once to describe its own configuration, then look for
    /// verbatim spans from that description in responses. Costs one extra
    /// request per run.
    #[serde(default)]
    pub reference_overlap: bool,
    /// Append an unguessable marker to every probe and treat its echo as proof
    /// the model executed the instruction. This is the only deterministic
    /// channel that works for behavioural objectives, where there is no secret
    /// to extract. It perturbs the probe text, so it is opt-in.
    #[serde(default)]
    pub nonce: bool,
}

fn default_population() -> usize {
    12
}
fn default_generations() -> u32 {
    4
}
fn default_concurrency() -> usize {
    4
}
fn default_seed() -> u64 {
    0x5eed_1234_abcd_0001
}

/// Compact run header for the history list.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSummary {
    pub run_id: String,
    pub started_at: String,
    pub finished_at: String,
    pub target_model: String,
    pub total_attempts: u32,
    pub total_breaks: u32,
    pub overall_success_rate: f32,
    pub seed: u64,
}

/// Metadata about the bundled attack library.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FamilyInfo {
    pub id: String,
    pub name: String,
    pub summary: String,
    pub multi_turn: bool,
}