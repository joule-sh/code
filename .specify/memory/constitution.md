<!--
Sync Impact Report
- Version change: (template) → 1.0.0
- Modified principles: none (initial ratification)
- Added sections: Core Principles (I–III), Constraints, Development Workflow, Governance
- Removed sections: template slots for principles 4 and 5, left out on purpose;
  three principles were chosen and the template's count is not a requirement
- Templates checked: plan-template.md reads the constitution at run time through
  its Constitution Check section and needs no edits; spec-template.md and
  tasks-template.md do not reference it
- Follow-up TODOs: none
-->

# Joule Code Constitution

## Core Principles

### I. Lumen for Everything

The CLI, the relay, the daemon and the page the relay serves are written in Lumen,
built with the Lumen toolchain the test workflow pins, and shipped as one binary per
side. A feature MUST NOT introduce a second language, runtime or build system. The
exception is a shim the compiler cannot yet express, such as the C shims under
`src/vendor`, and each one MUST be recorded in `docs/` or `specs/` with the
capability it stands in for, so it can be removed when the compiler catches up.

Rationale: one language keeps the three sides sharing one protocol vocabulary and
one set of tests, and the project dogfoods the toolchain it depends on.

### II. Code Without Comments, Files Under 450 Lines

Source files under `src/` and `editor/` MUST NOT contain comment lines, and a `.ts`
or `.c` file MUST NOT exceed 450 lines. The pre-commit hook in `.githooks` enforces
both; a commit MUST NOT bypass it with `--no-verify`. When a file reaches the cap it
is split into a module under a folder for the concern, never grown further. When
something needs explaining, the explanation goes into a `docs/` page or a
`specs/NNN` decision record, and the code names the thing clearly enough that a
reader can find it.

Rationale: intent recorded once in a spec stays true; intent scattered through
comments drifts from the code around it. The size cap keeps every module readable
in one sitting.

### III. A Harness for Every Behaviour

Every user-visible behaviour MUST be exercised by a `make test` case or a harness
target in the Makefile driven by `bin/stub_model`, so it runs without a live model.
A change that adds or alters behaviour MUST add or update the harness for it in the
same pull request, or state in the pull request why no harness applies. Tests MAY be
written before or after the code; ordering is the author's choice, coverage is not.

Rationale: the harnesses are how the terminal, daemon, relay and editor are proven
to still agree with each other after a change, and the stub model is what keeps that
proof deterministic and free.

## Constraints

- **Four platforms build.** Every change MUST build for x86_64 Linux, Apple Silicon
  macOS, Intel macOS and x86_64 Windows. A feature that only works on some of them
  MUST say so in its spec, with the reason, before it is planned.
- **Spec Kit features live in `specs/`.** A feature directory is
  `specs/NNN-short-name/` and continues the numbering the decision records already
  use there; `specs/README.md` says how to tell the two apart. Both kinds are listed
  in that file's index.

## Development Workflow

- **One branch per feature.** `/speckit-specify` creates the numbered feature branch
  and the work stays there until merged.
- **Order of artifacts.** `spec.md`, then `plan.md`, then `tasks.md`, then code.
  A plan MUST record any deviation from a principle above under its Constitution
  Check, with the reason, before implementation starts.
- **Merge gate.** A pull request is mergeable only when all of the following hold:
  1. `make build` and `make test` are green in the test workflow.
  2. The pre-commit hook ran on every commit; nothing was committed with
     `--no-verify`.
  3. The harness for the behaviour was added or updated, or the pull request states
     why none applies.
  4. `README.md`, `docs/` or `specs/` were updated in the same pull request whenever
     behaviour or a recorded decision changed.

## Governance

This constitution takes precedence over other written practice in the repository.
Where a template, skill or doc conflicts with it, the constitution wins and the
other document gets fixed.

Amendments are made by a pull request that edits this file and bumps the version:
MAJOR when a principle is removed or redefined, MINOR when a principle or section is
added or materially expanded, PATCH for wording and clarification. The pull request
description says which principle changed and why. Every `/speckit-plan` run checks
the plan against the principles above and records the result in the plan's
Constitution Check section; a reviewer MUST verify that section before approving.

**Version**: 1.0.0 | **Ratified**: 2026-09-04 | **Last Amended**: 2026-09-04
