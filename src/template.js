// Path templates, requested literally. Agents and registry probers copy OpenAPI path templates
// like /sse/{flavor} into requests without substituting them — ~600 times a day from x402 ecosystem
// monitors within two days of being listed (2026-08-25), and 285/312/314 a day across all thirteen
// templates /openapi.json publishes, on 2026-09-05/06/07 — re-measured because the first figure had
// been sitting on the home page in the present tense for two weeks. (Brace shapes the spec does not
// publish drew 0/10/14 those days: /402/pay/{network}, which this file answers, and /nope{x} and
// /sse/{flavor}/x, which correctly 404.) A 404 teaches them nothing and reads
// as "broken" in their catalogues, so a URL whose {braces} arrive intact answers 200 with the
// menu of values that belong in them. Any method except OPTIONS (the router answers that first,
// 204 with Allow, as everywhere): the resource at a template URL is its own documentation.
// Only the documented template shapes match; /nope/{x} stays a 404.

const brace = (s) => typeof s === 'string' && /^\{[^{}]*\}$/.test(s);

const abouts = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v.about]));

const FAMILIES = ['status', 'delay', 'flaky', 'redirect', 'badjson', 'sse', 'range', 'etag', 'cookies', 'auth', 'compress', 'crosshost', '402'];

// Shape test only, no response: the router's OPTIONS branch uses it to widen Allow.
export function matchesTemplate(seg) {
  if (seg.length === 2 && brace(seg[1])) return FAMILIES.includes(seg[0]);
  return seg.length === 3 && seg[0] === '402' && (seg[1] === 'broken' || seg[1] === 'pay') && brace(seg[2]);
}

export function templateExplainer({ seg, url, json, catalog }) {
  if (!seg.some(brace)) return null;
  const { limits, x402Limits, badjson, sse, range, etag, cookies, auth, compress, crosshost, scenarios, broken } = catalog;
  const o = url.origin;
  const explain = ({ template, param, valid, values, examples, index, see_also }) =>
    json({
      template,
      note: `This URL matches the path template ${template} with its placeholder unsubstituted. A template names a family, not an endpoint: fill in {${param}} as described below and request that URL instead.`,
      param,
      ...(valid ? { valid } : {}),
      ...(values ? { values } : {}),
      examples: examples.map((e) => o + e),
      ...(see_also ? { see_also: Object.fromEntries(Object.entries(see_also).map(([k, v]) => [k, o + v])) } : {}),
      docs: { ...(index ? { index: o + index } : {}), openapi: `${o}/openapi.json`, guidance: `${o}/llms.txt` },
    });

  const [a, b, c] = seg;
  if (seg.length === 2 && brace(b)) {
    switch (a) {
      case 'status':
        return explain({ template: '/status/{code}', param: 'code', valid: 'an integer 200-599, or a comma-separated list to pick from at random; ?retry-after= adds the header', examples: ['/status/429?retry-after=3', '/status/200,500,503'] });
      case 'delay':
        return explain({ template: '/delay/{seconds}', param: 'seconds', valid: `a number of seconds, 0-${limits.delayMaxSeconds}, decimals allowed`, examples: ['/delay/2', '/delay/0.5'] });
      case 'flaky':
        return explain({ template: '/flaky/{percent}', param: 'percent', valid: 'an integer failure percentage, 0-100; ?fail= sets the failure status, ?seed=&i= makes the sequence deterministic', examples: ['/flaky/50', '/flaky/70?seed=ci&i=0'] });
      case 'redirect':
        return explain({ template: '/redirect/{hops}', param: 'hops', valid: `an integer 0-${limits.redirectMaxHops}, or "loop" for a redirect that never ends; ?code= picks 301, 302, 303, 307 or 308`, examples: ['/redirect/3', '/redirect/loop'] });
      case 'badjson':
        return explain({ template: '/badjson/{flavor}', param: 'flavor', values: abouts(badjson), examples: ['/badjson/trailing-comma', '/badjson/html?code=502'], index: '/badjson' });
      case 'sse':
        return explain({ template: '/sse/{flavor}', param: 'flavor', values: abouts(sse), examples: ['/sse/ok', '/sse/split-utf8'], index: '/sse' });
      case 'range':
        return explain({ template: '/range/{flavor}', param: 'flavor', values: abouts(range), examples: ['/range/ok?length=512', '/range/shifted'], index: '/range' });
      case 'etag':
        return explain({ template: '/etag/{flavor}', param: 'flavor', values: abouts(etag), examples: ['/etag/ok', '/etag/mismatch'], index: '/etag' });
      case 'cookies':
        return explain({ template: '/cookies/{flavor}', param: 'flavor', values: abouts(cookies), examples: ['/cookies/ok', '/cookies/echo'], index: '/cookies' });
      case 'auth':
        return explain({ template: '/auth/{flavor}', param: 'flavor', values: abouts(auth), examples: ['/auth/basic', '/auth/none'], index: '/auth' });
      case 'compress':
        return explain({ template: '/compress/{flavor}', param: 'flavor', values: abouts(compress), examples: ['/compress/ok', '/compress/mismatch'], index: '/compress' });
      case 'crosshost':
        return explain({ template: '/crosshost/{flavor}', param: 'flavor', values: abouts(crosshost), examples: ['/crosshost/same-origin', '/crosshost/to-subdomain'], index: '/crosshost' });
      case '402': {
        const misbehaving = Object.fromEntries(Object.entries(scenarios).filter(([k]) => k !== 'pay' && k !== 'broken').map(([k, v]) => [k, v.about]));
        return explain({ template: '/402/{scenario}', param: 'scenario', values: misbehaving, examples: ['/402/never', '/402/reject?reason=expired'], index: '/402', see_also: { the_one_that_settles: '/402/pay', malformed_402s: '/402/broken' } });
      }
    }
    return null;
  }
  if (seg.length === 3 && a === '402' && b === 'broken' && brace(c)) {
    return explain({ template: '/402/broken/{flavor}', param: 'flavor', values: abouts(broken), examples: ['/402/broken/no-accepts', '/402/broken/decimal-amount'], index: '/402/broken' });
  }
  if (seg.length === 3 && a === '402' && b === 'pay' && brace(c)) {
    return explain({ template: '/402/pay/{network}', param: 'network', values: { 'base-sepolia': `test USDC on Base Sepolia, free (what the bare /402/pay offers); price ${x402Limits.minUsd}-${x402Limits.maxUsd} USD via ?amount=`, 'base': 'real USDC on Base mainnet; the payment is this site\'s revenue, booked at /books' }, examples: ['/402/pay/base-sepolia', '/402/pay/base'], index: '/402' });
  }
  return null;
}
