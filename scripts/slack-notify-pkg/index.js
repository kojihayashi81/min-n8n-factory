'use strict';

// Slack Block Kit templates for n8n notifications.
// Pure data builders — no I/O. Invoked from n8n Code nodes via require().
//
// Navigation: URL buttons in `actions` blocks. Slack shows an
// "interactivity not configured" warning on first click unless the app has
// Interactivity & Shortcuts enabled — this is accepted intentionally.

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

function buildSuccessMessage({ repo, issueNumber, issueTitle, channelId, threadTs, prUrl }) {
  const issueUrl = `https://github.com/${repo}/issues/${issueNumber}`;
  const prNum = prUrl.split('/').pop();
  const elapsed = threadTs ? Math.floor(Date.now() / 1000 - parseFloat(threadTs)) : 0;
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

function buildFailureMessage({ repo, issueNumber, issueTitle, channelId, threadTs, error, executionUrl }) {
  const issueUrl = `https://github.com/${repo}/issues/${issueNumber}`;
  const errorText = (error || 'タイムアウト').substring(0, 2500);
  const elapsed = threadTs ? Math.floor(Date.now() / 1000 - parseFloat(threadTs)) : 0;
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
  const list = issues.map((i) => {
    const updated = new Date(i.updatedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    return `• <https://github.com/${repo}/issues/${i.number}|#${i.number}> ${i.title}\n  最終更新: ${updated}`;
  }).join('\n');
  return {
    channel: channelId,
    text: `⏰ スタック検知: ${issues.length}件`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `⏰ スタック検知 (${issues.length}件)` } },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `\`ai-processing\` のまま ${timeoutSec}秒以上経過した Issue を検知しました。\n全て \`ai-failed\` に変更済みです。\n\n${list}`
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

module.exports = {
  buildStartMessage,
  buildSuccessMessage,
  buildFailureMessage,
  buildStuckMessage,
  buildStuckBatchMessage
};
