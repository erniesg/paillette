# Paillette — demo script v2

Supersedes `webmcp-vo-script-final.md`, which was written for the earlier
framing: delegation, *"let AI be your eyes and ears"*, and a board that was the
end of the interaction. The build has moved past all three.

**Target 2:45.** Under three minutes is a ceiling, not a target.

Every claim below is marked:
**[P]** proven — a report or transcript attests to it ·
**[U]** built, unverified end to end — the shot may not exist yet.

---

## 0:00–0:22 — Cold open. The thing itself.

*No logo. No upload. No indexing. Start inside the work.*

**On screen:** a board of twelve paintings, already dealt.
Then two rejects. Then the board re-deals — and two works do not move.

> **VO:** I can't tell you what I want. But I can tell you when I see it.

*Beat. Let the re-deal land with no narration over it.* **[P]**

**On screen, as the note writes itself under the board:**
*"You rejected the two brown-and-ochre oils; these keep the warmth in
firelight, gold, and clear sunlit colour."* **[P]**

> **VO:** I didn't say brown. I rejected two pictures.

*The colour swatches sit under the note — the ones it read, picks whole,
rejects struck through.* **[P]**

**Shot:** `/nga/search`. Type *"something warm for above the sofa"*, `X` the two
darkest works, Enter. This is the negative-control run; it has been executed and
the note above is verbatim.

---

## 0:22–0:50 — What just happened, and why it isn't a search box.

> **VO:** Most collections can only answer questions their catalogue
> anticipated. Paillette searches what's actually in the picture — so the
> agent can see what I kept and what I threw out, and say what they had in
> common.

**On screen:** hover a work, `P` to keep, `X` to drop. The marks are the
plainest thing on the page. **[P]**

> **VO:** Keep. Drop. That's the whole language.

**On screen:** two works side by side, a question between them in serif.
Click one. A third option: *neither*. **[U]**

> **VO:** And when it can't tell which way I'm leaning, it asks with pictures
> instead of words.

---

## 0:50–1:12 — The part with no agent in it.

**On screen:** flags set. The prompt bar is empty. Press Enter.
The board re-deals. Picks hold position.

> **VO:** No model ran there.

*Beat.*

> **VO:** The re-deal is relevance feedback — the same thing a photographer does
> culling a contact sheet, and it works whether or not anyone's driving. The
> agent isn't the machinery. It's a second pair of hands on the same controls.

**Shot:** provable — verified in a browser, and with no WebMCP host present at
all. **[P]** Worth showing the network panel staying quiet.

---

## 1:12–1:50 — Curating, not retrieving.

> **VO:** Once we've narrowed it, it writes the show.

**On screen:** a title appears. A statement. A label under each work. **[P]**

**On screen:** the human edits the statement — deletes a line, types
*"it's not about weather, it's about leaving."* **[U]**

> **VO:** That's not a filter. It's what the show is about — and it's mine to
> change.

**On screen:** the board re-selects; the labels rewrite around the correction.
The human's own sentence stays. **[U]**

> **VO:** Same paintings, different show. The labels follow the argument, not
> the catalogue.

---

## 1:50–2:10 — It leaves something behind.

**On screen:** one control. Click. A link.
Then the link opening in a clean browser — title, statement, works, labels.

> **VO:** And it doesn't die with the tab.

**Shot:** https://paillette-stg.berlayar.ai/e/MKwsxHy — live, opens cold with
no session, serves real preview cards. **[P]**

**On screen (the actual OG card as it renders in a chat app):**
*Everything the Light Left Behind — "It is not about weather. It is about
leaving."* **[P]**

---

## 2:10–2:28 — Scale as evidence.

> **VO:** This is the National Gallery of Art's entire open-access
> collection — sixty-three thousand, two hundred and fifty-three works. **[P]**

**On screen:** *stormy seascapes* · *Rembrandt etchings from the 1640s* —
each returning immediately.

> **VO:** Scale is what makes it useful. The loop is what makes it new.

*Replaces the old line "The true power of Paillette is unleashed when we run it
over an entire collection."*

**Then, briefly:** open a work, let it be described aloud. Two or three seconds
of audio, no more. **[P]**

> **VO:** And it can be explored by ear — not read out to you, but steered:
> compare these two, open the quieter one, tell me what's in the corner.

---

## 2:28–2:45 — How it's built, shown rather than claimed.

**On screen:** the activity glyph in the corner, animating. Click it. It expands
into the live log — every tool call, its arguments, its duration. **[U]**

> **VO:** Paillette registers twenty-five tools on `document.modelContext`.
> Every one of them wraps something I can also do by hand, on the same page,
> with the same result. There's no agent-only back door — there's one
> workspace, and two of us using it.

**Shot:** verify the count before filming; it moved twice during development.
**[P]** for the mechanism, **[U]** for the glyph shot.

---

## End card

**On screen:**

> **Paillette**
> For everything you can't name. And everything you can't see.

> **VO:** Most of these have never hung anywhere.

---

# Two decisions for you

## 1. Completing the co-curator beat

Recommend combining, at 1:50:

> **"I didn't search for a single one of these. I described a room."**

It's the most literally true of the footage — the sofa instruction produced the
board without a single manual query. *"Sixty-three thousand works, narrowed to
five, for one wall in one room"* is the alternative and pairs well as a second
line if the beat needs more air.

*Co-curator*, not co-creator: the paintings already exist. What's co-created is
the curation.

## 2. The ending

Recommend **"For everything you can't name. And everything you can't see."**

It closes the opening loop — can't name maps to search-by-resemblance, can't see
maps to read-aloud — without announcing a roadmap. Already rejected: *"Today, on
one collection. Next, on every collection"* (roadmap-speak) and *"in the future,
your ears too"* (read-aloud ships today).

---

# What this script does NOT claim

Deliberately absent, because nothing yet proves them:

- That voice drives the demo. **Text is the spine.** Headless Chromium can't do
  real speech recognition, so any genuinely spoken take must be filmed on a real
  machine.
- That the deal animation runs on the real search page rather than the
  `/night/deal` harness — verify before filming.
- Any indexing duration. The 100-work sample takes ~5.5 minutes; speed-ramp it
  and never state a number the footage doesn't support.
- That the agent "understands" the paintings. It reads indexed swatches, medium,
  year and classification. That's enough to be true and specific; more would be
  a claim a judge could break in one try.
