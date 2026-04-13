'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildStartMessage,
  buildSuccessMessage,
  buildFailureMessage,
  buildStuckMessage,
  buildStuckBatchMessage
} = require('./slack-notify-pkg/index.js');

const COMMON = {
  repo: 'owner/repo',
  issueNumber: 42,
  issueTitle: 'ログイン画面のエラーハンドリング改善',
  channelId: 'C0XXXXXXXXX'
};

function findBlock(msg, type) {
  return msg.blocks.find((b) => b.type === type);
}

function findButton(msg, label) {
  const actions = findBlock(msg, 'actions');
  if (!actions) return null;
  return actions.elements.find((el) => el.text.text.includes(label));
}

// ─── buildStartMessage ───────────────────────────────────────────

test('buildStartMessage: 基本構造', () => {
  const msg = buildStartMessage(COMMON);
  assert.equal(msg.channel, 'C0XXXXXXXXX');
  assert.match(msg.text, /🔄 処理開始/);
  assert.match(msg.text, /#42/);
  assert.equal(msg.blocks.length, 4);
  assert.equal(msg.blocks[0].type, 'header');
  assert.equal(msg.blocks[1].type, 'section');
  assert.equal(msg.blocks[2].type, 'context');
  assert.equal(msg.blocks[3].type, 'actions');
});

test('buildStartMessage: section にインラインリンクを含まない', () => {
  const msg = buildStartMessage(COMMON);
  const section = findBlock(msg, 'section');
  assert.doesNotMatch(section.text.text, /<https?:\/\//);
});

test('buildStartMessage: context にリポジトリリンクを含まない', () => {
  const msg = buildStartMessage(COMMON);
  const context = findBlock(msg, 'context');
  assert.doesNotMatch(context.elements[0].text, /<https?:\/\//);
  assert.match(context.elements[0].text, /owner\/repo/);
});

test('buildStartMessage: Issue ボタンの URL', () => {
  const msg = buildStartMessage(COMMON);
  const button = findButton(msg, 'Issue #42');
  assert.ok(button);
  assert.equal(button.url, 'https://github.com/owner/repo/issues/42');
});

test('buildStartMessage: threadTs なしは thread_ts を含まない', () => {
  const msg = buildStartMessage(COMMON);
  assert.equal(msg.thread_ts, undefined);
});

test('buildStartMessage: threadTs 指定時はスレッド返信になる', () => {
  const msg = buildStartMessage({ ...COMMON, threadTs: '1776000000.123456' });
  assert.equal(msg.thread_ts, '1776000000.123456');
});

// ─── buildSuccessMessage ─────────────────────────────────────────

test('buildSuccessMessage: 基本構造と Issue/PR ボタン', () => {
  const msg = buildSuccessMessage({
    ...COMMON,
    threadTs: String(Math.floor(Date.now() / 1000) - 192),
    prUrl: 'https://github.com/owner/repo/pull/43'
  });
  assert.match(msg.text, /✅ 調査完了/);
  assert.ok(msg.thread_ts);
  const issueBtn = findButton(msg, 'Issue #42');
  const prBtn = findButton(msg, 'PR #43');
  assert.ok(issueBtn);
  assert.ok(prBtn);
  assert.equal(prBtn.url, 'https://github.com/owner/repo/pull/43');
  assert.equal(issueBtn.url, 'https://github.com/owner/repo/issues/42');
});

test('buildSuccessMessage: section にインラインリンクを含まない', () => {
  const msg = buildSuccessMessage({
    ...COMMON,
    threadTs: '0',
    prUrl: 'https://github.com/owner/repo/pull/43'
  });
  const section = findBlock(msg, 'section');
  assert.doesNotMatch(section.text.text, /<https?:\/\//);
});

test('buildSuccessMessage: threadTs なしは thread_ts を含まない', () => {
  const msg = buildSuccessMessage({
    ...COMMON,
    threadTs: '',
    prUrl: 'https://github.com/owner/repo/pull/43'
  });
  assert.equal(msg.thread_ts, undefined);
});

// ─── buildFailureMessage ─────────────────────────────────────────

test('buildFailureMessage: エラー内容・リトライ案内・Issue/n8n実行ログボタン', () => {
  const msg = buildFailureMessage({
    ...COMMON,
    threadTs: String(Math.floor(Date.now() / 1000) - 601),
    error: 'Claude Code タイムアウト',
    executionUrl: 'http://localhost:5678/execution/xxx'
  });
  assert.match(msg.text, /❌ 処理失敗/);
  const section = findBlock(msg, 'section');
  assert.match(section.text.text, /Claude Code タイムアウト/);
  assert.match(section.text.text, /ai-ready.*再付与/);
  assert.doesNotMatch(section.text.text, /<https?:\/\//);
  const logBtn = findButton(msg, 'n8n実行ログ');
  assert.ok(logBtn);
  assert.equal(logBtn.url, 'http://localhost:5678/execution/xxx');
});

test('buildFailureMessage: 長いエラーメッセージを切り詰める', () => {
  const longError = 'x'.repeat(500);
  const msg = buildFailureMessage({
    ...COMMON,
    threadTs: '0',
    error: longError,
    executionUrl: 'http://localhost:5678/execution/xxx'
  });
  const section = findBlock(msg, 'section');
  // 2500 文字に切り詰め + 後続のリトライ案内
  assert.ok(section.text.text.length < 2800);
});

test('buildFailureMessage: error 未指定時はタイムアウト扱い', () => {
  const msg = buildFailureMessage({
    ...COMMON,
    threadTs: '0',
    error: undefined,
    executionUrl: 'http://localhost:5678/execution/xxx'
  });
  const section = findBlock(msg, 'section');
  assert.match(section.text.text, /タイムアウト/);
});

// ─── buildStuckMessage ───────────────────────────────────────────

test('buildStuckMessage: 基本構造と Issue ボタン', () => {
  const msg = buildStuckMessage({
    ...COMMON,
    updatedAt: '2026-04-12T05:20:00Z',
    timeoutSec: '660'
  });
  assert.match(msg.text, /⏰ スタック検知/);
  const section = findBlock(msg, 'section');
  assert.match(section.text.text, /660秒以上経過/);
  assert.match(section.text.text, /ai-failed/);
  assert.match(section.text.text, /ai-ready/);
  assert.doesNotMatch(section.text.text, /<https?:\/\//);
  const issueBtn = findButton(msg, 'Issue #42');
  assert.ok(issueBtn);
});

// ─── buildStuckBatchMessage ──────────────────────────────────────

test('buildStuckBatchMessage: 複数 Issue の集約(リストは mrkdwn リンク)', () => {
  const msg = buildStuckBatchMessage({
    repo: 'owner/repo',
    channelId: 'C0XXXXXXXXX',
    issues: [
      { number: 42, title: 'Issue A', updatedAt: '2026-04-12T05:20:00Z' },
      { number: 43, title: 'Issue B', updatedAt: '2026-04-12T05:25:00Z' },
      { number: 44, title: 'Issue C', updatedAt: '2026-04-12T05:30:00Z' }
    ],
    timeoutSec: '660'
  });
  assert.equal(msg.channel, 'C0XXXXXXXXX');
  assert.match(msg.text, /3件/);
  const header = findBlock(msg, 'header');
  assert.match(header.text.text, /⏰ スタック検知 \(3件\)/);
  const section = findBlock(msg, 'section');
  assert.match(section.text.text, /#42/);
  assert.match(section.text.text, /#43/);
  assert.match(section.text.text, /#44/);
  assert.match(section.text.text, /Issue A/);
  assert.match(section.text.text, /660秒以上経過/);
  // Issue 一覧は視認性のため mrkdwn リンクとして残す
  assert.match(section.text.text, /<https:\/\/github\.com\/owner\/repo\/issues\/42/);
});

test('buildStuckBatchMessage: context からリポジトリリンクが除去されている', () => {
  const msg = buildStuckBatchMessage({
    repo: 'owner/repo',
    channelId: 'C0XXXXXXXXX',
    issues: [
      { number: 42, title: 'Test', updatedAt: '2026-04-12T05:20:00Z' }
    ],
    timeoutSec: '660'
  });
  const context = findBlock(msg, 'context');
  assert.doesNotMatch(context.elements[0].text, /<https?:\/\//);
  assert.match(context.elements[0].text, /owner\/repo/);
});

test('buildStuckBatchMessage: 1件でもバッチ形式で送れる', () => {
  const msg = buildStuckBatchMessage({
    repo: 'owner/repo',
    channelId: 'C0XXXXXXXXX',
    issues: [
      { number: 42, title: 'Only one', updatedAt: '2026-04-12T05:20:00Z' }
    ],
    timeoutSec: '660'
  });
  assert.match(msg.text, /1件/);
  const header = findBlock(msg, 'header');
  assert.match(header.text.text, /1件/);
});
