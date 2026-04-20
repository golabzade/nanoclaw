# Claude Code vs Gemini CLI: Debugging Architecture Comparison

> Based on the nanoclaw Docker debugging session — why one fixed 9 stacked bugs and one didn't.

---

## What actually happened

The nanoclaw container was silent-crashing — `docker logs` returned nothing. Gemini CLI failed. The actual root cause turned out to be nine separate bugs stacked on top of each other, each one hiding the next. The first was a suicide loop with zero log output.

---

## Where the architectures are identical (and this wasn't the difference)

Both have the same raw capabilities: read files, grep code, run bash commands, edit files. Gemini CLI had full access to the nanoclaw repo — it installed it. The tool set is not the differentiator.

---

## Difference 1: What to do when the primary diagnostic tool is broken

The correct first step when `docker logs` is empty is to stop trying `docker logs` and read the startup code instead. This requires a meta-cognitive step: recognizing that the evidence-gathering tool itself has failed, and switching to static analysis of what runs at startup.

Gemini CLI's agent loop processes tool results and drives the next action based on them. When logs return nothing, the model gets a null result and has to decide what to do next. The architecture doesn't distinguish between "logs are empty because nothing happened" and "logs are empty because the process died too fast to flush". Both look like empty strings. Without that distinction, the model tends to retry the same log commands with different flags, or move to surface-level hypotheses (network, credentials) without reading the startup code.

What worked: read `container-runtime.ts` specifically because it runs at startup, found `cleanupOrphans()`, traced the filter string `nanoclaw-` against the container name `nanoclaw-main`, and recognized the suicide loop. This required treating the codebase as the primary evidence source, not the runtime.

**Fix for Gemini CLI**: when a standard diagnostic command returns empty output that should not be empty, trigger a "code-read phase" rather than retrying runtime commands.

---

## Difference 2: Compound bugs require persistent hypothesis tracking across compressions

Gemini CLI's `chatCompressionService.ts` uses Gemini Flash Lite to summarize conversation history when context pressure builds. The summarization is LLM-based, which means it prioritizes semantic importance — and "I tried X and it didn't work" often gets compressed to nothing because it seems like dead weight.

But in compound debugging, what you've *ruled out* is as important as what you've found. The nanoclaw issues came in layers:

1. Suicide loop (no logs) → fix hostname filter
2. Now have logs → exit 125 "read-only file system" → remove `.env` shadow mount
3. Now starts → agent containers mount empty dirs → DinD path translation
4. Paths correct → bot asks for `/login` → `secrets` field missing from `ContainerInput`
5. Credentials work → ECONNREFUSED → `HTTP_PROXY` forwarded into containers that have no proxy

Each fix revealed the next problem. If compression summarizes away "Telegram 409 conflict was ruled out" or "the .env shadow mount was removed", the model can revisit dead ends or misattribute later symptoms.

**Fix for Gemini CLI**: compress summaries of successful actions freely, but pin two things: (a) exact error strings from tool output, (b) an explicit "ruled out" list. These are diagnostic state, not narrative. The current compression treats them as equivalent to conversational filler.

---

## Difference 3: Confirmation bias pressure from action budgets

Gemini CLI's `config.ts` sets `maxActionsPerTask: 100` as a default ceiling. An agent that knows it has a finite action budget tends to converge on the first plausible hypothesis rather than falsifying it. The nanoclaw issue had two convincing red herrings — Telegram 409 conflict and missing Google credentials — both of which look like startup failures. A model under budget pressure that finds "ah, missing credentials" will attempt a fix and declare progress.

The nine-bug chain required not declaring victory after each fix but immediately re-running the full diagnostic suite to see what was next. This is only safe if the model isn't watching an action counter.

**Fix for Gemini CLI**: the budget limit is fine as a safety valve, but it shouldn't be visible to the model during investigation. The model should reason about evidence, not turns remaining.

---

## Difference 4: Falsification is not structurally enforced

Good debugging is: hypothesis → prediction → falsification. Most LLM agents don't do this naturally — they tend toward confirmation. The structural difference is that reading code gives you ground truth that can definitively rule something out, while log-chasing gives you evidence that can only confirm.

Returning repeatedly to the code — `container-runner.ts`, `container-runtime.ts`, `index.ts` in the agent runner — as the primary source of truth is what allowed each bug to be definitively identified. Staying at the runtime/log layer longer means working with incomplete evidence about a process that crashed before producing any.

**Fix for Gemini CLI**: after forming a hypothesis, generate and test its negation before acting on it.

---

## Summary

| Problem | Root cause | Fix |
|---|---|---|
| Silent crash → log retry loop | No distinction between "empty logs" and "process too fast to flush" | Detect empty-when-unexpected output, trigger code-read mode |
| Compound bugs collapse across compressions | LLM summarization drops "ruled out" state | Pin error strings and ruled-out hypotheses through compression |
| Confirmation bias | Action budget creates convergence pressure | Decouple budget limit from model reasoning; don't expose counter |
| Red herrings stick | No falsification step | After forming a hypothesis, generate and test its negation before acting |

The gap isn't tool access or capability — it's that debugging compound, silent-failure problems requires treating the codebase as primary evidence and maintaining exact diagnostic state across a long investigation. Both are architectural properties, not prompt engineering.
