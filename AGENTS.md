# Project AGENTS.md Guide for OpenAI Codex — Homey Apps

This file defines mandatory project-specific instructions for OpenAI Codex and other AI agents working on this Homey application.

Global Codex instructions also apply. Where this file is more specific or stricter for Homey application development, this file takes precedence for this repository.

Always respect current:

* Homey Apps SDK v3 documentation: https://apps.developer.homey.app/
* Homey Apps SDK v3 API reference: https://apps-sdk-v3.developer.homey.app/

Do not assume that a Homey SDK method, capability, Flow definition, Compose property, CLI option, npm API, Homey API behavior, or project helper exists.

Verify material Homey behavior against:

1. the current repository;
2. installed dependency and SDK versions;
3. this project `AGENTS.md`;
4. current official Athom documentation;
5. demonstrated runtime behavior and existing tests.

Existing application behavior and backwards compatibility must not be silently changed merely because a newer pattern is available.

---

# Homey Domain Skill

If the `$homey-app` skill is installed and available, it may be used as supplementary Homey domain guidance.

Use it for tasks involving:

* Homey application architecture;
* drivers and devices;
* Homey Compose;
* capabilities;
* Flow cards;
* pairing;
* discovery;
* widgets;
* Homey Cloud;
* App Store publishing.

The skill is advisory, not authoritative.

Apply this precedence:

1. current repository and installed dependencies;
2. this project `AGENTS.md`;
3. current official Athom documentation;
4. `$homey-app`.

If `$homey-app` conflicts with the repository, current SDK behavior, this file, or official current Athom documentation, ignore the conflicting skill guidance and report the conflict.

Do not depend on optional reference files from the skill unless those files actually exist in the installed skill.

Sol Advisor agents do not need Homey instructions embedded into their TOML files. Relevant Homey constraints belong in the worker specification.

---

# Sol Advisor for Homey

Use `$orchestration` for non-trivial Homey implementation work when the global standalone skill is available.

Preferred invocation:

```text
Use $orchestration to implement and verify this change.
```

If the actual environment provides the namespaced Sol Advisor plugin instead:

```text
Use $sol-advisor:orchestration to implement and verify this change.
```

When using Sol Advisor, the primary session must be:

```text
GPT-5.6 Sol / High
```

Do not use Luna or Terra as the primary orchestration session.

The custom implementation/review roles are:

```text
sol_advisor_luna_implementer  = GPT-5.6 Luna / Max
sol_advisor_terra_implementer = GPT-5.6 Terra / High
sol_advisor_sol_reviewer      = GPT-5.6 Sol / High
```

Do not silently replace these roles, models, or reasoning levels.

---

## When Sol Advisor Should Be Used

Use Sol Advisor for Homey work involving:

* new application features;
* behavior-changing bug fixes;
* changes spanning multiple files;
* driver/device lifecycle;
* pairing or repair;
* discovery;
* authentication or session handling;
* capabilities;
* capability migrations;
* Flow cards or Flow tokens;
* Homey Compose changes affecting runtime behavior;
* settings-page behavior;
* networking;
* polling;
* retry/backoff;
* reconnect behavior;
* timeouts;
* timers;
* persistence;
* restart recovery;
* dependency upgrades;
* refactors affecting existing users;
* release-bound implementation changes;
* difficult runtime-sensitive defects.

Sol Advisor is normally unnecessary for:

* documentation-only edits;
* spelling corrections;
* formatting-only changes;
* isolated translation corrections;
* clearly non-behavioral one-line edits.

---

# Homey Selective Routing

For Sol Advisor work, declare before task tools:

```text
SELECTIVE ROUTE
mode: solo | delegate | audit | full
risk: <concise Homey-specific rationale>
```

`solo` is the default.

Select the route according to actual Homey risk.

---

## Homey `solo`

Prefer `solo` for contained changes where:

