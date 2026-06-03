export type Severity = 'low' | 'medium' | 'high';

export type PipelineStage =
  | 'detected'
  | 'carded'
  | 'branched'
  | 'ai-fix'
  | 'validating'
  | 'awaiting-approval'
  | 'pr-opened'
  | 'done'
  | 'failed';

export type StageStatus = 'start' | 'success' | 'error' | 'info';

/** A bug as emitted by the detector. */
export interface Bug {
  id: string;
  title: string;
  severity: Severity;
  category: string;
  repository: string;
  branch: string;
  files: string[];
  failingTest: string;
  testFile: string;
  description: string;
  logs: string;
  detectedAt: string;
}

export interface FixRequest {
  bug: Bug;
  /** Path to the isolated worktree the fix should target. */
  repoPath: string;
  /** Demo switch: 'rogue' makes the mock attempt a test-editing fix (guard demo). */
  mode?: 'normal' | 'rogue';
  /** Streamed reasoning trace sink (drives the live dashboard). */
  onReasoning?: (line: string) => void;
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

export interface FixResponse {
  diff: string;
  reasoning: string[];
  filesChanged: string[];
  model: string;
  provider: 'mock' | 'claude';
  tokenUsage: TokenUsage;
  latencyMs: number;
}

export type ValidationStepName = 'test' | 'lint' | 'build' | 'e2e';

export interface ValidationStep {
  name: ValidationStepName;
  ok: boolean;
  skipped?: boolean;
  durationMs: number;
  exitCode: number | null;
  output: string;
}

export interface ValidationResult {
  ok: boolean;
  durationMs: number;
  steps: ValidationStep[];
}

export interface TrelloCard {
  id: string;
  url: string;
  name: string;
  labels: string[];
  listName: string;
}

export interface PullRequest {
  number: number;
  url: string;
  title: string;
  body: string;
  head: string;
  base: string;
  reviewers: string[];
  draft: boolean;
}

export interface PipelineEvent {
  jobId: string;
  stage: PipelineStage;
  status: StageStatus;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export type JobStatus = 'running' | 'awaiting-approval' | 'succeeded' | 'failed' | 'discarded';

export interface JobRecord {
  jobId: string;
  bugId: string;
  status: JobStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  bug?: Bug;
  card?: TrelloCard;
  fix?: FixResponse;
  validation?: ValidationResult;
  pullRequest?: PullRequest;
  fixBranch?: string;
  failureReason?: string;
  events: PipelineEvent[];
}
