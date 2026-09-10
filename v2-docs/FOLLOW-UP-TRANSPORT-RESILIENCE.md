# FOLLOW-UP — TRANSPORT RESILIENCE (out of legacy-cleanup scope)

Created: 2026-09-10, per operator GO §18. NOT implemented in the cleanup branch.

## Observed incidents (2026-09-09/10, sandbox runtime)

1. **Workers AI streaming (`workers_ai_stream`)**: long streaming completions
   (the ONE site-repair call streams for minutes) die mid-stream with
   `8005: Internal server error`, reproducibly, across multiple attempts over
   ~1.5 hours. Short streams (builder ONE_CALL, blueprint) succeeded in the
   same window; the failure profile is length/duration-correlated.
   The designed 3-attempt × 1s retry bound cannot outlive a provider episode —
   by intent (bounded retry), but it makes terminal completion hostage to
   provider stability.
2. **Z.AI General streaming (`zai_general_stream`)**: HTTP 400, code `1210` —
   "This model always engages in thinking and cannot be disabled; please use
   low, high, off…". The current `glm-5.3-flash` contract requires an explicit
   thinking parameter; the zai_general transport request predates it. This
   also reproduces through the pre-existing `stream-canary-text` driver op.
   No silent model substitution is acceptable.

## Follow-up items

1. Investigate Workers AI 8005 long-stream reliability (duration thresholds,
   keep-alive/chunking behavior, provider-side incident correlation); consider
   a guarded stream-resume/restart strategy WITHIN the established bounded
   repair budget.
2. Update the Z.AI General transport request for the current thinking-parameter
   contract on the same canonical model (`glm-5.3-flash`) — no model
   substitution.
3. Re-verify both transports through the existing driver canaries
   (`stream-canary-text` with a realistic thinking parameter) before relying
   on them for terminal verification.
