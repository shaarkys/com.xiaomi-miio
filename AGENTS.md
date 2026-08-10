# Project AGENTS.md Guide for OpenAI Codex

This file provides mandatory guidance for OpenAI Codex and other AI agents working on this Homey application.

Always respect:

* Homey Apps SDK v3: https://apps.developer.homey.app/
* Homey Apps SDK reference: https://apps-sdk-v3.developer.homey.app/

Do not assume that a Homey SDK method, capability, Flow definition, Compose property, CLI option, npm package API, or project helper exists. Verify it against:

1. the current project;
2. installed dependencies and their versions;
3. the supported Homey runtime;
4. official Athom documentation.

---

## Sol Advisor Orchestration

This project supports the Sol Advisor orchestration workflow.

Use Sol Advisor for implementation work that is behavior-changing, runtime-sensitive, cross-file, compatibility-sensitive, or otherwise non-trivial.

Depending on how Sol Advisor is installed, invoke the available skill using one of:

```text
Use $orchestration to implement and verify this change.
```

or, when installed as a Codex plugin:

```text
Use $sol-advisor:orchestration to implement and verify this change.
```

Prefer the project-scoped standalone `$orchestration` skill when both variants are available.

### When Sol Advisor Is Required

Use Sol Advisor for:

* new features;
* bug fixes affecting application behavior;
* changes involving multiple files;
* driver or device lifecycle changes;
* pairing, discovery, authentication, or session handling;
* capabilities and capability migrations;
* Flow cards, Flow tokens, triggers, conditions, or actions;
* Homey Compose changes;
* settings page behavior;
* networking, polling, retry, reconnect, timeout, or timer logic;
* persistence and restart recovery;
* dependency upgrades;
* refactors with potential impact on existing users;
* release-bound changes;
* changes requiring a Homey runtime smoke test.

Sol Advisor is optional for:

* documentation-only changes;
* spelling corrections;
* formatting-only changes;
* clearly isolated non-behavioral edits;
* a trivial one-line change with no compatibility or runtime impact.

When there is reasonable doubt about the blast radius, use Sol Advisor.

### Sol Advisor Roles

The primary Codex session acts as the architect and owns:

1. requirements analysis;
2. architecture;
3. decomposition;
4. implementation specifications;
5. lane selection;
6. acceptance criteria;
7. inspection of the actual files and Git diff;
8. execution of verification commands;
9. final acceptance.

The primary Codex session should normally use GPT-5.6 Luna with High reasoning.

Escalate the primary session to GPT-5.6 Terra when the task requires
material architectural or implementation judgment that Luna cannot
reliably resolve.

Use GPT-5.6 Sol only for unusually difficult, ambiguous, security-sensitive,
or high-risk work, or after Luna/Terra has demonstrably failed to resolve
the problem.

Do not escalate models solely because Sol Advisor orchestration is required.

The expected custom agent types are:

* `sol_advisor_luna_implementer`
* `sol_advisor_terra_implementer`
* `sol_advisor_sol_reviewer`

Do not silently replace these roles with a built-in agent, differently named agent, different model, or different reasoning level.

If a required role is unavailable, report the limitation. Do not claim that the Sol Advisor workflow was completed.

### Luna Implementation Lane

Use `sol_advisor_luna_implementer` for bounded work where the specification largely determines the implementation.

Typical Luna tasks include:

* boilerplate and routine wiring;
* translation updates;
* simple Flow card additions;
* straightforward validation;
* bounded logging improvements;
* mechanical manifest updates;
* routine unit tests;
* isolated and well-understood bug fixes.

Luna must receive a complete implementation specification and an explicit owned file set.

### Terra Implementation Lane

Use `sol_advisor_terra_implementer` when correctness depends on material implementation judgment or the change has a wider blast radius.

Typical Terra tasks include:

* capability migrations for existing devices;
* complex driver or device lifecycle changes;
* pairing process refactoring;
* authentication and token refresh;
* concurrency and race conditions;
* polling, retry, reconnect, or backoff redesign;
* restart-safe timer persistence;
* cross-driver shared library changes;
* security-sensitive behavior;
* broad refactoring;
* difficult runtime debugging;
* changes where one Luna attempt demonstrates that the task was misclassified.

Do not choose Terra merely because a task is important. Route according to implementation complexity and risk.

### Five-Part Implementation Specification

Before delegating implementation, the primary session must define:

1. **Objective**

   * Exact behavior to implement or correct.
   * User-visible and runtime-visible outcomes.

2. **File ownership**

   * Files and directories the implementation agent may modify.
   * Files that must remain unchanged.

