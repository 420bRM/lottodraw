---
title: What do cold numbers, pair numbers and AC value mean? A glossary of lotto statistics
description: This post defines the terms used on the statistics pages one by one, and separates what each measure can tell you from what it cannot.
---

Lotto statistics use many words that rarely come up in daily life. This post is a glossary of the terms used on this site's statistics pages. For each term, it notes **what it counts** and **what that number can tell you**. To give the conclusion up front: all of these measures are tools for summarizing the past, and none of them can predict the next draw.

## Appearance count / appearance rate

The number of times a given number has come up as a main number so far. As of draw 1243, the average is 165.7 times, with a standard deviation of about 12. The appearance rate is this count divided by the total number of draws, and its theoretical value is 13.3% (6/45). How large a difference in counts is still normal is worked out in [Is it special that number 34 came up 186 times?](/blog/is-number-34-special.html).

## Cold numbers (numbers that have not come up for a while)

**Numbers that have not come up even once in the last N draws.** This site's [cold numbers page](/statistics-gap.html) ranks each number by how many draws it has gone without appearing since it last came up (as of draw 1243, number 5 is at the top, at 30 draws). If you set the window at the last 10 draws, the chance that a number misses 10 draws in a row is (39/45)¹⁰ ≈ 24%, so at any point there are usually about 10 cold numbers.

The idea that 'it hasn't come up for a long time, so it will come up soon' is the gambler's fallacy. The chance that a cold number comes up in the next draw is 13.3%, the same as for any other number. An explanation using independent trials and the geometric distribution is in [Will a long-missing number come up soon?](/blog/cold-numbers-gamblers-fallacy.html).

## Current gap (longest gap)

The number of draws since a number last came up. The average gap is about 7.5 draws (45/6), and the historical record has several cases of a number going more than 30 draws without appearing.

## Pair numbers (coming up together)

**The number of times two numbers have come up together in the same draw.** The chance that two given numbers both come up in one draw is (6×5)/(45×44) ≈ 1.5%, so over 1243 draws a pair is expected to come up together about 18.8 times. The actual top pair is 11 and 21, at 34 times ([pair numbers ranking](/statistics-pair.html)). There are as many as 990 possible pairs, so it is natural that a few of them have come up together more than 30 times. The more pairs there are, the more values stand out by chance. The post that explains this with the birthday problem and multiple comparisons is [Are pair numbers real?](/blog/pair-numbers-multiple-comparisons.html).

## AC value (Arithmetic Complexity)

A value that shows how irregularly the six numbers are spread out. It is calculated as follows.

1. Take every pair of the six numbers and find the difference within each pair. (15 differences)
2. Count how many distinct values there are among those differences.
3. Subtract 5 from that count.

For example, 1-2-3-4-5-6 has only five kinds of difference (1 to 5), so its AC value is 0. When the numbers are spread out evenly, the value can go as high as 10.

Most actual winning combinations have an AC value of 7 or more (84.7% of draws 1–1243, [AC value statistics](/statistics-ac.html)). But this does not mean 'high AC values come up more often'. It is because **most possible combinations have a high AC value to begin with**. The AC value is useful for something else. A combination with a low AC value is more likely to be one a person picked in a regular pattern, so it can serve as a filter to avoid [shared jackpots](/blog/why-jackpots-split.html). The full distribution and the story of the Golomb ruler are covered in [Understanding the AC value properly](/blog/ac-value-explained.html).

## Odd/even ratio / low/high ratio

The ratio of odd to even numbers, and of low numbers (1–22) to high numbers (23–45), among the six numbers. 3:3 and 4:2 are the most common, and again this is because those combinations are the most numerous to begin with. Combinations with a 3:3 odd/even split make up about 33% of all combinations. ([Why do number sums cluster around 138?](/blog/sum-odd-even-bell-curve.html))

## Number sum

The sum of the six numbers. The possible range runs from 21 (1–6) to 255 (40–45), and the average is 138. The sums of actual winning numbers also mostly fall between 100 and 175. The distribution is bell-shaped because far more combinations produce a sum in the middle than at either end.

## Last digit / consecutive numbers

The last digit is the ones digit (for example, 3, 13, 23, 33 and 43 all have last digit 3), and consecutive numbers are two numbers in a row, such as 12-13. More than half of all winning combinations contain at least one pair of consecutive numbers. Many people avoid consecutive numbers on purpose, but combinations with consecutive numbers do not come up any less often. ([Are consecutive numbers really rare?](/blog/consecutive-numbers-clustering-illusion.html))

## In summary

| Term | What it can tell you | What it cannot tell you |
|---|---|---|
| Appearance count | Whether the past distribution is within the range of randomness | Which numbers will come up next |
| Cold numbers | A summary of recent results | Which numbers will come up soon |
| Pair numbers | The record of numbers that came up together | Which pairs will come up together |
| AC value, odd/even, sum | How 'regular' a hand-picked combination is | Any difference in the odds of winning |

Statistics are at their most honest when you use them to check that the draw is fair and to pick numbers that are less likely to overlap with other people's.
