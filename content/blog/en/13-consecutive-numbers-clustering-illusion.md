---
title: Are consecutive numbers really rare? Randomness clumps more than you think
description: More than half of all winning draws contain consecutive numbers. Using the WWII London bombing map and the story of music shuffle features, we look at how people misread randomness.
---

People who pick their own numbers rarely include adjacent numbers like 12-13 or 43-44. They look too "neat", so they don't feel random. Yet the winning numbers for the most recent draw, draw 1243, were 9, 18, 24, 38, **43, 44**. Was that unusual?

## The chance of getting consecutive numbers

Counting all 8.15 million combinations gives a result that runs against intuition.

| Consecutive pairs | Share of combinations |
|---|---|
| 0 (none) | 47.1% |
| 1 | 40.4% |
| 2 | 11.2% |
| 3 or more | 1.3% |

Combinations with at least one consecutive pair make up **52.9%**, more than half. Combinations without consecutive numbers are actually the minority. The real records agree. Of draws 1–1243, **643 draws (51.7%)** had at least one consecutive pair ([consecutive numbers statistics](/statistics-consecutive.html)). You can also get the chance of no consecutive numbers from a formula. For six numbers not to touch, there must be at least one gap between each of them, and the number of such arrangements is ₄₀C₆ = 3,838,380. Dividing this by the total of 8,145,060 gives 47.1%.

## Principle 1: Human-made randomness is too even

In psychology experiments, when people are asked to write out coin-toss results that "look random", the same traits appear. They switch between heads and tails too often, and they almost never write a run of four or five of the same side. Yet if you really toss a coin 100 times, a run of six or more of the same side is quite likely.

People imagine randomness as "evenly scattered". But true randomness **clumps** here and there. An arrangement with no clumps is more likely a sign that someone has tampered with it.

## Principle 2: The London bombing map

There is a classic example of this illusion. Near the end of World War II, Germany attacked London with V-1 flying bombs. Londoners felt the bombs were falling in clusters on certain areas, and fear spread that Germany was aiming precisely.

In 1946 the British actuary R. D. Clarke divided south London into 576 small squares (0.25 km² each) and counted where 537 bombs had landed. He then compared this with the distribution expected if the bombs had fallen completely at random (the Poisson distribution).

| Hits per square | 0 | 1 | 2 | 3 | 4 | 5 or more |
|---|---|---|---|---|---|---|
| Expected if random | 226.7 | 211.4 | 98.5 | 30.6 | 7.1 | 1.7 |
| Actual | 229 | 211 | 93 | 35 | 7 | 1 |

The match was almost perfect. The clusters people read as "targeted strikes" were the clusters that occur naturally when bombs fall at random. This habit of reading clumps in randomness as intent is called the **clustering illusion**.

## Principle 3: A shuffle made less random on purpose

There is also a case from the opposite direction. Early music players shuffled songs truly at random, but when songs by the same artist played back to back, users complained that "shuffle is broken". In the end, makers changed shuffle to be **less random** so that the same artist would not play twice in a row. The goal was to give results that people "feel are random".

## What this means for picking lotto numbers

1. **Consecutive numbers are not rare.** It is normal for about every other draw to include consecutive numbers.
2. **Avoiding consecutive numbers gives no advantage in the odds.** Combinations with and without consecutive numbers have the same chance of winning.
3. **One or two consecutive pairs have little to do with overlapping other players' picks, but numbers packed tightly into one stretch are a different story.** Draw 1152 in December 2024 (30, 31, 32, 35, 36, 37) and draw 1162 in March 2025 (20, 21, 22, 25, 28, 29) had 35 and 36 1st-prize winners respectively. This means quite a few people deliberately pick combinations that look like one block on the play slip. A combination made only of consecutive numbers, like 1-2-3-4-5-6, is an even clearer case. In this site's [number generator](/index.html#sec-generator), checking the "six consecutive numbers" pattern filters out such combinations.

Randomness is less even, and more clumped, than people imagine. If you see a "pattern" in winning numbers, it is usually just what randomness really looks like.

> The theoretical share of consecutive numbers was calculated directly from all 8,145,060 combinations, and the real share and the number of 1st-prize winners come from this site's data for draws 1–1243. The London bombing figures are from R. D. Clarke (1946), "An application of the Poisson distribution".
