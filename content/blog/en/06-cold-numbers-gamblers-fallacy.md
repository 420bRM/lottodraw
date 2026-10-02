---
title: Will a long-missing number come up soon? Cold numbers and the gambler's fallacy
description: Starting with the day black came up 26 times in a row at the Monte Carlo Casino in 1913, this post sets out what cold numbers can tell you and what they cannot.
---

On 18 August 1913, the ball at one roulette table in the Monte Carlo Casino started landing on black again and again. After about fifteen blacks in a row, a crowd gathered and began betting on red. Their thinking was: "Black has come up for so long that red must be next." Black came up **26 times** in a row, and the casino made a lot of money that day.

Because of this story, the belief that a result that has not appeared for a long time will appear soon is called the **gambler's fallacy**, or the Monte Carlo fallacy. In lotto, this fallacy shows up most often with cold numbers (numbers that have not come up for a while).

## What are cold numbers?

A cold number is **a number that has not come up even once in a recent stretch of draws**. Let's set the window at the last 10 draws. The chance that a given number does not come up in one draw is 39/45, so the chance that it misses 10 draws in a row is

> (39/45)¹⁰ ≈ 23.9%

This means that, on average, **10.8** of the 45 numbers are 'cold for 10 draws' at any given time. Having about ten cold numbers is not strange; it is the normal state. In fact, as of draw 1243, **11** numbers had not come up even once in the last 10 draws.

| Draws missed in a row | Chance for one number | Expected count out of 45 |
|---|---|---|
| 10 draws | 23.9% | about 10.8 |
| 20 draws | 5.7% | about 2.6 |
| 30 draws | 1.4% | about 0.6 |

## The principle: independent draws and 'no memory'

Each lotto draw is an **independent trial**. Which balls came out last week leaves no trace on the balls in the machine this week. In this situation, the number of draws you wait until a number next comes up follows a **geometric distribution**.

The geometric distribution has an unusual property: it is **memoryless**. Whether a number has already been missing for 20 draws or has just come up, the distribution of how many more draws you will wait is exactly the same. The average gap between appearances of a number is 45÷6 = 7.5 draws, and a number that has been missing for 20 draws still has to wait 7.5 more draws on average from now. A number that is behind does not get 'pulled forward'.

Our intuition says the opposite because we are used to **drawing without replacement**. If no hearts have come out of a deck of cards for a while, the share of hearts among the remaining cards really does go up. But in lotto, all 45 balls go back into the machine every week. Each draw is a fresh deck.

## So why do things even out in the end?

Over 1243 draws, every number's count sits roughly around 165, so it feels as if some force is evening things out. But the law of large numbers works by **dilution**, not by 'correction'. A 10-draw gap almost disappears from the overall share once another 1,000 draws pile up. The past shortfall is not filled in; it is buried under the normal results that keep arriving. As shown in the [post on how often number 34 has come up](/blog/is-number-34-special.html), the differences in counts actually grow as the number of draws increases.

## Very long gaps are normal too

If you simulate 1243 random draws 2,000 times, the longest gap among the 45 numbers usually comes out at about **65 draws**. The longest gap in the real record was **73 draws**, for number 5. That is within the 90% range of the random simulations (54–86 draws). In other words, a number going missing for more than a year happens often through randomness alone. In theory there should be about 24 gaps of 40 draws or longer, and in fact there were **25**. If you spot a long gap and think 'this time it must come up', you are standing in the same place as the Monte Carlo gamblers of 1913.

## Reading the current cold numbers

This site's [cold numbers page](/statistics-gap.html) ranks each number by how many draws it has gone since it last came up. As of draw 1243, number 5 is at the top, 30 draws in. By coincidence, number 5 also holds the record for the longest gap ever (73 draws). Even so, the chance that 5 comes up in the next draw stays at 13.3%. A long rest is only a record of the past, not a mark left on the ball.

## An honest way to use cold numbers

A cold numbers table is not a forecast; it is **a summary of recent results**. It does have another use, though. If many people pick cold numbers as 'numbers about to come up', more people will share the prize if those numbers win. On the other hand, few people may pick numbers that have come up often lately and are seen as 'due for a rest'. Either way the odds are the same; the only thing that changes is what people choose.

> Actual gap records were calculated from this site's data for draws 1–1243. The simulation ran 2,000 sets of an experiment that repeats a draw of 6 numbers out of 45 without replacement 1243 times.
