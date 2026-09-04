// Rolodex UI mechanics -- extracted from starter/app.js (Aug 16, 2026,
// Phase 3 kickoff of the TypeScript adoption plan) so Free/Pro's own
// eventual Rolodex builds can reuse this instead of hand-copying it, the
// way Starter's own build was created. Every hard-won fix from the
// preview/rolodex/ iteration saga and the Starter build (Gate dock-
// threshold math, marquee wrap-boundary arithmetic, the self-healing
// pause, swipe-to-delete) lives here now, in exactly one place.
//
// Scope boundary, deliberate: this module owns HOW the UI moves (dock/
// undock, marquee stepping, stacked-card positioning, swipe gesture) --
// never WHAT it shows. Card content (roloCardHTML, gate rendering,
// ticker links), GATE_FIELDS, and all business logic (analyzeOne, the
// real /analyze call) stay tier-owned, since those genuinely differ per
// tier (Pro's card/list-window split and exclusive features, Free's
// teased Sector Pulse). Trying to force those into this module before a
// second real consumer (Free) proves out what's actually shared would be
// premature abstraction in the other direction.
//
// This is also this repo's first Phase 3 (bundler) module -- see
// esbuild.config.mjs. It's authored with real, unversioned ES imports
// (no `?v=N`), because esbuild resolves and inlines them at build time;
// the emitted bundle is what tiers actually import.

export interface RolodexElements {
  scroller: HTMLElement;
  gateCard: HTMLElement;
  gateFullOverlay: HTMLElement;
  gateSpacer: HTMLElement;
  gateMarquee: HTMLElement;
  listHead: HTMLElement;
  roloIndex: HTMLElement;
  roloStage: HTMLElement;
  roloHint: HTMLElement | null;
}

export interface RolodexCallbacks {
  // Called after goRolo() has repositioned the stack and scrolled the
  // active card into view -- the tier's own hook for "auto-analyze if
  // this ticker has no result yet," same as the rest of the app's logic.
  onActivate: (sym: string, index: number) => void;
  // Called once a swipe-to-delete gesture crosses its threshold and the
  // slide-out animation finishes -- the tier calls its own removeTicker()
  // (shared/watchlist.ts's real one, with persistence/sync/undo toast).
  onDeleteConfirmed: (sym: string) => void;
  getWatchlist: () => string[];
  // Fired exactly once per dock/undock transition (never on every scroll
  // tick) -- a landscape-only header collapse hooks this to reclaim
  // vertical space once the Gate is docked, since landscape has far less
  // height to spare than portrait. Deliberately NOT the same shape as the
  // Aug 16, 2026 scroll-hide header this app already tried and reverted
  // ("broke too much") -- that one reacted continuously to scroll
  // position and fought scrollToActiveCard()'s own scroll-margin math;
  // this is a discrete boolean tied to the Gate's own already-debounced
  // dock state, the same one gateSpacer's collapse already uses, so it
  // can't independently drift out of sync or fire mid-gesture in a new way
  // that state doesn't already handle. Optional -- a tier that doesn't
  // want this leaves it undefined and nothing changes for it.
  onGateDockChange?: (docked: boolean) => void;
}

const GATE_MARQUEE_SPEED = 0.4;
const ROLO_MARQUEE_SPEED = 0.5;
const ROLO_MARQUEE_RESUME_MS = 2000;
const ROLO_SWIPE_MOVE_THRESHOLD = 14;

let els: RolodexElements;
let cb: RolodexCallbacks;
let GATE_DOCKED_H = 44;

// ── Gate dock/scroll mechanics ─────────────────────────────────────────
let spacerHeight = 0;
let dockThreshold = 0;
let gateDockedLast = false;
let gateTicking = false;

function currentGateFullHeight(): number {
  return Math.max(0, els.gateFullOverlay.getBoundingClientRect().height - GATE_DOCKED_H);
}

export function sizeGateSpacer(): void {
  spacerHeight = currentGateFullHeight();
  els.gateSpacer.style.height = (els.gateCard.classList.contains('docked') ? 0 : spacerHeight) + 'px';
  updateGateDockState();
  // Content (e.g. Sector Pulse's real text landing after /market
  // resolves) can change size independent of any scroll event -- same
  // "re-check whenever the thing being measured can change" reasoning as
  // updateGateDockState() just above.
  scheduleFirstCardSnapCheck();
  sizeRoloIndexOffset();
}

// listHead (the "Tap Pills to Analyze" CTA row) sits between the Gate and
// the ticker-pill strip and is sticky itself, so #roloIndex has to dock
// BELOW its real height, not directly under the Gate. Measured live
// rather than baked into a CSS pixel value -- the exact "guess a
// font-metric-dependent constant, then it's wrong on a real device's
// actual font" mistake this app's own gate-dot alignment fix (Aug 18,
// 2026) already learned the hard way applies here just as much: listHead's
// height is real rendered text + padding, not a fixed control like the
// Gate's own docked bar.
function listHeadHeight(): number {
  return els.listHead.getBoundingClientRect().height;
}

function sizeRoloIndexOffset(): void {
  els.roloIndex.style.top = (GATE_DOCKED_H + listHeadHeight()) + 'px';
}

export function updateGateDockState(): void {
  const docked = els.scroller.scrollTop >= dockThreshold;
  els.gateCard.classList.toggle('docked', docked);
  els.gateCard.setAttribute('aria-expanded', String(!docked));
  if (docked !== gateDockedLast) {
    els.gateSpacer.style.height = (docked ? 0 : spacerHeight) + 'px';
    gateDockedLast = docked;
    if (cb.onGateDockChange) cb.onGateDockChange(docked);
  }
}