* blast radius is small;
* no persisted format changes;
* no capability migration is required;
* no existing ID or public contract changes;
* no authentication redesign;
* no device identity changes;
* no significant cross-driver change;
* independent final review would add little value.

The primary Sol / High session implements and verifies the change directly.

No auxiliary reviewer is required.

---

## Homey `delegate`

Use `delegate` when the implementation is well specified and one worker materially improves execution.

Use Luna / Max for:

* routine Flow wiring;
* boilerplate;
* bounded manifest updates;
* simple capability handling;
* translations;
* straightforward tests;
* mechanical implementation following an already settled architecture.

Use Terra / High for:

* complex driver/device lifecycle behavior;
* capability migration;
* pairing or repair redesign;
* authentication/token refresh;
* race conditions;
* reconnect logic;
* persistence;
* restart recovery;
* cross-driver shared code;
* security-sensitive implementation;
* difficult debugging;
* wider-blast-radius refactoring.

The primary Sol session independently verifies the complete result.

A fresh Sol reviewer is not automatically required for `delegate`.

---

## Homey `audit`

Prefer `audit` when the primary Sol session should implement but independent review is warranted because of compatibility or correctness risk.

Strong candidates include:

* material Flow compatibility changes;
* settings lifecycle changes;
* API/session handling;
* release-bound compatibility-sensitive fixes;
* changes where static correctness is difficult to assess;
* changes affecting several existing device behaviors without requiring delegated implementation.

The primary Sol session implements and verifies.

A fresh read-only Sol / High reviewer then inspects the accumulated result.

---

## Homey `full`

Strongly consider `full` for broad or high-risk changes such as:

* migration of capabilities across existing paired devices;
* changing stored device data or device identity;
* authentication/session architecture redesign;
* persisted data-format migrations;
* significant pairing/repair redesign;
* cross-driver architecture changes;
* major lifecycle/persistence redesign;
* security-sensitive changes;
* broad release-bound refactoring affecting existing installations;
* changes with a substantial risk of breaking existing user Flows or paired devices.

`full` uses:

1. one selected implementation agent;
2. primary Sol verification;
3. fresh read-only Sol review.

Do not use `full` automatically for every Homey change.

---

# Sol Advisor Global Preflight

The preferred installation is global:

```text
$HOME/.agents/skills/orchestration/
$HOME/.agents/scripts/
$HOME/.agents/agents/
$HOME/.codex/agents/
```

Do not require repository-local Sol Advisor files when the valid global installation is available.

Preflight only selected auxiliary roles.

### Luna

```sh
sh "$HOME/.agents/scripts/install-agents.sh" \
  --target-dir "$HOME/.codex/agents" \
  --check-role luna
```

### Terra

```sh
sh "$HOME/.agents/scripts/install-agents.sh" \
  --target-dir "$HOME/.codex/agents" \
  --check-role terra
```

### Reviewer

```sh
sh "$HOME/.agents/scripts/install-agents.sh" \
  --target-dir "$HOME/.codex/agents" \
  --check-role sol
```

For `solo`, no auxiliary-role check is necessary.

If the repository intentionally contains a project-scoped Sol Advisor installation, use its corresponding `.agents` and `.codex` paths instead.

Do not mix global and project-scoped role files within one orchestration task unless the effective source has been explicitly identified and verified.

After agent installation or updates, start a new Codex task or IDE chat.

---

# Worker Specification for Homey

Before delegating to Luna or Terra, the primary Sol session must define:

## Objective

Specify:

* exact behavior;
* expected Homey-visible behavior;
* expected device-visible behavior;
* failure behavior;
* acceptance criteria.

## Files and Ownership

Specify:

* exact files/directories the worker owns;
* generated files that must not be edited;
* files explicitly outside scope.

## Interfaces

Identify every relevant stable interface, including:

* app ID;
* driver IDs;
* device class;
* capability IDs;
* Flow card IDs;
* Flow argument names/types;
* Flow token IDs;
* settings keys;
* device `data`;
* store values;
* pairing data;
* persisted timer/state formats;
* exported project APIs;
* network/API contracts.

