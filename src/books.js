// Public books. Costs and booked revenue are hand-maintained each session; the receive
// address's balance and itemized transfer list are read live from chain on /books and
// reconciled against this table.
// Every number here must match LEDGER.md. If they disagree, LEDGER.md wins and this is a bug.
export const BOOKS = {
  updated: '2026-09-17',  // session 23 (/clients.jsonl gains the crosshost family; see LEDGER.md #23)
  currency: 'USD',
  budget_per_year: 150,
  project_started: '2026-08-23',
  // USDC on Base (network: Base, chain id 8453). The project holds no key that can spend from
  // this address (the operator does); every USDC movement in or out of it is itemized on /books
  // and must be explained by a row in chain_movements below or a revenue row's tx.
  receive_address: '0x2b14ad50d63c7fee5a33847f95153ac37a690170',
  // Hosting is the one cost that grows on a clock rather than on a decision, so it is DERIVED here
  // rather than hand-typed (session 20). Until now it was a single $5 row dated 2026-08-23 with a
  // note reading "Accrues monthly", correct on the day it was written and arithmetically wrong from
  // 2026-09-23 — with no mechanism to notice and nothing but a note-to-self, carried in every entry
  // since #4, obliging a session to look. A public ledger that quietly understates its own costs
  // flatters its author, which is the one direction these books must never be wrong in.
  //
  // The arithmetic is published beside the number on /books and in /books.json (hosting.basis plus
  // totals.hosting_months, totals.hosting_accrued and totals.next_accrual) so a reader can redo it
  // rather than trust it, and the smoke check `booksaccrual` recomputes the month count
  // independently in shell rather than reading the Worker's own number back to itself.
  hosting: {
    rate_usd_per_month: 5.0,
    since: '2026-08-23',
    item: 'Cloudflare Workers Paid plan (hosting)',
    basis:
      'Month 1 accrued the day the project started (2026-08-23) and another $5.00 accrues on that ' +
      'day of each following month, so totals.hosting_months x hosting.rate_usd_per_month is the ' +
      'hosting figure inside totals.costs, and totals.next_accrual is the date it next changes. ' +
      'The account-level plan is the operator\'s and covers other work too; the charter ' +
      'attributes ~$5/mo of it to this project, so this is an attributed accrual, not an invoice.',
  },
  // The rate above is an ATTRIBUTION. What this Worker actually consumes is a different question,
  // and until session 21 these books never answered it — they published $5.00/mo with a note saying
  // "attributed, not an invoice" and no way for a reader to tell whether the real figure was ten
  // cents or fifty dollars. That is the same shape of hole as the corpus row that claimed stable
  // bytes while its own defect string said otherwise (#20): a number stated without its basis.
  //
  // So: a dated measurement, in the idiom this project already uses for observations of a third
  // party (the /compress edge column, the /clients witness matrix). The raw counts are constants
  // read from Cloudflare's own analytics on measured_on; every ratio below them is DERIVED in
  // hostingUsage() so the arithmetic cannot drift from the inputs, and the query that produced
  // them is published beside them so the reader can re-run it rather than trust it.
  //
  // The honest conclusion is NOT that hosting is free, and the measurement is not an argument for
  // lowering the accrual: standalone this Worker could not use the free plan at all (its P99.9 CPU
  // is nearly 5x the free per-invocation ceiling, and the endpoints that exceed it are the
  // deliberately expensive ones that are the product), so $5.00/mo — the paid plan's floor — is
  // what it would cost on its own. What the measurement establishes is the OTHER number: on the
  // account that already carries the plan, this project's usage sits inside the included allowance
  // and adds nothing to the bill. Both are true, they answer different questions, and the books
  // should state both rather than quietly pick the flattering one.
  hosting_measured: {
    measured_on: '2026-09-08',
    window: { from: '2026-09-01T00:00:00Z', to: '2026-09-08T00:00:00Z', days: 7 },
    source: 'Cloudflare GraphQL Analytics API, workersInvocationsAdaptive, scriptName "badhttp"',
    requests: 18499,
    cpu_ms: 31366,
    subrequests: 1992,
    egress_bytes: 168900000,
    // Per-invocation CPU distribution, in milliseconds, over the same window. The maximum is the
    // figure that settles the free-plan question, and it is measured per day as well as in
    // aggregate: 7 of the 7 days in this window had a single request costing more CPU than the
    // free plan allows per invocation (daily maxima 11.7, 32.0, 35.4, 80.6, 88.4, 190.9 and
    // 292.7 ms), and on two of them the 99th percentile exceeded it too (10.9 ms on 2026-09-01,
    // 10.6 ms on 2026-09-02) — so the loss there would not be a rounding error on a bad day.
    cpu_ms_p50: 1.053,
    cpu_ms_p99: 8.735,
    cpu_ms_p999: 48.549,
    cpu_ms_max: 292.68,
    days_in_window_exceeding_free_ceiling: 7,
    days_in_window_with_p99_exceeding_free_ceiling: 2,
    // Cloudflare's published figures, read on the date below. If these change, the ratios move.
    plan: {
      source_url: 'https://developers.cloudflare.com/workers/platform/pricing/',
      read_on: '2026-09-08',
      paid_min_usd_per_month: 5.0,
      paid_included_requests_per_month: 10000000,
      paid_included_cpu_ms_per_month: 30000000,
      free_requests_per_day: 100000,
      free_cpu_ms_per_invocation: 10,
    },
  },
  // Money already owed but not yet spent. Stated so the books show what is coming rather than
  // burying it in a note; not included in the costs total, which is spend to date.
  // Session 22 added a SECOND HOSTNAME, alt.badhttp.dev, so the /crosshost family can cross a real
  // host boundary. It appears here at $0.00 on purpose: the books are meant to be auditable against
  // the infrastructure, and a reader who notices the project answering on a hostname that appears
  // nowhere in the cost table has found a gap in the books, not a saving. There is no cost line
  // because there is genuinely no cost — the zone's universal certificate already covered
  // *.badhttp.dev before the host existed, custom domains are not a billed unit (100 per zone
  // included; this zone uses 2), and the requests it serves bill exactly as the first host's do,
  // inside the already-attributed Workers plan above.
  infrastructure: [
    {
      item: 'Second hostname alt.badhttp.dev (Cloudflare Workers custom domain, same Worker, same zone)',
      added: '2026-09-10',
      cost_usd: 0.0,
      why_zero:
        'The zone certificate already covered *.badhttp.dev; a custom domain consumes no billed ' +
        'unit (100 per zone are included and this zone uses 2); and its requests bill inside the ' +
        'Workers plan already accrued above. Verified against the zone (plan: Free Website, $0) ' +
        'and the certificate on the wire on 2026-09-10.',
      purpose: 'Gives /crosshost a real second host, so a redirect can cross a genuine host boundary with real DNS and a real certificate rather than a loopback listener.',
    },
  ],
  commitments: [
    {
      due: '2027-08-23',
      item: 'badhttp.dev renewal, 1 year (Porkbun)',
      amount: 12.87,
      // Re-checked against the Porkbun API 2026-09-08: badhttp.dev ACTIVE, autoRenew on, expiring
      // 2027-08-23 05:27:07 UTC. The registrar exposes no account-balance endpoint, so the balance
      // below is dated rather than stated in the present tense — it is what remained after
      // registration and this project cannot re-read it.
      verified: '2026-09-08 (registrar API: ACTIVE, auto-renew on, expires 2027-08-23)',
      note: 'Auto-renew is on. The Porkbun account held $1.25 after registration on 2026-08-23 and the registrar publishes no balance endpoint, so that figure is dated, not live: it needs a top-up of roughly $12 before the renewal date or the domain lapses.',
    },
  ],
  // What the project could pay a bill WITH, against the one bill it actually has. Added session 21,
  // because "is this self-sustaining?" had never been reducible to a number on this site: the books
  // showed spend and revenue, and the charter set breakeven as a design constraint, but nothing
  // said what the project holds or whether it covers what it owes. It reduces to one line.
  //
  // The payer balance is NOT stated here — it is read from chain on every /books render, for the
  // same reason hosting accrues itself: an asset figure typed by hand goes stale silently, and this
  // one is the numerator. Only the registrar credit is a stated figure, because Porkbun publishes
  // no balance endpoint and the project genuinely cannot read it; it is dated rather than asserted
  // in the present tense, and the page says so.
  solvency: {
    // The project's own mainnet payer wallet (entry #12). Its address is already public — the
    // self-test transaction hashes in GET /402 and the chain_movements table below both lead to it
    // in one click — so naming it here discloses nothing new and makes the figure checkable.
    payer_address: '0xa4A3E7857bE6b14F9e2570Af6805bDd183CDfE5a',
    payer_note:
      'Working capital funded by the operator on 2026-08-28 (costs row below) and held by the '
      + 'project, which controls this key. It has never been revenue and is not counted as any.',
    registrar_credit_usd: 1.25,
    registrar_credit_dated: '2026-08-23',
    registrar_credit_note:
      'What remained in the Porkbun account after registration. The registrar publishes no '
      + 'account-balance endpoint, so this is the last figure anyone observed, not a live read.',
    // The rail that would let the project's on-chain capital reach its registrar, established
    // session 21: Porkbun accepts one-time cryptocurrency deposits which are credited to the
    // account and usable for automatic renewals, processed through Coinbase
    // (kb.porkbun.com/article/143). The chains accepted are not documented on that page. The flow
    // is a browser checkout, so the project cannot drive it end to end — it is an operator task,
    // and the books should not imply otherwise.
    conversion_rail:
      'Porkbun accepts one-time crypto deposits as account credit usable for automatic renewals, '
      + 'via Coinbase (kb.porkbun.com/article/143). Supported chains are not documented there. The '
      + 'checkout is a browser flow, so moving this capital is an operator action, not a project one.',
  },
  costs: [
    {
      date: '2026-08-23',
      item: 'badhttp.dev registration, 1 year (Porkbun)',
      amount: 8.75,
      note: 'First-year promo price; renews at $12.87 on 2027-08-23.',
    },
    {
      date: '2026-08-28',
      item: 'Mainnet payer wallet funded (working capital, USDC on Base)',
      amount: 10.0,
      note: 'Most of it is still held by the project: $9.965 at the payer, $0.02 self-test settlements to the receive address (transfers between our own addresses — NOT revenue; tx hashes in GET /402), $0.015 spent on three x402-trust paid trust reports — the project\'s payments to an external x402 service.',
    },
  ],
  // A booked revenue row for an on-chain payment should carry its tx hash as `tx` so the
  // /books itemization can label it. Amounts are NUMBERS, never strings.
  revenue: [
    {
      date: '2026-09-01',
      item: 'x402 payment at /402/pay/base: 0.01 USDC from nohumans.directory\'s paying scout (their paid-verification probe of our listing) — the first payment from anyone other than this project',
      amount: 0.01,
      tx: '0x645b92cd93250785c5208821f22328087389803ed2178566e871f2edeed5686a',
      note: 'Settled 2026-09-01 21:32:11 UTC (block 50754492) from 0x54e163e9b8edda194d83f46add921bfa5fc5f4e0, the scout address nohumans.directory publishes on its sellers page; the request was a 200 from /402/pay/base with user agent nohumans-scout/1.0. Booked the next session start (2026-09-02).',
    },
  ],
  // Every on-chain USDC movement of the receive address that is NOT booked revenue, labeled by
  // transaction hash. Hand-maintained like the tables above; amount_atomic is exact atomic USDC
  // (6 dp) as a digit string, direction is 'in' or 'out' relative to the receive address.
  // The live reconciliation derives its aggregate identity from these rows, and the itemized
  // transfer list on /books labels each on-chain row by matching tx hashes here (then revenue
  // rows); an on-chain transfer matching neither is "unbooked" if incoming — and, if outgoing,
  // an unexplained withdrawal the page must flag loudly.
  chain_movements: [
    {
      date: '2026-08-28',
      direction: 'in',
      amount_atomic: '10000000',
      tx: '0xd3d2c7fc86c6fb60f6c69accd55f37e2230d13b989740222e67cfcc7ce451236',
      label: 'operator capital, arriving',
      note: 'The $10 working capital (costs row of 2026-08-28) passing through this address on its way to the project\'s mainnet payer wallet. Not revenue.',
    },
    {
      date: '2026-08-28',
      direction: 'out',
      amount_atomic: '10000000',
      tx: '0x6f2248af15b43062a49f1257f47bba2f4efa925fa28886dc4ca43a5798554924',
      label: 'operator capital, on to the payer wallet',
      note: 'The same $10 leaving for the mainnet payer wallet the project uses for self-tests and paid reports. Sent by the operator, who holds this address\'s key; the project holds none.',
    },
    {
      date: '2026-08-28',
      direction: 'in',
      amount_atomic: '10000',
      tx: '0x8a331a0a28a26d290984c34bd12ae03bdc31603856b4e46bace3d2045cddc089',
      label: 'self-test settlement (x402 v2)',
      note: 'Project money returning from the payer wallet: proof that settlement works, booked as a labeled transfer, never revenue. Tx hash also in GET /402 (verified.exercised).',
    },
    {
      date: '2026-08-28',
      direction: 'in',
      amount_atomic: '10000',
      tx: '0x629b1a478e88c8be043ee0e8ebac67169a386192fde388b9a616fc850b5010b8',
      label: 'self-test settlement (x402 v1)',
      note: 'Project money returning from the payer wallet: proof that settlement works, booked as a labeled transfer, never revenue. Tx hash also in GET /402 (verified.exercised).',
    },
  ],
};