export function jumpToTop(): void {
  els.scroller.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Soft-snap Sector Pulse (the first card after the Gate) flush under
// the docked Gate ────────────────────────────────────────────────────
// The gateSpacer collapse above already "pulls" the page's content up
// when the Gate docks (a passive layout reflow, not a scroll -- see
// updateGateDockState()), but that reflow isn't guaranteed to land the
// very next card's top edge pixel-flush against the docked bar's bottom
// edge -- a real, small residual gap or overlap can survive it depending
// on exactly where the user's scroll gesture stopped relative to the
// dock threshold. This corrects that residual with one more soft
// scrollBy(), same "measure the real thing, don't derive it" discipline
// as every other scroll-position fix in this file's history.
//
// Deliberately debounced to scroll-SETTLE, not fired synchronously from
// the scroll/rAF loop that flips the docked class -- programmatically
// moving scrollTop while a real touch gesture (or inertial momentum) is
// still in flight is exactly the fragile pattern the Aug 13, 2026
// collapsing-card lesson found broken three separate ways on a real
// device. Waiting for scrolling to actually stop means this never fights
// the user's own gesture, at the cost of the correction landing a beat
// after the dock visually finishes rather than perfectly mid-motion --
// an acceptable trade given that history.
//
// Bounded to a small max correction (not a hand-picked "is this near the
// threshold" flag) so it only ever behaves as a soft snap of a residual
// few pixels right at the transition -- anywhere else on the page (the
// user scrolled deep into later content, or all the way back near the
// top before the Gate would undock) the measured delta is far outside
// this bound and the check is a no-op by construction.
const FIRST_CARD_SNAP_MAX_DELTA = 80;
const FIRST_CARD_SNAP_SETTLE_MS = 120;
let firstCardSnapTimer: ReturnType<typeof setTimeout> | null = null;

// gateSpacer's height is CSS-transitioned (.2s == 200ms) on every dock/undock,
// same as the case forceGateDockedSync() above already handles synchronously
// for a forced dock. This check only debounces to FIRST_CARD_SNAP_SETTLE_MS
// (120ms) after the last scroll event -- shorter than the 200ms transition, so
// a dock/undock that happens right as scrolling stops can still be mid-
// animation when this runs. Reading getBoundingClientRect() against a
// still-animating spacer measures a moving target: the computed delta can
// under/overshoot, and the resulting scrollBy() dispatches its own scroll
// events, which reschedule this same check -- a real, demonstrable path to
// exactly the repeated-correction "glitching" this function exists to
// prevent, not just a theoretical race. Forcing the spacer to its final
// height synchronously first (transition suppressed, forced reflow, then
// restored) removes the timing dependency entirely, the same trick
// forceGateDockedSync() already uses for the same underlying reason.
function settleGateSpacerHeightSync(): void {
  const target = els.gateCard.classList.contains('docked') ? 0 : spacerHeight;
  const prevTransition = els.gateSpacer.style.transition;
  els.gateSpacer.style.transition = 'none';
  els.gateSpacer.style.height = target + 'px';
  void els.gateSpacer.offsetHeight;
  els.gateSpacer.style.transition = prevTransition;
}

function snapFirstCardUnderGateDock(): void {
  if (!els.gateCard.classList.contains('docked')) return;
  settleGateSpacerHeightSync();
  const card = document.querySelector('.content')?.firstElementChild as HTMLElement | null;
  if (!card) return;
  const scrollerTop = els.scroller.getBoundingClientRect().top;
  const cardTop = card.getBoundingClientRect().top - scrollerTop;
  const delta = cardTop - GATE_DOCKED_H;
  if (Math.abs(delta) > 0.5 && Math.abs(delta) <= FIRST_CARD_SNAP_MAX_DELTA) {
    els.scroller.scrollBy({ top: delta, behavior: 'smooth' });
  }
}

function scheduleFirstCardSnapCheck(): void {
  if (firstCardSnapTimer) clearTimeout(firstCardSnapTimer);
  firstCardSnapTimer = setTimeout(snapFirstCardUnderGateDock, FIRST_CARD_SNAP_SETTLE_MS);
}

// ── Gate's own index marquee (docked bar) ──────────────────────────────
let gateMarqueeOneSetW = 0;
let gateMarqueePos = 0;

// Caller supplies the built item HTML (GATE_FIELDS + tickerHref links are
// tier-owned content) -- this just wires the duplicate-pass marquee shell
// and re-measures.
export function buildGateMarquee(itemsHTML: string): void {
  els.gateMarquee.innerHTML = itemsHTML + itemsHTML;
  gateMarqueePos = 0;
  requestAnimationFrame(sizeGateMarquee);
}

// Measures pass1's first item vs pass2's first item directly -- scrollLeft/
// padding/gap all cancel out of the difference automatically.
function sizeGateMarquee(): void {
  const items = els.gateMarquee.querySelectorAll<HTMLElement>('.gm-item');
  if (items.length < 2) { gateMarqueeOneSetW = els.gateMarquee.scrollWidth / 2; return; }
  const firstPassStart = items[0].getBoundingClientRect().left;
  const secondPassStart = items[items.length / 2].getBoundingClientRect().left;
  gateMarqueeOneSetW = secondPassStart - firstPassStart;
}

function stepGateMarquee(): void {
  if (els.gateCard.classList.contains('docked') && gateMarqueeOneSetW > 0) {
    gateMarqueePos += GATE_MARQUEE_SPEED;
    if (gateMarqueePos >= gateMarqueeOneSetW) { gateMarqueePos -= gateMarqueeOneSetW; }
    els.gateMarquee.scrollLeft = Math.round(gateMarqueePos);
  }
  requestAnimationFrame(stepGateMarquee);
}

// ── Stacked-card positioning ────────────────────────────────────────────
let roloCurrent = 0;

export function getRoloCurrent(): number {
  return roloCurrent;
}

// Caps the active .rolo-card to the space actually available below
// whichever dock sits above the Rolodex stage -- the docked Gate, the
// sticky "Tap Pills to Analyze" row, and the pill strip, since .rolo-wrap
// always sits after #roloIndex in every tier's markup, the same "dock
// offset" every below-pill utility card already uses (capCardBodyHeight
// above) -- with internal scroll past that, matching the same treatment
// every accordion card already got.
// activeCard.scrollHeight (not offsetHeight) reports the true, un-clipped
// content height regardless of any max-height already applied from a
// previous call, so this is safe to call every time without needing to
// clear the cap first.
const ROLO_CARD_MIN_HEIGHT = 160;
const ROLO_CARD_BOTTOM_MARGIN = 16;

function capRoloCardHeight(activeCard: HTMLElement): void {
  const roloIndexH = els.roloIndex.getBoundingClientRect().height;
  const available = els.scroller.clientHeight - GATE_DOCKED_H - listHeadHeight() - roloIndexH - ROLO_CARD_BOTTOM_MARGIN;
  const cap = Math.max(ROLO_CARD_MIN_HEIGHT, available);
  if (activeCard.scrollHeight > cap) {
    activeCard.style.maxHeight = cap + 'px';
    activeCard.style.overflowY = 'auto';
  } else {
    activeCard.style.maxHeight = '';
    activeCard.style.overflowY = '';
  }
}

export function syncRoloStageHeight(): void {
  const cards = Array.from(els.roloStage.querySelectorAll<HTMLElement>('.rolo-card'));
  const activeCard = cards[roloCurrent];
  if (!activeCard) return;
  capRoloCardHeight(activeCard);
  els.roloStage.style.height = activeCard.offsetHeight + 'px';
}

export function positionRoloStack(): void {
  const cards = Array.from(els.roloStage.querySelectorAll<HTMLElement>('.rolo-card'));
  cards.forEach((card, i) => {
    const d = i - roloCurrent, abs = Math.abs(d);
    card.style.pointerEvents = abs === 0 ? 'auto' : 'none';
    if (abs === 0) {
      card.style.transform = 'translateY(0) scale(1)'; card.style.opacity = '1'; card.style.zIndex = '10'; card.style.filter = 'none';
    } else if (abs <= 2) {
      card.style.transform = `translateY(${d < 0 ? -14 * abs : 14 * abs}px) scale(${1 - 0.05 * abs})`;
      card.style.opacity = String(0.55 - 0.2 * (abs - 1)); card.style.zIndex = String(10 - abs); card.style.filter = 'brightness(.7)';
    } else {
      card.style.transform = `translateY(${d < 0 ? -60 : 60}px) scale(0.85)`; card.style.opacity = '0'; card.style.zIndex = '1';
    }
  });
  const chips = Array.from(els.roloIndex.querySelectorAll<HTMLElement>('.rolo-chip'));
  chips.forEach((chip) => chip.classList.toggle('active', +(chip.dataset.idx || -1) === roloCurrent));
  if (els.roloHint) els.roloHint.textContent = cards.length ? (roloCurrent + 1) + ' / ' + cards.length : '— / —';
  syncRoloStageHeight();
}

// Forces the Gate into its docked layout synchronously and returns the pill
// strip's current (docked) height -- shared by scrollToActiveCard() and
// snapCardUnderDock() below, both of which need the page settled into its
// final docked layout BEFORE computing a scrollIntoView target, not after.
// scrollIntoView() computes its destination once, synchronously, against
// the CURRENT document layout -- but a real scroll normally triggers
// updateGateDockState() to collapse gateSpacer's ~150-200px of reserved
// flow space. Left to happen only via the scroll event, that collapse
// lands while the native smooth-scroll animation is already mid-flight
// toward a target computed against the OLD (taller) layout -- the page
// shifts out from under the animation and it overshoots. Confirmed via
// direct getBoundingClientRect measurement (Aug 16, 2026): the active card
// ended up rendered partially UNDER the sticky pill strip instead of below
// it, breaking pointer targeting on the card's top edge (the swipe-to-
// delete gesture's own pointerdown handler). Settling the dock state
// first, synchronously, makes the layout stable for the entire scroll --
// idempotent with updateGateDockState()'s own dock handling once the real
// scroll event fires (gateDockedLast is already true, so it's a no-op, no
// double transition).
function forceGateDockedSync(): number {
  if (!els.gateCard.classList.contains('docked')) {
    els.gateCard.classList.add('docked');
    els.gateCard.setAttribute('aria-expanded', 'false');
    // gateSpacer's height is CSS-transitioned (.2s) for the normal scroll-
    // driven dock -- a style write alone doesn't make the LAYOUT (what
    // scrollIntoView below actually measures) reflect 0 until that
    // transition finishes animating, confirmed by sampling
    // getBoundingClientRect() every 30ms through a real dock: it stayed
    // at the full ~198px for one frame after the style write, then eased
    // down over the next ~200ms while the scroll (and the target's real
    // position) tracked it the whole way, landing short every time.
    // Suppress the transition for this forced, synchronous collapse only
    // (still-natural scroll-driven docks keep their eased "pull up"), and
    // force a reflow before restoring it so scrollIntoView measures the
    // real, final, already-collapsed layout.
    const prevTransition = els.gateSpacer.style.transition;
    els.gateSpacer.style.transition = 'none';
    els.gateSpacer.style.height = '0px';
    void els.gateSpacer.offsetHeight;
    els.gateSpacer.style.transition = prevTransition;
    gateDockedLast = true;
    if (cb.onGateDockChange) cb.onGateDockChange(true);
  }
  return els.roloIndex.getBoundingClientRect().height;
}

// Tapping a pill can happen from anywhere on the page -- #roloIndex stays
// sticky-docked all the way through content that follows it, so the card
// itself can be scrolled well out of view. scrollIntoView (not a hand-
// computed scrollTop) so it stays correct automatically as the Gate/pill-
// strip's own real heights change, rather than re-deriving offsets by
// hand -- this codebase has repeatedly relearned that lesson the hard way.
function scrollToActiveCard(): void {
  const wrap = els.roloStage.closest<HTMLElement>('.rolo-wrap');
  if (!wrap) return;
  const roloIndexH = forceGateDockedSync();
  wrap.style.scrollMarginTop = (GATE_DOCKED_H + listHeadHeight() + roloIndexH) + 'px';
  wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Caps an expanding card's body to the space actually available below
// whichever dock sits above it, and lets it scroll internally past that --
// so a long card (many Watchlist rows, a long Track Record table) reads as
// a sheet that fits the screen, not an accordion that pushes the whole
// page to an arbitrary length with no visible bottom. Capped on
// .card-body-pad specifically, not .card-body-inner (which must keep a
// plain, uncapped overflow:hidden for the 0fr/1fr collapse trick below to
// keep working) -- .card-body's own grid row sizes to .card-body-inner's
// intrinsic content height, which naturally shrinks to match its now-
// capped child, so nothing about the collapse mechanism needs touching.
const CARD_BODY_MIN_HEIGHT = 120;
const CARD_BODY_BOTTOM_MARGIN = 16;

function capCardBodyHeight(cardEl: HTMLElement, dockOffset: number): void {
  const pad = cardEl.querySelector<HTMLElement>('.card-body-pad');
  const head = cardEl.querySelector<HTMLElement>('.card-head');
  if (!pad || !head) return;
  const available = els.scroller.clientHeight - dockOffset - head.getBoundingClientRect().height - CARD_BODY_BOTTOM_MARGIN;
  pad.style.maxHeight = Math.max(CARD_BODY_MIN_HEIGHT, available) + 'px';
}

function dockOffsetFor(cardEl: HTMLElement, roloIndexH: number): number {
  const afterPillStrip = !!(els.roloIndex.compareDocumentPosition(cardEl) & Node.DOCUMENT_POSITION_FOLLOWING);
  return GATE_DOCKED_H + (afterPillStrip ? listHeadHeight() + roloIndexH : 0);
}

// Soft-snaps a tapped/expanded utility card's top edge to sit just under
// whichever docked sticky bar sits directly above it on the page --
// determined by real DOM order, not a hand-maintained per-tier list, so it
// stays correct as tiers add/reorder cards (Pro's Watchlist/Proxy/Heat Map/
// Track Record cards all sit below #roloIndex, same as the active ticker
// card; Sector Pulse/Session Context/Import sit above it, same as the
// Gate). A card before #roloIndex snaps under the docked Gate alone
// (GATE_DOCKED_H); a card after it snaps under the docked Gate PLUS the
// sticky "Tap Pills to Analyze" row PLUS the pill strip's own docked
// height, exactly matching scrollToActiveCard()'s own offset for the same
// reason -- three sticky bars are stacked and occupying real space above
// it once docked. Never reorders anything or
// locks scroll -- a single smooth scrollIntoView, same as
// scrollToActiveCard(), so free scrolling immediately afterward is
// completely unaffected.
//
// Confirmed real (Aug 18, 2026): Watchlist/Proxy/Heat Map/Track Record --
// the cards below the ticker pills -- were landing well short of flush,
// worse the further down the page they sat. Root cause: at the instant
// this runs, the just-toggled 'expanded' class hasn't actually grown the
// card's body yet -- .card-body's grid-template-rows is CSS-transitioned
// (.22s), so scrollIntoView below computes/clamps its target against the
// STILL-COLLAPSED document height. For a card near the bottom of the page
// (not much content below it while collapsed), that clamp is real: the
// browser can't scroll further than what's currently scrollable, and once
// the accordion finishes growing a moment later and more room becomes
// available, the already-dispatched scroll never revisits its target --
// it just stops wherever it got clamped. Same class of bug
// forceGateDockedSync() above exists to prevent, just for a GROWING
// element instead of a shrinking one. Confirmed empirically: Watchlist/
// Proxy (higher up, already enough content below them) landed flush;
// Heat Map/Track Record (lower, not enough) landed 20-80px short,
// worse the lower the card sat -- exactly the "not consistent" symptom.
//
// Fix: force the body to its real final (capped) height synchronously --
// transition suppressed -- so the scroll target is computed against the
// true final layout, then revert to collapsed and restore the transition
// so the visual accordion-open animation still plays normally afterward.
// Mirrors forceGateDockedSync()'s own suppress/force-reflow/restore
// dance, just in the opposite (grow, not shrink) direction.
export function snapCardUnderDock(cardEl: HTMLElement): void {
  const roloIndexH = forceGateDockedSync();
  const dockOffset = dockOffsetFor(cardEl, roloIndexH);
  capCardBodyHeight(cardEl, dockOffset);
  cardEl.style.scrollMarginTop = dockOffset + 'px';

  const body = cardEl.querySelector<HTMLElement>('.card-body');
  if (!body) { cardEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }

  const prevTransition = body.style.transition;
  body.style.transition = 'none';
  body.style.gridTemplateRows = '1fr';
  void body.offsetHeight; // commit the real final (capped) height now

  cardEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

  body.style.gridTemplateRows = '0fr';
  void body.offsetHeight; // commit back to collapsed before restoring the transition
  body.style.transition = prevTransition;
  body.style.gridTemplateRows = ''; // hand control back to the .expanded class rule, now animated
}

// Re-caps every currently-expanded card's body on resize (rotation, a
// desktop window resize) -- the available-height math above is a snapshot
// of the viewport at expand time and doesn't self-update otherwise.
function recapExpandedCards(): void {
  const roloIndexH = els.roloIndex.getBoundingClientRect().height;
  document.querySelectorAll<HTMLElement>('.card.expanded[data-card]').forEach((cardEl) => {
    capCardBodyHeight(cardEl, dockOffsetFor(cardEl, roloIndexH));
  });
}

// ── Landscape "HUD" mode ─────────────────────────────────────────────────
// In portrait, utility cards (Pulse/Agitator/Import/Watchlist/Proxy/etc.)
// stack vertically as independent accordions -- fine when there's plenty
// of height to scroll through. Landscape is the opposite shape (wide,
// short), so instead they collapse into a left-side icon ribbon; tapping
// one shows ONLY that card's full content in a pane to the right,
// positioned directly under the active ticker card (not interleaved with
// it -- every card, wherever it lives in the DOM in portrait, ends up in
// this one shared pane). Only one card visible at a time, matching a
// direct instruction, not the independent-multi-open portrait behavior.
//
// Tapping a ribbon item snaps the whole hud into view exactly the way
// snapCardUnderDock() already brings a newly-expanded portrait card into
// view -- reusing forceGateDockedSync()/dockOffsetFor() directly rather
// than re-deriving the same offset math a second time. Unlike
// snapCardUnderDock(), there's no per-card 0fr/1fr collapse animation to
// race against here (a landscape card is plain display:none/block, not
// CSS-transitioned), so no measure-against-a-moving-target guard is
// needed for this part -- forceGateDockedSync() alone is enough to settle
// the one animated thing (the Gate's own dock) before scrollIntoView
// reads positions.
export interface LandscapeElements {
  hud: HTMLElement;
  ribbon: HTMLElement;
  pane: HTMLElement;
  empty: HTMLElement;
}

const LANDSCAPE_HUD_MIN_HEIGHT = 160;
const LANDSCAPE_HUD_BOTTOM_MARGIN = 16;

let lsEls: LandscapeElements | null = null;
let lsOnSelect: ((card: HTMLElement) => void) | null = null;
let lsIsActive = false;
let lsActiveCard: HTMLElement | null = null;
// Records each card's real original DOM position (parent + next sibling)
// the first time it's ever moved into the pane, so it can be put back
// exactly where portrait expects it when landscape deactivates -- captured
// lazily on first activation (not at init) so it reflects the DOM as the
// page actually finished rendering, not a guess at load order.
const lsAnchors = new Map<HTMLElement, { parent: Node; next: ChildNode | null }>();

export function isLandscapeMode(): boolean {
  return lsIsActive;
}

function snapLandscapeHudUnderDock(hudEl: HTMLElement): void {
  if (!lsEls) return;
  const roloIndexH = forceGateDockedSync();
  const dockOffset = dockOffsetFor(hudEl, roloIndexH);
  hudEl.style.scrollMarginTop = dockOffset + 'px';
  hudEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const available = els.scroller.clientHeight - dockOffset - LANDSCAPE_HUD_BOTTOM_MARGIN;
  lsEls.pane.style.maxHeight = Math.max(LANDSCAPE_HUD_MIN_HEIGHT, available) + 'px';
}

function buildLandscapeRibbon(cards: HTMLElement[]): void {
  if (!lsEls) return;
  lsEls.ribbon.innerHTML = cards.map((card) => {
    const icon = card.querySelector('.card-icon')?.textContent || '';
    const label = card.querySelector('.card-label')?.textContent || '';
    return `<button type="button" class="ribbon-item" data-card="${card.dataset.card}" aria-label="${label}"><span class="ribbon-icon">${icon}</span><span class="ribbon-label">${label}</span></button>`;
  }).join('');
  Array.from(lsEls.ribbon.children).forEach((btn, i) => {
    btn.addEventListener('click', () => selectLandscapeCard(cards[i]));
  });
}

function selectLandscapeCard(card: HTMLElement): void {
  if (!lsEls) return;
  lsActiveCard = card;
  lsEls.empty.style.display = 'none';
  Array.from(lsEls.pane.querySelectorAll<HTMLElement>('.card[data-card]')).forEach((c) => {
    c.classList.toggle('landscape-active', c === card);
  });
  Array.from(lsEls.ribbon.children).forEach((btn) => {
    (btn as HTMLElement).classList.toggle('active', (btn as HTMLElement).dataset.card === card.dataset.card);
  });
  if (lsOnSelect) lsOnSelect(card);
  snapLandscapeHudUnderDock(lsEls.hud);
}

function activateLandscape(): void {
  if (!lsEls) return;
  const cards = Array.from(document.querySelectorAll<HTMLElement>('.card[data-card]'));
  cards.forEach((card) => {
    if (!lsAnchors.has(card)) lsAnchors.set(card, { parent: card.parentNode as Node, next: card.nextSibling as ChildNode | null });
    lsEls!.pane.appendChild(card);
  });
  if (!lsEls.ribbon.childElementCount) buildLandscapeRibbon(cards);
  lsIsActive = true;
  if (lsActiveCard) selectLandscapeCard(lsActiveCard);
  else lsEls.empty.style.display = '';
}

function deactivateLandscape(): void {
  if (!lsEls) return;
  Array.from(document.querySelectorAll<HTMLElement>('.card[data-card]')).forEach((card) => {
    const anchor = lsAnchors.get(card);
    if (anchor) anchor.parent.insertBefore(card, anchor.next);
    card.classList.remove('landscape-active');
  });
  lsEls.pane.style.maxHeight = '';
  lsIsActive = false;
}

// onSelect is called with the same card element portrait's own
// expandCard() already handles (lazy-render dispatch, etc.) -- the tier
// passes its real expandCard so both entry points share one
// implementation, not two copies that could drift.
export function initLandscapeMode(landscapeElements: LandscapeElements, onSelect: (card: HTMLElement) => void): void {
  lsEls = landscapeElements;
  lsOnSelect = onSelect;
  const mq = window.matchMedia('(orientation: landscape)');
  const apply = () => { if (mq.matches) activateLandscape(); else deactivateLandscape(); };
  mq.addEventListener('change', apply);
  apply();
}

export function goRolo(i: number): void {
  const count = els.roloStage.querySelectorAll('.rolo-card').length;
  if (!count) return;
  roloCurrent = Math.max(0, Math.min(count - 1, i));
  positionRoloStack();
  scrollToActiveCard();
  const watchlist = cb.getWatchlist();
  const sym = watchlist[roloCurrent];
  if (sym) cb.onActivate(sym, roloCurrent);
}

export function clampRoloCurrent(): void {
  const watchlist = cb.getWatchlist();
  roloCurrent = Math.min(roloCurrent, Math.max(0, watchlist.length - 1));
}

// ── Swipe-to-delete on the active card only ─────────────────────────────
// Same visual/threshold pattern as production's real card-list swipe
// (shared/watchlist.ts's gesture handlers), re-bound to whichever single
// .rolo-card is currently active instead of a list row, since the
// Rolodex stage has no per-row list to attach the old gesture to.
interface SwipeState {
  pointerId: number;
  card: HTMLElement;
  startX: number;
  startY: number;
  mode: 'swipe' | null;
  pendingDx: number;
}
let roloSwipe: SwipeState | null = null;

function roloDeleteThreshold(card: HTMLElement): number {
  return Math.min(120, card.getBoundingClientRect().width * 0.35);
}

function ensureRoloSwipeBg(): HTMLElement {
  let bg = els.roloStage.querySelector<HTMLElement>('.rolo-swipe-bg');
  if (!bg) {
    bg = document.createElement('div');
    bg.className = 'rolo-swipe-bg';
    bg.innerHTML = '<span class="swipe-icon">🗑</span><span class="swipe-label">DELETE</span>';
    els.roloStage.insertBefore(bg, els.roloStage.firstChild);
  }
  return bg;
}

function onRoloPointerDown(e: PointerEvent): void {
  if (roloSwipe) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const target = e.target as HTMLElement;
  const card = target.closest<HTMLElement>('.rolo-card');
  if (!card) return;
  const cards = Array.from(els.roloStage.querySelectorAll('.rolo-card'));
  if (cards.indexOf(card) !== roloCurrent) return;
  roloSwipe = { pointerId: e.pointerId, card, startX: e.clientX, startY: e.clientY, mode: null, pendingDx: 0 };
}

function onRoloPointerMove(e: PointerEvent): void {
  const g = roloSwipe; if (!g || e.pointerId !== g.pointerId) return;
  const dx = e.clientX - g.startX, dy = e.clientY - g.startY;
  if (g.mode === null) {
    if (Math.abs(dx) > ROLO_SWIPE_MOVE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      g.mode = 'swipe';
      try { g.card.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      g.card.style.transition = 'none';
    } else if (Math.abs(dy) > ROLO_SWIPE_MOVE_THRESHOLD) {
      endRoloSwipe();
      return;
    } else return;
  }
  if (g.mode === 'swipe') {
    e.preventDefault();
    const clamped = Math.min(0, Math.max(dx, -g.card.getBoundingClientRect().width));
    g.card.style.transform = 'translateY(0) scale(1) translateX(' + clamped + 'px)';
    const bg = ensureRoloSwipeBg();
    const progress = Math.min(Math.abs(clamped) / roloDeleteThreshold(g.card), 1);
    bg.style.opacity = String(progress);
    g.pendingDx = clamped;
  }
}

function onRoloPointerUp(e: PointerEvent): void {
  const g = roloSwipe; if (!g || e.pointerId !== g.pointerId) return;
  if (g.mode === 'swipe') finishRoloSwipe(g);
  endRoloSwipe();
}

function finishRoloSwipe(g: SwipeState): void {
  const threshold = roloDeleteThreshold(g.card);
  const bg = ensureRoloSwipeBg();
  if (Math.abs(g.pendingDx) >= threshold) {
    const w = g.card.getBoundingClientRect().width;
    g.card.style.transition = 'transform .18s ease-in, opacity .18s ease-in';
    g.card.style.transform = 'translateX(-' + (w + 40) + 'px)';
    g.card.style.opacity = '0';
    const sym = cb.getWatchlist()[roloCurrent];
    setTimeout(() => { bg.style.opacity = '0'; if (sym) cb.onDeleteConfirmed(sym); }, 180);
  } else {
    g.card.style.transition = 'transform .18s ease';
    g.card.style.transform = 'translateY(0) scale(1)';
    bg.style.opacity = '0';
  }
}

function endRoloSwipe(): void {
  const g = roloSwipe;
  if (g) { try { g.card.releasePointerCapture(g.pointerId); } catch (err) { /* noop */ } }
  roloSwipe = null;
}

// ── Ticker pill strip auto-scroll marquee ──────────────────────────────
let roloMarqueeOneSetW = 0;
let roloMarqueePos = 0;
let roloMarqueeDataReady = false;
let roloMarqueePaused = false;
let roloMarqueeResumeTimer: ReturnType<typeof setTimeout> | null = null;
let roloItemsPerPass = 1;

function scheduleRoloMarqueeResume(): void {
  if (roloMarqueeResumeTimer) clearTimeout(roloMarqueeResumeTimer);
  roloMarqueeResumeTimer = setTimeout(() => {
    roloMarqueePos = els.roloIndex.scrollLeft;
    roloMarqueePaused = false;
  }, ROLO_MARQUEE_RESUME_MS);
}

function pauseRoloMarquee(): void {
  roloMarqueePaused = true;
  scheduleRoloMarqueeResume();
}

export function sizeRoloMarquee(): void {
  const itemsPerPass = roloItemsPerPass;
  if (els.roloIndex.children.length >= itemsPerPass * 2) {
    const firstPassStart = els.roloIndex.children[0].getBoundingClientRect().left;
    const secondPassStart = els.roloIndex.children[itemsPerPass].getBoundingClientRect().left;
    roloMarqueeOneSetW = secondPassStart - firstPassStart;
  } else {
    roloMarqueeOneSetW = els.roloIndex.scrollWidth / 2;
  }
}

function stepRoloMarquee(): void {
  if (!roloMarqueePaused && roloMarqueeDataReady && roloMarqueeOneSetW > 0) {
    roloMarqueePos += ROLO_MARQUEE_SPEED;
    if (roloMarqueePos >= roloMarqueeOneSetW) { roloMarqueePos -= roloMarqueeOneSetW; }
    els.roloIndex.scrollLeft = Math.round(roloMarqueePos);
  }
  requestAnimationFrame(stepRoloMarquee);
}

// Rebuilds the pill strip from the current watchlist -- caller supplies a
// chip factory (tier-owned pill content/styling) and a divider label
// (tier-owned "— N —" text). Handles the duplicate-pass-for-wraparound
// loop, the click->goRolo wiring, and the native-focus-scroll suppression
// on each chip, all of which are pure mechanics independent of what a
// chip actually looks like.
//
// buildExtraChip is optional and, when supplied, appends ONE additional
// non-ticker element into every repeated pass (after the watchlist's real
// chips, before the divider) -- e.g. Free's "Starter?" upsell pill (Aug
// 16, 2026). It's deliberately NOT routed through goRolo/the active-card
// index at all (the caller wires its own href/click behavior on the
// element it returns) and doesn't affect the watchlist or its tickers in
// any way -- purely a repeating, marquee-visible promotional pill. Still
// mechanics-owned (repeating it correctly across passes, keeping the
// wrap-boundary math correct) even though its content is tier-specific.
export function rebuildRoloIndex(
  watchlist: string[],
  buildChip: (sym: string, idx: number) => HTMLButtonElement,
  dividerText: string,
  buildExtraChip?: () => HTMLElement,
): void {
  els.roloIndex.innerHTML = '';
  roloMarqueePos = 0;
  roloMarqueeDataReady = false;
  roloItemsPerPass = watchlist.length + (buildExtraChip ? 1 : 0) + 1;

  function appendChipPass(): HTMLElement {
    watchlist.forEach((sym, i) => {
      const chip = buildChip(sym, i);
      chip.addEventListener('click', () => goRolo(i));
      chip.addEventListener('pointerdown', (e) => e.preventDefault());
      els.roloIndex.appendChild(chip);
    });
    if (buildExtraChip) {
      const extra = buildExtraChip();
      extra.addEventListener('pointerdown', (e) => e.preventDefault());
      els.roloIndex.appendChild(extra);
    }
    const divider = document.createElement('span');
    divider.className = 'rolo-divider';
    divider.textContent = dividerText;
    els.roloIndex.appendChild(divider);
    return divider;
  }

  const firstDivider = appendChipPass();
  const oneSetW = firstDivider.offsetLeft + firstDivider.offsetWidth;
  for (let guard = 0; guard < 20 && (els.roloIndex.scrollWidth - els.roloIndex.clientWidth) < oneSetW; guard++) {
    appendChipPass();
  }
}

export function markRoloMarqueeDataReady(): void {
  roloMarqueeDataReady = true;
}

// ── Card-header help balloons ───────────────────────────────────────────
// One shared popover element (position:fixed, appended to <body> once)
// reused for every "(?)" help button on the page -- Gate + every utility
// card. Mechanics only, same scope boundary as the rest of this module:
// the actual short-copy strings (keyed by whatever id a given "(?)"
// button carries) are tier-owned, passed in once via initHelpBalloons().
//
// Dismissal-by-timeout scales with how much there actually is to read --
// 5s per 4 lines of the balloon's own rendered content, not a flat 5s
// regardless of length (a flat timeout read as "too quick" on the
// longer entries, since it was tuned for a one-line balloon). Measured
// against the balloon's REAL rendered height once its content is set,
// not guessed from character count -- same "measure the real thing"
// discipline this app's own scroll/dock math has already learned the
// hard way applies here too. A click on the SAME button toggles it
// closed early; a click on a DIFFERENT help button, a glossary link
// inside the balloon, an outside click, Escape, or a scroll/resize all
// close it too, regardless of how long the computed duration is.
const HELP_BALLOON_MS_PER_4_LINES = 5000;
// A tap that brings an off-screen "(?)" button into view (browsers/test
// automation both do this for a click on a non-visible element) fires a
// real #scroller 'scroll' event essentially simultaneously with the click
// that opens the balloon -- close-on-scroll must not treat that as "the
// user scrolled away" and immediately undo the balloon it was just asked
// to open. Any #scroller scroll within this grace window of the balloon
// having opened is ignored; anything after it is a real subsequent scroll.
const HELP_SCROLL_GRACE_MS = 200;
let helpEl: HTMLElement | null = null;
let helpTimer: ReturnType<typeof setTimeout> | null = null;
let helpOpenKey: string | null = null;
let helpOpenedAt = 0;
let helpContent: Record<string, string> = {};

function ensureHelpEl(): HTMLElement {
  if (helpEl) return helpEl;
  const el = document.createElement('div');
  el.className = 'help-balloon';
  el.setAttribute('role', 'tooltip');
  document.body.appendChild(el);
  helpEl = el;
  return el;
}

export function closeHelpBalloon(): void {
  if (helpTimer) { clearTimeout(helpTimer); helpTimer = null; }
  if (helpEl) helpEl.classList.remove('open');
  helpOpenKey = null;
}

// Clamped to the viewport, not the caller's own scroll container -- the
// balloon is position:fixed precisely so it isn't clipped by any of this
// page's several overflow:hidden/sticky containers (.rolo-stage,
// .gate-full-overlay, etc.).
function positionHelpBalloon(btn: HTMLElement, el: HTMLElement): void {
  const margin = 10;
  const r = btn.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  let left = Math.min(Math.max(r.left, margin), window.innerWidth - margin - w);
  let top = r.bottom + 8;
  if (top + h > window.innerHeight - margin) top = Math.max(margin, r.top - h - 8);
  el.style.left = left + 'px';
  el.style.top = top + 'px';
}

function openHelpBalloon(btn: HTMLElement, key: string): void {
  if (helpOpenKey === key && helpEl && helpEl.classList.contains('open')) { closeHelpBalloon(); return; }
  const html = helpContent[key];
  if (!html) return;
  const el = ensureHelpEl();
  el.classList.remove('open');
  el.innerHTML = html;
  positionHelpBalloon(btn, el);
  requestAnimationFrame(() => el.classList.add('open'));
  helpOpenKey = key;
  helpOpenedAt = Date.now();
  if (helpTimer) clearTimeout(helpTimer);
  // Real rendered line count, not a character-count guess: total content
  // height (scrollHeight minus the box's own vertical padding, which
  // isn't part of any line) divided by the actual computed line-height.
  const cs = getComputedStyle(el);
  const lineHeightPx = parseFloat(cs.lineHeight) || 19.5;
  const vPad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  const lines = Math.max(1, Math.round((el.scrollHeight - vPad) / lineHeightPx));
  const duration = Math.ceil(lines / 4) * HELP_BALLOON_MS_PER_4_LINES;
  helpTimer = setTimeout(closeHelpBalloon, duration);
}

// Delegated at the document level, in the CAPTURE phase, so a "(?)"
// button or a glossary link nested inside an existing clickable header
// (.card-head's own accordion-toggle listener, #gateCard's own tap-to-
// jump-to-top listener) never also fires that ancestor's handler --
// capture runs before any bubble-phase listener registered directly on
// the ancestor gets a chance to. Content is tier-owned (content map) and
// the actual glossary jump is tier-owned too (buildGlossary()/
// filterGlossary() are per-tier), so onGlossaryJump is a callback rather
// than something this module implements itself -- same "mechanics here,
// content/business-logic in the tier" split as the rest of this file.
//
// This also sidesteps a real cross-tier inconsistency: Starter/Pro wire
// static markup via inline onclick="..." + a window.fn bridge, Free wires
// everything via addEventListener with no window bridge at all. A single
// shared delegated listener works identically under both conventions
// without forcing either tier to adopt the other's pattern just for this
// one feature.
export function initHelpBalloons(content: Record<string, string>, onGlossaryJump: (term: string) => void): void {
  helpContent = content;
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const link = target.closest<HTMLElement>('.help-glossary-link');
    if (link) {
      e.preventDefault(); e.stopPropagation();
      closeHelpBalloon();
      onGlossaryJump(link.dataset.term || '');
      return;
    }
    const btn = target.closest<HTMLElement>('[data-help]');
    if (btn) {
      e.preventDefault(); e.stopPropagation();
      openHelpBalloon(btn, btn.dataset.help || '');
      return;
    }
    if (helpEl && helpEl.classList.contains('open') && !helpEl.contains(target)) closeHelpBalloon();
  }, true);
  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if ((e.key === 'Enter' || e.key === ' ') && (target.closest('[data-help]') || target.closest('.help-glossary-link'))) {
      e.stopPropagation();
    } else if (e.key === 'Escape') {
      closeHelpBalloon();
    }
  }, true);
  // Scoped to the page's own scroll container, NOT window, and
  // deliberately NOT capture-phase -- 'scroll' events don't bubble, so a
  // plain (bubble-phase) listener directly on #scroller only ever fires
  // when #scroller ITSELF is the scroll target, never for a descendant's
  // own scroll. That distinction matters here: #roloIndex (the ticker
  // pill marquee) and #gateMarquee both live inside #scroller and write
  // their own scrollLeft every animation frame -- real, continuous
  // 'scroll' events with nothing to do with the user's viewport moving.
  // A CAPTURE-phase listener (whether on window or on #scroller itself)
  // still sees those, since capture always walks the full target-to-root
  // ancestor chain regardless of bubbling -- confirmed live: both closed
  // the balloon within one frame of opening it, every single time, with
  // zero user interaction. Bubble-phase on #scroller is the one
  // combination that only reacts to #scroller's own real position change
  // (real user scroll, or a real programmatic jump like
  // scrollToActiveCard()/jumpToTop()).
  els.scroller.addEventListener('scroll', () => {
    if (Date.now() - helpOpenedAt < HELP_SCROLL_GRACE_MS) return;
    closeHelpBalloon();
  });
  window.addEventListener('resize', closeHelpBalloon);
}

