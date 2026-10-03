---
title: "A Monaco editor will overwrite the code you just typed"
description: "The test set a value on a Monaco editor. An async language stub wrote a different one a moment later. The helper now waits until the value sits still, writes, and reads it back."
pubDatetime: 2026-10-01T10:00:00+05:30
tags:
  - playwright
  - testing
featured: true
draft: false
---

<video controls playsinline preload="metadata" poster="/videos/monaco-editor-overwrites-the-code.jpg" width="1920" height="1080" style="width:100%;height:auto;border-radius:8px">
  <source src="/videos/monaco-editor-overwrites-the-code.mp4" type="video/mp4" />
</video>

The test was supposed to fill a code editor. It called `setValue` with the contents of a fixture file, logged success, and moved on. Sometimes the editor then showed a language stub instead of that file. The stub had not been there when `setValue` ran. It arrived afterwards, because changing the language kicks off an async load, and that load writes into the same model.

Monaco does not have one editor on this screen. `monaco.editor.getEditors()` returns a list, and the code editor is index 1. The old helper checked that the list was non-empty and always wrote to index 1. It never checked that the write was still there a moment later. A green step only meant the call did not throw.

The replacement, committed on 24 June 2026, takes the editor index as an argument (still defaulting to 1) and does three things.

It waits until that index exists. A `waitForFunction` polls `getEditors()` and continues only when the list is longer than the index, with a 15 second timeout. Writing before the widget is mounted was a separate way to hit the wrong surface.

It waits until the value stops changing. A helper reads the current text, sleeps 200ms, and reads again. Three identical reads in a row count as stable. The loop gives up after 50 tries, about 10 seconds, and if the value is still moving it logs a warning and goes on. That branch is deliberate. A stub that never settles should not hide inside a timeout that the test treats as success, but it also should not fail the run before the write has been attempted. The warning is the record that the race was still open.

It writes, then reads. After `setValue` it waits 500ms and compares `getValue()` to the fixture. Equal means the write stuck. Not equal means something, usually the late stub, replaced it, and the helper tries again, up to three times. Each lost attempt is logged with the attempt number. If all three lose, the test throws:

> Failed to set code in Monaco editor at index 1 after 3 attempts. Value keeps getting overwritten — likely a delayed codestub update.

That message is the point of the last step. The old failure looked like a wrong submission or a bad locator. This one says the editor did not keep what the test wrote.

The 500ms gap is still a fixed sleep. It is only there to give a pending update a chance to show itself before the comparison. The part that decides pass or fail is the comparison, not the sleep. The stabilize loop is what makes the retry rare. The read-back is what makes a leftover race fail in the open.
