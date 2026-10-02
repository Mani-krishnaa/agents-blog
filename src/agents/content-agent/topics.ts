import type { Idea } from "../../core/models.ts";

type Format = Idea["recommended_format"];

export interface Topic {
  title: string;
  /** A neutral angle, not a claim about what the author did. First-person detail only comes from evidence or the user. */
  hook: string;
  /** Standard QA/SDET knowledge. Tagged GENERAL_KNOWLEDGE, never presented as the author's result. */
  lesson: string;
  audience: string;
  format: Format;
}

/** Highest priority first. The first rule present in a work item becomes the idea's topic. */
export const TOPIC_PRIORITY = [
  "migration.selenium-to-playwright",
  "flaky.remove-hard-wait",
  "locator.strategy",
  "flaky.keywords",
  "perf.execution-time",
  "framework.design",
  "accessibility",
  "genai",
  "api-testing",
  "ci.config",
  "flaky.retries-config",
  "assertions.web-first",
  "debugging",
  "aws",
  "docker",
] as const;

export const TOPICS: Record<(typeof TOPIC_PRIORITY)[number], Topic> = {
  "migration.selenium-to-playwright": {
    title: "Migrating a test suite from Selenium to Playwright",
    hook: "What to plan for when moving an existing browser suite to Playwright",
    lesson:
      "Migrating a test framework is easiest in slices: keep both suites running, port feature by feature, and compare results before deleting the old suite.",
    audience: "QA/SDET engineers considering a move to Playwright",
    format: "technical story",
  },
  "flaky.remove-hard-wait": {
    title: "Replacing fixed waits with web-first assertions",
    hook: "What actually replaces waitForTimeout in a Playwright test",
    lesson:
      "A fixed sleep is a guess about timing: too short and the test flakes, too long and the suite is slow. Waiting on an observable condition removes the guess.",
    audience: "QA/SDET engineers writing browser tests",
    format: "debugging story",
  },
  "locator.strategy": {
    title: "Choosing locators that survive UI changes",
    hook: "Role, label and test-id locators versus long XPath chains",
    lesson:
      "Locators tied to what users see (role, label, test id) survive layout changes better than long XPath or CSS chains tied to DOM structure.",
    audience: "QA/SDET engineers maintaining UI automation",
    format: "comparison",
  },
  "flaky.keywords": {
    title: "Finding the real cause of a flaky test",
    hook: "Retries hide flakiness; they do not explain it",
    lesson:
      "Flakiness usually has a root cause (timing, shared state, test data or environment). Retrying hides it instead of fixing it.",
    audience: "QA/SDET engineers fighting flaky suites",
    format: "debugging story",
  },
  "perf.execution-time": {
    title: "Making a test suite run faster",
    hook: "Where the time in a slow test suite usually goes",
    lesson:
      "Faster suites come from parallelism, sharding and removing waits, but parallel tests need isolated data and independent state.",
    audience: "QA/SDET engineers and CI owners",
    format: "lesson learned",
  },
  "framework.design": {
    title: "Structuring a test framework with page objects and fixtures",
    hook: "How much abstraction a test framework actually needs",
    lesson:
      "A small page-object and fixture layer keeps tests readable, but over-abstracting hides what a test really does.",
    audience: "SDETs designing or refactoring automation frameworks",
    format: "technical story",
  },
  accessibility: {
    title: "Adding automated accessibility checks to UI tests",
    hook: "What automated accessibility testing can and cannot catch",
    lesson:
      "Automated checks such as axe catch only a subset of accessibility issues. They complement manual and screen-reader testing instead of replacing it.",
    audience: "QA engineers adding accessibility coverage",
    format: "short technical insight",
  },
  genai: {
    title: "Using generative AI in QA work, with a review step",
    hook: "Where a ChatGPT-style assistant helps in test automation and where it needs checking",
    lesson:
      "Generative AI can speed up test authoring and test-data generation, but generated tests still need review for correctness and flakiness.",
    audience: "QA/SDET engineers exploring AI tooling",
    format: "short technical insight",
  },
  "api-testing": {
    title: "Testing business rules at the API level",
    hook: "Which checks belong in API tests instead of the browser",
    lesson:
      "API tests are faster and less brittle than UI tests for business rules. Keep UI tests for flows that genuinely need a browser.",
    audience: "QA/SDET engineers balancing UI and API coverage",
    format: "tutorial",
  },
  "ci.config": {
    title: "Making test failures diagnosable in CI",
    hook: "What a CI pipeline needs so a red build can be understood quickly",
    lesson:
      "A suite is only as trustworthy as the pipeline running it: environment parity, caching and saved artifacts (traces, reports) decide how fast a failure can be diagnosed.",
    audience: "QA/SDET engineers who own CI test jobs",
    format: "checklist",
  },
  "flaky.retries-config": {
    title: "Retries and timeouts: a safety net, not a fix",
    hook: "How to tune retries and timeouts without hiding real failures",
    lesson:
      "Retries and timeouts should be set deliberately and reported, so real regressions are not hidden behind a green re-run.",
    audience: "QA/SDET engineers configuring test runners",
    format: "mistake/lesson",
  },
  "assertions.web-first": {
    title: "Web-first assertions in browser tests",
    hook: "Why a retrying assertion beats checking a value once",
    lesson:
      "Web-first assertions retry until the condition holds or a timeout expires, so they absorb timing differences that one-shot checks cannot.",
    audience: "QA/SDET engineers learning Playwright",
    format: "short technical insight",
  },
  debugging: {
    title: "Debugging a failing automated test",
    hook: "Which artifacts make a failing test debuggable",
    lesson:
      "Capturing traces and artifacts on failure turns 'it failed in CI' into something that can be diagnosed.",
    audience: "QA/SDET engineers triaging failures",
    format: "debugging story",
  },
  aws: {
    title: "Test support code that runs on AWS",
    hook: "What changes when test tooling runs in cloud functions",
    lesson:
      "Cloud-hosted test tooling (functions, queues, buckets) needs the same isolation and cleanup discipline as test data.",
    audience: "SDETs working with cloud test infrastructure",
    format: "short technical insight",
  },
  docker: {
    title: "Running tests in a pinned container image",
    hook: "How containers remove 'works on my machine' from test runs",
    lesson:
      "Running tests in a pinned container image removes environment differences between local runs and CI.",
    audience: "QA/SDET engineers standardising environments",
    format: "short technical insight",
  },
};
