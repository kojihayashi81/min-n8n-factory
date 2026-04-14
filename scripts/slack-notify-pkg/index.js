'use strict';

// Slack Block Kit templates for n8n notifications.
// Pure data builders — no I/O. Invoked from n8n Code nodes via require().
//
// Navigation: URL buttons in `actions` blocks. Slack shows an
// "interactivity not configured" warning on first click unless the app has
// Interactivity & Shortcuts enabled — this is accepted intentionally.

// Slack section block has a hard 3000-char limit on text.text.
// Keep generous headroom so the full payload (bullets, prefixes,
// retry guidance lines) never bumps against the ceiling.
const SLACK_SECTION_TEXT_LIMIT = 3000;
const FAILURE_ERROR_MAX = 2800;
// buildStuckBatchMessage: cap how many issues are listed inline so a
// big backlog of stuck issues cannot blow the section-text limit and
// drop the notification entirely. Titles are also truncated so a
// single long title cannot explode the per-item size.
const STUCK_BATCH_ISSUE_DISPLAY_LIMIT = 15;
const STUCK_BATCH_TITLE_MAX = 80;

const PR_NUMBER_PATTERN = /\/pull\/(\d+)/;

// Redact well-known secret shapes before any error text leaves the
// trust boundary (Slack, GitHub Issue comment). Defense-in-depth — the
// upstream tools shouldn't leak these, but Claude Code / gh CLI stderr
// has occasionally surfaced Authorization headers during network errors.
// Order matters: the Authorization-header pattern must run first so it
// consumes "Authorization: Bearer <token>" as a whole line. Otherwise the
// Bearer rule alone would only replace the "Bearer" keyword and leave the
// token value behind when the separator between them is a single space.
const SECRET_PATTERNS = [
  /\bAuthorization:[^\n\r]*/gi, // Authorization: ... to end of line
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, // Bare Bearer tokens
  /xox[baeprs]-[A-Za-z0-9-]{10,}/g, // Slack tokens (b/a/e/p/r/s incl. xoxe rotation refresh)
  /ghp_[A-Za-z0-9]{20,}/g, // GitHub personal access tokens
  /gho_[A-Za-z0-9]{20,}/g, // GitHub OAuth tokens
  /ghu_[A-Za-z0-9]{20,}/g, // GitHub user-to-server tokens
  /ghs_[A-Za-z0-9]{20,}/g, // GitHub server-to-server tokens
  /ghr_[A-Za-z0-9]{20,}/g, // GitHub refresh tokens
  /github_pat_[A-Za-z0-9_]{20,}/g, // GitHub fine-grained PATs
  /sk-ant-[A-Za-z0-9_-]{20,}/g, // Anthropic API keys
];

function scrubSecrets(text) {
  if (text === undefined || text === null) return text;
  let out = text.toString();
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, '[REDACTED]');
  }
  return out;
}

// Extract the PR number from a GitHub PR URL. Robust against trailing
// slashes, query strings, and fragments ("#/files" etc.). Returns the
// trailing /pulls path as a placeholder when no PR number can be parsed.
function extractPrNumber(prUrl) {
  if (!prUrl) return '—';
  const match = prUrl.toString().match(PR_NUMBER_PATTERN);
  return match ? match[1] : '—';
}

// Seconds elapsed since the given ISO-8601 timestamp (what n8n's
// $execution.startedAt returns). Falls back to 0 when the input is
// missing or unparseable so the builders stay pure and crash-free.
function elapsedSinceStart(startedAt) {
  if (!startedAt) return 0;
  const startMs = Date.parse(startedAt);
  if (Number.isNaN(startMs)) return 0;
  const diff = Math.floor((Date.now() - startMs) / 1000);
  return diff < 0 ? 0 : diff;
}

function buildStartMessage({ repo, issueNumber, issueTitle, channelId, threadTs }) {
  const issueUrl = `https://github.com/${repo}/issues/${issueNumber}`;
  const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const msg = {
    channel: channelId,
    text: `🔄 処理開始: #${issueNumber} ${issueTitle}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: '🔄 処理開始' } },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `#${issueNumber} ${issueTitle}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `${repo} | issues/${issueNumber} | ${now}`,
          },
        ],
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: `📋 Issue #${issueNumber}` },
            url: issueUrl,
          },
        ],
      },
    ],
  };
  if (threadTs) msg.thread_ts = threadTs;
  return msg;
}

