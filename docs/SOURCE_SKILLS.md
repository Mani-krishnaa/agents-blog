# SOURCE_SKILLS — Reference repositories for QA2Content

Status: Phase 0 research. Nothing from these repos has been copied into this project yet.
Inspected: 2026-10-01, shallow clones in a temp directory outside this workspace.

## 0. Summary

| # | Repo | Pinned commit | License | Role | Integration |
|---|------|---------------|---------|------|-------------|
| 1 | satnaing/astro-paper | `35cfa7f` (2026-08-05), v6.1.0 | MIT | Public blog/portfolio | **Use as template** (copy into `blog/`) |
| 2 | sergebulaev/linkedin-skills | `14d332b` (2026-09-29) | MIT | LinkedIn writing, audit, humanize, publish | **Adapt** (prompts + rules + ported Publora adapter) |
| 3 | affaan-m/ECC | `c70874f` (2026-09-29), v2.2.2 | MIT | Content, article, voice, video | **Cherry-pick 5-6 skills**, never install the whole thing |
| 4 | JimLiu/baoyu-skills | `1567581` (2026-09-10) | MIT | Diagrams, covers, slide decks | **Cherry-pick 2-4 skills**, one wrapped, rest as method references |

Full SHAs are recorded in `vendor/skill-sources.lock.json` once Phase 1 starts:

- astro-paper `35cfa7fbe0b897306d27670d3819e55d5205f3dd`
- linkedin-skills `14d332b9e91e314f2e35b299246ced6df2594fab`
- ECC `c70874fae9eb0e5ad0365beb7e2955899fd1d30f`
- baoyu-skills `1567581c26ec29f4216c6e6835415bf30343b0e3`

### Cross-cutting findings (these change the design)

1. **All four "skill" repos are LLM playbooks, not libraries.** A `SKILL.md` is instructions an interactive agent (Claude Code, Codex) follows. They assume a human in the loop (`AskUserQuestion`), and some assume `bun` or `npx bun`. QA2Content is its own application with its own LLM client, so we cannot "call" a skill. We adapt the prompt and rule content into our own `skills/*/SKILL.md` + references, and implement the checkable parts (audit rules, privacy rules) as deterministic code.
2. **linkedin-skills' approval gate is a convention, not enforcement.** Its own `lib/approval.py` says: "thin conventions layer, not runtime enforcement". Our requirement (`PUBLIC_SAFE` AND `user_approved`, impossible to bypass) must be enforced in code, inside the publisher adapter. We cannot rely on the upstream pattern.
3. **linkedin-skills is tuned for reach, which conflicts with your "never invent" rule in specific places.** The humanizer's fingerprint pass says "add at least 1 specific number, 1 named entity, 1 first-person concrete detail per 100 words". The post writer requires "at least one moment of real vulnerability or concrete stakes". Both would push an LLM to fabricate. We **override** these: numbers/entities may only come from `evidence`, and vulnerability only if the source work supports it. Several hook formulas (odd-precision money ledger, comment-gate lead magnet, R.I.P. obituary) are growth tactics, not technical writing. We use only compatible ones.
4. **Its engagement statistics are mostly vendor data** (it labels them `[vendor]` itself). We use the rules as heuristics, not as truth.
5. **The repo gives WHAT changed; only you know WHY it was hard and what you learned.** Your spec asks the system to capture "what was difficult / what was learned". That cannot be read from a diff. linkedin-skills' `linkedin-interviewer` + Story Bank concept fits exactly: a short Q&A step per work item. We add it (Phase 2).
6. **Third-party image/publish services are a data-exfiltration path.** baoyu image generation sends prompts to OpenAI/Google/etc. Publora's `mediaUrls` takes URLs, so media must be publicly hosted before publish. Both are acceptable only *after* the privacy gate and (for publish) *after* approval. Detailed in `ARCHITECTURE.md` §8.

---

## 1. satnaing/astro-paper — blog / portfolio

- **URL:** https://github.com/satnaing/astro-paper
- **Purpose:** Minimal, accessible, SEO-friendly Astro blog theme.
- **Version inspected:** 6.1.0. Requires **Node >= 22.12** (local Node is v24.18, OK). Package manager: pnpm (installed).

