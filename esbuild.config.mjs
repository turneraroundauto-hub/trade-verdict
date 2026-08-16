// Phase 3 of the TypeScript adoption plan (CLAUDE.md, "Engineering:
// TypeScript adoption path"). Bundles real .ts entry points into single
// output files -- eliminating the ?v=N cache-busting cascade this repo's
// own history has repeatedly hit (a shared module's version bump needing
// to propagate by hand through every importer, sometimes 4+ files deep).
//
// Deliberately does NOT change how the site deploys. Same pattern Phase 2
// already established (tsc emits shared/*.js from shared/*.ts, committed
// alongside the source, GitHub Pages keeps serving from branch) -- this
// just emits a bundled file instead of a 1:1 transpiled one. No GitHub
// Pages config change, no build-via-Actions switch (that's explicitly
// flagged elsewhere in CLAUDE.md as its own, bigger, not-yet-decided
// step). Run with `npm run build:bundle` after editing any entry point or
// anything it imports, then commit the emitted output.
//
// esbuild resolves and inlines the existing shared/*.ts files' own
// internal `?v=N`-suffixed imports transparently (confirmed empirically
// before this was relied on) -- none of those files needed touching to
// become bundle-able.
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

// The existing shared/*.ts files (Phase 2's conversions) still carry
// their own internal `?v=N` cache-busting suffixes on every import --
// necessary for tiers that load them as raw, unbundled ES modules
// (Free/Pro today), actively harmful for bundling. Two DISTINCT ways
// this caused real duplicate-module bugs, both found and fixed the hard
// way (Aug 16, 2026) while converting Starter's own entry point -- worth
// keeping both fixes explicit since either one alone looked sufficient
// until tested against the real dependency graph:
//
// 1. Query-string identity: esbuild's module cache is keyed by the exact
//    specifier string, so './watchlist.js?v=32' and '../shared/watchlist'
//    resolve to the same file but don't deduplicate into the same module
//    instance -- confirmed via a synthetic two-importer repro, then via
//    the real bundle showing a second `watchlist` (renamed `watchlist2`
//    by esbuild's collision handling) with its own independent array.
// 2. .ts-vs-compiled-.js identity: every Phase 2 file has BOTH its .ts
//    source and its tsc-emitted .js sibling committed side by side (the
//    .js is the real deploy artifact for unbundled tiers). An
//    extensionless specifier ('../shared/watchlist') resolves to the
//    .ts source; an explicit '.js'-suffixed specifier
//    ('./watchlist.js?v=32', even after its query is stripped) resolves
//    to the literal .js file instead -- a second, DIFFERENT physical
//    file with its own independent top-level state, bundled alongside
//    the .ts source's. Fixing #1 alone still left this one in place
//    (caught only because setWatchlist()'s own writes landed on the .js
//    copy's `watchlist2` while every read elsewhere in the bundle saw
//    the .ts copy's `watchlist` -- the server-synced watchlist visibly
//    never updated on screen).
//
// Rather than hand-match every entry point's own import specifiers to
// whatever version number and extension a shared file's internal imports
// happen to carry right now -- fragile, and the exact kind of manual
// bookkeeping Phase 3 exists to eliminate -- this plugin normalizes
// every specifier reaching a shared/*.js(?v=N)? path onto its .ts
// sibling (falling back to the plain .js file, query stripped, only
// when no .ts sibling exists), so every path into the same logical
// module converges on one physical file and one instance regardless of
// which legacy specifier form reached it.
const normalizeSharedImports = {
  name: 'normalize-shared-imports',
  setup(build) {
    build.onResolve({ filter: /\.js(\?v=\d+)?$/ }, async (args) => {
      if (!args.path.startsWith('.')) return null; // leave bare/package specifiers alone
      const cleanPath = args.path.replace(/\?v=\d+$/, '');
      const tsCandidate = cleanPath.replace(/\.js$/, '.ts');
      const tsAbsPath = path.resolve(args.resolveDir, tsCandidate);
      const preferred = fs.existsSync(tsAbsPath) ? tsCandidate : cleanPath;
      return build.resolve(preferred, { kind: args.kind, resolveDir: args.resolveDir, importer: args.importer });
    });
  },
};

const entryPoints = [
  // Starter was the first tier converted to a bundled entry point. Free
  // is the second (Aug 16, 2026) -- its own Rolodex build at the repo
  // root, consuming shared/rolodex.ts the same way. Pro's own future
  // Rolodex build adds a third entry here once it exists -- each tier
  // gets its own bundle, not one shared across tiers, since the tiers'
  // business logic (real /analyze body, TIER config, card content)
  // genuinely differs.
  { in: 'starter/app.ts', out: 'starter/app' },
  { in: 'app.ts', out: 'app' },
];

for (const entry of entryPoints) {
  await esbuild.build({
    entryPoints: [entry.in],
    outfile: `${entry.out}.js`,
    bundle: true,
    format: 'esm',
    target: 'es2020',
    // Not minified -- this repo has no source-map/build-artifact
    // separation story yet, and the emitted .js is what a future
    // contributor reads directly (same posture as Phase 2's plain
    // tsc-emitted output). Revisit once Phase 3 covers more than one
    // entry point.
    minify: false,
    sourcemap: false,
    logLevel: 'info',
    plugins: [normalizeSharedImports],
  });
}
