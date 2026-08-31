# Legacy Roadmap — Historical Only

This file previously described the V1/brownfield implementation roadmap. It is intentionally no longer an execution plan for Website Builder V2.

The current implementation phases and release gates are defined in:

- `../v2-docs/IMPLEMENTATION-PRD.md`
- `../CONTEXT.md`
- `../v2-docs/CAPABILITY-ENVELOPE.md`
- `../v2-docs/prompts/PROMPT-MANIFEST.md`

The V2 sequence is:

```text
brownfield audit
-> canonical domain/state/contracts
-> Reference Suitability + Evidence
-> Reference Analysis + Visual Blueprint
-> Implementation Contract + incremental generation
-> Image Slot/KIE pipeline
-> central Form Service
-> QA + bounded Automated Repair
-> Approval / Publication / Rollback
-> fixed five-site benchmark (3/5 Benchmark Pass)
-> ORIGINAL_DESIGN
-> V1 product-logic removal / final audit
```

Do not use historical V1 milestone names, Client Account/User assumptions, old SMTP2Go/per-Site form architecture, old revision loops, or old publication semantics as implementation requirements.
