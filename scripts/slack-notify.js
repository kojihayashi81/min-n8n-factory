#!/usr/bin/env node
'use strict';

const https = require('https');

// ─── Block Kit Templates ────────────────────────────────────────

function buildStartMessage({ repo, issueNumber, issueTitle, channelId }) {
  const issueUrl = `https://github.com/${repo}/issues/${issueNumber}`;
  const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  return {
    channel: channelId,
    text: `🔄 処理開始: #${issueNumber} ${issueTitle}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: '🔄 処理開始' } },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `<${issueUrl}|#${issueNumber} ${issueTitle}>`
        }
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `<https://github.com/${repo}|${repo}> | issues/${issueNumber} | ${now}` }]
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
  const errorText = (error || 'タイムアウト').substring(0, 200);
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

// ─── Slack API ──────────────────────────────────────────────────

function postMessage(token, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request({
      hostname: 'slack.com',
      path: '/api/chat.postMessage',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Invalid JSON response: ${body}`));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  const encoded = process.argv[2];
  if (!encoded) {
    process.stderr.write('Usage: slack-notify.js <encodeURIComponent-encoded JSON>\n');
    process.exit(0);
  }

  const args = JSON.parse(decodeURIComponent(encoded));

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    process.stderr.write('SLACK_BOT_TOKEN is not set — skipping Slack notification\n');
    process.exit(0);
  }

  const channelId = process.env.SLACK_CHANNEL_ID;
  if (!channelId) {
    process.stderr.write('SLACK_CHANNEL_ID is not set — skipping Slack notification\n');
    process.exit(0);
  }

  const repo = args.repo || process.env.GITHUB_REPO;
  const common = {
    repo,
    issueNumber: args.issueNumber,
    issueTitle: args.issueTitle,
    channelId
  };

  let payload;
  switch (args.type) {
    case 'start':
      payload = buildStartMessage(common);
      break;
    case 'success':
      payload = buildSuccessMessage({ ...common, threadTs: args.threadTs, prUrl: args.prUrl });
      break;
    case 'failure':
      payload = buildFailureMessage({
        ...common,
        threadTs: args.threadTs,
        error: args.error,
        executionUrl: args.executionUrl
      });
      break;
    case 'stuck':
      payload = buildStuckMessage({
        ...common,
        updatedAt: args.updatedAt,
        timeoutSec: args.timeoutSec || process.env.CLAUDE_TIMEOUT_SEC || '600'
      });
      break;
    default:
      process.stderr.write(`Unknown message type: ${args.type}\n`);
      process.exit(0);
  }

  try {
    const result = await postMessage(token, payload);
    if (result.ok) {
      process.stdout.write(result.ts || '');
    } else {
      process.stderr.write(`Slack API error: ${result.error}\n`);
    }
  } catch (err) {
    process.stderr.write(`Slack request failed: ${err.message}\n`);
  }
}

main();