## Constraints

Include:

* Homey SDK requirements;
* Compose source-of-truth rules;
* backwards compatibility;
* runtime compatibility;
* dependency restrictions;
* logging/security requirements;
* real-device test authorization boundaries;
* publishing/deployment restrictions.

## Verification

Specify applicable:

* syntax checks;
* build;
* lint;
* tests;
* Homey validation;
* publish-level Homey validation;
* generated-output inspection;
* Git checks;
* runtime smoke tests.

---

# Project Structure

Typical Homey application structure:

```text
/app.js or /app.ts
/api.js
/app.json
/.homeycompose/
/.homeybuild/
/drivers/
/lib/
/assets/
/settings/
/locales/
/docs/
/scripts/
/tests/
/node_modules/
```

Relevant details:

* `/app.js` or `/app.ts`: Homey App source entrypoint.
* `/api.js`: optional app Web API helpers.
* `/app.json`: application manifest; when `.homeycompose/` is used, treat generated sections as generated output.
* `/.homeycompose/`: source-of-truth Compose definitions where used.
* `/.homeybuild/`: generated build output; never edit manually.
* `/drivers/<driver_id>/`: driver/device code, pairing views, assets and driver manifests.
* `/lib/`: shared implementation.
* `/assets/`: application assets.
* `/settings/`: application settings UI.
* `/locales/`: translations.
* `/tests/`: tests when present.
* `/node_modules/`: third-party dependencies; never edit manually.

Before implementation, inspect where relevant:

* `package.json`;
* lockfile;
* app manifest;
* `.homeycompose/`;
* app entrypoint;
* affected drivers;
* affected devices;
* `lib/`;
* settings;
* tests;
* lint/build configuration;
* dependency versions;
* existing migrations;
* existing logging patterns.

---

# Homey Compose

If `.homeycompose/` is present and contains the applicable source definition:

* edit the Compose source;
* do not hand-edit the corresponding generated `app.json` content.

Treat the actual repository layout as authoritative. Do not assume every Homey project uses every possible Compose directory.

Do not edit `.homeybuild/` manually.

Generated output may be inspected when relevant to:

* entrypoints;
* packaging;
* exports;
* runtime behavior;
* generated manifest integrity.

Keep driver/device implementation synchronized with capability and Flow definitions.

Do not move existing definitions between manifest formats merely to modernize structure unless explicitly required.

---

# Homey Coding Conventions

Use the language and conventions already established by the repository.

Use JavaScript in JavaScript projects.

Use TypeScript only when the application is already a TypeScript project or the user explicitly requests a migration.

Follow existing Homey SDK patterns:

```text
Homey.App
Homey.Driver
Homey.Device
```

Prefer:

* simple changes;
* existing project helpers;
* existing abstractions;
* focused drivers/devices;
* genuinely shared logic in `/lib`;
* async/await consistent with project style;
* explicit error handling;
* bounded retry/backoff;
* deterministic cleanup.

Avoid:

* unnecessary abstractions;
* architecture rewrites unrelated to the task;
* duplicate polling;
* duplicate listeners;
* orphaned timers;
* unbounded retry loops;
* unnecessary dependencies.

Preserve existing comments unless they are no longer accurate.

Add comments only for complex or non-obvious behavior.

JSON must never contain comments.

---

# Logging

Use the existing repository logging style.

Prefer Homey logging methods where applicable:

```text
this.log()
this.warn()
this.error()
```

Log enough information to diagnose:

* initialization;
* migration;
* API failure;
* reconnect;
* retry;
* timer behavior;
* device communication failure;
* capability errors.

Never log:

* passwords;
* API secrets;
* access tokens;
* refresh tokens;
* authorization headers;
* session cookies;
* private certificates;
* unnecessary personal data;
* complete sensitive API responses.

Failure diagnostics should preserve the underlying safe error/cause.