3. **Interfaces**

   * Existing driver IDs, capability IDs, Flow card IDs, settings keys, storage formats, exported APIs, event names, and method contracts that must be preserved.

4. **Constraints**

   * Homey SDK requirements.
   * Backwards compatibility.
   * Existing project patterns.
   * Dependency restrictions.
   * Logging and security requirements.
   * Runtime-test authorization boundary.

5. **Verification**

   * Exact static checks, tests, build commands, validation commands, and runtime smoke tests that apply.

Implementation agents must not redesign settled architecture without reporting the issue back to the primary session.

### Concurrent Work

Agents may work concurrently only when their file ownership and responsibilities do not overlap.

Each implementation agent must be told that:

* other work may exist in the repository;
* unrelated edits must be preserved;
* files outside its ownership must not be reverted;
* shared-file changes and dependency chains must be performed serially.

Avoid parallel write-heavy tasks when they could modify the same files, manifests, dependencies, generated outputs, or interfaces.

### Sol Advisor Preflight

When the project contains the project-scoped Sol Advisor installation, the expected paths are:

```text
$HOME/.agents/skills/orchestration/
$HOME/.agents/scripts/
$HOME/.agents/agents/
$HOME/.codex/agents/
```

When available, verify the installed custom agent files before delegation:

```sh
sh .agents/scripts/install-agents.sh \
  --target-dir .codex/agents \
  --check
```

The check must pass before work is accepted as correctly routed Sol Advisor work.

The installer must never be used to overwrite differing custom agent files silently. Conflicting role files must be inspected and reconciled deliberately.

Start a new Codex task or IDE chat after installing or updating custom agent definitions because agent roles may be discovered only when the task is created.

### Implementation Acceptance

Implementation-agent reports are claims, not proof.

Before accepting delegated work, the primary session must:

1. inspect `git status`;
2. inspect the complete Git diff;
3. verify that only in-scope files changed;
4. inspect generated output when relevant;
5. rerun applicable verification commands;
6. compare the result with the objective, interfaces, constraints, and acceptance criteria;
7. delegate corrections when verification fails.

The primary session must not silently repair an implementation-agent result while still claiming that the delegated implementation passed unchanged.

### Final Sol Review

After implementation and primary verification, obtain a fresh review from:

```text
sol_advisor_sol_reviewer
```

The reviewer must:

* use a fresh context;
* remain strictly read-only;
* inspect the actual files and complete accumulated diff;
* inspect verification evidence;
* inspect backwards-compatibility impact;
* inspect runtime-test status;
* avoid implementing its own fixes;
* return exactly one verdict:

```text
ship
fix-first
rethink
```

Verdict meanings:

* `ship`: the inspected implementation and available evidence satisfy the specification.
* `fix-first`: bounded corrections are required before acceptance.
* `rethink`: architecture, scope, or fundamental implementation approach must change.

When the verdict is `fix-first`, delegate the required fixes, rerun verification, and request a new fresh Sol review.

When the verdict is `rethink`, return to architecture and revise the implementation plan.

Do not report static implementation completion without a final `ship` verdict when Sol Advisor was required.

### Runtime Verification Boundary

A Sol Advisor `ship` verdict does not override Homey runtime verification requirements.

For runtime-sensitive changes:

* `ship` means the reviewed code, diff, and available verification evidence are acceptable;
* runtime behavior remains unverified until the required Homey smoke test succeeds;
* without explicit authorization to run the Homey app, provide exact smoke-test steps;
* do not claim runtime completion until the user reports successful runtime results or an authorized runtime test succeeds.

The final report must distinguish between:

* statically verified;
* build verified;
* Homey package validated;
* runtime smoke tested;
* runtime unverified.

---

## Project Structure for Homey App Navigation

* `/app.js` or `/app.ts`: Homey App class source entrypoint. TypeScript is compiled to `/app.js` in the build output.
* `/api.js`: optional Web API or app API helpers.
* `/app.json`: app manifest. If `.homeycompose/` exists, treat this as generated output.
* `/.homeycompose`: source-of-truth manifest parts for the app, drivers, capabilities, and Flows.

  * `/app.json`
  * `/drivers`
  * `/capabilities`
  * `/flow`
* `/.homeybuild`: generated build output. Never edit it by hand, but inspect relevant compiled files when module exports, entrypoints, packaging, or runtime behavior changes.
* `/drivers/<driver_id>`: driver and device code plus pairing views.

  * `driver.js`
  * `device.js`
  * `assets/`
  * `pair/`
