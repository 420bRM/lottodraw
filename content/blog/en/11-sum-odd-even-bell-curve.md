---
title: Why do lotto sums cluster near 138? Odd/even, low/high and the bell curve
description: Why winning-number sums cluster between 100 and 175, explained from two dice up to the central limit theorem. We also worked out the real distribution of odd/even and low/high splits.
---

Lotto statistics pages often give the same advice: "Keep your number sum between 100 and 175" and "An odd/even split of 3:3 or 4:2 is best." This advice does match the real draw records. But does it raise your chance of winning? Let's start with two dice.

## The sum of two dice

When you roll two dice, 7 is the most likely sum. That is because 7 has the most ways to happen, six in all: (1,6), (2,5), (3,4), (4,3), (5,2), (6,1). The sums 2 and 12 have only one way each. Each face is equally fair at 1/6, yet the **sum** clusters in the middle.

The general form of this effect is the **central limit theorem**. When you add up many independent values, the distribution of the sum gets closer and closer to a **bell shape (normal distribution)**, whatever each value's own distribution looks like. This is also why results made of many added factors, such as height, test scores and measurement error, take a bell shape.

## The real distribution of lotto number sums

The sum of six lotto numbers is at least 21 (1–6) and at most 255 (40–45). Working through all 8.15 million combinations gives the following.

| Item | Value |
|---|---|
| Mean | 138 |
| Standard deviation | about 30 |
| Most common sum | 138 (105,690 combinations) |
| Share of combinations with a sum of 100–175 | 79.0% |

In real draws 1–1243, the winning-number sums had a mean of **138.3** and a standard deviation of 30.7, almost the same as theory. The smallest sum was 48 and the largest was 238. A bar chart with the theoretical curve laid over it is on the [number sum distribution](/statistics-sum.html) page.

The advice "keep the sum between 100 and 175" really means **pick from 79% of all combinations**. In fact, **77.6%** of the winning numbers in draws 1–1243 fell in this range. Most winning numbers land in this range not because the draw machine likes it, but because that range holds so many combinations. A single combination with a sum of 138 and the single combination with a sum of 21 (1-2-3-4-5-6) have exactly the same chance of winning.

## Odd/even split

From 1 to 45 there are 23 odd numbers and 22 even numbers. Here is the share of combinations by how many of the six numbers are odd.

| Odd:even | All combinations | Actual, draws 1–1243 |
|---|---|---|
| 6:0 | 1.2% | 1.5% |
| 5:1 | 9.1% | 8.0% |
| 4:2 | 25.1% | 26.5% |
| 3:3 | 33.5% | 33.3% |
| 2:4 | 22.7% | 22.6% |
| 1:5 | 7.4% | 6.7% |
| 0:6 | 0.9% | 1.4% |

Because there is one extra odd number, 4:2 (25.1%) is slightly more common than 2:4 (22.7%). The real records also match theory to within about 1 percentage point ([odd/even split](/statistics-even-odd.html)). 3:3 is the most common, but it comes up only about one time in three, and if you insist on matching 3:3 you throw away the other 66.5%.

## Low/high split

If you call 1–22 low and 23–45 high, there are 23 high numbers. So the distribution has exactly the same shape as odd/even: four high and two low numbers come up 25.1% of the time, more than the reverse (22.7%). The real records are on the [low/high split](/statistics-low-high.html) page.

## Principle: a common type is not the same as a common combination

The key here is to separate a **type** from an **individual combination**. The type "sum in the 130s" wins often, but only because many combinations belong to it. **Each** combination within that type has the same chance as every other combination.

Here is an analogy. If you pick one student at random from a school, that student is likely to be 160–175 cm tall, because many students are that height. That does not mean each student in that range is more likely to be picked.

## It is still useful

Sum and odd/even filters are useful not for the odds but for **not overlapping with other people**. Combinations with extreme sums (for example, all single-digit numbers) or a 6:0 split may be chosen by many people who pick by a pattern. On the other hand, if many people pick only the "good ratios" such as 3:3 and sums in the 130s, overlaps can happen there too. For more, see [why jackpots get split](/blog/why-jackpots-split.html).

> The theoretical distribution was calculated directly from all 8,145,060 combinations, and the real distribution uses this site's data for draws 1–1243.
