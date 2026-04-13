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
          text: `#${issueNumber} ${issueTitle}`
        }
      },
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `${repo} | issues/${issueNumber} | ${now}`
        }]
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: `📋 Issue #${issueNumber}` },
            url: issueUrl
          }
        ]
      }
    ]
  };
  if (threadTs) msg.thread_ts = threadTs;
  return msg;
}

function buildSuccessMessage({ repo, issueNumber, issueTitle, channelId, threadTs, prUrl, executionStartedAt }) {
  const issueUrl = `https://github.com/${repo}/issues/${issueNumber}`;
  const prNum = extractPrNumber(prUrl);
  const elapsed = elapsedSinceStart(executionStartedAt);
  const min = Math.floor(elapsed / 60);
  const sec = String(elapsed % 60).padStart(2, '0');
  const msg = {
    channel: channelId,
    text: `✅ 調査完了: #${issueNumber} ${issueTitle}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: '✅ 調査完了' } },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '調査が完了し、Draft PR を作成しました。' }
      },
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `${repo} | issues/${issueNumber} → PR #${prNum} | ⏱️ ${min}分${sec}秒`
        }]
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: `📋 Issue #${issueNumber}` },
            url: issueUrl
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: `🔀 PR #${prNum}` },
            url: prUrl
          }
        ]
      }
    ]
  };
  if (threadTs) msg.thread_ts = threadTs;
  return msg;
}

function buildFailureMessage({ repo, issueNumber, issueTitle, channelId, threadTs, error, executionUrl, executionStartedAt }) {
  const issueUrl = `https://github.com/${repo}/issues/${issueNumber}`;
  const errorText = (error || 'タイムアウト').substring(0, FAILURE_ERROR_MAX);
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
          text: `• ${errorText}\n• 👉 Issue に \`ai-ready\` ラベルを再付与してリトライしてください`
        }
      },
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `${repo} | issues/${issueNumber} | ⏱️ ${min}分${sec}秒`
        }]
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: `📋 Issue #${issueNumber}` },
            url: issueUrl
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '🔗 n8n実行ログ' },
            url: executionUrl
          }
        ]
      }
    ]
  };
  if (threadTs) msg.thread_ts = threadTs;
  return msg;
}

function buildStuckBatchMessage({ repo, channelId, issues, timeoutSec }) {
  const total = issues.length;
  const shown = issues.slice(0, STUCK_BATCH_ISSUE_DISPLAY_LIMIT);
  const overflow = total - shown.length;
  const list = shown.map((i) => {
    const title = (i.title || '').length > STUCK_BATCH_TITLE_MAX
      ? `${i.title.slice(0, STUCK_BATCH_TITLE_MAX - 1)}…`
      : i.title;
    const updated = new Date(i.updatedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    return `• <https://github.com/${repo}/issues/${i.number}|#${i.number}> ${title}\n  最終更新: ${updated}`;
  }).join('\n');
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
          text: `\`ai-processing\` のまま ${timeoutSec}秒以上経過した Issue を検知しました。\n全て \`ai-failed\` に変更済みです。\n\n${list}${overflowLine}`
        }
      },
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `${repo} | リトライ: \`ai-ready\` ラベルを再付与してください`
        }]
      }
    ]
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
          text: `• \`ai-processing\` のまま ${timeoutSec}秒以上経過\n• \`ai-failed\` に変更済み\n• リトライ: \`ai-ready\` ラベルを再付与してください`
        }
      },
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `${repo} | issues/${issueNumber} | 最終更新: ${updatedAtStr}`
        }]
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: `📋 Issue #${issueNumber}` },
            url: issueUrl
          }
        ]
      }
    ]
  };
}

// ─── Context-aware payload builder ──────────────────────────────
// Consolidates the business rules (PR URL extraction, error fallback,
// env defaults, Slack-node blocksJson wrapping) so n8n Code nodes can
// stay as 3-line adapters.

const PR_URL_PATTERN = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/;
const DEFAULT_CLAUDE_TIMEOUT_SEC = '600';
const DEFAULT_WORKFLOW_TIMEOUT_SEC = '660';

function extractPrUrl(stdout) {
  if (stdout === undefined || stdout === null) return null;
  const match = stdout.toString().match(PR_URL_PATTERN);
  return match ? match[0] : null;
}

function resolveFailureError(runClaudeOutput, timeoutSec) {
  const raw = ((runClaudeOutput && (runClaudeOutput.error || runClaudeOutput.stderr)) || '').toString().trim();
  if (raw) return raw;
  return `タイムアウトまたは不明なエラー（Claude Code 上限: ${timeoutSec}秒）`;
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
      threadTs
    }),
    replyBroadcast: false
  }),
  success: ({ issue, env, threadTs, runClaudeOutput, executionStartedAt }) => ({
    message: buildSuccessMessage({
      repo: env.GITHUB_REPO,
      issueNumber: issue.number,
      issueTitle: issue.title,
      channelId: env.SLACK_CHANNEL_ID,
      threadTs,
      prUrl: extractPrUrl(runClaudeOutput && runClaudeOutput.stdout)
        || `https://github.com/${env.GITHUB_REPO}/pulls`,
      executionStartedAt
    }),
    // Broadcast back to the main channel so people see the final result
    // even if they weren't watching the Issue's thread.
    replyBroadcast: true
  }),
  failure: ({ issue, env, threadTs, runClaudeOutput, executionUrl, executionStartedAt }) => ({
    message: buildFailureMessage({
      repo: env.GITHUB_REPO,
      issueNumber: issue.number,
      issueTitle: issue.title,
      channelId: env.SLACK_CHANNEL_ID,
      threadTs,
      error: resolveFailureError(
        runClaudeOutput,
        env.CLAUDE_TIMEOUT_SEC || DEFAULT_CLAUDE_TIMEOUT_SEC
      ),
      executionUrl,
      executionStartedAt
    }),
    replyBroadcast: true
  }),
  'stuck-batch': ({ env, issues }) => ({
    message: buildStuckBatchMessage({
      repo: env.GITHUB_REPO,
      channelId: env.SLACK_CHANNEL_ID,
      issues: issues || [],
      timeoutSec: env.WORKFLOW_TIMEOUT_SEC || DEFAULT_WORKFLOW_TIMEOUT_SEC
    }),
    replyBroadcast: false
  })
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
  const { message, replyBroadcast } = strategy({
    issue: context.issue,
    env: context.env || {},
    threadTs: context.threadTs,
    runClaudeOutput: context.runClaudeOutput,
    executionUrl: context.executionUrl,
    executionStartedAt: context.executionStartedAt,
    issues: context.issues
  });

  return {
    channel: message.channel,
    text: message.text,
    blocks: message.blocks,
    blocksJson: JSON.stringify({ blocks: message.blocks }),
    thread_ts: message.thread_ts || '',
    reply_broadcast: Boolean(replyBroadcast)
  };
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
  elapsedSinceStart,
  resolveFailureError,
  rememberThread,
  MAX_THREAD_ENTRIES,
  SLACK_SECTION_TEXT_LIMIT,
  FAILURE_ERROR_MAX,
  STUCK_BATCH_ISSUE_DISPLAY_LIMIT
};