function buildSuccessMessage({
  repo,
  issueNumber,
  issueTitle,
  channelId,
  threadTs,
  prUrl,
  executionStartedAt,
  qualityScore,
  qualityScoreMax,
  qualityScoreRerun,
  webSkipReason,
}) {
  const issueUrl = `https://github.com/${repo}/issues/${issueNumber}`;
  const hasPr = Boolean(prUrl) && extractPrNumber(prUrl) !== '—';
  const prNum = hasPr ? extractPrNumber(prUrl) : null;
  const elapsed = elapsedSinceStart(executionStartedAt);
  const min = Math.floor(elapsed / 60);
  const sec = String(elapsed % 60).padStart(2, '0');

  // Section body adapts: if the PR URL is missing we don't want to
  // mislead the reader with a "Draft PR を作成しました" line or a
  // "PR #—" button that dead-ends at the repo /pulls page.
  const baseSectionText = hasPr
    ? '調査が完了し、Draft PR を作成しました。'
    : '調査が完了しました。PR URL を stdout から検出できなかったため、リポジトリの Pull requests 一覧を確認してください。';
  const scoreLine = formatQualityScoreLine(
    qualityScore,
    qualityScoreMax,
    qualityScoreRerun,
    webSkipReason
  );
  const sectionText = scoreLine ? `${baseSectionText}\n${scoreLine}` : baseSectionText;
  const contextText = hasPr
    ? `${repo} | issues/${issueNumber} → PR #${prNum} | ⏱️ ${min}分${sec}秒`
    : `${repo} | issues/${issueNumber} | ⏱️ ${min}分${sec}秒`;

  const actionsElements = [
    {
      type: 'button',
      text: { type: 'plain_text', text: `📋 Issue #${issueNumber}` },
      url: issueUrl,
    },
  ];
  if (hasPr) {
    actionsElements.push({
      type: 'button',
      text: { type: 'plain_text', text: `🔀 PR #${prNum}` },
      url: prUrl,
    });
  }

  const msg = {
    channel: channelId,
    text: `✅ 調査完了: #${issueNumber} ${issueTitle}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: '✅ 調査完了' } },
      { type: 'section', text: { type: 'mrkdwn', text: sectionText } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: contextText }] },
      { type: 'actions', elements: actionsElements },
    ],
  };
  if (threadTs) msg.thread_ts = threadTs;
  return msg;
}

// Render the Gatekeeper quality score line attached to the Slack success
// section. Returns null when no score is available (backward compatible
// with the legacy single-shot invocation that has no Gatekeeper).
function formatQualityScoreLine(score, max, rerunScore, webSkipReason) {
  if (typeof score !== 'number') return null;
  const safeMax = typeof max === 'number' && max > 0 ? max : 100;
  // 80 点満点は Web 調査失敗/スキップ時のみ。通常ケースと混ざると「なぜ 80？」と
  // なりやすいので本文に明示する。skip 理由（検索ヒントなし / Web 調査失敗）も
  // 併記してレビュー時に 80 点満点の根拠が追えるようにする。
  const reasonLabel =
    webSkipReason === 'no_hints'
      ? '検索ヒントなし'
      : webSkipReason === 'web_failed'
        ? 'Web 調査失敗'
        : null;
  const scaleNote =
    safeMax === 80
      ? reasonLabel
        ? `（Web 調査スキップ: ${reasonLabel}、80 点満点換算）`
        : '（Web 調査スキップ、80 点満点換算）'
      : '';
  if (typeof rerunScore === 'number') {
    return `品質スコア: 初回 ${score} / ${safeMax} → 再実行後 ${rerunScore} / ${safeMax}${scaleNote}`;
  }
  return `品質スコア: ${score} / ${safeMax}${scaleNote}`;
}

function buildFailureMessage({
  repo,
  issueNumber,
  issueTitle,
  channelId,
  threadTs,
  error,
  executionUrl,
  executionStartedAt,
}) {
  const issueUrl = `https://github.com/${repo}/issues/${issueNumber}`;
  // Error body is rendered inside a Slack mrkdwn code fence for
  // readability (preserves newlines, indentation, and escapes most
  // mrkdwn specials). Replace any literal ``` in the payload with a
  // zero-width-space-separated sequence so the fence can't be closed
  // prematurely by stray backticks in the captured error output.
  const rawErrorText = (error || 'タイムアウト').substring(0, FAILURE_ERROR_MAX);
  const errorText = rawErrorText.replace(/```/g, '`\u200B`\u200B`');
  const elapsed = elapsedSinceStart(executionStartedAt);
  const min = Math.floor(elapsed / 60);
  const sec = String(elapsed % 60).padStart(2, '0');
  const msg = {
    channel: channelId,
    text: `❌ 処理失敗: #${issueNumber} ${issueTitle}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: '❌ 処理失敗' } },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `\`\`\`\n${errorText}\n\`\`\`\n👉 Issue に \`ai-ready\` ラベルを再付与してリトライしてください`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `${repo} | issues/${issueNumber} | ⏱️ ${min}分${sec}秒`,
          },
        ],
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: `📋 Issue #${issueNumber}` },
            url: issueUrl,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '🔗 n8n実行ログ' },
            url: executionUrl,
          },
        ],
      },
    ],
  };
  if (threadTs) msg.thread_ts = threadTs;
  return msg;
}