### Files inspected
`README.md`, `package.json`, `astro-paper.config.ts`, `astro.config.ts`, `src/content.config.ts`, `src/utils/postFilter.ts`, `src/pages/*` (index, about, posts, tags, search, rss.xml.ts, og.png.ts, robots.txt.ts), `src/components/*`, `src/layouts/*`, `src/content/posts/*`, `LICENSE`, `Dockerfile`.

### Facts that matter
- Stack: Astro 7, TypeScript, Tailwind 4, MDX (`@astrojs/mdx`), `@astrojs/rss`, `@astrojs/sitemap`, Pagefind static search, Satori+Sharp dynamic OG images, Shiki code highlighting with diff/highlight transformers, light/dark mode.
- Content: `src/content/posts/**/*.{md,mdx}`, with frontmatter schema in `src/content.config.ts`: `title`, `description`, `pubDatetime` (required), `author`, `modDatetime`, `featured`, `draft`, `tags` (default `["others"]`), `ogImage`, `canonicalURL`, `timezone`.
- **Drafts and scheduling are built in:** `draft: true` is always excluded; future `pubDatetime` is hidden in production. This maps directly onto our approval workflow (see below).
- Site config is a single typed file `astro-paper.config.ts` (site URL, title, author, socials, features).
- Build: `astro check && astro build && pagefind --site dist && cp -r dist/pagefind public/`. Output is static `dist/`. Vercel-compatible without an adapter.
- README names Cloudflare Pages as the default host; Vercel works the same for static output.
- Tags page exists, so "Playwright", "Automation", "QA/SDET" can be tags with no new code.

### What we will use
- The theme as the foundation of `blog/`, created from the template at Phase 4 (not earlier).
- Posts collection, tags, RSS, sitemap, OG image generation, Pagefind search, MDX.
- `draft: true` as the "not approved" state; the agent writes `draft: false` only for approved articles.

### What we will add (AstroPaper does not have these)
- `Projects` page and `Contact` page (spec requires them).
- Nav changes: Home, About, Projects, Articles, QA/SDET, Playwright, Automation, Contact. Category pages are tag-filtered views.

### What we will not use
- Giscus/comments, LaTeX, i18n variants, the sample posts (removed), Cloudflare config.

### Integration approach
- **Copy, don't submodule.** AstroPaper is a template meant to be forked. `blog/` becomes our own project. Upstream updates are merged by hand.
- Agent writes MDX/MD files into `blog/src/content/posts/`. **The agent never runs `git push` or `vercel deploy`.** Deploy only when you ask.

### Dependencies
Node >= 22.12, pnpm, Astro 7, Tailwind 4, sharp (native build), Pagefind, Satori.

### License
MIT (c) 2023 Sat Naing. Keep `LICENSE` in `blog/`. Remove the "AstroPaper" footer credit only if you want; the license only requires the copyright notice be preserved.

---

## 2. sergebulaev/linkedin-skills — LinkedIn content and publishing

- **URL:** https://github.com/sergebulaev/linkedin-skills
- **Purpose:** 12 skills that draft, audit, humanize, and (via Publora) publish LinkedIn posts/comments, with an approve-before-publish flow.

### Files inspected
`README.md`, `SKILL.md` (bundle), `AGENTS.md`, `SECURITY.md`, `skills/linkedin-post-writer/SKILL.md`, `skills/linkedin-humanizer/SKILL.md` + `sub-skills/{post-audit,illustration,voice-profile}.md`, `skills/linkedin-content-planner/SKILL.md`, `references/{voice-rules,hook-formulas,algorithm-heuristics,untrusted-content,story-bank,voice-profile}.md`, `lib/{approval,publora_client,backend_selector,_env}.py`, `requirements.txt`, `LICENSE`.

### The 12 skills and our decision

