#!/usr/bin/env node
// backend/scripts/devReset.js — `npm run dev:reset` (run from backend/).
// Developer-only: wipes development/test business data after a verified backup. All logic and
// every safety gate live in src/db/devResetCli.js; this entrypoint only loads configuration
// exactly like the server does (lib/config.js first: the installed production config if present —
// which makes the CLI refuse — otherwise backend/.env) and wires the terminal prompt.
import { configSource } from '../src/lib/config.js';
import readline from 'readline';
import process from 'process';
import { runDevResetCli } from '../src/db/devResetCli.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const prompt = (question) => new Promise((resolve) => {
  rl.question(question, resolve);
  rl.once('close', () => resolve(''));
});

const code = await runDevResetCli({
  env: process.env,
  configMode: configSource.mode,
  prompt,
  print: (line) => process.stdout.write(`${line}\n`),
});
rl.close();
process.exit(code);
