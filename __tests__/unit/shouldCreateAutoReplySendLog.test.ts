import { describe, it, expect } from "vitest";
import {
  shouldCreateAutoReplySendLog,
  shouldCreateAutoReplyTagLog,
} from "@/lib/automation/shouldCreateAutoReplySendLog";

function makeSendInput(overrides = {}) {
  return {
    humanReviewRequired: false,
    riskLevel: "low",
    recommendedOffer: "life_plan",
    replyText: "住宅ローンのご不安、よく分かります。ライフプランでご相談ください。\n\n平松",
    safetyErrors: [],
    hasSuccessSendLog: false,
    ...overrides,
  };
}

function makeTagInput(overrides = {}) {
  return {
    humanReviewRequired: false,
    riskLevel: "low",
    tags: ["相談_住宅ローン予算", "導線_ライフプラン"],
    hasSuccessTagLog: false,
    ...overrides,
  };
}

describe("shouldCreateAutoReplySendLog", () => {
  describe("should=true（全条件通過）", () => {
    it("デフォルト入力では should=true", () => {
      expect(shouldCreateAutoReplySendLog(makeSendInput()).should).toBe(true);
    });
    it("recommendedOffer=individual_consultation も should=true", () => {
      expect(shouldCreateAutoReplySendLog(makeSendInput({ recommendedOffer: "individual_consultation" })).should).toBe(true);
    });
    it("riskLevel=medium かつ safetyErrors なしは should=true", () => {
      expect(shouldCreateAutoReplySendLog(makeSendInput({ riskLevel: "medium" })).should).toBe(true);
    });
    it("replyText がちょうど500文字は should=true", () => {
      expect(shouldCreateAutoReplySendLog(makeSendInput({ replyText: "あ".repeat(500) })).should).toBe(true);
    });
  });

  describe("humanReviewRequired=true → should=false", () => {
    it("should=false を返す", () => {
      expect(shouldCreateAutoReplySendLog(makeSendInput({ humanReviewRequired: true })).should).toBe(false);
    });
    it("reason に humanReviewRequired が含まれる", () => {
      expect(shouldCreateAutoReplySendLog(makeSendInput({ humanReviewRequired: true })).reason).toContain("humanReviewRequired");
    });
  });

  describe("riskLevel=high → should=false", () => {
    it("should=false を返す", () => {
      expect(shouldCreateAutoReplySendLog(makeSendInput({ riskLevel: "high" })).should).toBe(false);
    });
    it("reason に high が含まれる", () => {
      expect(shouldCreateAutoReplySendLog(makeSendInput({ riskLevel: "high" })).reason).toContain("high");
    });
  });

  describe("safetyErrors あり → should=false", () => {
    it("1件でもエラーがあれば should=false", () => {
      expect(shouldCreateAutoReplySendLog(makeSendInput({ safetyErrors: ["NGワード"] })).should).toBe(false);
    });
    it("エラー内容が reason に含まれる", () => {
      expect(shouldCreateAutoReplySendLog(makeSendInput({ safetyErrors: ["500文字超過"] })).reason).toContain("500文字超過");
    });
  });

  describe("replyText 空・超過 → should=false", () => {
    it("空文字は should=false", () => {
      expect(shouldCreateAutoReplySendLog(makeSendInput({ replyText: "" })).should).toBe(false);
    });
    it("空白のみは should=false", () => {
      expect(shouldCreateAutoReplySendLog(makeSendInput({ replyText: "   " })).should).toBe(false);
    });
    it("501文字は should=false", () => {
      const r = shouldCreateAutoReplySendLog(makeSendInput({ replyText: "あ".repeat(501) }));
      expect(r.should).toBe(false);
      expect(r.reason).toContain("500文字");
    });
  });

  describe("hasSuccessSendLog=true → should=false（二重送信防止）", () => {
    it("should=false を返す", () => {
      expect(shouldCreateAutoReplySendLog(makeSendInput({ hasSuccessSendLog: true })).should).toBe(false);
    });
    it("reason に 二重送信 または success が含まれる", () => {
      expect(shouldCreateAutoReplySendLog(makeSendInput({ hasSuccessSendLog: true })).reason).toMatch(/二重送信|success/);
    });
  });

  describe("recommendedOffer=none → should=false", () => {
    it("should=false を返す", () => {
      expect(shouldCreateAutoReplySendLog(makeSendInput({ recommendedOffer: "none" })).should).toBe(false);
    });
  });

  describe("優先順位（複数条件）", () => {
    it("humanReviewRequired=true が最優先", () => {
      const r = shouldCreateAutoReplySendLog(makeSendInput({ humanReviewRequired: true, riskLevel: "high", safetyErrors: ["NG"] }));
      expect(r.should).toBe(false);
      expect(r.reason).toContain("humanReviewRequired");
    });
  });
});

describe("shouldCreateAutoReplyTagLog", () => {
  it("デフォルト入力では should=true", () => {
    expect(shouldCreateAutoReplyTagLog(makeTagInput()).should).toBe(true);
  });
  it("humanReviewRequired=true は should=false", () => {
    expect(shouldCreateAutoReplyTagLog(makeTagInput({ humanReviewRequired: true })).should).toBe(false);
  });
  it("riskLevel=high は should=false", () => {
    expect(shouldCreateAutoReplyTagLog(makeTagInput({ riskLevel: "high" })).should).toBe(false);
  });
  it("tags が空配列は should=false", () => {
    expect(shouldCreateAutoReplyTagLog(makeTagInput({ tags: [] })).should).toBe(false);
  });
  it("hasSuccessTagLog=true は should=false（再実行不可）", () => {
    const r = shouldCreateAutoReplyTagLog(makeTagInput({ hasSuccessTagLog: true }));
    expect(r.should).toBe(false);
    expect(r.reason).toMatch(/再実行不可|success/);
  });
});
