# Full Repository Audit

Perform a broad, evidence-first, read-only audit of the complete repository. Find
concrete failures and risks rather than style preferences. The only permitted
external write is the final GitHub issue described below.

## Safety Contract

- Read every applicable `AGENTS.md` and active project document before judging code.
- Do not edit, create, rename, or delete repository files.
- Do not commit. Do not push. Do not change branches, create tags, publish
  artifacts, deploy, or migrate data.
- Do not create a pull request or post PR comments.
- Run only repository-defined or clearly safe diagnostic commands. Build outputs
  and caches are allowed only when required for evidence; disclose them.
- Redact credentials. Never print, copy, rotate, or test a suspected live secret.

## Procedure

### 1. Establish scope and baseline

1. Record the repository, base commit SHA, Git state, languages, frameworks,
   generated/vendor areas, entrypoints, runtime boundaries, and supported commands.
2. Inventory the whole tree, then choose depth by risk. State every exclusion;
   do not silently reduce the audit to the current diff.
3. Run feasible build, test, lint, type, data-generation, dependency, and smoke
   checks. Record commands, environment, exit status, and relevant output.

### 2. Audit the repository

Trace reachable paths and confirm consequence before reporting:

- incorrect or surprising behavior, invalid state transitions, incomplete features,
  error handling, boundary values, empty/null paths, overflow, and corner cases;
- trust boundaries, validation, authorization, injection-sensitive sinks, unsafe
  file/network/deserialization behavior, secrets, logging, and dependency exposure;
- repeated work, unbounded collections or scans, blocking paths, excessive allocation,
  cache lifetime, resource leaks, and performance regressions;
- shared mutable state, ordering, atomicity, retries, cancellation, races, startup,
  shutdown, cleanup, persistence, compatibility, and recovery;
- duplicated implementations, dead paths, parallel mechanisms, speculative
  abstractions, misleading APIs, mixed ownership, and custom replacements for
  existing platform capabilities;
- API and dependency misuse, unsupported versions, registration/discovery mistakes,
  client/server or platform boundaries, serialization drift, and unsafe fallbacks;
- weak or missing tests, false-green CI, ignored failures, nondeterminism, packaging
  drift, stale documentation, and behavior not covered by executable evidence.

A search match is a candidate, not a finding. Check callers, registration, reflection,
configuration, generated code, compatibility intent, and historical decisions.
Deduplicate symptoms that share one root cause.

### 3. Research external evidence when useful

- When a finding depends on current behavior, consult official documentation,
  release notes, advisories, and source matching the relevant version.
- When design intent or a difficult implementation is unclear, compare similar projects
  and similar modules. Follow project-named references before broader alternatives.
- Record the exact upstream URL, commit or version, relevant file or symbol, license,
  and the pattern learned. Explain why the comparison applies.
- Never copy code from a reference implementation. Treat it as a design pattern only,
  especially when the license differs.
- A different upstream design is not itself a defect. If primary evidence is
  unavailable or version-mismatched, mark the candidate `UNVERIFIED`.

### 4. Validate and rank

- Reproduce P0/P1 candidates with a safe test, deterministic command, complete call
  path, or authoritative contract whenever possible.
- Rank distinct root causes as `P0`, `P1`, `P2`, or `P3` using exploitability,
  data/availability impact, delivery blockage, recurrence, and urgency.
- Every finding needs `file:line`, trigger or path to failure, evidence, impact,
  confidence, affected scope, smallest credible remediation, and estimated effort.
- Use `FAIL` for verified unresolved P0/P1 or a required failing delivery gate.
  Use `CONCERNS` for verified non-blocking risks, `PASS` only after required checks
  complete without material findings, and `BLOCKED` when required evidence or issue
  publication cannot be completed safely.

## GitHub Issue Contract

Publish the audit as exactly one GitHub issue, even when the verdict is `PASS`.
Do not create one issue per finding.

1. Use the provided `GH_TOKEN` when present, but never print, replace, or persist it.
   Confirm read access with `gh issue list`. Do not create a canary issue; the final
   `gh issue create` is the only write.
2. Resolve the repository and full base commit SHA. Build this marker:
   `<!-- full-repo-audit base:<full-sha> -->`.
3. Deduplicate before writing: inspect existing open and closed issues for the exact
   marker. If found, do not create or modify another issue; return its issue URL.
4. Build the complete issue body in temporary storage outside the repository.
5. Run `gh issue create` with the title
   `Full repository audit: <short-sha> (<verdict>)` and the complete body.
6. Capture the returned issue URL, then run `gh issue view` to verify the title,
   marker, body, and repository. Only verified output counts as success.
7. If authentication or `issues:write` is missing, including
   `Resource not accessible by integration`, stop with `BLOCKED`. Report the exact
   failed command and error; do not claim that an issue exists and do not substitute
   a commit, pull request, discussion, or local report file.

Use this issue body:

```markdown
<!-- full-repo-audit base:<full-sha> -->
# Full Repository Audit

**Base:** `<full-sha>`
**Verdict:** PASS | CONCERNS | FAIL | BLOCKED
**Checklist:** X/Y complete

## Scope, baseline, and exclusions
## Health summary
| Area | Status | Evidence |
|---|---|---|
| Correctness and behavior | ... | ... |
| Security and dependencies | ... | ... |
| Performance and lifecycle | ... | ... |
| Maintainability and duplication | ... | ... |
| Tests, CI, and documentation | ... | ... |

## Findings
### [P0 | P1 | P2 | P3] Finding title
- Location: `file:line`
- Trigger and evidence:
- Impact and confidence:
- Smallest remediation and effort:
- External reference, if used:

## Similar implementations consulted
## Commands and results
## Unverified candidates, incomplete checks, and residual risk
```

## Completion

Return only the verified issue URL and a one-line verdict. The GitHub issue is the
durable report; do not require the user to read the Cloud Agent transcript.

## Provenance

Adapted under MIT from
`https://github.com/levnikolaevich/claude-code-skills` at commit
`a8b40c18969b89f5f422389c5ab385c5771a05ea`.