function buildStuckBatchMessage({ repo, channelId, issues, timeoutSec }) {
  const total = issues.length;
  const shown = issues.slice(0, STUCK_BATCH_ISSUE_DISPLAY_LIMIT);
  const overflow = total - shown.length;
  const list = shown
    .map((i) => {
      const title =
        (i.title || '').length > STUCK_BATCH_TITLE_MAX
          ? `${i.title.slice(0, STUCK_BATCH_TITLE_MAX - 1)}…`
          : i.title;
      const updated = new Date(i.updatedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
      return `• <https://github.com/${repo}/issues/${i.number}|#${i.number}> ${title}\n  最終更新: ${updated}`;
    })
    .join('\n');
  const overflowLine = overflow > 0 ? `\n... 他 ${overflow} 件` : '';
  return {
    channel: channelId,
    text: `⏰ スタック検知: ${total}件`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `⏰ スタック検知 (${total}件)` } },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `\`ai-processing\` のまま ${timeoutSec}秒以上経過した Issue を検知しました。\n全て \`ai-failed\` に変更済みです。\n\n${list}${overflowLine}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `${repo} | リトライ: \`ai-ready\` ラベルを再付与してください`,
          },
        ],
      },
    ],
  };
}

function buildStuckMessage({ repo, issueNumber, issueTitle, channelId, updatedAt, timeoutSec }) {
  const issueUrl = `https://github.com/${repo}/issues/${issueNumber}`;
  const updatedAtStr = new Date(updatedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  return {
    channel: channelId,
    text: `⏰ スタック検知: #${issueNumber} ${issueTitle}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: '⏰ スタック検知' } },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `• \`ai-processing\` のまま ${timeoutSec}秒以上経過\n• \`ai-failed\` に変更済み\n• リトライ: \`ai-ready\` ラベルを再付与してください`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `${repo} | issues/${issueNumber} | 最終更新: ${updatedAtStr}`,
          },
        ],
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: `📋 Issue #${issueNumber}` },
            url: issueUrl,
          },
        ],
      },
    ],
  };
}

// ─── Context-aware payload builder ──────────────────────────────
// Consolidates the business rules (PR URL extraction, error fallback,
// env defaults, Slack-node blocksJson wrapping) so n8n Code nodes can
// stay as 3-line adapters.

const PR_URL_PATTERN = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/;
const DEFAULT_CLAUDE_TIMEOUT_SEC = '1020';
const DEFAULT_STUCK_THRESHOLD_SEC = '1800';

// Gatekeeper outputs its score by printing a sentinel line to stdout
// from n8n-run-claude-pipeline.sh. The rerun variant is emitted only
// when the Synthesizer was rerun and Gatekeeper was run a second time
// for notification purposes (no threshold judgment).
//
// Line format (one per line, anywhere in stdout):
//   QUALITY_SCORE=75/100
//   QUALITY_SCORE_RERUN=85/100
//   WEB_SKIP_REASON=no_hints     (only when Web Investigator was skipped)
//   WEB_SKIP_REASON=web_failed
const QUALITY_SCORE_PATTERN = /^QUALITY_SCORE=(\d+)\/(\d+)$/m;
const QUALITY_SCORE_RERUN_PATTERN = /^QUALITY_SCORE_RERUN=(\d+)\/(\d+)$/m;
const WEB_SKIP_REASON_PATTERN = /^WEB_SKIP_REASON=(no_hints|web_failed)$/m;

