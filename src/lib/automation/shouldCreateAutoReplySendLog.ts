export type ShouldCreateSendLogInput = {
  humanReviewRequired: boolean;
  riskLevel: "low" | "medium" | "high";
  recommendedOffer: string;
  replyText: string;
  safetyErrors: string[];
  hasSuccessSendLog: boolean;
};

export type ShouldCreateSendLogResult = {
  should: boolean;
  reason: string;
};

export function shouldCreateAutoReplySendLog(
  input: ShouldCreateSendLogInput
): ShouldCreateSendLogResult {
  const { humanReviewRequired, riskLevel, recommendedOffer, replyText, safetyErrors, hasSuccessSendLog } = input;
  if (humanReviewRequired) return { should: false, reason: "humanReviewRequired=true" };
  if (riskLevel === "high") return { should: false, reason: "riskLevel=high" };
  if (safetyErrors.length > 0) return { should: false, reason: "safetyErrors: " + safetyErrors.join(", ") };
  const trimmed = replyText?.trim() ?? "";
  if (trimmed.length === 0) return { should: false, reason: "replyText が空" };
  if (trimmed.length > 500) return { should: false, reason: "replyText が500文字超過" };
  if (hasSuccessSendLog) return { should: false, reason: "success送信ログあり・二重送信しない" };
  if (recommendedOffer === "none") return { should: false, reason: "recommendedOffer=none" };
  return { should: true, reason: "全安全条件を通過" };
}

export type ShouldCreateTagLogInput = {
  humanReviewRequired: boolean;
  riskLevel: "low" | "medium" | "high";
  tags: string[];
  hasSuccessTagLog: boolean;
};

export type ShouldCreateTagLogResult = { should: boolean; reason: string; };

export function shouldCreateAutoReplyTagLog(input: ShouldCreateTagLogInput): ShouldCreateTagLogResult {
  const { humanReviewRequired, riskLevel, tags, hasSuccessTagLog } = input;
  if (humanReviewRequired) return { should: false, reason: "humanReviewRequired=true" };
  if (riskLevel === "high") return { should: false, reason: "riskLevel=high" };
  if (tags.length === 0) return { should: false, reason: "タグが空" };
  if (hasSuccessTagLog) return { should: false, reason: "successタグログあり・再実行不可" };
  return { should: true, reason: "全安全条件を通過" };
}
