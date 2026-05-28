# TEST_NOTES.md

## 実行できなかったコマンド

- npm test
- npm run typecheck
- npm run build
- npm install

## 理由

Claude in Chrome / ブラウザ自動化環境では Node.js / npm / require / process にアクセスできないため。

確認値:
- hasNodeAccess: false
- hasRequire: false
- platform: MacIntel（ブラウザ内サンドボックス）

## ローカルで実行すべきコマンド

```bash
npm install
npm run db:generate
npm run typecheck
npm run lint
npm run build
npm test
npm run test:coverage
```

## 実際に作成・コミットしたファイル

| ファイル | 種別 | 内容 |
|---|---|---|
| src/lib/automation/shouldCreateAutoReplySendLog.ts | 純粋関数 | 送信ログ・タグログ作成判定ロジック |
| __tests__/unit/shouldCreateAutoReplySendLog.test.ts | ユニットテスト | 純粋関数の全分岐テスト |
| __tests__/integration/webhook-auto-reply.test.ts | 統合テスト | Webhook自動返信フロー（6シナリオ） |
| __tests__/integration/cron-auto-replies.test.ts | 統合テスト | cron API（認証・フィルター・上限・mock） |
| __tests__/integration/auto-reply-scenarios.test.ts | 統合テスト | 住宅ローン/土地/工務店/クレームシナリオ |
| TEST_NOTES.md | ドキュメント | 本ファイル |

## 安全ルール（全テストで遵守）

- LSTEP_MODE=mock をデフォルト
- LSTEP_DRY_RUN=true をデフォルト
- OpenAI API を本物で叩かない（fetch をグローバルモック）
- Lステップ本番 API を叩かない
- @prisma/client を vi.mock でスタブ（prisma generate 不要）
- APIキーをテストコード・ログ・レスポンスに出さない
- success 済みログは再実行不可
- humanReviewRequired=true は自動返信しない
- riskLevel=high は自動返信しない
- safetyErrors がある返信は送信しない
- AuditLog 作成を壊さない

## モック設計方針

既存テスト（sendExecute.test.ts / tagsExecute.test.ts）と同じ戦略:

```typescript
vi.mock("@prisma/client", () => ({
  ActionLogStatus: { pending, running, success, failed, skipped },
  MessageStatus: { PENDING, AI_DRAFT_READY, SEND_QUEUED, HUMAN_REQUIRED, REPLIED },
  Prisma: { JsonNull: "JsonNull" },
}));
```

\$transaction は配列渡し・コールバック渡し両方に対応:

```typescript
mockTransaction.mockImplementation(async (ops) => {
  if (Array.isArray(ops)) return Promise.all(ops);
  if (typeof ops === "function") return ops({ /* tx mock */ });
});
```

## 自動返信フロー（テストで保証する内容）

```
LステップWebhook受信
↓ payload parse（userId/message/displayName のフォールバック含む）
↓ Message 保存
↓ ConversationHistory に user 発言保存
↓ classifyConsultation（OpenAI 未設定時はルールベース）
↓ generateHiramatsuReply（平松社長口調・500文字以内・署名あり）
↓ AiReply 保存
↓ ConversationHistory に assistant 返信案保存
↓ recommendedTags 生成
↓ shouldCreateAutoReplySendLog() で安全条件チェック
↓ 条件を満たす場合だけ SendActionLog 作成（pending）
↓ 条件を満たす場合だけ LstepTagActionLog 作成（pending）
↓ AUTO_EXECUTE_LSTEP_ACTIONS=true の場合だけ mock/dry-run 実行
↓ AuditLog 保存
```

## cron フロー（テストで保証する内容）

- CRON_SECRET 認証（Bearer / x-cron-secret ヘッダー）
- humanReviewRequired=false のみ対象
- success 送信ログがあるものは対象外
- LSTEP_AUTO_REPLY_LIMIT で件数制限（上限50）
- mock モードでは fetch（本番API）を呼ばない
- AuditLog に auto_reply_run として保存
