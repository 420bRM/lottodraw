---
title: Where does a number generator's "random" come from? Pseudo-random numbers and fair shuffling
description: How do computers make random numbers? We cover how pseudo-random numbers work, the exact steps this site's generator follows to draw numbers, and why the Fisher–Yates method and rejection sampling are fair.
---

Among lotto 1st-prize winners, **about 66% used automatic selection** (since draw 262). Automatic numbers are chosen by the computer in the retailer's terminal. This site's number generator works the same way. But how can a computer, which only follows set instructions, produce "randomness"?

## Computers can't truly make randomness

A computer program always gives the same output for the same input. So most random numbers made by computers are **pseudo-random numbers**. Start from an initial value (the seed) and apply a fixed formula over and over, and you get a sequence of numbers that looks random. With the same seed, the same sequence repeats exactly.

Your web browser's `Math.random()` is also pseudo-random. Chrome and other major browsers use a fast algorithm called xorshift128+. It is good enough for games and simulations, but after seeing a few outputs you can guess the next value, so it is not used for security.

## How this site's generator draws numbers

This site's [number generator](/index.html#sec-generator) also uses the browser's `Math.random()`. Here is what the code does, step by step.

1. It builds a candidate list from 1 to 45, leaving out the **excluded numbers** and **fixed numbers**.
2. It picks one slot from the candidate list at random, takes that number out, and removes it from the list.
3. It repeats step 2 until there are six numbers, counting the fixed numbers.
4. If the finished combination matches any of the **16 special patterns** you have checked, it throws away the whole combination and starts again from step 1. It tries up to 10,000 times.

Open the "History · attempt log" panel on screen and you can see exactly which combination was thrown away on which attempt, and because of which pattern.

## Why this method is fair

**Step 2 is the Fisher–Yates method as it stands.** In 1938 the statisticians Ronald Fisher and Frank Yates described a way to make a random order with pencil and paper: pick one of the remaining numbers at random, write it down, cross it off the list, and repeat. In 1964 Richard Durstenfeld adapted this for computers, and that is the "Fisher–Yates shuffle" programmers use today. Because every remaining candidate is equally likely to be picked, all combinations that include your fixed numbers come up with exactly the same probability.

**Step 4 is rejection sampling.** When a combination matches a pattern, the generator does not just swap one number. It throws out the whole combination and draws again from the start. So even after filtering, **the remaining combinations are still exactly equally likely.** In other words, the filter does not make the generator favor particular numbers.

## Compared with common coding mistakes

Even with good random numbers, the wrong drawing method skews the results. Two mistakes come up often.

**Mistake 1: random sorting.** Sorting an array with a "random comparison function" is popular because the code is short, but depending on the sorting algorithm, certain values end up in certain positions more often.

**Mistake 2: modulo bias.** If you take a random integer from 0 to 255 and use the remainder after dividing by 45, the first 31 numbers come up slightly more often than the rest, because 256 is not evenly divisible by 45 (6/256 versus 5/256).

This site's code makes neither mistake. It does not shuffle by sorting but takes numbers out one at a time. It also multiplies the real number from `Math.random()` (at least 0 and less than 1) by the number of candidates and rounds down, so there is no modulo bias either. The error that remains is smaller than one in 10 trillion.

## Do you need cryptographic random numbers?

Where security matters, people use a **cryptographically secure random number generator**. The operating system collects physical entropy, such as hardware noise, to make the seed, and the design makes it impossible to work back from the output to the next value. In the browser, `crypto.getRandomValues()` does this job.

`Math.random()` has no such guarantee, so it must not be used to make passwords or login tokens. But a number generator has no secret to keep. Nothing is lost if someone guesses your numbers in advance, and every set of numbers has the same chance of 1st prize. What matters is that all 45 numbers come up evenly, and `Math.random()` meets that need well.

## The real draw uses physical randomness

For reference, the Saturday draw each week is done not by computer but by an **air-mix draw machine**. It mixes the 45 balls with air and draws them out one by one, and the balls' weight and size are checked before the draw. It is physical randomness, with no seed or algorithm at all. As shown in the [post on how often number 34 appears](/blog/is-number-34-special.html), the distribution of appearances over 1243 draws also falls within the range expected from chance.

## How to judge a good generator

| What to check | Good practice | This site |
|---|---|---|
| Source of randomness | Proven pseudo-random or cryptographic random numbers | `Math.random()` |
| Drawing method | Fisher–Yates method, rejection sampling | Uses both |
| Transparency | Shows discarded combinations and why | Shows an attempt log |
| Claims about odds | Does not claim to change the odds | Pattern filters are about overlap, not odds |

Be careful with generators that claim to analyze past data and pick "the numbers that will come up". As long as the balls have no memory, no generator can raise the chance of 1st prize above 1 in 8,145,060. The only honest things a generator can do are **pick without bias** and, if you want, [avoid combinations that many people choose](/blog/why-jackpots-split.html).

> The automatic/manual split is quoted from figures published by Donghaeng Lottery (1st prize, draws 262–1209: automatic 65.9%).