* `/lib`: shared modules and helpers.
* `/assets`: app icons and images.
* `/settings`: settings views and their HTML or JavaScript.
* `/locales`: translation strings.
* `/docs`: project documentation.
* `/scripts`: project helper scripts.
* `/tests`: test files when present.
* `/node_modules`: third-party dependencies. Never edit.

Before changing code, inspect at minimum where relevant:

* `package.json`;
* `app.json`;
* `.homeycompose/`;
* `app.js` or `app.ts`;
* affected drivers and devices;
* shared modules in `lib/`;
* existing tests;
* lint and build configuration;
* installed dependency versions;
* existing project utilities.

---

## Coding Conventions for Homey Apps

* Use the language already used by the file and repository.
* Use JavaScript in JavaScript projects.
* Use TypeScript only when the application is already a TypeScript project.
* Follow existing Homey SDK patterns:

  * `Homey.App`
  * `Homey.Driver`
  * `Homey.Device`
* Preserve the current architecture unless a redesign is explicitly required and approved.
* Prefer simple changes over unnecessary abstraction.
* Keep drivers and devices small and focused.
* Place genuinely shared logic in `/lib`.
* Use existing project helpers before creating new utilities.
* Add or update `locales/*` entries when adding user-visible strings for pairing, settings, devices, capabilities, or Flow cards.
* Update capability and Flow definitions in `.homeycompose/` and keep driver and device code synchronized.
* Add comments only for complex or non-obvious logic.
* Preserve existing comments unless they are no longer correct because the associated behavior changed or was removed.
* Any JSON must comply with Homey SDK requirements and must not contain comments.
* Do not add an npm dependency unless existing project code and dependencies cannot reasonably provide the required functionality.
* Do not edit third-party code in `/node_modules`.

### Logging

Use the project’s existing logging style.

Prefer Homey logging methods where available:

* `this.log()` for normal diagnostic information;
* `this.warn()` for recoverable abnormal conditions;
* `this.error()` for failures.

Log enough context to diagnose failures, but never log:

* passwords;
* access tokens;
* refresh tokens;
* API keys;
* authorization headers;
* session cookies;
* private certificates;
* personally identifying data;
* complete API responses containing credentials or sensitive information.

Failure logs must preserve the underlying error or cause.

### Asynchronous Operations

Use `async` and `await` consistently with the existing project style.

External asynchronous operations must have appropriate:

* timeout handling;
* error handling;
* diagnostic logging;
* cancellation or cleanup where applicable;
* bounded retry behavior;
* backoff where repeated failures are possible.

Do not introduce unbounded retries, duplicate polling loops, duplicate listeners, or orphaned timers.

---

## Homey Compose Rules

* If `.homeycompose/` exists, edit it instead of the generated `app.json`.
* Treat `.homeycompose/` as the source of truth for manifest definitions.
* Do not manually edit generated sections of `app.json`.
* Do not edit `.homeybuild/` by hand.
* Keep Flow cards, capabilities, signals, discovery definitions, settings, and driver manifests in their existing Compose locations.
* Do not move definitions between generated files and Compose source files unless an explicit migration requires it.
* Run Homey validation after relevant Compose or manifest changes.
* Inspect generated output where the generated result affects runtime entrypoints, packaging, exports, or manifest integrity.

---

## Backwards Compatibility

Existing paired devices and existing user Flows must continue to work after an update.

Do not silently:

* remove or rename a driver ID;
* remove or rename a capability ID;
* remove or rename a Flow card ID;
* remove or rename Flow card arguments;
* change a Flow card argument contract;
* change a device class;
* change stored device data identifiers;
* change settings keys;
* change Flow token IDs;
* invalidate pairing data;
* change authentication storage formats;
* alter persisted timer formats without migration;
* alter public helper or API contracts used elsewhere in the project.

When replacing a Flow card:

* preserve the old card where required for existing Flows;
* mark it deprecated where supported;
* keep its run listener functional for existing users;
* add a replacement card rather than silently changing the old contract.

When removing a capability from newly paired devices:

* preserve compatibility listeners and handling required by existing paired devices;
* do not assume that all existing devices have the same capability set.

---

## Capability Rules and Migrations

A newly declared capability is not automatically added to already paired devices.

Whenever code expects a capability:

1. check whether it exists;
2. add it when appropriate and supported;
3. handle migration failure safely;
4. avoid repeatedly adding or removing the same capability;
5. keep driver manifests and runtime code consistent.

Capability migrations must be idempotent.

Every migration must:

* detect whether migration is required;
* preserve existing device data and settings;
* preserve existing capability values where possible;
* log migration start;
* log migration completion;
* log failures with the underlying error;
* tolerate repeated execution;
* avoid preventing device initialization where safe recovery is possible.

