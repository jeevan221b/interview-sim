import { mock } from './mock.js';
import { extractJson, normalizeBatch, normalizeEvaluation, normalizeModelAnswer, normalizePlan, normalizeReview } from './normalize.js';
import { evaluateBatchPrompt, evaluatePrompt, modelAnswerPrompt, planPrompt, reviewPrompt } from './prompts.js';
import { claudeCli, gemini, groq } from './providers.js';
import { createQuota } from './quota.js';

// maxTokens caps each response (reasoning included) so one call can't eat a whole
// per-minute token allowance on Groq's free tier.
const TASKS = {
  plan: { prompt: planPrompt, normalize: (data, input) => normalizePlan(data, input), temperature: 0.7, maxTokens: () => 4000 },
  evaluate: {
    prompt: evaluatePrompt,
    normalize: (data, input) => normalizeEvaluation(data, { kind: input.question.kind, allowFollowUp: input.allowFollowUp }),
    temperature: 0.2,
    maxTokens: (input) => (input.config.modelAnswers === 'full' ? 2500 : 1800),
  },
  evaluateBatch: {
    prompt: evaluateBatchPrompt,
    normalize: (data, input) => normalizeBatch(data, input.items),
    temperature: 0.2,
    maxTokens: (input) => 800 + input.items.length * (input.config.modelAnswers === 'full' ? 900 : 650),
  },
  modelAnswer: { prompt: modelAnswerPrompt, normalize: (data) => normalizeModelAnswer(data), temperature: 0.4, maxTokens: () => 1200 },
  review: { prompt: reviewPrompt, normalize: (data) => normalizeReview(data), temperature: 0.3, maxTokens: () => 2500 },
};

/**
 * Runs AI tasks against the configured providers in order, falling back to the next
 * provider when one fails (rate limit, outage, malformed JSON). Groq additionally falls
 * back across its own model chain before giving up.
 *
 * @param {{ store?: { get(key: string): any, set(key: string, value: any): void } | null, log?: any, fetchImpl?: typeof fetch }} [deps]
 */
export function createLlm(llmConfig, { log = console, store = null, fetchImpl = fetch } = {}) {
  const quota = createQuota(store);
  const factories = {
    gemini: () => gemini(llmConfig.gemini),
    groq: () => groq(llmConfig.groq, { quota, log, fetchImpl }),
    'claude-cli': () => claudeCli(llmConfig.claudeCli),
    mock: () => mock(),
  };
  const providers = llmConfig.providers
    .filter((name) => factories[name])
    .map((name) => factories[name]())
    .filter((p) => p.available);
  const groqProvider = providers.find((p) => p.name === 'groq');

  return {
    providers: providers.map(({ name, label, models }) => ({ name, label, ...(models ? { models } : {}) })),

    /** @returns {Promise<{ data: any, provider: string, model: string | null }>} */
    async run(task, input) {
      const spec = TASKS[task];
      if (!providers.length) throw new Error('no AI provider is configured (set LLM_PROVIDERS / API keys)');
      const errors = [];
      for (const provider of providers) {
        try {
          if (provider.tasks) return { data: spec.normalize(provider.tasks[task](input), input), provider: provider.name, model: null };
          const { system, user } = spec.prompt(input);
          const { data, model } = await provider.complete({
            system,
            user,
            temperature: spec.temperature,
            maxTokens: spec.maxTokens(input),
            parse: (text) => spec.normalize(extractJson(text), input),
          });
          return { data, provider: provider.name, model };
        } catch (err) {
          log.warn?.(`[llm] ${task} via ${provider.name} failed: ${err.message}`);
          errors.push(`${provider.name}: ${err.message}`);
        }
      }
      throw new Error(`all AI providers failed — ${errors.join(' | ')}`);
    },

    /** Rate-limit status per Groq model, or null when Groq isn't in use. */
    quota() {
      return groqProvider ? { provider: 'groq', models: quota.snapshot(groqProvider.models) } : null;
    },

    async refreshQuota() {
      await groqProvider?.probe();
      return this.quota();
    },
  };
}