function extractPrUrl(stdout) {
  if (stdout === undefined || stdout === null) return null;
  const match = stdout.toString().match(PR_URL_PATTERN);
  return match ? match[0] : null;
}

// Extract the Gatekeeper initial quality score from pipeline stdout.
// Returns `{ score, max }` or null when the sentinel is absent.
function extractQualityScore(stdout) {
  if (stdout === undefined || stdout === null) return null;
  const match = stdout.toString().match(QUALITY_SCORE_PATTERN);
  if (!match) return null;
  return { score: Number(match[1]), max: Number(match[2]) };
}

// Extract the Gatekeeper rerun (2nd pass) quality score from pipeline
// stdout. Only present when the Synthesizer was rerun. Returns
// `{ score, max }` or null.
function extractQualityScoreRerun(stdout) {
  if (stdout === undefined || stdout === null) return null;
  const match = stdout.toString().match(QUALITY_SCORE_RERUN_PATTERN);
  if (!match) return null;
  return { score: Number(match[1]), max: Number(match[2]) };
}

// Extract the Web Investigator skip reason from pipeline stdout.
// Returns "no_hints" (Code Investigator produced no search_hints),
// "web_failed" (Web Investigator errored or returned invalid JSON),
// or null when Web investigation ran normally.
function extractWebSkipReason(stdout) {
  if (stdout === undefined || stdout === null) return null;
  const match = stdout.toString().match(WEB_SKIP_REASON_PATTERN);
  return match ? match[1] : null;
}

function resolveFailureError(runClaudeOutput, timeoutSec) {
  const raw = ((runClaudeOutput && (runClaudeOutput.error || runClaudeOutput.stderr)) || '')
    .toString()
    .trim();
  if (raw) return scrubSecrets(raw);
  // Defensive: timeoutSec flows in from $env and is interpolated into
  // the Slack / GitHub comment. Anything that is not a plain digit
  // string is silently replaced with the default so a miswired env
  // (e.g. SLACK_BOT_TOKEN vs CLAUDE_TIMEOUT_SEC) cannot leak into the
  // notification text via this path.
  const safeTimeout = /^\d{1,6}$/.test(String(timeoutSec))
    ? String(timeoutSec)
    : DEFAULT_CLAUDE_TIMEOUT_SEC;
  return `タイムアウトまたは不明なエラー（Claude Code 上限: ${safeTimeout}秒）`;
}

// Dispatch table: kind → Strategy that resolves Slack-node fields from the
// n8n context. Add a new notification kind by appending one entry here;
// the Code nodes and Slack nodes in workflow JSON never have to change.
const STRATEGIES = {
  start: ({ issue, env, threadTs }) => ({
    message: buildStartMessage({
      repo: env.GITHUB_REPO,
      issueNumber: issue.number,
      issueTitle: issue.title,
      channelId: env.SLACK_CHANNEL_ID,
      threadTs,
    }),
    replyBroadcast: false,
  }),
  success: ({ issue, env, threadTs, runClaudeOutput, executionStartedAt }) => {
    const stdout = runClaudeOutput && runClaudeOutput.stdout;
    const initialScore = extractQualityScore(stdout);
    const rerunScore = extractQualityScoreRerun(stdout);
    const webSkipReason = extractWebSkipReason(stdout);
    return {
      // Pass the raw extractPrUrl result through — null signals "PR not
      // found" to buildSuccessMessage, which suppresses the PR button and
      // softens the section text. The old "/pulls" fallback rendered as
      // "PR #—" in Slack, which looked broken.
      message: buildSuccessMessage({
        repo: env.GITHUB_REPO,
        issueNumber: issue.number,
        issueTitle: issue.title,
        channelId: env.SLACK_CHANNEL_ID,
        threadTs,
        prUrl: extractPrUrl(stdout),
        executionStartedAt,
        // Gatekeeper score fields are null when Gatekeeper was skipped or
        // its stdout sentinel is absent — buildSuccessMessage then falls
        // back to the pre-pipeline behavior of no score line.
        qualityScore: initialScore ? initialScore.score : null,
        qualityScoreMax: initialScore ? initialScore.max : null,
        qualityScoreRerun: rerunScore ? rerunScore.score : null,
        webSkipReason,
      }),
      // Broadcast back to the main channel so people see the final result
      // even if they weren't watching the Issue's thread.
      replyBroadcast: true,
    };
  },
  failure: ({ issue, env, threadTs, runClaudeOutput, executionUrl, executionStartedAt }) => {
    const errorText = resolveFailureError(
      runClaudeOutput,
      env.CLAUDE_TIMEOUT_SEC || DEFAULT_CLAUDE_TIMEOUT_SEC
    );
    return {
      message: buildFailureMessage({
        repo: env.GITHUB_REPO,
        issueNumber: issue.number,
        issueTitle: issue.title,
        channelId: env.SLACK_CHANNEL_ID,
        threadTs,
        error: errorText,
        executionUrl,
        executionStartedAt,
      }),
      replyBroadcast: true,
      // Surface the scrubbed error text so the GitHub comment node can
      // reuse the same resolved string instead of duplicating the
      // error/stderr/timeout fallback logic in a workflow expression.
      errorText,
    };
  },
  'stuck-batch': ({ env, issues }) => ({
    message: buildStuckBatchMessage({
      repo: env.GITHUB_REPO,
      channelId: env.SLACK_CHANNEL_ID,
      issues: issues || [],
      timeoutSec: env.STUCK_THRESHOLD_SEC || DEFAULT_STUCK_THRESHOLD_SEC,
    }),
    replyBroadcast: false,
  }),
};