Do not rename an existing capability as a substitute for migration.

---

## Device and App Lifecycle

Respect Homey application, driver, and device lifecycle methods.

Do not create duplicate timers, listeners, polling loops, realtime subscriptions, or network sessions after:

* app restart;
* device restart;
* settings changes;
* reconnect;
* reinitialization;
* device migration.

Store references to:

* timers;
* intervals;
* event listeners;
* subscriptions;
* abort controllers;
* network sessions where cleanup is required.

Clean them up when no longer required.

For timers and persisted runtime state:

* make initialization idempotent;
* recover active state after restart where required;
* validate persisted values;
* handle expired state during startup;
* prevent duplicate expiry actions;
* define behavior when users manually change the affected capability;
* define replacement and cancellation behavior.

---

## Flow Cards

Preserve stable Flow card IDs.

Ensure that:

* every condition card has a registered run listener;
* every action card has a registered run listener;
* triggers use consistent arguments and trigger state;
* argument types are validated;
* failures return useful errors;
* token IDs remain stable;
* replaced cards preserve backwards compatibility.

Do not change an existing Flow card argument contract without:

* a backwards-compatible implementation;
* a migration where possible; or
* a deprecated replacement card.

Flow-trigger behavior must be covered by tests or runtime smoke-test steps where relevant.

---

## Homey API and Settings Rules

* Do not assume `this.homey.api.getApi(uri)` provides an authenticated REST session.
* `getApi(uri)` creates an API endpoint primarily intended for realtime events.
* Prove authenticated REST behavior in the actual Homey application context.

Cross-device REST access must use a supported authenticated owner session, such as:

* `getOwnerApiToken()` with `getLocalUrl()`; or
* a Node-runtime-compatible official Homey API client.

Handle:

* token or session expiry;
* HTTP 401 responses;
* authenticated-session refresh;
* network timeout;
* partial API failure;
* diagnostic logging without credential disclosure.

### Settings Lifecycle

Keep settings lifecycle code safe when Homey invokes the global callback early.

The settings page must:

* define the global `onHomeyReady(Homey)` callback correctly;
* call `Homey.ready()` immediately;
* avoid top-level lexical dependencies that could be in the temporal dead zone when `onHomeyReady` executes;
* load controller code after required DOM elements exist;
* handle optional UI or API initialization failures;
* avoid blocking Homey readiness on non-essential work.

Do not assume browser APIs or module formats are available without verifying the actual settings runtime.

### Timer Diagnostics

Log timer requests as one of:

* started;
* replaced;
* cancelled;
* skipped;
* restored;
* expired;
* failed.

Failure logs must include the underlying API, persistence, or capability error.

---

## Testing Requirements for OpenAI Codex

OpenAI Codex may run safe local verification commands after changes:

* `node --check` on modified JavaScript files;
* configured build commands;
* configured unit tests;
* configured lint commands;
* `npm audit --omit=dev`;
* `homey app validate`;
* `homey app validate --level publish` for release-bound changes;
* `git diff --check`;
* read-only inspection commands such as `git status`, `git diff`, and file inspection.

OpenAI Codex must not run integration tests, device communication tests, publishing commands, or destructive commands unless explicitly requested.

Do not automatically run:

* `homey app run`;
* `homey app run --remote`;
* `homey app install`;
* `homey app publish`;
* `homey app version`;
* npm publication;
* Git commit;
* Git push;
* pull request creation;
* commands that modify a real Homey;
* commands that modify production or remote data.

---

## Static Validation Boundary

Never describe a Homey change as runtime-verified based only on:

* compilation;
* a successful build;
* unit tests;
* lint;
* `homey app validate`;
* `homey app validate --level publish`;
* static code review;
* a Sol Advisor `ship` verdict.

Homey validation checks package and manifest integrity. It does not prove that:

* the application starts successfully;
* the entrypoint exports the expected Homey class;
* the settings page initializes;
* authenticated Manager API calls work;
* realtime listeners work;
* timers work;
* devices can be enumerated;
* capabilities can be read or written;
* persistence survives restart;
* actual device communication works.

### TypeScript Entrypoint Validation

When TypeScript entrypoints or module settings change:

1. build the application;
2. inspect `.homeybuild/app.js`;
3. verify that the entry module directly exports the class extending `Homey.App`.

For CommonJS builds, the generated entrypoint must provide an effective direct export equivalent to:

```js
module.exports = AppClass;
```

A build that only produces `exports.default` is not sufficient for a CommonJS Homey entrypoint unless the project’s runtime wrapper explicitly handles it.

