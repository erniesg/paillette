# Full-width About and Technical Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make About and Technical share the same centered production editorial layout and make the Browser-to-R2 asset exchange unmistakable.

**Architecture:** Keep the existing route and SVG component boundaries. Change only layout tokens and the diagram's declared connection data so the visual treatment remains lightweight, responsive, and testable.

**Tech Stack:** Remix, React, TypeScript, Tailwind CSS, inline SVG, Vitest, Testing Library.

## Global Constraints

- Page content uses the production `mx-auto max-w-7xl` frame with matching responsive gutters.
- Narrative copy uses the production `max-w-4xl` reading column.
- The feedback form remains constrained because it is an input workflow, not narrative copy.
- Technical uses About's page padding, heading scale, body leading, and section rhythm.
- RRF remains separate from R2; the browser requests and receives artwork assets directly.
- Existing unrelated working-tree changes remain untouched.

---

### Task 1: Align About and Technical layout

**Files:**

- Modify: `apps/web/app/routes/about.tsx`
- Modify: `apps/web/app/routes/technical.tsx`
- Test: `apps/web/app/routes/__tests__/about-layout.test.tsx`
- Test: `apps/web/app/routes/__tests__/technical-route.test.tsx`

**Interfaces:**

- Consumes: existing Tailwind layout class constants.
- Produces: `ABOUT_BODY_GROUP_CLASS_NAME` and `TECHNICAL_MAIN_CLASS_NAME` layout contracts.

- [ ] **Step 1: Write failing tests**

Assert About and Technical export the production `max-w-7xl` page frame and `max-w-4xl` reading-column contracts.

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm --filter @paillette/web exec vitest run app/routes/__tests__/about-layout.test.tsx app/routes/__tests__/technical-route.test.tsx`

Expected: FAIL when either route diverges from the production layout contracts.

- [ ] **Step 3: Implement the layout changes**

Export the production layout constants from About and restyle Technical with the matching main, heading, body, and section classes.

- [ ] **Step 4: Verify the tests pass**

Run the same focused Vitest command and expect both files to pass.

### Task 2: Clarify the R2 exchange

**Files:**

- Modify: `apps/web/app/components/technical/system-architecture-diagram.tsx`
- Test: `apps/web/app/components/technical/system-architecture-diagram.test.tsx`

**Interfaces:**

- Consumes: the `CONNECTIONS` topology array.
- Produces: separately labeled `GET artwork asset` and `image response` connections linked to `visitor-browser` and `artwork-assets`.

- [ ] **Step 1: Write a failing topology test**

Assert both asset-flow labels exist and the ambiguous `load images` label does not.

- [ ] **Step 2: Verify the test fails**

Run: `pnpm --filter @paillette/web exec vitest run app/components/technical/system-architecture-diagram.test.tsx`

Expected: FAIL because the diagram still exposes only `load images`.

- [ ] **Step 3: Implement the two-way connection**

Replace the single bottom connection with two visibly separated paths: browser-to-R2 request and R2-to-browser response. Keep both linked to the same node IDs for reciprocal highlighting.

- [ ] **Step 4: Verify the test passes**

Run the focused diagram test and expect it to pass.

### Task 3: Verify the finished surface

**Files:**

- Verify only; no planned source changes.

**Interfaces:**

- Consumes: the completed route and diagram behavior.
- Produces: test, typecheck, build, visual, and agent-evidence proof.

- [ ] Run `pnpm --filter @paillette/web test`.
- [ ] Run `pnpm --filter @paillette/web typecheck`.
- [ ] Run `pnpm --filter @paillette/web build`.
- [ ] Inspect `/about` and `/technical` at desktop and narrow widths.
- [ ] Run `scripts/agent-evidence`.
