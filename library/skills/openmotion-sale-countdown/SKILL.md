---
name: openmotion-sale-countdown
description: >-
  OpenMotion — Make a short sale countdown teaser: split-flap digits roll down to the true number of
  days or hours left, then the date, the offer teaser and a call to action. Use when someone asks for a
  Black Friday or Cyber Monday countdown, a "sale starts in N days" or "ends in N hours" video, a launch
  or drop countdown, or a last-chance reminder. Produces an editable 9.6 second HyperFrames project and
  MP4 in 9:16, 4:5, 1:1 or 16:9.
---

# OpenMotion · Sale Countdown

An OpenMotion Skill. The advertiser's brand leads the film and its colour can replace the accent; the
end card carries a small "Made with OpenMotion" sign-off (`--no-credit` removes it).

A video cannot know when it is watched, so the number must be true when it is posted. The script
computes it from two real moments: when the video goes live (`postAt`) and when the sale starts or ends
(`target.date`). It rounds down, so "6 days" never overstates the time left. Post a fresh render each
day of a teaser run instead of reusing yesterday's number.

## 1. Collect the moments

Ask for the occasion, whether the countdown is to the start (`starts`) or the end (`ends`) of the sale,
the exact start or end time with its time zone, when the video will be posted, a short teaser line
("Up to 40% off sitewide") if the offer is public, and the call to action. Never invent the date or the
discount.

## 2. Write countdown.json and check it

Use the [schema](references/schema.md), then:

```sh
node scripts/build.mjs --check countdown.json
```

The check refuses a target before `postAt`, less than one unit left, more than 99, and text too long to
fit. It prints the number that will appear; confirm it with the user.

## 3. Generate and render

```sh
node scripts/build.mjs countdown.json out/ [--aspect 9:16] [--no-credit]
cd out && npx hyperframes check && npx hyperframes render -o countdown.mp4
```

| Beat | Time | What happens |
| --- | --- | --- |
| Kicker | 0–1.3 s | The occasion and "starts in" / "ends in" |
| Roll | 1.3–5.2 s | Split-flap reels step down a few numbers and land on the true value; "days to go" / "hours left" |
| Date | 5.2–7.6 s | The exact date as the shop writes it, then the teaser |
| Call to action | 7.6–9.6 s | Button, URL, sign-off |

The unit is days when two or more days are left, otherwise hours; set `unit` to force one. Each digit
is a reel moved by the timeline, so every frame is deterministic and editable. `theme`, `brand.accent`
and `labels` work as in the sale-promo Skill. The film is silent; add music in the editor and put a
tick on each flip if the user wants sound.

The generator uses the GSAP and Geist font installed with OpenMotion; when this Skill is installed on
its own, set `OPENMOTION_HOME` to the OpenMotion checkout or run `npm install gsap`. In OpenMotion,
import or open `out/` as a project and continue through the usual editor preview and export.

## 4. Review

Walk [references/review.md](references/review.md) and report what you checked.

## Provenance

Deriving the remaining time from fixed moments instead of a ticking timer, choosing days or hours by the
span, and reel-style digit motion follow the MIT-licensed
[countdown-video](https://github.com/iart-ai/tiktok-video-skills/tree/main/skills/countdown-video) Skill
by iart.ai (Copyright (c) 2026 iart.ai). That Skill targets Remotion; this one is rewritten for
OpenMotion's HTML compositions in our own words and code. This Skill is Apache-2.0, like the rest of the
repository.
