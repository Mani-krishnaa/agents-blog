---
title: "A load test you can watch on your laptop"
description: "One k6 scenario, moved to TypeScript, pushing metrics to a local Prometheus and Grafana. Two stacks, different ports, so Docker and a native install can run together."
pubDatetime: 2026-10-02T02:12:00+05:30
tags: ["k6", "performance", "testing"]
draft: true
featured: false
---

The load-test repo started as a baseline and, on 21 July 2026, became a small stack you can run locally. One scenario exists so far: a candidate login, written in TypeScript, configured at 20 virtual users for 30 seconds. The plain JavaScript version of that scenario was removed in the same change. New scenarios are meant to be added as their own files, after that one is trusted.

k6 pushes metrics with remote-write. Prometheus stores them. Grafana reads Prometheus. Nothing in that path is a hosted account. The repo ships two ways to start it, because the two ways fail differently.

The Docker path brings up Prometheus on port 9090 and Grafana on port 3000. k6 itself runs in a container on the same Compose network, so the remote-write URL is `http://prometheus:9090/api/v1/write`, not localhost. `BASE_URL` is forwarded into that container. `stack:down` drops the history with the containers.

The native path uses Homebrew Prometheus and Grafana, on ports 9091 and 3001, so both stacks can be up at once. Grafana is started by a project script, with its pid and logs gitignored, and its provisioning lives in the repo. The shared Homebrew Grafana config is left alone. That history survives `stack:down`.

The split is the part worth keeping. A load test you cannot see is a number in a terminal. A load test whose graph disappears every time you stop Docker is a demo. The native stack is there for the afternoon you want yesterday's run still on screen.
