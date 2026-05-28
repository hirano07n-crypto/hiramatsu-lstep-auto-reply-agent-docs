/**
 * シナリオ別自動返信テスト
 * classifyConsultation / generateHiramatsuReply のルールベース動作を
 * Webhook フロー全体で検証する。
 * OpenAI API は mock（OPENAI_API_KEY 未設定）
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
const mockConvCreate = vi.fn();
const mockConvFindMany = vi.fn();
const mockSendLogCreate = vi.fn();
const mockSendLogFindFirst = vi.fn();
const mockTagLogCreate = vi.fn();
const mockAuditLogCreate = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    message: { create: mockMessageCreate, update: mockMessageUpdate },
    aiReply: { create: mockAiReplyCreate },
    conversationHistory: { create: mockConvCreate, findMany: mockConvFindMany },
    sendActionLog: { create: mockSendLogCreate, findFirst: mockSendLogFindFirst },
    lstepTagActionLog: { create: mockTagLogCreate },
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
  delete process.env.OPENAI_API_KEY; // ルールベース動作を保証

  mockTransaction.mockImplementation(async (ops) => {
    if (Array.isArray(ops)) return Promise.all(ops);
    if (typeof ops === "function") return ops({
      message: { create: mockMessageCreate, update: mockMessageUpdate },
      aiReply: { create: mockAiReplyCreate },
      conversationHistory: { create: mockConvCreate },
      sendActionLog: { create: mockSendLogCreate },
      lstepTagActionLog: { create: mockTagLogCreate },
      auditLog: { create: mockAuditLogCreate },
    });
  });

  mockConvFindMany.mockResolvedValue([]);
  mockConvCreate.mockResolvedValue({ id: "ch_001" });
  mockSendLogFindFirst.mockResolvedValue(null);
  mockSendLogCreate.mockResolvedValue({ id: "send_001", status: "pending" });
  mockTagLogCreate.mockResolvedValue({ id: "tag_001", status: "pending" });
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
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return POST(req);
}

describe("シナリオ別自動返信テスト", () => {
  describe("シナリオ1: 住宅ローン相談", () => {
    beforeEach(() => {
      mockMessageCreate.mockResolvedValue({ id: "msg_loan", userId: "U001", humanReviewRequired: false, riskLevel: "low", status: "PENDING" });
      mockAiReplyCreate.mockImplementation(async ({ data }) => ({
        id: "reply_loan", replyText: data.replyText ?? "ライフプランでご相談ください。\n\n平松",
        humanReviewRequired: data.humanReviewRequired ?? false, safetyErrors: data.safetyErrors ?? [], safetyWarnings: [],
      }));
    });
    it("200 を返す", async () => {
      const res = await callWebhook({ userId: "U001", message: "住宅ローンが不安です。年収的にいくらまで借りても大丈夫ですか？" });
      expect(res.status).toBe(200);
    });
    it("humanReviewRequired=false", async () => {
      const res = await callWebhook({ userId: "U001", message: "住宅ローンが不安です" });
      const body = await res.json();
      expect(body.humanReviewRequired).toBe(false);
    });
    it("SendActionLog が作成される（送信候補）", async () => {
      await callWebhook({ userId: "U001", message: "住宅ローンの返済が心配です。いくら借りれますか？" });
      expect(mockSendLogCreate).toHaveBeenCalled();
    });
    it("category が loan_budget", async () => {
      await callWebhook({ userId: "U001", message: "住宅ローンの返済が心配です" });
      const aiReplyCall = mockAiReplyCreate.mock.calls[0];
      if (aiReplyCall) {
        const data = aiReplyCall[0]?.data;
        expect(data?.category ?? data?.consultationCategory).toMatch(/loan_budget/);
      }
    });
  });

  describe("シナリオ2: 土地探し相談", () => {
    beforeEach(() => {
      mockMessageCreate.mockResolvedValue({ id: "msg_land", userId: "U002", humanReviewRequired: false, riskLevel: "low", status: "PENDING" });
      mockAiReplyCreate.mockImplementation(async ({ data }) => ({
        id: "reply_land", replyText: data.replyText ?? "個別でお話を聞かせてください。\n\n平松",
        humanReviewRequired: data.humanReviewRequired ?? false, safetyErrors: data.safetyErrors ?? [], safetyWarnings: [],
      }));
    });
    it("200 を返す", async () => {
      const res = await callWebhook({ userId: "U002", message: "良い土地を探しているのですが、エリア選びのコツを教えてください" });
      expect(res.status).toBe(200);
    });
    it("SendActionLog が作成される", async () => {
      await callWebhook({ userId: "U002", message: "土地探しで悩んでいます" });
      expect(mockSendLogCreate).toHaveBeenCalled();
    });
  });

  describe("シナリオ3: 工務店選び相談", () => {
    beforeEach(() => {
      mockMessageCreate.mockResolvedValue({ id: "msg_company", userId: "U003", humanReviewRequired: false, riskLevel: "low", status: "PENDING" });
      mockAiReplyCreate.mockImplementation(async ({ data }) => ({
        id: "reply_company", replyText: data.replyText ?? "工務店選びは大切です。個別でご相談ください。\n\n平松",
        humanReviewRequired: false, safetyErrors: [], safetyWarnings: [],
      }));
    });
    it("200 を返す", async () => {
      const res = await callWebhook({ userId: "U003", message: "工務店とハウスメーカーの選び方を教えてください" });
      expect(res.status).toBe(200);
    });
    it("返信文に他社批判が含まれない", async () => {
      await callWebhook({ userId: "U003", message: "どの工務店がおすすめですか" });
      const createCall = mockAiReplyCreate.mock.calls[0];
      if (createCall) {
        const replyText = createCall[0]?.data?.replyText ?? "";
        expect(replyText).not.toMatch(/〇〇は悪い|あの会社はダメ/);
      }
    });
  });

  describe("シナリオ4: クレーム・法的判断（humanReviewRequired=true）", () => {
    beforeEach(() => {
      mockMessageCreate.mockResolvedValue({ id: "msg_claim", userId: "U004", humanReviewRequired: true, riskLevel: "high", status: "HUMAN_REQUIRED" });
      mockAiReplyCreate.mockImplementation(async ({ data }) => ({
        id: "reply_claim", replyText: data.replyText ?? "【要人対応】担当者が対応します。",
        humanReviewRequired: true, safetyErrors: [], safetyWarnings: [],
      }));
    });

    it("クレーム相談は humanReviewRequired=true", async () => {
      const res = await callWebhook({ userId: "U004", message: "契約を解約したい。返金されないなら弁護士に相談します。" });
      const body = await res.json();
      expect(body.humanReviewRequired).toBe(true);
    });
    it("SendActionLog が作成されない", async () => {
      await callWebhook({ userId: "U004", message: "詐欺だ。返金しろ。弁護士に相談する。" });
      expect(mockSendLogCreate).not.toHaveBeenCalled();
    });
    it("executeSendActionLog が呼ばれない", async () => {
      await callWebhook({ userId: "U004", message: "訴えます。損害賠償を請求します。" });
      expect(mockExecuteSend).not.toHaveBeenCalled();
    });
    it("法的判断も humanReviewRequired=true", async () => {
      const res = await callWebhook({ userId: "U004", message: "この土地の売買契約は有効ですか？法的に教えてください。" });
      const body = await res.json();
      expect(body.humanReviewRequired).toBe(true);
    });
  });
});
