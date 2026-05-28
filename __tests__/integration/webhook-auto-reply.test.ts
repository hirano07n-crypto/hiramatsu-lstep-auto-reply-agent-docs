/**
 * Webhook 自動返信フロー 統合テスト
 * 既存テスト（sendExecute / tagsExecute）と同じモック戦略を使用
 * - @prisma/client を vi.mock でスタブ
 * - @/lib/prisma を vi.mock
 * - fetch をグローバルモック（OpenAI / LステップAPI を叩かない）
 * - LSTEP_MODE=mock / LSTEP_DRY_RUN=true をデフォルト
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@prisma/client", () => ({
  ActionLogStatus: { pending: "pending", running: "running", success: "success", failed: "failed", skipped: "skipped" },
  MessageStatus: { PENDING: "PENDING", AI_DRAFT_READY: "AI_DRAFT_READY", SEND_QUEUED: "SEND_QUEUED", HUMAN_REQUIRED: "HUMAN_REQUIRED", REPLIED: "REPLIED" },
  Prisma: { JsonNull: "JsonNull" },
}));

const mockMessageCreate = vi.fn();
const mockMessageUpdate = vi.fn();
const mockAiReplyCreate = vi.fn();
const mockConversationHistoryCreate = vi.fn();
const mockConversationHistoryFindMany = vi.fn();
const mockSendActionLogCreate = vi.fn();
const mockSendActionLogFindFirst = vi.fn();
const mockTagActionLogCreate = vi.fn();
const mockAuditLogCreate = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    message: { create: mockMessageCreate, update: mockMessageUpdate },
    aiReply: { create: mockAiReplyCreate },
    conversationHistory: { create: mockConversationHistoryCreate, findMany: mockConversationHistoryFindMany },
    sendActionLog: { create: mockSendActionLogCreate, findFirst: mockSendActionLogFindFirst },
    lstepTagActionLog: { create: mockTagActionLogCreate },
    auditLog: { create: mockAuditLogCreate },
    \$transaction: mockTransaction,
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockExecuteSend = vi.fn();
const mockExecuteTag = vi.fn();
vi.mock("@/lib/actionLogs/executeSendActionLog", () => ({ executeSendActionLog: mockExecuteSend }));
vi.mock("@/lib/actionLogs/executeTagActionLog", () => ({ executeTagActionLog: mockExecuteTag }));

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.LSTEP_MODE = "mock";
  process.env.LSTEP_DRY_RUN = "true";
  process.env.AUTO_EXECUTE_LSTEP_ACTIONS = "false";

  mockTransaction.mockImplementation(async (ops) => {
    if (Array.isArray(ops)) return Promise.all(ops);
    if (typeof ops === "function") return ops({
      message: { create: mockMessageCreate, update: mockMessageUpdate },
      aiReply: { create: mockAiReplyCreate },
      conversationHistory: { create: mockConversationHistoryCreate },
      sendActionLog: { create: mockSendActionLogCreate },
      lstepTagActionLog: { create: mockTagActionLogCreate },
      auditLog: { create: mockAuditLogCreate },
    });
  });

  mockMessageCreate.mockResolvedValue({ id: "msg_001", userId: "U001", displayName: "山田太郎", message: "test", status: "PENDING", humanReviewRequired: false, riskLevel: "low" });
  mockConversationHistoryFindMany.mockResolvedValue([]);
  mockConversationHistoryCreate.mockResolvedValue({ id: "ch_001" });
  mockAiReplyCreate.mockResolvedValue({ id: "reply_001", replyText: "ご相談ありがとうございます。\n\n平松", humanReviewRequired: false, safetyErrors: [], safetyWarnings: [] });
  mockSendActionLogFindFirst.mockResolvedValue(null);
  mockSendActionLogCreate.mockResolvedValue({ id: "send_001", status: "pending" });
  mockTagActionLogCreate.mockResolvedValue({ id: "tag_001", status: "pending" });
  mockAuditLogCreate.mockResolvedValue({ id: "audit_001" });
  mockMessageUpdate.mockResolvedValue({ id: "msg_001" });
  mockExecuteSend.mockResolvedValue({ ok: true, status: "success", mode: "mock", dryRun: true });
  mockExecuteTag.mockResolvedValue({ ok: true, status: "success", mode: "mock", dryRun: true });
});

afterEach(() => {
  Object.keys(process.env).forEach(k => { if (!(k in originalEnv)) delete process.env[k]; });
  Object.assign(process.env, originalEnv);
  vi.clearAllMocks();
  vi.resetModules();
});

async function callWebhook(body) {
  const { POST } = await import("@/app/api/webhook/lstep/route");
  const req = new NextRequest("http://localhost/api/webhook/lstep", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req);
}

const STANDARD_PAYLOAD = {
  userId: "U001", displayName: "山田太郎",
  message: "住宅ローンが不安です。年収的にいくらまで借りても大丈夫ですか？",
  timestamp: "2026-05-21T10:00:00+09:00", eventType: "message",
};

describe("POST /api/webhook/lstep", () => {
  describe("AUTO_EXECUTE_LSTEP_ACTIONS=false", () => {
    it("200 を返す", async () => {
      const res = await callWebhook(STANDARD_PAYLOAD);
      expect(res.status).toBe(200);
    });
    it("Message が作成される", async () => {
      await callWebhook(STANDARD_PAYLOAD);
      expect(mockMessageCreate).toHaveBeenCalled();
    });
    it("ConversationHistory に user 発言が保存される", async () => {
      await callWebhook(STANDARD_PAYLOAD);
      expect(mockConversationHistoryCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ role: "user" }) })
      );
    });
    it("AiReply が作成される", async () => {
      await callWebhook(STANDARD_PAYLOAD);
      expect(mockAiReplyCreate).toHaveBeenCalled();
    });
    it("SendActionLog が pending で作成される", async () => {
      await callWebhook(STANDARD_PAYLOAD);
      expect(mockSendActionLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "pending" }) })
      );
    });
    it("executeSendActionLog は呼ばれない", async () => {
      await callWebhook(STANDARD_PAYLOAD);
      expect(mockExecuteSend).not.toHaveBeenCalled();
    });
    it("AuditLog が保存される", async () => {
      await callWebhook(STANDARD_PAYLOAD);
      expect(mockAuditLogCreate).toHaveBeenCalled();
    });
    it("sendExecuted=false が含まれる", async () => {
      const res = await callWebhook(STANDARD_PAYLOAD);
      const body = await res.json();
      expect(body.sendExecuted).toBe(false);
    });
  });

  describe("AUTO_EXECUTE_LSTEP_ACTIONS=true", () => {
    beforeEach(() => { process.env.AUTO_EXECUTE_LSTEP_ACTIONS = "true"; });
    it("executeSendActionLog が呼ばれる", async () => {
      await callWebhook(STANDARD_PAYLOAD);
      expect(mockExecuteSend).toHaveBeenCalled();
    });
    it("sendExecuted=true が含まれる", async () => {
      const res = await callWebhook(STANDARD_PAYLOAD);
      const body = await res.json();
      expect(body.sendExecuted).toBe(true);
    });
    it("本番LステップAPI（fetch）は呼ばれない", async () => {
      await callWebhook(STANDARD_PAYLOAD);
      const lstepCalls = mockFetch.mock.calls.filter(([url]) => !String(url).includes("openai.com"));
      expect(lstepCalls).toHaveLength(0);
    });
  });

  describe("humanReviewRequired=true", () => {
    beforeEach(() => {
      mockAiReplyCreate.mockResolvedValue({ id: "reply_risk", replyText: "【要人対応】担当者が対応します。", humanReviewRequired: true, safetyErrors: [], safetyWarnings: [] });
      mockMessageCreate.mockResolvedValue({ id: "msg_risk", userId: "U001", humanReviewRequired: true, riskLevel: "high", status: "HUMAN_REQUIRED" });
    });
    it("200 を返す", async () => {
      const res = await callWebhook({ ...STANDARD_PAYLOAD, message: "契約を解約したい。返金されなければ弁護士に相談します。" });
      expect(res.status).toBe(200);
    });
    it("Message が作成される", async () => {
      await callWebhook({ ...STANDARD_PAYLOAD, message: "訴えます。" });
      expect(mockMessageCreate).toHaveBeenCalled();
    });
    it("AiReply は作成される（人確認プレースホルダー）", async () => {
      await callWebhook({ ...STANDARD_PAYLOAD, message: "弁護士に相談します。" });
      expect(mockAiReplyCreate).toHaveBeenCalled();
    });
    it("SendActionLog は作成されない", async () => {
      await callWebhook({ ...STANDARD_PAYLOAD, message: "返金してください。" });
      expect(mockSendActionLogCreate).not.toHaveBeenCalled();
    });
    it("executeSendActionLog は呼ばれない", async () => {
      await callWebhook({ ...STANDARD_PAYLOAD, message: "詐欺だ。" });
      expect(mockExecuteSend).not.toHaveBeenCalled();
    });
    it("humanReviewRequired=true がレスポンスに含まれる", async () => {
      const res = await callWebhook({ ...STANDARD_PAYLOAD, message: "訴えます。" });
      const body = await res.json();
      expect(body.humanReviewRequired).toBe(true);
    });
  });

  describe("safetyErrors あり", () => {
    beforeEach(() => {
      mockAiReplyCreate.mockResolvedValue({ id: "reply_ng", replyText: "絶対に大丈夫です。100%通ります。", humanReviewRequired: false, safetyErrors: ["NGワード「絶対」が含まれています"], safetyWarnings: [] });
    });
    it("AiReply は作成される（safety エラー付き）", async () => {
      await callWebhook(STANDARD_PAYLOAD);
      expect(mockAiReplyCreate).toHaveBeenCalled();
    });
    it("executeSendActionLog は呼ばれない", async () => {
      await callWebhook(STANDARD_PAYLOAD);
      expect(mockExecuteSend).not.toHaveBeenCalled();
    });
  });

  describe("success 送信ログあり（二重送信防止）", () => {
    beforeEach(() => {
      mockSendActionLogFindFirst.mockResolvedValue({ id: "send_existing", status: "success", messageId: "msg_001" });
    });
    it("新しい SendActionLog を作成しない", async () => {
      await callWebhook(STANDARD_PAYLOAD);
      expect(mockSendActionLogCreate).not.toHaveBeenCalled();
    });
    it("executeSendActionLog を呼ばない", async () => {
      await callWebhook(STANDARD_PAYLOAD);
      expect(mockExecuteSend).not.toHaveBeenCalled();
    });
    it("200 を返す", async () => {
      const res = await callWebhook(STANDARD_PAYLOAD);
      expect(res.status).toBe(200);
    });
  });

  describe("ネストされた payload", () => {
    const NESTED_PAYLOAD = {
      source: { userId: "U002" },
      event: { message: { text: "土地探しで悩んでいます" } },
      user: { name: "佐藤花子" },
    };
    beforeEach(() => {
      mockMessageCreate.mockResolvedValue({ id: "msg_002", userId: "U002", displayName: "佐藤花子", message: "土地探しで悩んでいます", status: "PENDING", humanReviewRequired: false, riskLevel: "low" });
    });
    it("200 を返す", async () => {
      const res = await callWebhook(NESTED_PAYLOAD);
      expect(res.status).toBe(200);
    });
    it("userId が source.userId から取得される", async () => {
      await callWebhook(NESTED_PAYLOAD);
      expect(mockMessageCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: "U002" }) }));
    });
    it("displayName が user.name から取得される", async () => {
      await callWebhook(NESTED_PAYLOAD);
      expect(mockMessageCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ displayName: "佐藤花子" }) }));
    });
    it("message が event.message.text から取得される", async () => {
      await callWebhook(NESTED_PAYLOAD);
      expect(mockMessageCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ message: "土地探しで悩んでいます" }) }));
    });
  });
});
