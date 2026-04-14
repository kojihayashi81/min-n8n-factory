'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
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
  STUCK_BATCH_ISSUE_DISPLAY_LIMIT,
} = require('./slack-notify-pkg/index.js');

const COMMON = {
  repo: 'owner/repo',
  issueNumber: 42,
  issueTitle: 'ログイン画面のエラーハンドリング改善',
  channelId: 'C0XXXXXXXXX',
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
    threadTs: '1776000000.000000',
    executionStartedAt: new Date(Date.now() - 192 * 1000).toISOString(),
    prUrl: 'https://github.com/owner/repo/pull/43',
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
    prUrl: 'https://github.com/owner/repo/pull/43',
  });
  const section = findBlock(msg, 'section');
  assert.doesNotMatch(section.text.text, /<https?:\/\//);
});

test('buildSuccessMessage: threadTs なしは thread_ts を含まない', () => {
  const msg = buildSuccessMessage({
    ...COMMON,
    threadTs: '',
    prUrl: 'https://github.com/owner/repo/pull/43',
  });
  assert.equal(msg.thread_ts, undefined);
});

test('buildSuccessMessage: prUrl が null のとき PR ボタンを出さず section を差し替える', () => {
  const msg = buildSuccessMessage({
    ...COMMON,
    threadTs: '0',
    prUrl: null,
  });
  // PR ボタンは出ない（findButton は未発見時 undefined を返す）
  assert.equal(findButton(msg, 'PR #'), undefined);
  // Issue ボタンは残る
  assert.ok(findButton(msg, 'Issue #42'));
  // section は「Draft PR を作成しました」と書かない
  const section = findBlock(msg, 'section');
  assert.doesNotMatch(section.text.text, /Draft PR を作成/);
  assert.match(section.text.text, /PR URL.*検出できなかった/);
  // context からも "PR #—" が消える
  const context = findBlock(msg, 'context');
  assert.doesNotMatch(context.elements[0].text, /PR #—/);
  assert.doesNotMatch(context.elements[0].text, /→ PR/);
});

test('buildSuccessMessage: qualityScore を渡すと section に「品質スコア: X / Y」を追加する', () => {
  const msg = buildSuccessMessage({
    ...COMMON,
    threadTs: '0',
    prUrl: 'https://github.com/owner/repo/pull/99',
    qualityScore: 78,
    qualityScoreMax: 100,
  });
  const section = findBlock(msg, 'section');
  assert.match(section.text.text, /Draft PR を作成しました/);
  assert.match(section.text.text, /品質スコア: 78 \/ 100/);
  assert.doesNotMatch(section.text.text, /再実行後/);
});

test(
  'buildSuccessMessage: qualityScoreRerun を渡すと「初回 X / Y → 再実行後 X' +
    "'" +
    ' / Y」表示になる',
  () => {
    const msg = buildSuccessMessage({
      ...COMMON,
      threadTs: '0',
      prUrl: 'https://github.com/owner/repo/pull/99',
      qualityScore: 55,
      qualityScoreMax: 100,
      qualityScoreRerun: 82,
    });
    const section = findBlock(msg, 'section');
    assert.match(section.text.text, /品質スコア: 初回 55 \/ 100 → 再実行後 82 \/ 100/);
  }
);

test('buildSuccessMessage: qualityScoreMax=80 は Web スキップの注記付きで表示される', () => {
  const msg = buildSuccessMessage({
    ...COMMON,
    threadTs: '0',
    prUrl: 'https://github.com/owner/repo/pull/99',
    qualityScore: 64,
    qualityScoreMax: 80,
  });
  const section = findBlock(msg, 'section');
  assert.match(section.text.text, /品質スコア: 64 \/ 80/);
  assert.match(section.text.text, /Web 調査スキップ/);
});

test('buildSuccessMessage: webSkipReason=no_hints は「検索ヒントなし」ラベル付きで表示', () => {
  const msg = buildSuccessMessage({
    ...COMMON,
    threadTs: '0',
    prUrl: 'https://github.com/owner/repo/pull/99',
    qualityScore: 64,
    qualityScoreMax: 80,
    webSkipReason: 'no_hints',
  });
  const section = findBlock(msg, 'section');
  assert.match(section.text.text, /Web 調査スキップ: 検索ヒントなし/);
  assert.match(section.text.text, /80 点満点換算/);
});

test('buildSuccessMessage: webSkipReason=web_failed は「Web 調査失敗」ラベル付きで表示', () => {
  const msg = buildSuccessMessage({
    ...COMMON,
    threadTs: '0',
    prUrl: 'https://github.com/owner/repo/pull/99',
    qualityScore: 64,
    qualityScoreMax: 80,
    webSkipReason: 'web_failed',
  });
  const section = findBlock(msg, 'section');
  assert.match(section.text.text, /Web 調査スキップ: Web 調査失敗/);
});

test('buildSuccessMessage: webSkipReason は qualityScoreMax=100 なら無視される', () => {
  const msg = buildSuccessMessage({
    ...COMMON,
    threadTs: '0',
    prUrl: 'https://github.com/owner/repo/pull/99',
    qualityScore: 75,
    qualityScoreMax: 100,
    webSkipReason: 'no_hints',
  });
  const section = findBlock(msg, 'section');
  assert.doesNotMatch(section.text.text, /Web 調査スキップ/);
});

test('buildSuccessMessage: qualityScore を渡さない場合は品質スコア行を含まない（後方互換）', () => {
  const msg = buildSuccessMessage({
    ...COMMON,
    threadTs: '0',
    prUrl: 'https://github.com/owner/repo/pull/99',
  });
  const section = findBlock(msg, 'section');
  assert.doesNotMatch(section.text.text, /品質スコア/);
});

test('buildSuccessMessage: qualityScoreMax が未指定なら 100 点満点として扱う', () => {
  const msg = buildSuccessMessage({
    ...COMMON,
    threadTs: '0',
    prUrl: 'https://github.com/owner/repo/pull/99',
    qualityScore: 75,
  });
  const section = findBlock(msg, 'section');
  assert.match(section.text.text, /品質スコア: 75 \/ 100/);
  assert.doesNotMatch(section.text.text, /Web 調査スキップ/);
});

test('buildSuccessMessage: prUrl が PR URL として解釈できない文字列でも PR ボタンを出さない', () => {
  const msg = buildSuccessMessage({
    ...COMMON,
    threadTs: '0',
    prUrl: 'https://github.com/owner/repo/pulls',
  });
  assert.equal(findButton(msg, 'PR #'), undefined);
  const context = findBlock(msg, 'context');
  assert.doesNotMatch(context.elements[0].text, /PR #—/);
});

// ─── extractQualityScore / extractQualityScoreRerun ──────────────

test('extractQualityScore: QUALITY_SCORE=X/Y 行を抽出する', () => {
  const stdout = 'blah\nQUALITY_SCORE=78/100\nhttps://github.com/owner/repo/pull/42\n';
  assert.deepEqual(extractQualityScore(stdout), { score: 78, max: 100 });
});

test('extractQualityScore: 80 点満点ケースも抽出できる', () => {
  const stdout = 'QUALITY_SCORE=64/80';
  assert.deepEqual(extractQualityScore(stdout), { score: 64, max: 80 });
});

test('extractQualityScore: センチネル行がなければ null を返す', () => {
  assert.equal(extractQualityScore('just some stdout without marker'), null);
});

test('extractQualityScore: stdout が null / undefined でも安全', () => {
  assert.equal(extractQualityScore(null), null);
  assert.equal(extractQualityScore(undefined), null);
});

test('extractQualityScore: QUALITY_SCORE_RERUN 行を誤って初回スコアとして拾わない', () => {
  const stdout = 'QUALITY_SCORE_RERUN=85/100';
  assert.equal(extractQualityScore(stdout), null);
});

test('extractQualityScoreRerun: QUALITY_SCORE_RERUN=X/Y 行を抽出する', () => {
  const stdout = 'QUALITY_SCORE=55/100\nQUALITY_SCORE_RERUN=82/100\n';
  assert.deepEqual(extractQualityScoreRerun(stdout), { score: 82, max: 100 });
});

test('extractQualityScoreRerun: センチネル行がなければ null（再実行なしのケース）', () => {
  const stdout = 'QUALITY_SCORE=78/100';
  assert.equal(extractQualityScoreRerun(stdout), null);
});

// ─── extractWebSkipReason ────────────────────────────────────────

test('extractWebSkipReason: WEB_SKIP_REASON=no_hints を抽出する', () => {
  const stdout =
    'QUALITY_SCORE=64/80\nWEB_SKIP_REASON=no_hints\nhttps://github.com/owner/repo/pull/42';
  assert.equal(extractWebSkipReason(stdout), 'no_hints');
});

test('extractWebSkipReason: WEB_SKIP_REASON=web_failed を抽出する', () => {
  const stdout = 'WEB_SKIP_REASON=web_failed';
  assert.equal(extractWebSkipReason(stdout), 'web_failed');
});

test('extractWebSkipReason: センチネル行がなければ null（Web 調査が正常に走ったケース）', () => {
  assert.equal(extractWebSkipReason('QUALITY_SCORE=78/100'), null);
});

test('extractWebSkipReason: 未知の値は null として扱う（型不一致の防御）', () => {
  assert.equal(extractWebSkipReason('WEB_SKIP_REASON=other_reason'), null);
});

test('extractWebSkipReason: stdout が null / undefined でも安全', () => {
  assert.equal(extractWebSkipReason(null), null);
  assert.equal(extractWebSkipReason(undefined), null);
});

// ─── buildFailureMessage ─────────────────────────────────────────

test('buildFailureMessage: エラー内容・リトライ案内・Issue/n8n実行ログボタン', () => {
  const msg = buildFailureMessage({
    ...COMMON,
    threadTs: '1776000000.000000',
    executionStartedAt: new Date(Date.now() - 601 * 1000).toISOString(),
    error: 'Claude Code タイムアウト',
    executionUrl: 'http://localhost:5678/execution/xxx',
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

test('buildFailureMessage: 巨大なエラーメッセージでも Slack の 3000 文字上限を超えない', () => {
  const longError = 'x'.repeat(10000);
  const msg = buildFailureMessage({
    ...COMMON,
    threadTs: '0',
    error: longError,
    executionUrl: 'http://localhost:5678/execution/xxx',
  });
  const section = findBlock(msg, 'section');
  assert.ok(
    section.text.text.length <= SLACK_SECTION_TEXT_LIMIT,
    `section.text.text.length=${section.text.text.length} > ${SLACK_SECTION_TEXT_LIMIT}`
  );
  // エラー本文が切り詰められても、リトライ案内は必ず末尾に残る
  assert.match(section.text.text, /ai-ready.*再付与/);
});

test('buildFailureMessage: error 未指定時はタイムアウト扱い', () => {
  const msg = buildFailureMessage({
    ...COMMON,
    threadTs: '0',
    error: undefined,
    executionUrl: 'http://localhost:5678/execution/xxx',
  });
  const section = findBlock(msg, 'section');
  assert.match(section.text.text, /タイムアウト/);
});

// ─── buildStuckMessage ───────────────────────────────────────────

test('buildStuckMessage: 基本構造と Issue ボタン', () => {
  const msg = buildStuckMessage({
    ...COMMON,
    updatedAt: '2026-04-12T05:20:00Z',
    timeoutSec: '660',
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
      { number: 44, title: 'Issue C', updatedAt: '2026-04-12T05:30:00Z' },
    ],
    timeoutSec: '660',
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
    issues: [{ number: 42, title: 'Test', updatedAt: '2026-04-12T05:20:00Z' }],
    timeoutSec: '660',
  });
  const context = findBlock(msg, 'context');
  assert.doesNotMatch(context.elements[0].text, /<https?:\/\//);
  assert.match(context.elements[0].text, /owner\/repo/);
});

test('buildStuckBatchMessage: 上限を超えたら先頭 N 件だけ表示し残りは "... 他 M 件" にまとめる', () => {
  const total = STUCK_BATCH_ISSUE_DISPLAY_LIMIT + 10;
  const issues = [];
  for (let i = 0; i < total; i++) {
    issues.push({
      number: 1000 + i,
      title: `Issue ${i}`,
      updatedAt: `2026-04-12T05:${String(i % 60).padStart(2, '0')}:00Z`,
    });
  }
  const msg = buildStuckBatchMessage({
    repo: 'owner/repo',
    channelId: 'C0XXXXXXXXX',
    issues,
    timeoutSec: '660',
  });
  const section = findBlock(msg, 'section');
  // 先頭の Issue は表示される
  assert.match(section.text.text, /#1000/);
  assert.match(section.text.text, new RegExp(`#${1000 + STUCK_BATCH_ISSUE_DISPLAY_LIMIT - 1}`));
  // 上限を超えた Issue は表示されない
  assert.doesNotMatch(
    section.text.text,
    new RegExp(`#${1000 + STUCK_BATCH_ISSUE_DISPLAY_LIMIT}\\b`)
  );
  // 「... 他 10 件」のような overflow 表示がある
  assert.match(section.text.text, /\.\.\. 他 10 件/);
  // ヘッダーは全件数を反映する
  const header = findBlock(msg, 'header');
  assert.match(header.text.text, new RegExp(`${total}件`));
});

test('buildStuckBatchMessage: 大量の Issue でも Slack の 3000 文字上限を超えない', () => {
  const issues = [];
  for (let i = 0; i < 100; i++) {
    issues.push({
      number: 10000 + i,
      title: 'x'.repeat(100), // わざと長めのタイトル
      updatedAt: '2026-04-12T05:20:00Z',
    });
  }
  const msg = buildStuckBatchMessage({
    repo: 'owner/repo',
    channelId: 'C0XXXXXXXXX',
    issues,
    timeoutSec: '660',
  });
  const section = findBlock(msg, 'section');
  assert.ok(
    section.text.text.length <= SLACK_SECTION_TEXT_LIMIT,
    `section.text.text.length=${section.text.text.length} > ${SLACK_SECTION_TEXT_LIMIT}`
  );
});

test('buildStuckBatchMessage: 上限以下の件数では overflow 表示が出ない', () => {
  const issues = [
    { number: 42, title: 'A', updatedAt: '2026-04-12T05:20:00Z' },
    { number: 43, title: 'B', updatedAt: '2026-04-12T05:25:00Z' },
  ];
  const msg = buildStuckBatchMessage({
    repo: 'owner/repo',
    channelId: 'C0XXXXXXXXX',
    issues,
    timeoutSec: '660',
  });
  const section = findBlock(msg, 'section');
  assert.doesNotMatch(section.text.text, /\.\.\. 他 /);
});

test('buildStuckBatchMessage: 1件でもバッチ形式で送れる', () => {
  const msg = buildStuckBatchMessage({
    repo: 'owner/repo',
    channelId: 'C0XXXXXXXXX',
    issues: [{ number: 42, title: 'Only one', updatedAt: '2026-04-12T05:20:00Z' }],
    timeoutSec: '660',
  });
  assert.match(msg.text, /1件/);
  const header = findBlock(msg, 'header');
  assert.match(header.text.text, /1件/);
});

// ─── extractPrNumber ─────────────────────────────────────────────

test('extractPrNumber: 普通の PR URL', () => {
  assert.equal(extractPrNumber('https://github.com/owner/repo/pull/43'), '43');
});

test('extractPrNumber: 末尾スラッシュ付きでも正しく抽出', () => {
  assert.equal(extractPrNumber('https://github.com/owner/repo/pull/43/'), '43');
});

test('extractPrNumber: クエリ文字列付きでも正しく抽出', () => {
  assert.equal(extractPrNumber('https://github.com/owner/repo/pull/43?foo=bar'), '43');
});

test('extractPrNumber: フラグメント付きでも正しく抽出', () => {
  assert.equal(extractPrNumber('https://github.com/owner/repo/pull/43/files#diff-abc'), '43');
});

test('extractPrNumber: PR URL でなければプレースホルダー', () => {
  assert.equal(extractPrNumber('https://github.com/owner/repo/pulls'), '—');
  assert.equal(extractPrNumber(''), '—');
  assert.equal(extractPrNumber(null), '—');
  assert.equal(extractPrNumber(undefined), '—');
});

// ─── elapsedSinceStart ───────────────────────────────────────────

test('elapsedSinceStart: ISO 文字列からの経過秒を返す', () => {
  const start = new Date(Date.now() - 123 * 1000).toISOString();
  const elapsed = elapsedSinceStart(start);
  assert.ok(elapsed >= 123 && elapsed <= 125); // 実行時のずれを許容
});

test('elapsedSinceStart: 未来の時刻でも負にはならない', () => {
  const start = new Date(Date.now() + 60 * 1000).toISOString();
  assert.equal(elapsedSinceStart(start), 0);
});

test('elapsedSinceStart: 無効な入力は 0', () => {
  assert.equal(elapsedSinceStart(undefined), 0);
  assert.equal(elapsedSinceStart(null), 0);
  assert.equal(elapsedSinceStart(''), 0);
  assert.equal(elapsedSinceStart('not-a-date'), 0);
});

// ─── extractPrUrl ────────────────────────────────────────────────

test('extractPrUrl: stdout から PR URL を抽出', () => {
  assert.equal(
    extractPrUrl('調査完了\nhttps://github.com/owner/repo/pull/43\n'),
    'https://github.com/owner/repo/pull/43'
  );
});

test('extractPrUrl: PR URL がなければ null', () => {
  assert.equal(extractPrUrl('調査完了'), null);
});

test('extractPrUrl: undefined / null は null', () => {
  assert.equal(extractPrUrl(undefined), null);
  assert.equal(extractPrUrl(null), null);
});

// ─── resolveFailureError ─────────────────────────────────────────

test('resolveFailureError: error フィールドを優先', () => {
  const result = resolveFailureError({ error: 'fatal', stderr: 'warn' }, '600');
  assert.equal(result, 'fatal');
});

test('resolveFailureError: error がなければ stderr を使う', () => {
  const result = resolveFailureError({ stderr: 'something failed' }, '600');
  assert.equal(result, 'something failed');
});

test('resolveFailureError: 両方ない場合はタイムアウト案内にフォールバック', () => {
  const result = resolveFailureError({}, '1020');
  assert.match(result, /タイムアウトまたは不明なエラー/);
  assert.match(result, /1020秒/);
});

test('resolveFailureError: timeoutSec が数字でない場合はデフォルトに置換（env 誤配線ガード）', () => {
  // 例: SLACK_BOT_TOKEN のような値が誤って渡された場合
  const result = resolveFailureError({}, 'xoxb-12345-abcdef');
  assert.doesNotMatch(result, /xoxb/);
  assert.match(result, /1020秒/); // DEFAULT_CLAUDE_TIMEOUT_SEC にフォールバック
});

test('resolveFailureError: timeoutSec が 7 桁以上でもデフォルトに置換', () => {
  const result = resolveFailureError({}, '9999999');
  assert.match(result, /1020秒/);
});

test('resolveFailureError: timeoutSec が空文字でもデフォルトに置換', () => {
  const result = resolveFailureError({}, '');
  assert.match(result, /1020秒/);
});

test('resolveFailureError: runClaudeOutput 自体が undefined でも安全', () => {
  const result = resolveFailureError(undefined, '1020');
  assert.match(result, /タイムアウトまたは不明なエラー/);
});

test('resolveFailureError: エラー本文に含まれる秘匿トークンを REDACTED に置換する', () => {
  const result = resolveFailureError(
    { stderr: 'API error: Authorization: Bearer xoxb-12345-abcdefghij failed' },
    '600'
  );
  assert.doesNotMatch(result, /xoxb-12345-abcdefghij/);
  assert.doesNotMatch(result, /Bearer xoxb/);
  assert.match(result, /\[REDACTED\]/);
});

// n8n-run-claude-pipeline.sh の emit_failure が吐くデリミタ行
// `=== pipeline failed at agent=<name> (exit=<N>, reason=<text>) ===`
// は Slack 通知 / GitHub エラーコメントの両方で「どのエージェントで落ちたか」を
// 人間が追える唯一の手がかり。resolveFailureError → scrubSecrets がこの行を
// 誤って削ったり改変したりしないことを契約として守る。デリミタのフォーマットを
// 変更するとき（例: agent= を stage= に変える）はこのテストを一緒に更新すること。
test('resolveFailureError: pipeline emit_failure のデリミタ行から agent 名を失わない', () => {
  const stderr = [
    '=== pipeline failed at agent=collector (exit=1, reason=claude exit=1) ===',
    '--- collector stdout ---',
    '',
    '--- collector stderr ---',
    'Error: Anthropic API returned 401',
  ].join('\n');
  const result = resolveFailureError({ stderr }, '1020');
  assert.match(result, /agent=collector/);
  assert.match(result, /pipeline failed at agent=/);
  assert.match(result, /Anthropic API returned 401/);
});

// ─── scrubSecrets ────────────────────────────────────────────────

test('scrubSecrets: Slack bot token を REDACTED に置換', () => {
  assert.equal(
    scrubSecrets('token=xoxb-1234567890-abcdefghijk post failed'),
    'token=[REDACTED] post failed'
  );
});

test('scrubSecrets: Slack rotation refresh token (xoxe) も REDACTED に置換', () => {
  assert.equal(
    scrubSecrets('refresh token xoxe-1-My2AbCdEfGhIj expired'),
    'refresh token [REDACTED] expired'
  );
});

test('scrubSecrets: Slack app-level token (xoxa) も REDACTED に置換', () => {
  assert.equal(scrubSecrets('xoxa-2-123456789-abcdefghij'), '[REDACTED]');
});

test('scrubSecrets: GitHub PAT を REDACTED に置換', () => {
  assert.equal(
    scrubSecrets('auth failed with ghp_abcdefghijklmnopqrstuvwxyz0123456789'),
    'auth failed with [REDACTED]'
  );
  assert.equal(
    scrubSecrets('github_pat_11ABCDEFG0aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789'),
    '[REDACTED]'
  );
});

test('scrubSecrets: Anthropic API key を REDACTED に置換', () => {
  assert.equal(scrubSecrets('401 with sk-ant-api03-abcdefghijklmnop'), '401 with [REDACTED]');
});

test('scrubSecrets: Authorization: Bearer ヘッダーを丸ごと置換', () => {
  assert.equal(
    scrubSecrets('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'),
    '[REDACTED]'
  );
});

test('scrubSecrets: 複数の秘匿文字列を同時に置換', () => {
  const input = 'ghp_0123456789abcdefghij01 and xoxb-1-2-abcdefghij';
  const out = scrubSecrets(input);
  assert.doesNotMatch(out, /ghp_/);
  assert.doesNotMatch(out, /xoxb-/);
});

test('scrubSecrets: 秘匿文字列を含まない入力はそのまま返す', () => {
  assert.equal(scrubSecrets('plain error text'), 'plain error text');
});

test('scrubSecrets: undefined / null は素通し', () => {
  assert.equal(scrubSecrets(undefined), undefined);
  assert.equal(scrubSecrets(null), null);
});

// ─── buildPayloadForContext ──────────────────────────────────────

const ENV = {
  GITHUB_REPO: 'owner/repo',
  SLACK_CHANNEL_ID: 'C0XXXXXXXXX',
  CLAUDE_TIMEOUT_SEC: '1020',
  WORKFLOW_TIMEOUT_SEC: '1200',
  STUCK_THRESHOLD_SEC: '1800',
};
const ISSUE = { number: 42, title: 'ログイン画面のエラーハンドリング改善' };

test('buildPayloadForContext: kind=start で blocksJson を含む payload を返す', () => {
  const payload = buildPayloadForContext({ kind: 'start', issue: ISSUE, env: ENV });
  assert.equal(payload.channel, 'C0XXXXXXXXX');
  assert.match(payload.text, /🔄 処理開始/);
  assert.equal(typeof payload.blocksJson, 'string');
  const reparsed = JSON.parse(payload.blocksJson);
  assert.ok(Array.isArray(reparsed.blocks));
  // start は親メッセージなので reply_broadcast=false
  assert.equal(payload.reply_broadcast, false);
  assert.equal(payload.thread_ts, '');
});

test('buildPayloadForContext: kind=start で threadTs があればスレッド返信になる', () => {
  const payload = buildPayloadForContext({
    kind: 'start',
    issue: ISSUE,
    env: ENV,
    threadTs: '1776000000.123456',
  });
  assert.equal(payload.thread_ts, '1776000000.123456');
  assert.equal(payload.reply_broadcast, false);
});

test('buildPayloadForContext: kind=success は reply_broadcast=true でチャンネルに再告知する', () => {
  const payload = buildPayloadForContext({
    kind: 'success',
    issue: ISSUE,
    env: ENV,
    threadTs: '1776000000.000000',
    runClaudeOutput: { stdout: 'https://github.com/owner/repo/pull/43' },
  });
  assert.equal(payload.reply_broadcast, true);
  assert.equal(payload.thread_ts, '1776000000.000000');
});

test('buildPayloadForContext: kind=failure も reply_broadcast=true', () => {
  const payload = buildPayloadForContext({
    kind: 'failure',
    issue: ISSUE,
    env: ENV,
    threadTs: '0',
    runClaudeOutput: { stderr: 'boom' },
    executionUrl: 'http://localhost:5678/execution/xxx',
  });
  assert.equal(payload.reply_broadcast, true);
});

test('buildPayloadForContext: kind=stuck-batch は単独投稿（broadcast=false, thread_ts 空）', () => {
  const payload = buildPayloadForContext({
    kind: 'stuck-batch',
    env: ENV,
    issues: [{ number: 42, title: 'A', updatedAt: '2026-04-12T05:20:00Z' }],
  });
  assert.equal(payload.reply_broadcast, false);
  assert.equal(payload.thread_ts, '');
});

test('buildPayloadForContext: kind=success で stdout の PR URL を抽出', () => {
  const payload = buildPayloadForContext({
    kind: 'success',
    issue: ISSUE,
    env: ENV,
    threadTs: '1776000000.000000',
    runClaudeOutput: { stdout: '完了\nhttps://github.com/owner/repo/pull/43' },
  });
  const prBtn = findButton(payload, 'PR #43');
  assert.ok(prBtn);
  assert.equal(prBtn.url, 'https://github.com/owner/repo/pull/43');
});

test('buildPayloadForContext: kind=success で stdout の QUALITY_SCORE センチネル行を品質スコア表示に変換する', () => {
  const payload = buildPayloadForContext({
    kind: 'success',
    issue: ISSUE,
    env: ENV,
    threadTs: '0',
    runClaudeOutput: {
      stdout: [
        '進捗: Collector done',
        'QUALITY_SCORE=78/100',
        'https://github.com/owner/repo/pull/43',
      ].join('\n'),
    },
  });
  const section = findBlock(payload, 'section');
  assert.match(section.text.text, /品質スコア: 78 \/ 100/);
  assert.doesNotMatch(section.text.text, /再実行後/);
});

test('buildPayloadForContext: kind=success で QUALITY_SCORE_RERUN があれば再実行後スコアも表示する', () => {
  const payload = buildPayloadForContext({
    kind: 'success',
    issue: ISSUE,
    env: ENV,
    threadTs: '0',
    runClaudeOutput: {
      stdout: [
        'QUALITY_SCORE=55/100',
        'QUALITY_SCORE_RERUN=82/100',
        'https://github.com/owner/repo/pull/43',
      ].join('\n'),
    },
  });
  const section = findBlock(payload, 'section');
  assert.match(section.text.text, /初回 55 \/ 100 → 再実行後 82 \/ 100/);
});

test('buildPayloadForContext: kind=success で QUALITY_SCORE=X/80 は Web スキップ注記付きで表示', () => {
  const payload = buildPayloadForContext({
    kind: 'success',
    issue: ISSUE,
    env: ENV,
    threadTs: '0',
    runClaudeOutput: {
      stdout: ['QUALITY_SCORE=64/80', 'https://github.com/owner/repo/pull/43'].join('\n'),
    },
  });
  const section = findBlock(payload, 'section');
  assert.match(section.text.text, /品質スコア: 64 \/ 80/);
  assert.match(section.text.text, /Web 調査スキップ/);
});

test('buildPayloadForContext: kind=success で WEB_SKIP_REASON=no_hints を表示に反映', () => {
  const payload = buildPayloadForContext({
    kind: 'success',
    issue: ISSUE,
    env: ENV,
    threadTs: '0',
    runClaudeOutput: {
      stdout: [
        'QUALITY_SCORE=64/80',
        'WEB_SKIP_REASON=no_hints',
        'https://github.com/owner/repo/pull/43',
      ].join('\n'),
    },
  });
  const section = findBlock(payload, 'section');
  assert.match(section.text.text, /Web 調査スキップ: 検索ヒントなし/);
});

test('buildPayloadForContext: kind=success で WEB_SKIP_REASON=web_failed を表示に反映', () => {
  const payload = buildPayloadForContext({
    kind: 'success',
    issue: ISSUE,
    env: ENV,
    threadTs: '0',
    runClaudeOutput: {
      stdout: [
        'QUALITY_SCORE=64/80',
        'WEB_SKIP_REASON=web_failed',
        'https://github.com/owner/repo/pull/43',
      ].join('\n'),
    },
  });
  const section = findBlock(payload, 'section');
  assert.match(section.text.text, /Web 調査スキップ: Web 調査失敗/);
});

test('buildPayloadForContext: kind=success で QUALITY_SCORE 行がない場合は品質スコア行を含まない', () => {
  const payload = buildPayloadForContext({
    kind: 'success',
    issue: ISSUE,
    env: ENV,
    threadTs: '0',
    runClaudeOutput: { stdout: 'https://github.com/owner/repo/pull/43' },
  });
  const section = findBlock(payload, 'section');
  assert.doesNotMatch(section.text.text, /品質スコア/);
});

test('buildPayloadForContext: kind=success で PR URL が抽出できないと PR ボタンを出さない', () => {
  const payload = buildPayloadForContext({
    kind: 'success',
    issue: ISSUE,
    env: ENV,
    threadTs: '1776000000.000000',
    runClaudeOutput: { stdout: '出力なし' },
  });
  // PR ボタンは出ない
  const actions = findBlock(payload, 'actions');
  const prBtn = actions.elements.find((el) => /PR #/.test(el.text.text));
  assert.equal(prBtn, undefined);
  // Issue ボタンは残る
  const issueBtn = actions.elements.find((el) => /Issue #42/.test(el.text.text));
  assert.ok(issueBtn);
  // section 文言は差し替わる
  const section = findBlock(payload, 'section');
  assert.match(section.text.text, /PR URL.*検出できなかった/);
});

test('buildPayloadForContext: kind=failure で stderr をエラー本文に使う', () => {
  const payload = buildPayloadForContext({
    kind: 'failure',
    issue: ISSUE,
    env: ENV,
    threadTs: '0',
    runClaudeOutput: { stderr: 'segmentation fault' },
    executionUrl: 'http://localhost:5678/execution/xxx',
  });
  const section = findBlock(payload, 'section');
  assert.match(section.text.text, /segmentation fault/);
  assert.match(section.text.text, /ai-ready.*再付与/);
});

test('buildPayloadForContext: kind=failure で stdout/stderr が空ならタイムアウト案内', () => {
  const payload = buildPayloadForContext({
    kind: 'failure',
    issue: ISSUE,
    env: ENV,
    threadTs: '0',
    runClaudeOutput: {},
    executionUrl: 'http://localhost:5678/execution/xxx',
  });
  const section = findBlock(payload, 'section');
  assert.match(section.text.text, /タイムアウトまたは不明なエラー/);
  assert.match(section.text.text, /1020秒/);
});

test('buildPayloadForContext: kind=stuck-batch で集約された Issue 一覧を渡せる', () => {
  const payload = buildPayloadForContext({
    kind: 'stuck-batch',
    env: ENV,
    issues: [
      { number: 42, title: 'A', updatedAt: '2026-04-12T05:20:00Z' },
      { number: 43, title: 'B', updatedAt: '2026-04-12T05:25:00Z' },
    ],
  });
  assert.match(payload.text, /2件/);
  const section = findBlock(payload, 'section');
  assert.match(section.text.text, /#42/);
  assert.match(section.text.text, /#43/);
  // STUCK_THRESHOLD_SEC=1800 が反映されている（WORKFLOW_TIMEOUT_SEC ではない）
  assert.match(section.text.text, /1800秒/);
});

test('buildPayloadForContext: kind=failure で errorText を payload に含める', () => {
  const payload = buildPayloadForContext({
    kind: 'failure',
    issue: ISSUE,
    env: ENV,
    threadTs: '0',
    runClaudeOutput: { stderr: 'segmentation fault' },
    executionUrl: 'http://localhost:5678/execution/xxx',
  });
  // GitHub コメント側が同じエラーテキストを参照できるように payload に露出する
  assert.equal(payload.errorText, 'segmentation fault');
});

test('buildPayloadForContext: kind=failure で errorText もスクラブ済み', () => {
  const payload = buildPayloadForContext({
    kind: 'failure',
    issue: ISSUE,
    env: ENV,
    threadTs: '0',
    runClaudeOutput: { stderr: 'fetch failed Authorization: Bearer abc123456789xyz' },
    executionUrl: 'http://localhost:5678/execution/xxx',
  });
  assert.doesNotMatch(payload.errorText, /abc123456789xyz/);
  assert.match(payload.errorText, /\[REDACTED\]/);
});

test('buildPayloadForContext: errorText は failure 以外の kind では含まれない', () => {
  const start = buildPayloadForContext({ kind: 'start', issue: ISSUE, env: ENV });
  assert.equal(start.errorText, undefined);
  const success = buildPayloadForContext({
    kind: 'success',
    issue: ISSUE,
    env: ENV,
    threadTs: '0',
    runClaudeOutput: { stdout: 'https://github.com/owner/repo/pull/43' },
  });
  assert.equal(success.errorText, undefined);
});

test('buildPayloadForContext: 不明な kind は例外を投げる', () => {
  assert.throws(
    () => buildPayloadForContext({ kind: 'unknown', issue: ISSUE, env: ENV }),
    /Unknown payload kind: unknown/
  );
});

// ─── rememberThread ──────────────────────────────────────────────

test('rememberThread: 初回は ts を保存する', () => {
  const sd = {};
  rememberThread(sd, 42, '1776000000.111111');
  assert.equal(sd.slackThreads['42'], '1776000000.111111');
});

test('rememberThread: 既存エントリは上書きしない（リトライ時に元スレッドを維持）', () => {
  const sd = { slackThreads: { 42: '1776000000.111111' } };
  rememberThread(sd, 42, '1776999999.999999');
  assert.equal(sd.slackThreads['42'], '1776000000.111111');
});

test('rememberThread: staticData / issueNumber / ts が欠けていても落ちない', () => {
  rememberThread(null, 42, '1776000000.000000');
  rememberThread({}, null, '1776000000.000000');
  rememberThread({}, 42, '');
  // どれも例外を投げなければOK
  assert.ok(true);
});

test('rememberThread: エントリ数が上限を超えると古い Slack ts から順に削除される', () => {
  const sd = { slackThreads: {} };
  // 上限ちょうどまで詰める（古い順に ts を付与）
  for (let i = 0; i < MAX_THREAD_ENTRIES; i++) {
    sd.slackThreads[String(i + 1)] = String(1000000000 + i) + '.000000';
  }
  // 上限 + 1 件目を追加（最新 ts）
  rememberThread(sd, 99999, '2000000000.000000');
  const keys = Object.keys(sd.slackThreads);
  assert.equal(keys.length, MAX_THREAD_ENTRIES);
  // 最古のキー（"1"）が追い出されている
  assert.equal(sd.slackThreads['1'], undefined);
  // 新規追加分は残っている
  assert.equal(sd.slackThreads['99999'], '2000000000.000000');
});

test('rememberThread: 上限を大きく超えた流入でも上限件数に収まる', () => {
  const sd = { slackThreads: {} };
  for (let i = 0; i < MAX_THREAD_ENTRIES + 50; i++) {
    // 既存チェックを回避するため、毎回違う issue 番号で直接 map に書く代わりに
    // rememberThread を呼ぶ（空 map → 順次追加 → 上限超過）
    rememberThread(sd, 1000 + i, String(1000000000 + i) + '.000000');
  }
  assert.equal(Object.keys(sd.slackThreads).length, MAX_THREAD_ENTRIES);
  // 追い出されたのは最も古い 50 件
  assert.equal(sd.slackThreads['1000'], undefined);
  assert.equal(sd.slackThreads['1049'], undefined);
  assert.equal(sd.slackThreads['1050'], '1000000050.000000');
});