// ── Init ─────────────────────────────────────────────────────────────
export function initRolodex(elements: RolodexElements, callbacks: RolodexCallbacks): void {
  els = elements;
  cb = callbacks;
  GATE_DOCKED_H = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gate-docked-h')) || 44;
  // Dock threshold is a fixed constant (.content's own top padding) derived
  // algebraically from gateSpacer always being sized to exactly
  // (overlayHeight - GATE_DOCKED_H). Not re-measured live, which is what
  // makes undock work correctly once gateSpacer starts collapsing to 0.
  const contentEl = document.querySelector('.content');
  dockThreshold = contentEl ? parseFloat(getComputedStyle(contentEl).paddingTop) || 0 : 0;

  sizeRoloIndexOffset();

  window.addEventListener('resize', sizeGateMarquee);
  window.addEventListener('resize', sizeGateSpacer);
  window.addEventListener('resize', sizeRoloMarquee);
  window.addEventListener('resize', recapExpandedCards);
  window.addEventListener('resize', syncRoloStageHeight);
  window.addEventListener('resize', sizeRoloIndexOffset);

  let gateTickingLocal = false;
  els.scroller.addEventListener('scroll', () => {
    if (gateTickingLocal) return;
    gateTickingLocal = true;
    requestAnimationFrame(() => {
      updateGateDockState();
      gateTickingLocal = false;
    });
  }, { passive: true });

  // Separate, independently-debounced listener (see
  // snapFirstCardUnderGateDock() above) -- runs only once scrolling has
  // actually settled, not on every rAF-throttled tick above.
  els.scroller.addEventListener('scroll', scheduleFirstCardSnapCheck, { passive: true });

  els.gateCard.addEventListener('click', () => { if (els.gateCard.classList.contains('docked')) jumpToTop(); });
  els.gateCard.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (els.gateCard.classList.contains('docked')) jumpToTop(); }
  });

  els.roloStage.addEventListener('pointerdown', onRoloPointerDown);
  document.addEventListener('pointermove', onRoloPointerMove, { passive: false });
  document.addEventListener('pointerup', onRoloPointerUp);
  document.addEventListener('pointercancel', onRoloPointerUp);

  els.roloIndex.addEventListener('pointerdown', pauseRoloMarquee);
  els.roloIndex.addEventListener('pointerup', scheduleRoloMarqueeResume);
  els.roloIndex.addEventListener('pointercancel', scheduleRoloMarqueeResume);

  requestAnimationFrame(stepGateMarquee);
  requestAnimationFrame(stepRoloMarquee);
}
