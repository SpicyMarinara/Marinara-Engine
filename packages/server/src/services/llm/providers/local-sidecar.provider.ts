import type { ChatCompletionResult, ChatMessage, ChatOptions, LLMUsage } from "../base-provider.js";
import { BaseLLMProvider } from "../base-provider.js";
import { OpenAIProvider } from "./openai.provider.js";
import { sidecarModelService } from "../../sidecar/sidecar-model.service.js";
import { sidecarProcessService } from "../../sidecar/sidecar-process.service.js";
import { resolveSidecarRequestModel } from "../../sidecar/sidecar-request-model.js";

export class LocalSidecarProvider extends BaseLLMProvider {
  constructor() {
    super("", "");
  }

  private async createDelegate(): Promise<OpenAIProvider> {
    const baseUrl = await sidecarProcessService.ensureReady({ forceStart: true });
    const contextSize = sidecarModelService.getConfig().contextSize;
    return new OpenAIProvider(`${baseUrl}/v1`, "local-sidecar", contextSize, null);
  }

  private getRequestModel(): string {
    return resolveSidecarRequestModel(
      sidecarModelService.getResolvedBackend(),
      sidecarModelService.getConfiguredModelRef(),
    );
  }

  private applyRuntimeSettings(options: ChatOptions): ChatOptions {
    const config = sidecarModelService.getConfig();
    const requestedMaxTokens =
      typeof options.maxTokens === "number" && Number.isFinite(options.maxTokens) ? Math.max(1, Math.floor(options.maxTokens)) : undefined;
    return {
      ...options,
      maxTokens: requestedMaxTokens !== undefined ? Math.min(requestedMaxTokens, config.maxTokens) : config.maxTokens,
      temperature: config.temperature,
      topP: config.topP,
      topK: config.topK,
    };
  }

  async *chat(messages: ChatMessage[], options: ChatOptions): AsyncGenerator<string, LLMUsage | void, unknown> {
    const delegate = await this.createDelegate();
    return yield* delegate.chat(messages, {
      ...this.applyRuntimeSettings(options),
      model: this.getRequestModel(),
    });
  }

  async chatComplete(messages: ChatMessage[], options: ChatOptions): Promise<ChatCompletionResult> {
    const delegate = await this.createDelegate();
    return delegate.chatComplete(messages, {
      ...this.applyRuntimeSettings(options),
      model: this.getRequestModel(),
    });
  }

  async embed(_texts: string[], _model: string): Promise<number[][]> {
    throw new Error("The local sidecar does not support embeddings.");
  }
}