Add or update a regression test for the compiled entrypoint export whenever:

* the application entrypoint changes;
* TypeScript module configuration changes;
* bundling changes;
* package module type changes.

---

## Runtime-Sensitive Changes

The following changes require a Homey runtime smoke test before runtime completion may be claimed:

* application startup;
* application entrypoint or module exports;
* settings pages;
* authentication or session handling;
* Manager API access;
* realtime listeners;
* timers and intervals;
* restart recovery;
* persistence;
* device capability reads or writes;
* device communication;
* pairing;
* discovery;
* Flow trigger behavior;
* capability migration on existing paired devices.

Run `homey app run --remote` or an installed-app/device test only when explicitly authorized.

Without authorization:

1. complete all safe static verification;
2. provide exact runtime smoke-test steps;
3. mark runtime behavior as unverified;
4. wait for the user’s runtime result before declaring runtime completion.

---

## Minimum Runtime Smoke Test

For runtime-sensitive changes, verify the affected subset of the following:

* the app starts without an entrypoint or SDK class error;
* the application initializes without uncaught exceptions;
* the settings page invokes the global `onHomeyReady(Homey)` lifecycle callback;
* the settings page calls `Homey.ready()` immediately;
* the settings page loads without browser-console errors;
* settings can be read;
* settings can be written;
* authenticated device enumeration works in the actual app context;
* capability reads work;
* capability writes work;
* a short timer starts;
* the timer is visible in logs or settings;
* the timer expires;
* expiry applies or restores the expected capability state;
* an active timer survives an app restart;
* a restored timer later expires correctly;
* manual capability changes cancel the relevant timer;
* timer replacement options work;
* the `timer_finished` Flow trigger behaves as defined;
* newly added capabilities migrate correctly on an already paired device;
* repeated initialization does not create duplicate listeners, timers, or polling loops.

Record the exact tested scenario and result.

---

## Dependency Upgrade Rules

“Latest” means the newest mutually compatible versions for:

* Homey’s supported Node.js runtime;
* the current application;
* installed peer dependencies;
* the configured build system;
* the configured lint and test stack.

Do not blindly select the highest published version.

Before upgrading, inspect:

* npm `engines`;
* peer dependencies;
* Homey-supported Node.js versions;
* breaking release notes;
* TypeScript compatibility;
* ESLint compatibility;
* Homey CLI compatibility;
* runtime-library compatibility.

Report separately:

* upgraded production dependencies;
* upgraded development dependencies;
* intentionally held versions;
* production audit findings;
* development-only audit findings;
* unresolved compatibility risks.

Do not treat development-only audit findings as production runtime vulnerabilities without explaining the dependency path and actual production exposure.

---

## Verification Order

Run applicable verification in this order:

1. inspect modified files;
2. run `node --check` on modified JavaScript files;
3. run the configured build;
4. inspect generated entrypoints or manifests where relevant;
5. run configured lint;
6. run configured unit tests;
7. run `npm audit --omit=dev`;
8. run `homey app validate`;
9. run `homey app validate --level publish` for release-bound changes;
10. run `git diff --check`;
11. inspect `git status --short`;
12. inspect the complete Git diff;
13. obtain the final fresh Sol Advisor review when required;
14. perform an authorized runtime smoke test or provide exact manual smoke-test steps.

Do not claim that a command passed unless it was actually executed and returned a successful exit status.

Report:

* every command executed;
* its result;
* every skipped check;
* the reason each check was skipped;
* whether runtime verification was performed;
* the final Sol Advisor verdict when applicable.

---

## Pull Request and Git Guidelines

OpenAI Codex must not:

* create a branch;
* commit changes;
* push changes;
* submit a pull request;
* modify GitHub issues;
* modify GitHub pull requests;
* post GitHub comments;
* add labels;
* merge changes;

unless explicitly requested.

Read-only Git and GitHub inspection is permitted when required for analysis.

---

## Completion Report

The final report must include:

* changed files;
* implemented behavior;
* architecture or design decisions;
* Homey SDK interfaces affected;
* backwards-compatibility impact;
* capability or data migrations;
* Flow compatibility impact;
* dependency changes;
* verification commands and results;
* generated output inspected;
* runtime smoke-test status;
* exact manual smoke-test steps when runtime testing was not authorized;
* remaining risks;
* Sol Advisor implementation lane used;
* final Sol reviewer verdict;
* whether the result is:

  * statically verified;
  * build verified;
  * Homey package validated;
  * runtime smoke tested;
  * runtime unverified.

Do not use the word “complete” for runtime-sensitive work unless the required runtime smoke test has succeeded.