| Skill | Decision | Why |
|-------|----------|-----|
| linkedin-post-writer | **Adapt** | Core drafting workflow: pick formula by goal, draft, humanize, audit, approval card. Keep the process; replace growth-oriented parts (see cross-cutting #3). |
| linkedin-humanizer (rewrite) | **Adapt** | Vocabulary density scoring, reveal-bridge/staccato/triad rules, em-dash density cap, over-correction guard. Remove "inject numbers/hedges". |
| linkedin-humanizer `--mode audit` (post-audit) | **Adapt, partly as code** | Its blockers/warnings list is mostly mechanically checkable (char limit 3000, link in body, em-dash density, banned openers, hashtag count). We implement those as a deterministic linter with unit tests, and keep the judgment items for an LLM pass. |
| linkedin-humanizer `--mode profile` / voice-profile | **Adapt** | Build a voice profile from your own past posts. Reinforced by ECC `brand-voice`. |
| linkedin-interviewer (Story Bank) | **Adapt (Phase 2)** | Fills in the "why/difficulty/lesson" gap that code cannot supply. |
| linkedin-content-planner | **Reference only** (Phase 6) | Useful for the content calendar; pillars are marketing-oriented. |
| linkedin-repurposer | **Reference** (Phase 4) | Inverse direction of our post-to-article step, but the length/fold rules are reusable. |
| linkedin-comment-drafter, reply-handler, thread-monitor, engager-analytics, hook-extractor | **Not used** | Out of scope (commenting/engagement growth); they read other people's posts via Apify. |
| linkedin-profile-optimizer, employee-advocacy | **Not used** | Out of scope. |
| founder-topics reference | **Not used** | You are not positioning as a founder. |

### Publishing layer
- `lib/publora_client.py` is a ~330-line REST wrapper: `POST /create-post` (draft if no `scheduledTime`), `GET /get-post/<id>`, `DELETE /delete-post/<id>`, `GET /platform-connections`, header `x-publora-key`, retry on 408/429/5xx. Maps cleanly to our `LinkedInPublisher` interface (`createDraft`, `publishPost`, `getPostStatus`).
- **We port it to TypeScript as `PubloraAdapter`.** We do not use `backend_selector.py` (it contains a "manual/diy/publora" tier router and sign-up nudges; unnecessary).
- Publora takes `mediaUrls` (URLs, not file upload). Local-first media needs a hosting step; to be resolved in Phase 3 (see ARCHITECTURE §8.4).
- It is unverified whether Publora supports **PDF document posts (carousels)**. `references/algorithm-heuristics.md` claims document carousels get 1.7-2.3x reach, but the Publora client only shows `mediaUrls`. Must be verified in Phase 3 against Publora's docs before promising carousel publishing.
- Official LinkedIn API alternative (3-legged OAuth, `w_member_social`) is possible as a second adapter. The interface already allows it.

### Optional services we will NOT adopt
- **Apify** (read LinkedIn data): not needed.
- **Pixfaro** (paid image API): replaced by baoyu skills plus local rendering.
- **Detector tester** (GPTZero etc.): the repo itself says detector scores on LinkedIn-length text are noise, and sending drafts to five third-party detectors leaks pre-approval content.

### Security notes from the source
- `references/untrusted-content.md` states: fetched content is data, never instructions. We adopt this rule for repo content (commit messages, READMEs, comments). That is a prompt-injection vector in our design too.

### Dependencies
Upstream Python: `requests`, `python-dotenv`. Our port needs none (Node `fetch`).

### License
MIT (c) 2026 Sergey Bulaev. Adapted text goes in `skills/linkedin-content/references/` with a `NOTICE` file giving the source, commit, and license. README says "Powered by Publora": a service dependency, not a license term.

---

## 3. affaan-m/ECC — content, voice, video

- **URL:** https://github.com/affaan-m/ECC
- **Purpose:** "Agent harness operating system": 293 skills, 68 agents, 94 commands, hooks, rules, MCP configs, for Claude Code/Codex/Cursor/etc.
- **Version inspected:** 2.2.2.

### Files inspected
`README.md`, `package.json`, `SECURITY.md`, `LICENSE`, and `SKILL.md` for: `content-engine`, `article-writing`, `brand-voice` (+ `references/voice-profile-schema.md`), `manim-video`, `remotion-video-creation`, `video-editing`, `videodb`, `fal-ai-media`, `tasteforge-video`, `crosspost`, `social-publisher`, `e2e-testing`, `repo-scan`, `security-scan`. Filtered the skill list by keywords (video, content, writing, test, security, git, research, media).

### Do NOT install ECC as a whole
It ships hooks, rules, commands and hundreds of skills that alter agent behavior and inflate context. Importing it would conflict with our hard rules (read-only repos, no auto-publish). We take individual `SKILL.md` files as references only. 45 of its skills are marked `origin: community` (third-party content with possibly different provenance); we use only `origin: ECC` ones.

### Relevant skills and decision

| Skill | Decision | Use |
|-------|----------|-----|
| `brand-voice` | **Adapt (Phase 2)** | Voice profile from your real posts; "source-derived, not generic" principle. Schema in `references/voice-profile-schema.md`. |
| `content-engine` | **Adapt (Phase 2)** | Principles line up with ours: "start from source material", "one post = one claim", "specificity beats adjectives", hard-ban list, quality gate. Its Short Video section feeds the video script format. |
| `article-writing` | **Adapt (Phase 4)** | Long-form: "lead with the concrete thing", "never invent facts", structure guidance for technical guides. |
| `manim-video` | **Candidate for Phase 5 (default video backend)** | Deterministic, code-driven technical explainers (flows, architecture). Default output: 16:9 MP4, thumbnail, storyboard plus scene plan. No generative video model, so no data leaves the machine. Needs `manim` and `ffmpeg` (neither installed). |
| `remotion-video-creation` | **Candidate, with license check** | React-based video, good for captions/compositing. Remotion has its own commercial licensing terms for companies; must verify before adopting. |
| `video-editing`, `videodb`, `fal-ai-media`, `tasteforge-video` | **Not for MVP** | Cloud/third-party generation or footage editing. `fal-ai-media` would send content to fal.ai. Defer. |
| `e2e-testing` | **Reference for fact-checking** | Playwright patterns. Used to check that "lessons" we generate are technically correct and marked as general knowledge. |
| `repo-scan`, `security-scan` | **Not used** | `repo-scan` is only a pointer that installs an external skill; `security-scan` audits `.claude/` configs, not source repos. |
| `crosspost`, `social-publisher` (SocialClaw) | **Not used** | We publish to LinkedIn only; adds another third-party. |

### Video design
Per your spec, video is a modular interface (`VideoGenerator`: `generateScript`, `generateStoryboard`, `generateVideo`, `generateThumbnail`) with `NoopVideoGenerator` in MVP. The first real backend (Phase 5) is likely `ManimVideoGenerator` because it is deterministic and offline. Backends are swappable via config.

### Dependencies
For the skills we read: none. For Phase 5: Python + `manim`, `ffmpeg`.

### License
MIT (c) 2026 Affaan Mustafa. Per-skill NOTICE entries needed for adapted text. Third-party tools (Remotion, ElevenLabs, fal.ai, VideoDB) have their own terms.

---

## 4. JimLiu/baoyu-skills — visuals

- **URL:** https://github.com/JimLiu/baoyu-skills
- **Purpose:** 21 skills (content, AI generation, utilities) for Claude Code/Codex. Requires Node + `bun` (`npx -y bun` fallback). Bun is not installed locally.

### Files inspected
`README.md`, `package.json`, `LICENSE`, `skills/` listing, and SKILL.md headers for `baoyu-diagram`, `baoyu-infographic`, `baoyu-cover-image`, `baoyu-slide-deck`, `baoyu-article-illustrator`, `baoyu-image-gen` (incl. `scripts/providers/`, env var list).

### Skills and decision

| Skill | Decision | Use |
|-------|----------|-----|
| **`baoyu-diagram`** | **Primary (Phase 2)** | Produces self-contained, dark-mode-aware **SVG diagrams** written by the LLM (flowchart, sequence, structural, illustrative, class). **No image model is called.** Ideal for Playwright architecture, CI pipeline, test-framework layering, debugging flow. Contains `references/{architecture,flowchart,sequence,structural}.md` and `scripts/main.ts`. SVG can be statically checked (no `<script>`, no external hrefs) and scanned for sensitive text. |
| `baoyu-slide-deck` | **Adapt method, not image path** | Outline-then-render approach, designed for "reading and sharing" slides; merges into PDF/PPTX (`scripts/merge-to-pdf.ts`). LinkedIn carousels are PDFs. Upstream renders slides with an **image model**, which garbles text and sends slide text to a third party. Our plan renders slides as **HTML/SVG and converts to PDF with Playwright locally** (you know Playwright; deterministic, crisp text, offline). |
| `baoyu-cover-image` | **Optional (Phase 4)** | Article covers: 5 dimensions (type, palette, rendering, text, mood). Prefer AstroPaper's built-in Satori OG images first; use AI covers only with abstract prompts containing no work-derived text. |
| `baoyu-infographic` | **Reference only** | 21 layouts x 22 styles; image-model based. Useful vocabulary for layouts (`comparison-table`, `do-dont`, `fishbone`, `layers-stack`). |
| `baoyu-article-illustrator` | **Optional (Phase 4)** | Finds places in an article needing visuals. Image-model based. |
| `baoyu-image-gen` | **Optional adapter (Phase 2+)** | Multi-provider image gen (OpenAI, Google, OpenRouter, Azure, DashScope, Replicate, ...). Wrap as `ImageProvider` adapter, off by default. Env keys named by upstream: `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `OPENROUTER_API_KEY`, etc. |
| `baoyu-compress-image`, `baoyu-format-markdown`, `baoyu-markdown-to-html` | **Maybe later** | Utilities. Not needed. |
| `baoyu-post-to-x/wechat/weibo`, `baoyu-xhs-images`, `baoyu-comic`, `baoyu-translate`, `baoyu-wechat-summary`, `baoyu-youtube-transcript`, `baoyu-url-to-markdown`, `baoyu-electron-extract` | **Not used** | Out of scope. |
| **`baoyu-danger-gemini-web`, `baoyu-danger-x-to-markdown`** | **Never** | Names say it: they use reverse-engineered web APIs / session cookies (upstream labels them "danger"). They risk account bans and credential handling we do not want. |

### Integration approach
- `skills/visual-content/SKILL.md` (ours) points to vendored baoyu-diagram references, adds our rules (privacy gate before generation; SVG sanitizer after generation; label every visual `GENERAL_CONCEPT` or `FROM_WORK`).
- `VisualGenerator` interface: `generateDiagram()` (LLM to SVG, default), `renderCarousel()` (HTML/SVG to PDF via Playwright), `generateImage()` (adapter, off by default).

### Dependencies
Node. `bun` only if we call upstream scripts directly (we likely will not for `baoyu-diagram`; it is mostly prompt/reference content). Playwright (carousel PDF). `sharp` if image post-processing is needed.

### License
MIT (c) 2026 Jim Liu. Note: publishing individual skills to ClawHub re-licenses them as MIT-0 upstream; not relevant to us. Keep NOTICE with source commit.

---

## 5. How vendoring will work (Phase 1)

```
vendor/
  skill-sources.lock.json     # repo, url, commit SHA, license, paths we take
  linkedin-skills/            # only whitelisted markdown (post-writer, humanizer, voice rules, hook-formulas, ...)
  ecc/                        # content-engine, article-writing, brand-voice, manim-video SKILL.md
  baoyu-skills/               # baoyu-diagram (SKILL.md + references), baoyu-slide-deck SKILL.md
  NOTICE.md                   # attribution + licenses
skills/                       # OUR skills; they reference vendor/ files and add our overrides
```

- `qa-agent skills sync` fetches **only whitelisted paths at pinned SHAs** (small markdown, a few hundred KB total). Nothing else is downloaded or executed.
- Vendored files are never edited. Our overrides live in our own `skills/*/SKILL.md` ("Overrides" section wins on conflict). This keeps upstream diffs reviewable when you bump a SHA.
- No upstream scripts are executed automatically.

## 6. Open items needing verification later (not assumed)

1. Does Publora support PDF documents/carousels and direct media upload? (Phase 3)
2. Official LinkedIn API availability for posting documents on a personal profile without a partner program. (Phase 3)
3. Remotion's license terms for your situation. (Phase 5)
4. Whether your employer's policy permits (a) sending repo-derived text to a cloud LLM and (b) publishing about work projects. (Before Phase 1 AI features)