/**
 * Months of hosting accrued as of `now`, counting month 1 on the start date itself.
 *
 * Anniversary arithmetic, not 30-day buckets: whole calendar months between the two dates, minus
 * one if today's day-of-month has not yet reached the start's, plus one because month 1 accrued on
 * day zero. The project started on the 23rd, which every month has, so the short-month case cannot
 * arise here; it is handled anyway (a start on the 31st accrues on the last day of a short month)
 * so this stays correct if `since` ever changes.
 */
export function hostingMonths(b = BOOKS, now = new Date()) {
  const [y0, m0, d0] = b.hosting.since.split('-').map(Number);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const d = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const anniversary = Math.min(d0, daysInMonth);
  const months = (y - y0) * 12 + (m - m0) - (d < anniversary ? 1 : 0) + 1;
  // Clamped AFTER the +1, so a date before `since` accrues nothing rather than one month. The clock
  // only moves forward so this cannot arise in production; it matters because the smoke check
  // recomputes this arithmetic independently and the two must agree on every input, not just real ones.
  return months < 0 ? 0 : months;
}

/** The UTC date the next $5.00 accrues. Published so the reader can check the clock, not just the sum. */
export function nextAccrual(b = BOOKS, now = new Date()) {
  const d0 = Number(b.hosting.since.split('-')[2]);
  const n = hostingMonths(b, now);
  const [y0, m0] = b.hosting.since.split('-').map(Number);
  const target = new Date(Date.UTC(y0, m0 - 1 + n, 1));
  const y = target.getUTCFullYear();
  const m = target.getUTCMonth() + 1;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = Math.min(d0, dim);
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The hosting measurement projected onto Cloudflare's published allowances.
 *
 * Every figure here is derived from `hosting_measured`; nothing is typed twice. The raw counts are
 * a 7-day window, so the monthly projections are that window scaled by 30/days — stated as
 * projections, not as observed months, because nobody has observed a month.
 */
export function hostingUsage(b = BOOKS) {
  const m = b.hosting_measured;
  if (!m) return null;
  const days = m.window.days;
  const perDay = m.requests / days;
  const reqPerMonth = perDay * 30;
  const cpuMsPerMonth = (m.cpu_ms / days) * 30;
  const pct = (x, of) => Math.round((x / of) * 10000) / 100;
  return {
    requests_per_day: Math.round(perDay),
    projected_requests_per_month: Math.round(reqPerMonth),
    projected_cpu_ms_per_month: Math.round(cpuMsPerMonth),
    mean_cpu_ms_per_request: Math.round((m.cpu_ms / m.requests) * 1000) / 1000,
    projected_egress_gb_per_month: Math.round(((m.egress_bytes / days) * 30 / 1e9) * 100) / 100,
    // Share of what the paid plan already includes for its $5.00 minimum.
    percent_of_paid_included_requests: pct(reqPerMonth, m.plan.paid_included_requests_per_month),
    percent_of_paid_included_cpu: pct(cpuMsPerMonth, m.plan.paid_included_cpu_ms_per_month),
    // Both inside the allowance means the metered charge is zero; overage only starts above it.
    usage_charge_on_existing_paid_plan_usd:
      reqPerMonth <= m.plan.paid_included_requests_per_month
      && cpuMsPerMonth <= m.plan.paid_included_cpu_ms_per_month ? 0 : null,
    percent_of_free_daily_requests: pct(perDay, m.plan.free_requests_per_day),
    // The free plan's ceiling is per INVOCATION, so daily request volume is not what rules it out:
    // the CPU maximum is. Measured rather than reasoned about — see cpu_ms_max above.
    free_plan_viable: false,
    free_plan_cpu_overshoot_factor: Math.round((m.cpu_ms_max / m.plan.free_cpu_ms_per_invocation) * 10) / 10,
    free_plan_blocker:
      `The heaviest single request in the window cost ${m.cpu_ms_max} ms of CPU, `
      + `${Math.round((m.cpu_ms_max / m.plan.free_cpu_ms_per_invocation) * 10) / 10}x the free plan's `
      + `${m.plan.free_cpu_ms_per_invocation} ms per-invocation ceiling, and all `
      + `${m.days_in_window_exceeding_free_ceiling} of the ${days} days had at least one request over it. `
      + `On ${m.days_in_window_with_p99_exceeding_free_ceiling} of those days the 99th percentile was over `
      + 'it as well, so more than one caller in a hundred would have been affected. Such a request gets '
      + "Cloudflare's own error page (1102, exceeded resource limits) instead of a badhttp response, which "
      + 'for a service whose whole product is answering exactly as documented is a correctness failure, not '
      + 'a cost saving. Which endpoints these are is not measured — Cloudflare publishes no per-path CPU — '
      + 'but the ones built to be expensive (/compress/bomb inflates up to 32 MiB, /compress and /range at '
      + 'their megabyte maxima) are the candidates, and they are the product rather than an accident.',
    // The two answers, both true, to two different questions. Hosting only — the domain is a
    // separate line and is the same in both, so naming these "hosting" keeps them from reading
    // as all-in totals.
    standalone_hosting_usd_per_year: Math.round((m.plan.paid_min_usd_per_month * 12) * 100) / 100,
    incremental_hosting_usd_per_year: 0,
  };
}

/**
 * Assets on hand against the next hard bill. `payerUsdc` is the live chain read (a number) or null
 * when every RPC failed — in which case the whole line degrades rather than quietly using a stale
 * constant, because a solvency claim resting on an unavailable number is worse than no claim.
 */
export function solvency(b = BOOKS, payerUsdc = null, now = new Date()) {
  const s = b.solvency;
  const earned = b.revenue.reduce((sum, r) => sum + r.amount, 0);
  const next = (b.commitments || [])
    .filter((c) => c.due >= now.toISOString().slice(0, 10))
    .sort((x, y) => (x.due < y.due ? -1 : 1))[0] || null;
  // Six decimal places, not two: USDC has six, and rounding an ASSET to cents rounds it UP half
  // the time — 9.965 would publish as 9.97 and the shortfall would shrink by half a cent. These
  // books may be wrong, but never in the direction that flatters them.
  const round = (n) => Math.round(n * 1e6) / 1e6;
  const credit = s.registrar_credit_usd;
  const assets = payerUsdc === null ? null : round(payerUsdc + credit);
  const days = next
    ? Math.round((Date.parse(`${next.due}T00:00:00Z`) - now.getTime()) / 86400000)
    : null;
  return {
    payer_address: s.payer_address,
    payer_usdc: payerUsdc === null ? null : round(payerUsdc),
    payer_note: s.payer_note,
    registrar_credit_usd: credit,
    registrar_credit_dated: s.registrar_credit_dated,
    registrar_credit_note: s.registrar_credit_note,
    assets_on_hand_usd: assets,
    next_bill: next ? { due: next.due, item: next.item, amount: next.amount } : null,
    days_until_next_bill: days,
    // Positive = short by this much. Null when the chain read failed.
    shortfall_usd: assets === null || !next ? null : round(Math.max(0, next.amount - assets)),
    covers_next_bill: assets === null || !next ? null : assets >= next.amount,
    conversion_rail: s.conversion_rail,

    // The split that keeps this section from flattering the project, added the same session the
    // section shipped after two independent reviewers caught it. Everything above nets the
    // operator's working capital against the bill and reports a $1.66 gap — arithmetically true,
    // and it reads as "a service 87% of the way to paying its own way". It is not: $9.965 of that
    // is money the operator LENT the project and $1.25 is credit they bought. What the project has
    // earned, from anyone other than itself, in its entire existence, is one cent.
    //
    // "Self-sustaining" is a question about the earned column and nothing else, so it is answered
    // from the earned column, and the combined figure keeps its place below as a different and
    // clearly-labelled fact: how long the runway lasts on borrowed capital.
    earned_to_date_usd: round(earned),
    operator_funded_on_hand_usd: assets === null ? null : assets,
    covers_next_bill_from_earnings: next ? earned >= next.amount : null,
    earned_share_of_next_bill_percent: next ? Math.round((earned / next.amount) * 10000) / 100 : null,
    what_this_means:
      'Self-sustainability is a claim about money earned from other people. This project has earned '
      + `$${round(earned).toFixed(2)} since ${b.project_started}. The assets above are almost entirely the `
      + 'operator\'s: working capital they sent the project and registrar credit they bought. Netting '
      + 'the two produces a small-looking gap and a misleading impression, so the two are reported '
      + 'separately and the self-sustainability question is answered from the earned figure alone.',
  };
}

/**
 * funding.json (fundingjson.org v1.1.0), served at /funding.json and vouched for by
 * /.well-known/funding-manifest-urls.
 *
 * Why this exists, since a funding manifest on a project earning $0.01 could otherwise read as
 * wishful: session 21's research established that no free HTTP-testing utility has ever been
 * sustained by its users — icanhazip took $75 in donations across twelve years at 30-35 billion
 * requests a day — and that every healthy service in this niche is on some employer's or investor's
 * balance sheet. Grant-style funding is the only rail anyone has cleared, and this is its
 * machine-readable front door, in the same idiom as /openapi.json and /llms.txt.
 *
 * Two deliberate omissions, both honest rather than tactical. `projects[]` is absent because the
 * schema requires a `repositoryUrl` on every entry and this project's repository is private; a
 * manifest is not the place to imply otherwise. And the amounts below are the REAL ones — the
 * annual requirement of this service is under twenty dollars, and saying so is more useful to a
 * funder than a number chosen to look fundable.
 */
export function fundingManifest(origin, b = BOOKS) {
  const renewal = (b.commitments || []).find((c) => c.item.includes('renewal'));
  const domain = renewal ? renewal.amount : 12.87;
  const standalone = Math.round(b.hosting.rate_usd_per_month * 12 * 100) / 100;
  return {
    version: 'v1.1.0',
    entity: {
      type: 'group',
      role: 'owner',
      name: 'badhttp',
      email: 'ops@badhttp.dev',
      description:
        'badhttp.dev is a free, stateless catalogue of documented HTTP edge-case behaviours for '
        + 'testing HTTP clients, SDKs and agents: status codes, redirects, truncated and malformed '
        + 'bodies, Server-Sent Events, range and conditional requests, Set-Cookie edge cases, HTTP '
        + 'authentication, content codings, and x402 paywalls that misbehave on purpose. Everything '
        + 'it emits is CC0-1.0 public domain, including /corpus.jsonl (one row per documented '
        + 'defect, with a ready-to-run capture command) and /clients.jsonl (dated observations of '
        + 'how eight real HTTP clients diverge on the same responses). It is operated by an AI '
        + 'under a published charter; a human funds it and holds the credentials. Its accounts are '
        + `public and reconciled against chain at ${origin}/books. The source repository is not `
        + 'public, which is why no projects[] entry appears below — the schema requires a '
        + 'repository URL and this manifest will not imply one that does not exist.',
      webpageUrl: { url: `${origin}/`, wellKnown: `${origin}/.well-known/funding-manifest-urls` },
    },
    funding: {
      channels: [
        {
          guid: 'usdc-base',
          type: 'other',
          address: b.receive_address,
          description:
            'USDC on Base (chain id 8453), by direct transfer or x402. This is the only rail the '
            + 'operating AI can use end to end without a human identity. Every receipt appears in '
            + `the public chain reconciliation at ${origin}/books within minutes and is booked as `
            + 'revenue. The project holds no key that can spend from this address.',
        },
      ],
      plans: [
        {
          guid: 'keep-it-online',
          status: 'active',
          name: 'Keep badhttp.dev online for a year',
          description:
            `The whole annual requirement. $${domain.toFixed(2)} is the domain renewal, which is the `
            + 'only cash that must change hands; hosting is a Cloudflare Workers Paid plan whose '
            + "included allowance this service uses under 1% of, so it adds nothing to a bill that "
            + `already exists — though standing alone it would pay that plan's $${standalone.toFixed(2)}/year `
            + `floor, because its heaviest requests exceed the free plan's per-invocation CPU limit. `
            + `Both figures, and the measurement behind them, are published at ${origin}/books.`,
          amount: Math.ceil(domain + standalone),
          currency: 'USD',
          frequency: 'yearly',
          channels: ['usdc-base'],
        },
        {
          guid: 'domain-only',
          status: 'active',
          name: 'Cover the domain renewal',
          description:
            `The minimum that keeps the service reachable: one year of badhttp.dev, due `
            + `${renewal ? renewal.due : '2027-08-23'}. As of the last reading the project holds most of `
            + `this already and is short by a small amount; ${origin}/books states the exact gap and `
            + 'reads the balance from chain rather than asserting it.',
          amount: Math.ceil(domain),
          currency: 'USD',
          frequency: 'yearly',
          channels: ['usdc-base'],
        },
      ],
    },
  };
}

export function totals(b = BOOKS, now = new Date()) {
  const months = hostingMonths(b, now);
  const hosting = Math.round(months * b.hosting.rate_usd_per_month * 100) / 100;
  const itemized = b.costs.reduce((s, c) => s + c.amount, 0);
  const costs = Math.round((itemized + hosting) * 100) / 100;
  const revenue = b.revenue.reduce((s, r) => s + r.amount, 0);
  return {
    costs,
    revenue,
    net: Math.round((revenue - costs) * 100) / 100,
    hosting_accrued: hosting,
    hosting_months: months,
    next_accrual: nextAccrual(b, now),
    itemized_costs: Math.round(itemized * 100) / 100,
  };
}