const MAX_THREAD_ENTRIES = 200;

// Persist the Slack parent-message ts for an Issue so that retries of
// the same Issue can reply into the original thread. Caps the map at
// MAX_THREAD_ENTRIES and evicts oldest entries (by Slack ts value) so
// n8n's static data stays bounded under long-running operation.
function rememberThread(staticData, issueNumber, ts) {
  if (!staticData || issueNumber == null || !ts) return;
  const map = staticData.slackThreads || (staticData.slackThreads = {});
  const key = String(issueNumber);
  if (map[key]) return; // Preserve the original ts across retries.
  map[key] = ts;

  const keys = Object.keys(map);
  if (keys.length <= MAX_THREAD_ENTRIES) return;

  // Sort by the stored Slack ts (which is itself a Unix timestamp) so
  // oldest parent messages are evicted first.
  keys.sort((a, b) => parseFloat(map[a]) - parseFloat(map[b]));
  const overflow = keys.length - MAX_THREAD_ENTRIES;
  for (let i = 0; i < overflow; i++) {
    delete map[keys[i]];
  }
}

// Returns a flat object ready to feed the Slack node as-is.
// The caller's Slack node only needs to wire up $json fields — there is
// no per-kind branching left inside the workflow JSON.
function buildPayloadForContext(context) {
  context = context || {};
  const strategy = STRATEGIES[context.kind];
  if (!strategy) {
    throw new Error(`Unknown payload kind: ${context.kind}`);
  }
  const { message, replyBroadcast, errorText } = strategy({
    issue: context.issue,
    env: context.env || {},
    threadTs: context.threadTs,
    runClaudeOutput: context.runClaudeOutput,
    executionUrl: context.executionUrl,
    executionStartedAt: context.executionStartedAt,
    issues: context.issues,
  });

  const payload = {
    channel: message.channel,
    text: message.text,
    blocks: message.blocks,
    blocksJson: JSON.stringify({ blocks: message.blocks }),
    thread_ts: message.thread_ts || '',
    reply_broadcast: Boolean(replyBroadcast),
  };
  if (errorText !== undefined) payload.errorText = errorText;
  return payload;
}

module.exports = {
  buildStartMessage,
  buildSuccessMessage,
  buildFailureMessage,
  buildStuckMessage,
  buildStuckBatchMessage,
  buildPayloadForContext,
  extractPrUrl,
  extractPrNumber,
  extractQualityScore,
  extractQualityScoreRerun,
  extractWebSkipReason,
  elapsedSinceStart,
  resolveFailureError,
  scrubSecrets,
  rememberThread,
  MAX_THREAD_ENTRIES,
  SLACK_SECTION_TEXT_LIMIT,
  FAILURE_ERROR_MAX,
  STUCK_BATCH_ISSUE_DISPLAY_LIMIT,
};
