/**
 * cron 自動返信 API 統合テスト
 * GET /api/cron/auto-replies  — 認証確認
 * POST /api/cron/auto-replies — 自動返信実行
 * 既存テストと同じモック戦略。本番API を叩かない。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@prisma/client", () => ({
  ActionLogStatus: { pending: "pending", running: "running", success: "success", failed: "failed", skipped: "skipped" },
  MessageStatus: { PENDING: "PENDING", AI_DRAFT_READY: "AI_DRAFT_READY", SEND_QUEUED: "SEND_QUEUED", HUMAN_REQUIRED: "HUMAN_REQUIRED", REPLIED: "REPLIED" },
  Prisma: { JsonNull: "JsonNull" },
}));

const mockMessageFindMany = vi.fn();
const mockMessageUpdate = vi.fn();
const mockSendActionLogFindFirst = vi.fn();
const mockSendActionLogCreate = vi.fn();
const mockSendActionLogUpdate = vi.fn();
const mockSendActionLogUpdateMany = vi.fn();
const mockAiReplyFindFirst = vi.fn();
const mockAuditLogCreate = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    message: { findMany: mockMessageFindMany, update: mockMessageUpdate },
    sendActionLog: { findFirst: mockSendActionLogFindFirst, create: mockSendActionLogCreate, update: mockSendActionLogUpdate, updateMany: mockSendActionLogUpdateMany },
    aiReply: { findFirst: mockAiReplyFindFirst },
    auditLog: { create: mockAuditLogCreate },
    \$transaction: mockTransaction,
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockExecuteSend = vi.fn();
vi.mock("@/lib/actionLogs/executeSendActionLog", () => ({ executeSendActionLog: mockExecuteSend }));

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.LSTEP_MODE = "mock";
  process.env.LSTEP_DRY_RUN = "true";
  delete process.env.CRON_SECRET;

  mockTransaction.mockImplementation(async (ops) => {
    if (Array.isArray(ops)) return Promise.all(ops);
    if (typeof ops === "function") return ops({ sendActionLog: { create: mockSendActionLogCreate, update: mockSendActionLogUpdate }, auditLog: { create: mockAuditLogCreate } });
  });

  mockMessageFindMany.mockResolvedValue([]);
  mockAiReplyFindFirst.mockResolvedValue(null);
  mockSendActionLogFindFirst.mockResolvedValue(null);
  mockSendActionLogCreate.mockResolvedValue({ id: "send_001", status: "pending" });
  mockSendActionLogUpdate.mockResolvedValue({ id: "send_001", status: "success" });
  mockAuditLogCreate.mockResolvedValue({ id: "audit_001" });
  mockExecuteSend.mockResolvedValue({ ok: true, status: "success", mode: "mock", dryRun: true });
});

afterEach(() => {
  Object.keys(process.env).forEach(k => { if (!(k in originalEnv)) delete process.env[k]; });
  Object.assign(process.env, originalEnv);
  vi.clearAllMocks();
  vi.resetModules();
});

async function callCronGet(headers = {}) {
  const { GET } = await import("@/app/api/cron/auto-replies/route");
  const req = new NextRequest("http://localhost/api/cron/auto-replies", { headers });
  return GET(req);
}

async function callCronPost(headers = {}) {
  const { POST } = await import("@/app/api/cron/auto-replies/route");
  const req = new NextRequest("http://localhost/api/cron/auto-replies", { method: "POST", headers });
  return POST(req);
}

describe("GET /api/cron/auto-replies — CRON_SECRET 認証", () => {
  beforeEach(() => { process.env.CRON_SECRET = "test-secret"; });

  it("認証なし → 401", async () => {
    const res = await callCronGet({});
    expect(res.status).toBe(401);
  });
  it("Authorization: Bearer test-secret → 200", async () => {
    const res = await callCronGet({ authorization: "Bearer test-secret" });
    expect(res.status).toBe(200);
  });
  it("x-cron-secret: test-secret → 200", async () => {
    const res = await callCronGet({ "x-cron-secret": "test-secret" });
    expect(res.status).toBe(200);
  });
  it("間違ったsecret → 401", async () => {
    const res = await callCronGet({ authorization: "Bearer wrong-secret" });
    expect(res.status).toBe(401);
  });
  it("CRON_SECRET 未設定なら認証なしでも200", async () => {
    delete process.env.CRON_SECRET;
    const res = await callCronGet({});
    expect(res.status).toBe(200);
  });
});

describe("POST /api/cron/auto-replies — 対象メッセージフィルター", () => {
  it("humanReviewRequired=false かつ success送信ログなしのメッセージのみ処理", async () => {
    mockMessageFindMany.mockResolvedValue([
      { id: "msg_A", status: "AI_DRAFT_READY", humanReviewRequired: false, userId: "U001" },
    ]);
    mockAiReplyFindFirst.mockResolvedValue({ id: "reply_A", replyText: "ご相談ありがとうございます。\n\n平松", safetyErrors: [] });
    mockSendActionLogFindFirst.mockResolvedValue(null);

    const res = await callCronPost({});
    expect(res.status).toBe(200);
    expect(mockExecuteSend).toHaveBeenCalled();
  });

  it("humanReviewRequired=true のメッセージは対象外", async () => {
    mockMessageFindMany.mockResolvedValue([
      { id: "msg_B", status: "HUMAN_REQUIRED", humanReviewRequired: true, userId: "U002" },
    ]);
    const res = await callCronPost({});
    expect(res.status).toBe(200);
    expect(mockExecuteSend).not.toHaveBeenCalled();
  });

  it("success 送信ログがあるメッセージは対象外", async () => {
    mockMessageFindMany.mockResolvedValue([
      { id: "msg_D", status: "AI_DRAFT_READY", humanReviewRequired: false, userId: "U004" },
    ]);
    mockSendActionLogFindFirst.mockResolvedValue({ id: "send_existing", status: "success" });

    const res = await callCronPost({});
    expect(res.status).toBe(200);
    expect(mockExecuteSend).not.toHaveBeenCalled();
  });
});

describe("POST /api/cron/auto-replies — LSTEP_AUTO_REPLY_LIMIT", () => {
  it("LSTEP_AUTO_REPLY_LIMIT=3 ならtake=3 で DB クエリ", async () => {
    process.env.LSTEP_AUTO_REPLY_LIMIT = "3";
    mockMessageFindMany.mockResolvedValue([]);
    await callCronPost({});
    expect(mockMessageFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3 }));
  });
  it("50超える値は最大50", async () => {
    process.env.LSTEP_AUTO_REPLY_LIMIT = "999";
    mockMessageFindMany.mockResolvedValue([]);
    await callCronPost({});
    expect(mockMessageFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
  });
});

describe("POST /api/cron/auto-replies — mock モード", () => {
  it("LSTEP_MODE=mock では fetch（本番API）を呼ばない", async () => {
    mockMessageFindMany.mockResolvedValue([
      { id: "msg_A", status: "AI_DRAFT_READY", humanReviewRequired: false, userId: "U001" },
    ]);
    mockAiReplyFindFirst.mockResolvedValue({ id: "reply_A", replyText: "ご相談ありがとうございます。\n\n平松", safetyErrors: [] });

    await callCronPost({});
    const lstepCalls = mockFetch.mock.calls.filter(([url]) => !String(url).includes("openai.com"));
    expect(lstepCalls).toHaveLength(0);
  });

  it("AuditLog に auto_reply_run が保存される", async () => {
    mockMessageFindMany.mockResolvedValue([
      { id: "msg_A", status: "AI_DRAFT_READY", humanReviewRequired: false, userId: "U001" },
    ]);
    mockAiReplyFindFirst.mockResolvedValue({ id: "reply_A", replyText: "ご相談ありがとうございます。\n\n平松", safetyErrors: [] });

    await callCronPost({});
    expect(mockAuditLogCreate).toHaveBeenCalled();
  });
});
