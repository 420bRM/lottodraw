---
title: Are pair numbers real? 990 pairs and the multiple comparisons trap
description: Do number pairs that often come up together mean anything? The birthday problem and the Texas sharpshooter fallacy explain why searching hard enough always turns something up.
---

Pair numbers are **two numbers that have often come up together in the same draw**. Many statistics sites have tables like "pairs that have come up together most often", and claims that it pays to play those pairs together are common. To give the conclusion first, the pair at the top of a pair numbers table is **a value that randomness alone is certain to produce**. Let's see why.

## How often a pair should come up together

The chance that two given numbers come up together in one draw is

> (6/45) × (5/44) ≈ 1.52%

Over 1243 draws, then, a pair is expected to come up together about **18.8 times**, with a standard deviation of about 4.3. Most pairs should fall somewhere between 10 and 27 times.

## But there are 990 pairs

The number of pairs you can make from 45 numbers is 45×44÷2 = **990**. If you count 990 pairs at once, a few of them are bound to stray far from the average. We simulated 1243 draws under the same conditions as the real lotto 2,000 times, with the following results.

| Item | Random simulation (median) | 90% range |
|---|---|---|
| Pair that came up together most often | 34 times | 32–38 times |
| Pair that came up together least often | 7 times | — |
| Number of pairs that came up together 30+ times | about 10 pairs | — |

In a world where the average is 18.8, 34 is almost double. On its own it would be an extreme value, 3.5 standard deviations out, but as the maximum of 990 pairs it is an ordinary result. What does the real record show? In draws 1–1243, the pair that came up together most often is 11 and 21, at **34 times**. That is exactly the median of the random simulations. In reality 8 pairs came up together 30 or more times, and the least frequent pair came up together 7 times, which also matches what randomness would lead you to expect. The top of the pair numbers table looks just like the landscape that randomness produces.

## Principle 1: the birthday problem

A famous example of the same principle is the **birthday problem**. How many people do you need in a class for the chance that two of them share a birthday to pass 50%? The answer is **23**. That seems too few compared with 365 days, but 23 people form as many as 253 pairs. As the number of pairs you compare grows, 'coincidences' quickly become common.

The 990 pairs in lotto are far more comparisons than in the birthday problem. If there were no surprising pairs at all, that would be the more surprising thing.

## Principle 2: multiple comparisons and the Texas sharpshooter

In statistics this is called the **multiple comparisons problem**. If you run one test at a 5% significance level, there is a 5% chance of wrongly concluding by chance that a result is 'significant'. But if you run 990 tests, about 50 will come out significant by chance even when there is no real effect. So when you make many comparisons, you make the threshold stricter in line with the number of comparisons. With the simplest method, the **Bonferroni correction**, a result across 990 pairs has to pass a level of 0.05÷990, or about 0.005%, before it counts as meaningful.

A story that illustrates this trap is the **Texas sharpshooter fallacy**. Someone fires at a barn wall at random, then paints a target where the bullet holes are thickest and claims to be a sharpshooter. A pair numbers table is like looking at all the data first and then painting a target where the overlaps are thickest.

## An honest way to test it

To check whether a pair is really special, the order has to be reversed.

1. Pick the top pairs from earlier data (draws 1–621) **in advance**.
2. Check whether those pairs also come up together more often than average in later data (draws 622–1243).

We actually tried this with this site's data. The 10 pairs that came up together most often in the first 621 draws had come up together **18.4 times** on average. That is close to double the expected value of 9.4 for that period. But over the next 622 draws, the same 10 pairs came up together **8.5 times** on average, slightly fewer than the expected 9.4. The 'match' did not carry over into the next period. This is **regression to the mean**. If much of an extreme value was due to chance, that chance does not repeat in new data.

## How to read the pair numbers table

This site's [pair numbers ranking](/statistics-pair.html) page lists the top 20 pairs along with the expected number of times any one pair comes up together (18.8). As long as the 34 at the top stays within the range of maximums expected from randomness (32–38), that pair is not a 'match'. It is just the highest roll among 990 rolls of the dice.

> Actual pair counts were calculated from this site's data for draws 1–1243. The simulation ran 2,000 sets of an experiment that repeats a draw of 6 numbers out of 45 without replacement 1243 times.
