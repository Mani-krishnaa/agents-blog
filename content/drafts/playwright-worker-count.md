---
title: "The Playwright worker count did not stay put"
description: "Across one suite the worker count moved from 4 to 20 and back, preprod was pinned to 1 and then unpinned, and video was kept only on failure."
pubDatetime: 2026-10-02T02:14:00+05:30
tags: ["playwright", "ci"]
draft: true
featured: false
---

In this suite the Playwright worker count is a commit history, not a constant.

Through October 2025 the CI value moved 4 to 5, back to 4, then up again, and later from 16 to 20. In May 2026 preproduction was pinned to 1 worker, then raised to 4. In June the commit that had pinned it to 1 was reverted, staging got its own Playwright config, and that config's workers went from 4 to 5.

None of those messages record a before-and-after runtime. What they record is that one number was doing two jobs: filling the CI machine, and not knocking over a shared preprod. Those want different values, which is why staging ended up with its own config instead of another edit to the default.

Two related choices landed in the same period. The HTML report link in CI was pointed back at the Playwright report after an Allure trial was reverted. And the config was set to retain video on failure. A higher worker count makes a failure harder to reproduce by hand. The video is what you watch when you cannot get the same red locally.

The useful rule from this history is small. Give each environment its own worker count, and keep the artifact that explains a red run. The count will move again. The next change should say which environment it is for.
