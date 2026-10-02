---
title: Is number 34 special for coming up 186 times? Reading draw counts with standard deviation
description: Over 1,243 draws, 34 came up most often and 9 least often. A gap this size is normal even under pure chance, and we work it out step by step.
---

Across draws 1–1243, leaving out the bonus number, the number drawn most often is 34, at **186 times**. The number drawn least often is 9, at **137 times**. With a gap of 49, it is easy to feel there is something about 34. But is there really?

## First, find the average

Each draw picks 6 of 45 numbers, so the chance that a given number appears in a given draw is 6/45, or about 13.3%. Over 1,243 draws, the expected count for one number is:

> 1243 × 6/45 = **165.7 times**

So 34 is about 20 above the average, and 9 is about 29 below.

## Next, the size of the wobble

Toss a coin 100 times and you will rarely get exactly 50 heads. Standard deviation measures how big that wobble is. If we treat each draw as "appeared or did not appear" (a binomial distribution), the standard deviation is

> √(1243 × 6/45 × 39/45) ≈ **12.0 times**

In other words, it is normal for one number's count to move around within roughly 165.7 ± 12.

| Number | Times drawn | Difference from average | Standard deviations |
|---|---|---|---|
| 34 | 186 | +20.3 | +1.7σ |
| 13 | 183 | +17.3 | +1.4σ |
| 9 | 137 | −28.7 | −2.4σ |

If you look at one number on its own, +1.7σ is a rare value, roughly in the top 5%. This is where many analyses conclude that "34 comes up significantly more often". But that reading leaves out one important fact.

## Looking at all 45 at once changes the story

We did not choose 34 in advance and then watch it. We counted all 45 numbers and then **picked out the largest**. The largest of 45 counts is bound to sit above the average.

So we used a computer to simulate 1,243 draws in exactly the same way as the real draw (6 of 45, without replacement), and repeated this 5,000 times.

| Item | Random simulation (median) | 90% range | Actual Lotto |
|---|---|---|---|
| Count of the most frequent number | 192 | 185–204 | 186 |
| Count of the least frequent number | 140 | 130–147 | 137 |
| Gap between most and least frequent | 53 | — | 49 |

The result is clear. Even under pure chance, the top number usually comes up about 192 times. In **93%** of the simulations, the most frequent number came up 186 times or more. If anything, the real Lotto's 34 is **ordinary, or slightly less extreme than usual**. The 49-draw gap between the most and least frequent numbers is also almost the same as the 53 you would expect from chance.

## Is 9 an unlucky number?

The least frequent number, 9 (−2.4σ), can be read the same way. In the simulations, the least frequent number usually landed around 140, and counts in the 130s were common. Number 9's 137 sits inside that range. One of the 45 numbers has to come last, and over these 1,243 draws it just happened to be 9.

## Does the gap shrink as draws pile up?

Interestingly, as the number of draws grows, **the gap in counts between the most and least frequent numbers actually gets bigger.** This is because the standard deviation grows with the square root of the number of draws. On the other hand, **the gap measured as a rate gets smaller.** Right now 34 appears in 15.0% of draws and 9 in 11.0%, which puts them 1.6 and 2.3 percentage points away from the theoretical 13.3%. After about 5,000 draws, most numbers will sit within 1 percentage point of the theoretical value. This is what the law of large numbers actually says. Numbers that came up less often do not "catch up". The gap simply gets diluted as the total grows.

## So how should you read these numbers?

- **Differences in counts are closer to evidence that the draw machine is fair.** If all 45 numbers were bunched tightly around 165, that would be the stranger result.
- **Past counts do not change the next draw.** The balls have no memory. The chance that 34 comes up next week is 6/45, exactly the same as for 9.
- **It is true, though, that many people pick "frequently drawn numbers".** Draw 1019 in 2022 produced 1, 4, 13, 17, 34, 39. That draw included several of the most frequent numbers, such as 34 and 13, and 50 people won 1st prize. The odds are the same, but more people may end up sharing the prize. This is covered separately in [Why jackpots get split](/blog/why-jackpots-split.html).

This is also why the site's [most frequent numbers ranking](/statistics-frequency.html) page shows, for each number, both "how many more times than expected" and "how many standard deviations". The bell curve on that page shows 44 of the 45 numbers within ±2σ of the average. Before looking at how big a count is, first check whether it falls within the range that chance can explain.

> Counts cover the 6 main numbers of draws 1–1243 (bonus excluded), from this site's draw data (public data from Donghaeng Lottery). The simulation ran 5,000 sets of an experiment that repeats a 6-of-45 draw without replacement 1,243 times.
