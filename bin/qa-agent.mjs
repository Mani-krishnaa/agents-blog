#!/usr/bin/env node
// Thin launcher: runs the TypeScript CLI through tsx so no build step is needed.
/* global process */
import { register } from "tsx/esm/api";

register();
const { main } = await import("../src/cli/index.ts");
process.exitCode = await main(process.argv);