---

# Backwards Compatibility

Existing paired devices and existing user Flows must continue to work after application updates unless a breaking change has been explicitly designed and accepted.

Do not silently remove, rename, or change:

* driver IDs;
* capability IDs;
* Flow card IDs;
* Flow card argument names;
* Flow card argument types/contracts;
* Flow token IDs;
* device class;
* device `data` identity;
* settings keys;
* store formats;
* pairing/authentication formats;
* persisted runtime formats;
* exported APIs.

When replacing a Flow card:

* retain the existing card where required for existing Flows;
* deprecate it where supported;
* preserve its run listener for existing installations;
* introduce a replacement rather than silently changing the old contract.

Do not assume all paired devices have the same capability set or originate from the current driver manifest version.

---

# Capabilities and Existing Devices

A capability declared for newly paired devices is not automatically guaranteed to exist on already paired devices.

Whenever runtime code relies on a capability:

1. determine whether existing paired devices may lack it;
2. check capability existence where appropriate;
3. add it using the supported SDK mechanism when migration is required;
4. handle migration failure;
5. keep migration idempotent;
6. keep driver manifest and runtime expectations synchronized.

Do not repeatedly add/remove the same capability on every initialization without need.

Capability migration must:

* detect whether migration is required;
* preserve device identity;
* preserve settings;
* preserve relevant existing values where possible;
* log migration start;
* log successful completion;
* log failure and underlying cause;
* tolerate repeated execution;
* avoid unnecessarily preventing device initialization.

Do not rename a capability as a substitute for migration planning.

---

# Device Identity

Device `data` is part of the durable identity of a paired device.

Do not silently change it.

Prefer stable immutable identifiers such as:

* manufacturer/device IDs;
* serial numbers;
* MAC addresses when appropriate and stable;
* persistent cloud IDs.

Do not use a changeable IP address as the sole durable device identity when a stable identifier exists.

Any migration affecting device identity is high risk and normally warrants `audit` or `full`.

---

# App, Driver and Device Lifecycle

Respect Homey lifecycle behavior.

Avoid creating duplicate:

* intervals;
* timeouts;
* realtime listeners;
* event listeners;
* polling loops;
* network sessions;
* subscriptions.

Consider behavior after:

* app restart;
* device reinitialization;
* reconnect;
* settings change;
* migration;
* network failure.

Store references where cleanup is needed.

Clean up resources through the applicable lifecycle mechanisms.

Use `this.homey` timer APIs where required by the applicable Homey runtime/project architecture rather than blindly introducing global timer APIs.

For persisted timer/state logic:

* make initialization idempotent;
* validate persisted state;
* restore valid active state;
* process state already expired at startup;
* prevent duplicate completion;
* define manual-override behavior;
* define replacement behavior;
* define cancellation behavior.

---

# Flow Cards

Preserve existing Flow card IDs.

Ensure applicable action and condition cards have registered listeners.

For triggers, keep consistent:

* trigger IDs;
* arguments;
* tokens;
* state.

Validate Flow arguments where needed.

Return useful errors on failure.

Do not silently change the contract of an existing Flow card.

When behavior changes materially, consider:

* backwards-compatible handling;
* migration;
* deprecated replacement card.

Flow-trigger behavior should have tests or explicit runtime smoke-test steps when practical.

---

# Homey API and Authentication

Do not assume that a Homey API helper provides an authenticated REST session merely because it returns an API-related object.

In particular, do not assume:

```text
this.homey.api.getApi(uri)
```

is a general authenticated REST owner session without verifying the actual supported behavior for the installed SDK/runtime.

For cross-device or owner-level REST access, use a currently supported authenticated mechanism verified against:

* installed dependencies;
* current Athom documentation;
* actual runtime behavior.

If using mechanisms such as owner API tokens or local URLs, verify the APIs actually exist in the installed implementation before coding against them.

Handle where relevant:

* session expiry;
* token expiry;
* HTTP 401;
* refresh;
* timeout;
* network failure;
* partial API failure.

Never log authentication material.

---

# Settings Page Lifecycle

For settings pages using `onHomeyReady(Homey)`:

* define the global lifecycle callback correctly;
* call `Homey.ready()` at the appropriate early point required by the current implementation;
* avoid temporal-dead-zone dependencies during early callback execution;
* ensure required DOM/controller code exists before it is referenced;
* handle optional UI/API work without blocking readiness unnecessarily;
* handle browser-console failures.

Do not assume browser APIs or module behavior that has not been verified in the actual Homey settings environment.

For `onSettings({ oldSettings, newSettings, changedKeys })`, use the provided `newSettings` values for newly submitted settings when appropriate rather than assuming `this.getSetting()` has already committed the new value before the handler resolves.

---

# Timer Diagnostics

For material timer behavior, log meaningful state transitions such as:

```text
started
replaced
cancelled
skipped
restored
expired
failed
```

Failure logs must preserve the safe underlying persistence, API, or capability error.

---

# Testing Allowed Without Additional Authorization

Codex may run safe local verification such as:

```text
node --check <modified-js-file>
configured lint
configured unit tests
configured build
npm audit --omit=dev
homey app validate
homey app validate --level publish
git diff --check
git status --short
git diff
```

Run only commands applicable to the actual repository.

Do not claim that an unavailable or nonexistent test command passed.

---

# Commands Requiring Explicit Authorization

Do not automatically run:

```text
homey app run
homey app run --remote
homey app install
homey app publish
homey app version
```

Also do not automatically:

* communicate with real devices for testing;
* change production Homey state;
* publish npm packages;
* commit;
* push;
* open pull requests;
* modify GitHub;
* change remote production data.

These operations require explicit user authorization.

---

# Static Validation Boundary

Never describe Homey runtime behavior as verified based only on:

* syntax checks;
* successful compilation;
* successful build;
* lint;
* unit tests;
* `homey app validate`;
* `homey app validate --level publish`;
* static review;
* Sol Advisor `solo` completion;
* delegated implementation;
* Sol reviewer `ship`.

Homey validation does not prove:

* app startup succeeds;
* the application entrypoint is loadable;
* authenticated APIs work;
* settings initialize;
* realtime listeners work;
* polling works;
* timers work;
* persistence survives restart;
* pairing works;
* real devices can be discovered;
* capabilities can be read/written;
* actual device communication works.

---

# TypeScript Entrypoint Verification

When TypeScript entrypoints, package module mode, bundling, or module configuration changes:

1. build the app;
2. inspect generated `.homeybuild/app.js` where applicable;
3. verify that the effective runtime entrypoint exports the expected class extending `Homey.App`.

For CommonJS output, confirm an effective direct export equivalent to:

```js
module.exports = AppClass;
```

Do not assume an `exports.default` build is usable as a Homey CommonJS entrypoint unless the actual runtime wrapper supports it.

Add or update regression coverage when entrypoint/module generation changes materially.

---

# Runtime-Sensitive Changes

Runtime-sensitive work includes:

* application startup;
* entrypoint/module changes;
* settings pages;
* authentication;
* Manager API access;
* realtime listeners;
* timers;
* intervals;
* persistence;
* restart recovery;
* capability migration;
* device capability writes;
* device communication;
* pairing;
* repair;
* discovery;
* Flow triggers.

Such work requires a runtime smoke test before **runtime verification** may be claimed.

If runtime testing has not been explicitly authorized:

1. complete all safe static verification;
2. provide exact runtime test steps;
3. mark runtime behavior as unverified.

Do not describe static completion as runtime completion.

---

# Minimum Runtime Smoke Tests

Select only the tests relevant to the change.

Possible checks include:

* app starts without an SDK/entrypoint exception;
* app initialization finishes without uncaught errors;
* affected drivers initialize;
* affected existing devices initialize;
* settings page loads without console errors;
* settings can be read/written;
* authentication succeeds;
* authenticated API enumeration succeeds;
* capability reads work;
* capability writes work;
* polling starts once;
* reconnect does not duplicate polling;
* timer starts;
* timer expires;
* timer applies expected state;
* persisted timer survives restart;
* expired timer state is handled correctly after restart;
* manual override cancels or changes timer behavior as designed;
* replacement/cancellation works;
* relevant Flow trigger executes;
* new capability appears on an existing paired device after migration;
* repeated initialization does not duplicate listeners or timers;
* pairing works for a new device;
* repair works where affected.

Record the tested scenario and result.

---

# Dependency Upgrades

“Latest” means the newest version mutually compatible with:

* Homey’s currently supported runtime;
* this application;
* package engine requirements;
* peer dependencies;
* build system;
* lint/test stack.

Do not blindly install the highest published version.

Before an upgrade inspect:

* `package.json`;
* lockfile;
* `engines`;
* peer dependencies;
* relevant release notes;
* Homey runtime compatibility;
* TypeScript compatibility;
* ESLint compatibility;
* Homey CLI compatibility.

Report separately:

* production dependency changes;
* development dependency changes;
* intentionally held versions;
* production audit findings;
* development-only audit findings;
* unresolved compatibility risks.

Do not present a development-only audit issue as a production vulnerability without explaining the actual dependency/exposure path.

---

# Verification Order

For applicable changes, use this general order:

1. inspect repository status;
2. inspect affected source/configuration;
3. perform implementation;
4. inspect modified files;
5. run `node --check` on modified JavaScript where applicable;
6. run configured build where applicable;
7. inspect generated output where relevant;
8. run configured lint;
9. run configured unit tests;
10. run `npm audit --omit=dev` where appropriate;
11. run `homey app validate`;
12. run `homey app validate --level publish` for release-bound or manifest-sensitive changes;
13. run `git diff --check`;
14. inspect `git status --short`;
15. inspect the complete accumulated Git diff;
16. perform Sol Advisor review only when selected route requires it;
17. perform authorized runtime smoke test, or provide exact manual steps.

Do not claim a command passed unless it actually ran successfully.

If a relevant check is skipped, state why.

---

# Sol Advisor Review Boundary

For `solo`:

* no fresh reviewer is required.

For `delegate`:

* no fresh reviewer is required unless the route is explicitly escalated.

For `audit`:

* fresh read-only Sol review is required.

For `full`:

* fresh read-only Sol review is required after delegated implementation and primary verification.

Reviewer verdicts:

```text
ship
fix-first
rethink
```

Any implementation correction after review invalidates the previous verdict.

A reviewer verdict never substitutes for Homey runtime verification.

---

# Pull Request and Git Safety

Do not automatically:

* create branches;
* switch branches;
* commit;
* amend;
* rebase;
* reset;
* clean;
* push;
* force-push;
* create pull requests;
* modify issues;
* modify pull requests;
* post comments;
* add labels;
* merge.

Perform these operations only when explicitly requested.

Read-only Git inspection is permitted.

Preserve unrelated local modifications.

---

# Completion Report

For Homey implementation work, report:

* changed files;
* implemented behavior;
* architecture/design decisions;
* affected Homey SDK interfaces;
* backwards-compatibility impact;
* capability/data migrations;
* Flow compatibility impact;
* dependency changes;
* verification commands and results;
* generated output inspected;
* skipped verification and reasons;
* runtime smoke-test status;
* exact manual runtime test steps when runtime testing was not authorized;
* remaining risks;
* Sol Advisor route used;
* implementation lane used if delegated;
* reviewer verdict only when `audit` or `full` was selected.

Distinguish clearly:

```text
statically verified
build verified
Homey package validated
runtime smoke tested
runtime unverified
```

Do not use “runtime verified” unless the relevant runtime smoke test actually succeeded.

Do not claim that a Homey change is fully complete beyond the evidence obtained.
