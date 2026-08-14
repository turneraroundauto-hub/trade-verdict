// Phase 0 of the TypeScript adoption plan (CLAUDE.md, "Engineering: TypeScript
// adoption path" — Aug 14, 2026). JSDoc @typedef declarations only, checked
// via `tsc --noEmit` against tsconfig.json's `checkJs`. No .ts files, no
// build step, no runtime behavior.
//
// This file is never imported at runtime by any app.js/HTML — JSDoc
// `@typedef {import('./types.js').X}` references are erased by the JS
// engine (they're comments), so it does NOT need a `?v=` cache-busting
// query string anywhere, unlike every real ES module import in this repo
// (see CLAUDE.md's "cache-busting rule"). Don't add one.
//
// These are the highest-risk shapes named in the Phase 0 plan: the
// /analyze request/response and TickerData/GateResult. GateResult and the
// /analyze contract are actually built in server.js (this repo's mirror,
// and Tra for real), which is outside this file's checked scope
// (tsconfig.json only covers shared/*.js + gates-extended.js) — the
// typedefs still live here so gates-extended.js and shared/*.js can
// reference the same wire shapes server.js produces/consumes, instead of
// each guessing independently.

/**
 * A single gate's evaluated result, as every gate normalizes to in both the
 * /ticker/:symbol response (gate1, preGate) and the /analyze response's
 * `gates` map (pre_gate, sector, g1_prewindow, g2_catalyst, g3_openbar,
 * g4_phase, g5_korea). Every gate has at least {status, note}; the
 * server-enforced ones (Gate 1, Gate 5) also carry sizing/forceDown.
 *
 * This is the exact shape whose *input* side (see SectorContext below) was
 * silently wrong for three weeks — evaluateProxyStatus() in server.js read
 * `marketData[symbol].pct` assuming an object, but every client only ever
 * sent a formatted string, so Gate 5's RED status was unreachable via
 * /analyze until root-caused by hand (Aug 13, 2026 — see CLAUDE.md, "Gate 5
 * forceDown was silently unreachable"). Writing this shape down is what let
 * that exact bug class get caught by `tsc` on save during the investigation
 * that produced this plan, instead of needing another live incident.
 * @typedef {Object} GateResult
 * @property {"GREEN"|"YELLOW"|"RED"} status
 * @property {string} note
 * @property {"FULL"|"HALF"|"QUARTER"|"NONE"} [sizing]
 * @property {boolean} [forceDown]
 * @property {string} [unit]
 * @property {string} [branch]
 */

/**
 * sectorContext, exactly as every tier's client (app.js's `sc` object in
 * analyzeTicker()) actually sends it in the /analyze POST body: a plain map
 * of lowercase index/proxy symbol -> a formatted "+1.23%"/"-4.56%"
 * *string*, never a {pct, change} object — plus Gate 0's own
 * pre-resolved gateStatus/gateNote riding on the same object. This is the
 * shape the Aug 13, 2026 Gate 5 bug got wrong (see GateResult above):
 * `SectorContext[symbol]` is a `string`, not `{pct, change}`, in production.
 * @typedef {Object<string, string>} SectorContext
 */

/**
 * The GET /ticker/:symbol response — fetched and memoized per-symbol by
 * shared/ticker-cache.js's fetchTickerData(), consumed by
 * shared/watchlist.js's updateCardMeta() to populate a card's
 * price/52W/news/phase strip before the user ever taps ANALYZE.
 * @typedef {Object} TickerData
 * @property {string} symbol
 * @property {{price:number, pct:(number|null), week52hi:number, week52lo:number, rangePosition:(number|null), phaseProxy:string, beta:(number|null)}|null} metrics
 * @property {{headline:string, url:string, source:string, ageLabel:string, ageHours:number}|null} news
 * @property {Object|null} openingBar
 * @property {{proxy:{symbols:string[], name:string, rationale:string}, category:string, dynamicallyResolved?:boolean, forceDownAuthority?:boolean, sizingOverride?:string, elevatedCapCeiling?:boolean, autoExecuteStop?:boolean}} proxyRule
 * @property {GateResult} gate1
 * @property {{status:"GREEN"|"YELLOW"|"RED", hardTrigger:boolean, note:string}} preGate
 * @property {number|null} [iv]
 * @property {Object|null} weeklyCarryover
 * @property {{state:"INTACT"|"DEGRADING"|"BROKEN"|"UNKNOWN", rolling:(number|null), baseline:(number|null), delta:(number|null), action:string, note:string}|null} regime
 * @property {string} timestamp
 */

/**
 * The POST /analyze request body, built by each tier's own analyzeTicker()
 * (app.js / pro/app.js / starter/app.js / shark's monolithic file — none of
 * those are in Phase 0's checked scope, hence this typedef living here
 * instead of next to them) and consumed by server.js's /analyze handler.
 * @typedef {Object} AnalyzeRequestBody
 * @property {string} ticker
 * @property {SectorContext} [sectorContext]
 * @property {string} [marketContext]
 * @property {Object} [metricsData]
 * @property {Object} [newsData]
 * @property {Object} [openingBarData]
 * @property {Object} [proxyRule]
 * @property {GateResult} [gate1Data]
 * @property {Object} [preGateData]
 * @property {Object} [weeklyCarryoverData]
 * @property {Object} [regimeData]
 */

/**
 * The POST /analyze response — the LLM's own JSON (ticker/type/verdict/
 * confidence/reason/gates/sizing/wait_for, per SYSTEM_PROMPT in server.js)
 * plus everything server-enforced on top of it before the response goes out
 * (contextCorroboration, riskFlags, marketOpen, fromCache).
 * @typedef {Object} AnalyzeResponse
 * @property {string} ticker
 * @property {"CANARY"|"SENTIMENT"|"FLOW"} type
 * @property {"UP"|"DOWN"|"FLAT"} verdict
 * @property {"HIGH"|"MEDIUM"|"LOW"} confidence
 * @property {string} reason
 * @property {Object<string, GateResult>} gates
 * @property {"FULL"|"HALF"|"QUARTER"|"NONE"} sizing
 * @property {string|null} wait_for
 * @property {{corroborated:boolean, matchCount:number, note:string}} [contextCorroboration]
 * @property {{elevatedCapCeiling:boolean, autoExecuteStop:boolean}} [riskFlags]
 * @property {boolean} marketOpen
 * @property {boolean} [fromCache]
 */

export {};
