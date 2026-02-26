import { MODEL_PRICING, type ModelPricing } from '../types.js';

const pricingMap = new Map(MODEL_PRICING.map((p) => [p.modelId, p]));

/** Fallback pricing for unknown models */
const FALLBACK_PRICING: ModelPricing = {
  modelId: 'unknown',
  inputPerMTok: 3.0,
  outputPerMTok: 15.0,
};

export function getPricing(modelId: string): ModelPricing {
  return pricingMap.get(modelId) ?? FALLBACK_PRICING;
}

export function estimateCost(modelId: string, inputTokens: number, outputTokens: number): number {
  const pricing = getPricing(modelId);
  return (inputTokens * pricing.inputPerMTok + outputTokens * pricing.outputPerMTok) / 1_000_000;
}

export interface CostStep {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  timestamp: string;
}

export class SessionCostTracker {
  private steps: CostStep[] = [];

  addStep(modelId: string, inputTokens: number, outputTokens: number): CostStep {
    const costUsd = estimateCost(modelId, inputTokens, outputTokens);
    const step: CostStep = {
      modelId,
      inputTokens,
      outputTokens,
      costUsd,
      timestamp: new Date().toISOString(),
    };
    this.steps.push(step);
    return step;
  }

  getTotal(): {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    totalCostUsd: number;
    stepCount: number;
    breakdown: CostStep[];
  } {
    let totalInput = 0;
    let totalOutput = 0;
    let totalCost = 0;

    for (const step of this.steps) {
      totalInput += step.inputTokens;
      totalOutput += step.outputTokens;
      totalCost += step.costUsd;
    }

    return {
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalTokens: totalInput + totalOutput,
      totalCostUsd: parseFloat(totalCost.toFixed(6)),
      stepCount: this.steps.length,
      breakdown: [...this.steps],
    };
  }

  checkBudget(limitUsd: number): { ok: boolean; remaining: number; percentUsed: number } {
    const { totalCostUsd } = this.getTotal();
    const remaining = parseFloat((limitUsd - totalCostUsd).toFixed(6));
    const percentUsed = limitUsd > 0 ? (totalCostUsd / limitUsd) * 100 : 0;
    return { ok: remaining > 0, remaining, percentUsed };
  }

  reset(): void {
    this.steps = [];
  }
}
