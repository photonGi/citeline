import { getEncoding, type Tiktoken } from "js-tiktoken";

let encoder: Tiktoken | undefined;

/**
 * Token count used for chunk sizing. Gemini's tokeniser is not public, so this
 * uses cl100k_base as a stable approximation — chunk boundaries only need to be
 * consistent, not exact, and the embedding API enforces the real limit.
 */
export function countTokens(text: string): number {
  encoder ??= getEncoding("cl100k_base");
  return encoder.encode(text).length;
}
