import type { ScriptedConversation } from './types';

export const SCRIPTED_CONVOS: ScriptedConversation[] = [
  {
    id: 'demo-refactor',
    title: 'Refactor the Shopify cron from Python → TypeScript',
    folder: 'Engineering',
    pinned: true,
    ageHours: 0.4,
    turns: [
      { role: 'user',
        text: 'We have a 60-line Python cron that pulls Shopify orders, computes daily revenue per SKU, and writes to Postgres. Port it to TypeScript with proper types, drizzle-orm, and use the official Shopify Admin SDK. Use async/await, not callbacks.' },
      { role: 'assistant', brain: 'nandai', underlying: 'think',
        statuses: [
          { kind: 'thinking', ms: 1300, note: 'classifier picked think · weighing types vs runtime tradeoffs' },
          { kind: 'reflecting', ms: 900, note: 'comparing drizzle vs prisma · drizzle wins on bundle size' },
          { kind: 'generating', ms: 700 },
        ],
        thinking: 'The Python source mixes I/O with computation. In TS I should split into three layers: (1) `fetchOrders` returns a typed array, (2) `aggregateBySku` is pure, (3) `persist` is the only I/O on the write side. That makes the cron unit-testable. Drizzle over Prisma because we already have a Postgres schema and Drizzle\'s typed inserts mean we never have to write a migration runner. Cron scheduler: keep node-cron, but the actual logic should be a default export so a serverless wrapper can call it without spinning the scheduler.',
        text:
`Done. Three-file refactor, ~140 lines, fully typed, no \`any\`. Cron entrypoint is a default-export function so you can also call it from a Vercel cron or a GitHub Action.

**Layout**

  \`\`\`
  src/jobs/shopify-revenue/
    ├── fetchOrders.ts     // Shopify Admin SDK → typed rows
    ├── aggregate.ts       // pure: orders → SKU buckets
    ├── persist.ts         // Drizzle inserts into daily_sku_revenue
    └── index.ts           // entrypoint (run via node-cron OR vercel/cron)
  \`\`\`

Highlights worth flagging:

  1. **Type-safe Shopify rows** — generated from the SDK types, no hand-rolled interfaces.
  2. **Drizzle batched insert** — single round-trip to Postgres regardless of SKU count.
  3. **Idempotent** — uses (\`date\`, \`sku\`) as the conflict key and \`ON CONFLICT DO UPDATE\`.
  4. **Observable** — emits structured logs and an OpenTelemetry span per phase.

Artifact pane has the full TypeScript file. Want me to add Vitest tests for \`aggregate\` next?`,
        artifact: {
          kind: 'code',
          lang: 'typescript',
          title: 'src/jobs/shopify-revenue/index.ts',
          body:
`import { createAdminApiClient } from '@shopify/admin-api-client';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { dailySkuRevenue } from '@/db/schema';
import { fetchOrders, type ShopifyOrder } from './fetchOrders';
import { aggregateBySku, type SkuBucket } from './aggregate';
import { persistBuckets } from './persist';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

const shopify = createAdminApiClient({
  storeDomain: process.env.SHOPIFY_STORE_DOMAIN!,
  accessToken: process.env.SHOPIFY_ADMIN_TOKEN!,
  apiVersion: '2025-04',
});

export default async function runShopifyRevenueJob(forDate = new Date()) {
  const start = performance.now();
  // 1. fetch
  const orders: ShopifyOrder[] = await fetchOrders(shopify, forDate);
  // 2. aggregate (pure)
  const buckets: SkuBucket[] = aggregateBySku(orders, forDate);
  // 3. persist (single round-trip)
  await persistBuckets(db, buckets);

  const durMs = Math.round(performance.now() - start);
  console.log(JSON.stringify({
    job: 'shopify-revenue',
    date: forDate.toISOString().slice(0, 10),
    orders: orders.length,
    skus: buckets.length,
    durationMs: durMs,
  }));
}

if (import.meta.url === \`file://\${process.argv[1]}\`) {
  runShopifyRevenueJob().catch((err) => {
    console.error('[shopify-revenue] FAILED', err);
    process.exit(1);
  });
}`,
        },
        followups: [
          'Add Vitest tests for aggregate.ts',
          'Show fetchOrders.ts',
          'Wire to a Vercel cron job',
          'Add a Slack alert on failure',
        ],
        tokens: { prompt: 412, completion: 686 },
        latencyMs: 4180,
        costUsd: 0,
      },
    ],
  },

  {
    id: 'demo-inventory',
    title: 'Polki SKUs shipping before Dec 10?',
    folder: 'Atelier',
    pinned: true,
    ageHours: 2.1,
    turns: [
      { role: 'user',
        text: 'Which Polki pieces in stock can ship before Dec 10? Include karigar availability and a soft-reservation note.' },
      { role: 'assistant', brain: 'nandai', underlying: 'tool',
        statuses: [
          { kind: 'thinking', ms: 600, note: 'classified · 3 tools likely' },
          { kind: 'tool-calling', ms: 1500, note: 'shopify.inventory · karigar.schedule · ship.estimate' },
          { kind: 'generating', ms: 600 },
        ],
        toolCalls: [
          { name: 'shopify.inventory.list', args: { collection: 'Polki', in_stock: true },
            result: { count: 3, skus: ['NAN-POL-008', 'NAN-POL-031', 'NAN-POL-019'] }, durationMs: 412 },
          { name: 'karigar.schedule.window', args: { from: '2025-11-25', to: '2025-12-07', skill: 'jadau' },
            result: { available: ['Mahaveer Ji', 'Sundar Singh'], booked: ['Ravi Ji'] }, durationMs: 248 },
          { name: 'shipping.estimate.bulk', args: { skus: ['NAN-POL-008', 'NAN-POL-031', 'NAN-POL-019'], dest_pin: '110017' },
            result: { 'NAN-POL-008': '2025-12-07', 'NAN-POL-031': '2025-12-05', 'NAN-POL-019': '2025-12-09' }, durationMs: 538 },
        ],
        text:
`Three Polki SKUs are eligible, sir. Two have a comfortable buffer; one cuts it close.

  1. **NAN-POL-031 · Mehr Polki Cocktail Ring** — ships **Dec 5**, ~5-day buffer to your Dec 10 ceremony. ₹54,600.
  2. **NAN-POL-008 · Surya Polki Maang Tikka** — ships **Dec 7**, 3-day buffer. ₹96,500.
  3. **NAN-POL-019 · Antara Polki Pendant** — ships **Dec 9**, cuts it fine. Recommend only if courier window confirms morning delivery on Dec 10. ₹78,200.

Karigars Mahaveer Ji and Sundar Singh are both free in the working window — Ravi Ji is booked. I have *not* soft-reserved any pieces; say the word and I will lock 1 + 2 for 24 hours.`,
        artifact: {
          kind: 'json',
          title: 'ship-window · polki · dec10',
          body:
`{
  "query_window": "2025-12-01 → 2025-12-10",
  "destination_pin": "110017",
  "candidates": [
    { "sku": "NAN-POL-031", "name": "Mehr Polki Cocktail Ring",
      "price_inr": 54600, "ships_by": "2025-12-05", "buffer_days": 5 },
    { "sku": "NAN-POL-008", "name": "Surya Polki Maang Tikka",
      "price_inr": 96500, "ships_by": "2025-12-07", "buffer_days": 3 },
    { "sku": "NAN-POL-019", "name": "Antara Polki Pendant",
      "price_inr": 78200, "ships_by": "2025-12-09", "buffer_days": 1, "risk": "morning_delivery_required" }
  ],
  "karigar_pool": { "available": ["Mahaveer Ji", "Sundar Singh"], "booked": ["Ravi Ji"] },
  "soft_reserved": false
}`,
        },
        followups: [
          'Soft-reserve NAN-POL-031 + NAN-POL-008 for 24 h',
          'Add matching Meenakari earrings',
          'Compare against a ₹1.5L upper budget',
        ],
        tokens: { prompt: 287, completion: 414 },
        latencyMs: 2820,
        costUsd: 0,
      },
    ],
  },

  {
    id: 'demo-deepseek',
    title: 'Why does DeepSeek V4 fail on Ampere?',
    folder: 'Research',
    pinned: false,
    ageHours: 18.6,
    turns: [
      { role: 'user',
        text: 'Walk me through, in two paragraphs and one citation list, why DeepSeek V4 Flash will not run on RTX 3090s. I want the exact compute capability gate that breaks the build.' },
      { role: 'assistant', brain: 'opus', underlying: 'escape',
        statuses: [
          { kind: 'thinking', ms: 1100, note: 'routing escalation · this is a depth-bound query · escape lane' },
          { kind: 'researching', ms: 1500, note: 'reading 6 sources · deepgemm headers · vLLM PR 8412' },
          { kind: 'generating', ms: 1100 },
        ],
        thinking:
`The user has been told "it won't run" three times but wants the actual gate. Two layers to disentangle: (a) the Hyper-Connections op DeepSeek added in V4, (b) which CUDA arch the corresponding DeepGEMM kernel requires. The gate is in csrc/apis/hyperconnection.hpp at line 56 — the static assert fires if SM < 89. RTX 3090 / 3090 Ti are SM_86 (Ampere). That's the proximate cause. The deeper cause is that the kernel uses Hopper-only TMA + the WMMA path was rewritten for Ada in early 2025.

Also worth surfacing: VLLM_USE_DEEP_GEMM=0 is *not* a valid escape because the Hyper-Connection path is mandatory for the MLA attention layer; turning off DeepGEMM only routes around the GEMM fast-path, the attention layer still hits the same template instantiation.

So: the only realistic fixes are (1) 2× RTX 4090 (SM_89), (2) wait for the community to back-port to Ampere (slow), or (3) skip V4, run a smaller model that already works (Qwen 3.6 27B).`,
        text:
`Two paragraphs, then sources.

DeepSeek V4 Flash ships a custom op called **Hyper-Connections**, which the model uses inside its MLA attention layer. The kernel is implemented in DeepGEMM and lives in \`csrc/apis/hyperconnection.hpp\`. Line 56 of that header is a \`static_assert(__CUDA_ARCH__ >= 890, ...)\` — a hard compile-time gate that requires **compute capability 8.9 (SM_89, Ada Lovelace)** or newer. The RTX 3090 and RTX 3090 Ti are both **SM_86 (Ampere)**, so the file refuses to compile against the 3090 toolchain. This is not a "performance regression" — the kernel literally will not produce a binary.

You can't escape the gate by passing \`VLLM_USE_DEEP_GEMM=0\`, because Hyper-Connections is required for MLA attention; turning off DeepGEMM only disables the fast GEMM path, not the attention template. Three independent engines (cchuter llama.cpp, ktransformers, vLLM 0.20.2) hit the same wall during cutover testing. The practical paths forward are: 2× RTX 4090 (SM_89, ~$3.2k); wait for a community back-port to Ampere; or skip V4 entirely and keep running Qwen 3.6 27B, which already matches V4 on most non-MoE workloads.

**Sources**

  1. DeepSeek-V4 release notes — *github.com/deepseek-ai/V4*
  2. DeepGEMM kernel — \`csrc/apis/hyperconnection.hpp:56\`
  3. vLLM PR #8412 — "Skip Hopper-only path on Ampere" (closed, declined)
  4. ktransformers issue #1183 — same SM_89 assert
  5. cchuter/llama.cpp issue #6741 — confirms compilation failure on 3090
  6. Internal: \`project_v4_dead_on_ampere_2026may14.md\` — Nandai's own cutover post-mortem`,
        artifact: {
          kind: 'mermaid',
          title: 'V4 build gate · failure flowchart',
          body:
`flowchart TD
  A["Run DeepSeek V4 Flash on 3090"] --> B{"Compile hyperconnection.hpp"}
  B -- "static_assert SM >= 89 fails" --> C["Build error: SM_86 detected"]
  C --> D{"Can we disable DeepGEMM?"}
  D -- "VLLM_USE_DEEP_GEMM=0" --> E["GEMM bypassed - attention still uses Hyper-Connection"]
  E --> F["Still fails: template instantiated in MLA layer"]
  D -- "No" --> F
  F --> G{"Workable paths"}
  G --> H["1. Buy 2x RTX 4090 (SM_89)"]
  G --> I["2. Wait for community Ampere back-port"]
  G --> J["3. Skip V4 - run Qwen 3.6 27B instead"]
  J -. "Nandai chose this" .-> K["Trinity stack live since 2026-05-15"]`,
        },
        followups: [
          'Show the 2× 4090 BOM and rack delta',
          'How big is the Ampere back-port effort?',
          'Compare Qwen 3.6 27B vs DeepSeek V4 on AIME / SWE-bench',
        ],
        tokens: { prompt: 528, completion: 1041 },
        latencyMs: 6240,
        costUsd: 0.0188,
      },
    ],
  },

  {
    id: 'demo-mermaid-router',
    title: 'Diagram the Trinity routing flow',
    folder: 'Engineering',
    pinned: false,
    ageHours: 28,
    turns: [
      { role: 'user',
        text: 'Give me a Mermaid flowchart of the Trinity routing: how a user prompt picks fast vs think vs tool vs escape, with the classifier in the middle.' },
      { role: 'assistant', brain: 'nandai', underlying: 'fast',
        statuses: [
          { kind: 'thinking', ms: 500 },
          { kind: 'generating', ms: 700 },
        ],
        text:
`Diagram in the artifact pane — open Preview to see it render.

The classifier is intentionally tiny (a regex + tag-vote, not an LLM): mis-routes are cheap because Hermes can answer anything the others can, just slower.`,
        artifact: {
          kind: 'mermaid',
          title: 'trinity.routing.v1',
          body:
`flowchart LR
  U["User prompt"] --> C{"Classifier - regex + tag vote"}
  C -- "short / draft" --> F["nandai-fast (Qwen 3.6 27B)"]
  C -- "reasoning / refactor" --> T["nandai-think (Hermes 4.3 36B)"]
  C -- "tool needed" --> L["nandai-tool (ToolACE-2 8B)"]
  C -- "hard agentic chain" --> E["nandai-escape (Opus 4.7)"]
  F --> R(("Reply"))
  T --> R
  L --> R
  E --> R
  R --> A["Artifact pane (code, json, mermaid, html)"]`,
        },
        followups: [
          'Now show the same as a sequence diagram',
          'How does the classifier decide between think and escape?',
          'Add the LiteLLM gateway in the middle',
        ],
        tokens: { prompt: 96, completion: 158 },
        latencyMs: 1410,
        costUsd: 0,
      },
    ],
  },

  {
    id: 'demo-html-card',
    title: 'Generate a luxury card component (HTML)',
    folder: 'Atelier',
    pinned: false,
    ageHours: 47,
    turns: [
      { role: 'user',
        text: 'Generate a self-contained HTML+CSS "atelier card" I can drop into our Shopify theme. Burgundy + gold. Should render a product image, SKU, INR price, and an "Ask atelier" pill.' },
      { role: 'assistant', brain: 'nandai', underlying: 'fast',
        statuses: [
          { kind: 'thinking', ms: 400 },
          { kind: 'generating', ms: 900 },
        ],
        text:
`Single HTML file, no external CSS, no JS. Drops in to a Shopify section as a snippet. Open Preview to see it live.`,
        artifact: {
          kind: 'html',
          title: 'atelier-card.html',
          body:
`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  body { background: #1a0e0a; margin: 0; padding: 32px; font-family: ui-serif, Georgia, serif; }
  .card {
    width: 320px; background: #fbf5e9; border-radius: 18px; overflow: hidden;
    box-shadow: 0 1px 0 rgba(255,200,120,0.5) inset, 0 20px 50px -20px rgba(0,0,0,0.6);
  }
  .card img { width: 100%; height: 380px; object-fit: cover; display: block; }
  .body { padding: 20px 22px 24px; color: #1a0e0a; }
  .chip { display: inline-block; font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase;
          background: #f0e6d3; padding: 4px 10px; border-radius: 999px; }
  h3   { margin: 8px 0 4px; font-size: 22px; font-weight: 500; line-height: 1.1; }
  .sku { font-family: ui-monospace, monospace; font-size: 11px; color: #6b4f3a; }
  .row { display: flex; align-items: end; justify-content: space-between; margin-top: 14px; }
  .price { font-size: 22px; color: #722f37; font-weight: 500; }
  .ask  { background: #722f37; color: #fbf5e9; border: none; border-radius: 999px;
          padding: 10px 16px; font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; cursor: pointer; }
  .ask:hover { background: #5a2229; }
</style>
</head>
<body>
  <article class="card">
    <img alt="Surya Polki Maang Tikka"
         src="https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=900&q=70" />
    <div class="body">
      <span class="chip">Polki · 22kt gold</span>
      <h3>Surya Polki Maang Tikka</h3>
      <span class="sku">NAN-POL-008</span>
      <div class="row">
        <span class="price">₹96,500</span>
        <button class="ask">Ask atelier</button>
      </div>
    </div>
  </article>
</body>
</html>`,
        },
        followups: [
          'Make it responsive on mobile',
          'Add a wishlist heart icon',
          'Give me the same in dark mode',
        ],
        tokens: { prompt: 124, completion: 296 },
        latencyMs: 1840,
        costUsd: 0,
      },
    ],
  },
];

export const QUICK_PROMPTS = [
  'Diagram the Trinity routing as Mermaid',
  'Refactor a Python cron into TypeScript',
  'Which Polki ships before Dec 10?',
  'Why does DeepSeek V4 fail on Ampere?',
  'Generate an atelier product card (HTML)',
  'Write a Vitest suite for the aggregator',
];

export const SLASH_COMMANDS: { cmd: string; desc: string }[] = [
  { cmd: '/clear',   desc: 'Clear the active conversation' },
  { cmd: '/model',   desc: 'Force a specific brain — fast | think | tool | escape | auto' },
  { cmd: '/system',  desc: 'Edit the system prompt for this conversation' },
  { cmd: '/export',  desc: 'Download the conversation as markdown' },
  { cmd: '/share',   desc: 'Create a read-only share link' },
  { cmd: '/web',     desc: 'Force a web-search-grounded reply' },
  { cmd: '/image',   desc: 'Generate an image via ComfyUI' },
  { cmd: '/think',   desc: 'Force the think brain to show its reasoning' },
];
