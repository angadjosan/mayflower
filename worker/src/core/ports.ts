// Interfaces between the pipeline and the outside world. Each one has a real
// implementation and a dev fallback that is clearly labeled (see index.ts wiring).
import type { z } from 'zod';
import type {
  Critique, Forecast, InboundMessage, Market, MarketCandidate, MatchResult, OrderRequest,
  OrderResult, OutboundMessage, ProfilePatch, Quote, ResearchBundle, Source, UserProfile,
} from './types.js';

/** Gemini Prediction Markets catalog + quotes (public data, no key). */
export interface Catalog {
  refresh(): Promise<number>;                                  // reload events, returns contract count
  search(text: string, limit?: number): Promise<MarketCandidate[]>; // cheap keyword retrieval
  get(symbol: string): Promise<Market | null>;
  quote(symbol: string): Promise<Quote | null>;                // freshest executable prices
  categories(): Promise<Record<string, number>>;
}

/** Places orders. SandboxExecutor (real Gemini sandbox) or SimExecutor (labeled simulated). */
export interface Executor {
  readonly mode: 'sandbox' | 'simulated';
  place(req: OrderRequest, market: Market): Promise<OrderResult>;
}

/** Context.dev web research. */
export interface Research {
  readonly mode: 'contextdev' | 'none';
  search(query: string, opts?: { freshness?: 'day' | 'week' | 'month'; limit?: number }): Promise<Source[]>;
}

/** Google Gemini LLM, structured JSON only. */
export interface Llm {
  readonly mode: 'google' | 'fake';
  json<T>(args: { system: string; prompt: string; schema: z.ZodType<T>; fast?: boolean }): Promise<T>;
}

/** The reasoning steps. The LLM proposes; risk.ts (plain code) decides. */
export interface Brain {
  extractProfile(text: string, current: UserProfile): Promise<ProfilePatch>;
  classify(text: string, user: UserProfile): Promise<'onboarding' | 'belief' | 'question' | 'other'>;
  match(belief: string, candidates: MarketCandidate[]): Promise<MatchResult | null>;
  research(belief: string, market: Market): Promise<ResearchBundle>;
  forecast(market: Market, bundle: ResearchBundle): Promise<Forecast>;
  critique(market: Market, belief: string, bundle: ResearchBundle, forecast: Forecast): Promise<Critique>;
  answer(question: string, context: string): Promise<string>;
}

/** iMessage out (BlueBubbles) or console for dev. */
export interface Messenger {
  readonly mode: 'bluebubbles' | 'console';
  send(msg: OutboundMessage): Promise<void>;
}

/** ElevenLabs speech-to-text and text-to-speech. */
export interface Voice {
  readonly mode: 'elevenlabs' | 'none';
  transcribe(audio: Buffer, mime: string): Promise<string>;
  speak(text: string): Promise<{ data: Buffer; mime: string; filename: string } | null>;
}

export type InboundHandler = (msg: InboundMessage) => Promise<void>;
