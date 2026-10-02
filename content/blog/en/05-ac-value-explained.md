---
title: Understanding the AC value, and what the gaps between numbers tell you
description: From the definition of the AC value to its actual spread across all 8.15 million combinations and its link to the Golomb rulers used to lay out radio telescopes. We sort out what the AC value can and cannot do.
---

The AC value (Arithmetic Complexity) is the most "scientific-sounding" measure in Lotto statistics. The name sounds hard, but the idea is simple. It counts **how varied the gaps between the six numbers are**.

## How to calculate it

1. Pair up the six numbers in every possible way, and in each pair subtract the smaller from the larger. There are 15 pairs in all.
2. Count how many **different values** there are among the 15 differences.
3. Subtract 5 from that count.

You subtract 5 because any combination always has at least 5 different differences. So the AC value runs from 0 to 10.

For example, take the winning numbers from the most recent draw, draw 1243: 9, 18, 24, 38, 43, 44. All the differences are 9, 15, 29, 34, 35, 6, 20, 25, 26, 14, 19, 20, 5, 6, 1. Since 20 and 6 each appear twice, there are 13 different values, and the AC value is **8**.

## The actual spread across all 8.15 million combinations

Here is the distribution worked out over all 8,145,060 possible combinations, side by side with the distribution of actual winning numbers from draws 1–1243.

| AC value | All combinations | Actual winning numbers |
|---|---|---|
| 0–3 | 0.4% | 0.6% (7 draws) |
| 4 | 1.3% | 1.9% |
| 5 | 3.0% | 3.3% |
| 6 | 10.1% | 9.5% |
| 7 | 14.1% | 13.9% |
| 8 | 32.9% | 34.8% |
| 9 | 19.8% | 17.7% |
| 10 | 18.5% | 18.3% |

Combinations with an AC value of 7 or more make up **85%** of the total. It is true that "most winning numbers have a high AC value", but that is not because the draw machine likes high AC values. It is **because 85% of all combinations are like that to begin with**. Among actual winning numbers, AC values of 7 or more account for **84.7%**, almost the same as the 85.2% for all combinations. That only confirms the draw is random.

## What does an AC value of 0 look like?

An AC value of 0 means a combination with exactly five different differences, in other words an **arithmetic sequence**. Examples are 1-2-3-4-5-6, 5-10-15-20-25-30 and 1-8-15-22-29-36. Out of 8.15 million, there are only **180** of them. Yet these are exactly the combinations people often buy "for fun". Their odds are the same as any other combination, but if they win, many people share the prize.

## What an AC value of 10 really is, a Golomb ruler

An AC value of 10 means the 15 differences are **all different**. In mathematics, a set like this is called a **Golomb ruler**. It is a ruler with only a few marks, where no two pairs of marks are the same distance apart, so one ruler can measure many lengths, each in exactly one way.

Golomb rulers have real uses. In a radio telescope interferometer, where antennas are placed in a row, spacing them so that no gap repeats gives more information for the same cost. The same idea is used in assigning radio frequencies and in cryptography. Of all Lotto combinations, 18.5% are "perfect rulers" like this.

## What the AC value can and cannot do

**What it cannot do**: change your odds of winning. A combination with an AC value of 10 and a combination with an AC value of 0 have exactly the same 1 in 8,145,060 chance of 1st prize.

**What it can do**: filter out combinations that people picked by a pattern. Combinations with a low AC value are usually picked by following a fixed gap or a shape, so they are more likely to end in a [split jackpot](/blog/why-jackpots-split.html). Leaving out AC values of 6 or below removes about 15% of all combinations.

This filter is not a cure-all, though. Draw 1019 (1, 4, 13, 17, 34, 39), which had 50 1st-prize winners, had the highest possible AC value, **10**. Winners piled up in that draw not because of regular gaps, but because many people had picked "frequently drawn numbers". The AC value catches only one human habit, regular gaps.

## Summary

The AC value sums up how "irregular" a combination is in a single number. It is used honestly when it is treated not as a prediction tool but as **a tool for spotting combinations that look hand-picked**. This site's [AC value statistics](/statistics-ac.html) page has the full historical distribution and an AC value calculator, so you can check the AC value of your own six numbers right away.

> The distribution for all combinations is calculated over all 8,145,060 combinations, and the actual distribution uses this site's data for draws 1–1243.
