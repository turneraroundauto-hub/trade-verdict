// Phase 2 of the TypeScript adoption plan (CLAUDE.md, "Engineering:
// TypeScript adoption path" — Aug 14, 2026; Phase 2 picked up Aug 16,
// 2026). Formalizes Phase 0's shared/types.js JSDoc @typedefs into a real
// ambient declaration file. Zero runtime-behavior change — this file was
// never loaded at runtime before (JSDoc @typedef {import(...)} references
// are erased comments) and still isn't (a .d.ts file is never emitted to
// .js and never fetched by a browser), so it's exempt from the
// cache-busting rule exactly as shared/types.js was.
//
// Real .ts modules (shared/ticker-cache.ts, etc.) import these via
// `import type {...} from './types.js'` — the `.js` extension in a type-only
// import specifier is intentional and required under Node/bundler-style
// module resolution (TypeScript resolves `.js` specifiers against a
// sibling `.d.ts`/`.ts` file at compile time; nothing about the specifier
// itself implies a runtime file needs to exist at that exact name — see
// shared/ticker-cache.ts for the actual usage).

/**
 * A single gate's evaluated result, as every gate normalizes to in both the
 * /ticker/:symbol response (gate1, preGate) and the /analyze response's
 * `gates` map (pre_gate, sector, g1_prewindow, g2_catalyst, g3_openbar,
 * g4_phase, g5_korea). Every gate has at least {status, note}; the
 * server-enforced ones (Gate 1, Gate 5) also carry sizing/forceDown.
 */
export interface GateResult {
  status: "GREEN" | "YELLOW" | "RED";
  note: string;
  sizing?: "FULL" | "HALF" | "QUARTER" | "NONE";
  forceDown?: boolean;
  unit?: string;
  branch?: string;
}

/**
 * sectorContext, exactly as every tier's client (app.js's `sc` object in
 * analyzeTicker()) actually sends it in the /analyze POST body: a plain map
 * of lowercase index/proxy symbol -> a formatted "+1.23%"/"-4.56%"
 * *string*, never a {pct, change} object. This is the shape the Aug 13,
 * 2026 Gate 5 bug got wrong (see CLAUDE.md, "Gate 5 forceDown was silently
 * unreachable"): `SectorContext[symbol]` is a `string`, not `{pct, change}`,
 * in production.
 */
export type SectorContext = Record<string, string>;

export interface TickerMetrics {
  price: number;
  pct: number | null;
  week52hi: number;
  week52lo: number;
  rangePosition: number | null;
  phaseProxy: string;
  beta: number | null;
}

export interface TickerNews {
  headline: string;
  url: string;
  source: string;
  ageLabel: string;
  ageHours: number;
}

export interface ProxyRule {
  proxy: { symbols: string[]; name: string; rationale: string };
  category: string;
  dynamicallyResolved?: boolean;
  forceDownAuthority?: boolean;
  sizingOverride?: string;
  elevatedCapCeiling?: boolean;
  autoExecuteStop?: boolean;
}

export interface PreGateResult {
  status: "GREEN" | "YELLOW" | "RED";
  hardTrigger: boolean;
  note: string;
}

export interface RegimeState {
  state: "INTACT" | "DEGRADING" | "BROKEN" | "UNKNOWN";
  rolling: number | null;
  baseline: number | null;
  delta: number | null;
  action: string;
  note: string;
}

/**
 * The GET /ticker/:symbol response — fetched and memoized per-symbol by
 * shared/ticker-cache.js's fetchTickerData(), consumed by
 * shared/watchlist.js's updateCardMeta() to populate a card's
 * price/52W/news/phase strip before the user ever taps ANALYZE.
 */
export interface TickerData {
  symbol: string;
  metrics: TickerMetrics | null;
  news: TickerNews | null;
  openingBar: Record<string, unknown> | null;
  proxyRule: ProxyRule;
  gate1: GateResult;
  preGate: PreGateResult;
  iv?: number | null;
  weeklyCarryover: Record<string, unknown> | null;
  regime: RegimeState | null;
  // Proposal 7 (Aug 26, 2026) -- null unless the caller's tier has the
  // scorecard flag AND this ticker has a corroboration_log hit on record
  // (i.e. Session Context has actually been used on it at least once).
  corroborationDecay?: { freshnessPct: number; label: "FRESH" | "STALE"; hitAt: string } | null;
  timestamp: string;
}

/**
 * The POST /analyze request body, built by each tier's own analyzeTicker()
 * (app.js / pro/app.js / starter/app.js / shark's monolithic file — none of
 * those are in Phase 0/2's checked scope, hence this typedef living here
 * instead of next to them) and consumed by server.js's /analyze handler.
 */
export interface AnalyzeRequestBody {
  ticker: string;
  sectorContext?: SectorContext;
  marketContext?: string;
  metricsData?: Record<string, unknown>;
  newsData?: Record<string, unknown>;
  openingBarData?: Record<string, unknown>;
  proxyRule?: Record<string, unknown>;
  gate1Data?: GateResult;
  preGateData?: Record<string, unknown>;
  weeklyCarryoverData?: Record<string, unknown>;
  regimeData?: Record<string, unknown>;
}

/**
 * The POST /analyze response — the LLM's own JSON (ticker/type/verdict/
 * confidence/reason/gates/sizing/wait_for, per SYSTEM_PROMPT in server.js)
 * plus everything server-enforced on top of it before the response goes out
 * (contextCorroboration, riskFlags, marketOpen, fromCache).
 */
export interface AnalyzeResponse {
  ticker: string;
  type: "CANARY" | "SENTIMENT" | "FLOW";
  verdict: "UP" | "DOWN" | "FLAT";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reason: string;
  gates: Record<string, GateResult>;
  sizing: "FULL" | "HALF" | "QUARTER" | "NONE";
  wait_for: string | null;
  contextCorroboration?: { corroborated: boolean; matchCount: number; note: string };
  riskFlags?: { elevatedCapCeiling: boolean; autoExecuteStop: boolean };
  marketOpen: boolean;
  fromCache?: boolean;
}
