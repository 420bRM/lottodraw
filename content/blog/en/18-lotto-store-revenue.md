---
title: How much does a lucky lotto store earn? — Working back sales and commission
description: Lotto retailers' sales are not published, but 1st and 2nd prizes let you work them out backwards. The top seller moves about ₩26 billion a year and keeps ₩1.0–1.7 billion in commission. And why net profit can't be known.
---

Seeing the long Saturday queue outside a "lucky" lotto store, you start to wonder: how much does that shop sell in a year, and how much does it make? Sales per retailer are not published. But one published number lets you work it out backwards surprisingly well: **how many 1st and 2nd prizes it has sold**.

One thing first. Wherever you buy, the chance of a 1st prize is 1 in 8,145,060. This is about how much was sold, not about where winners come from. All figures cover the last three years up to 24 October 2026 (draws 1092–1247, 156 draws).

## One 1st or 2nd prize = about ₩1.16 billion of sales

A game wins 1st prize with probability 1 in 8,145,060 and 2nd prize (five numbers plus the bonus) with probability 6 in 8,145,060. Together that is **7 in 8,145,060** — the same for auto and manual picks, and at every retailer.

So for one 1st or 2nd prize to turn up, on average 8,145,060 ÷ 7 = **1,163,580 games** have to be sold — at ₩1,000 a game, **about ₩1.16 billion**. We checked: three years of total sales, ₩18.3 trillion, divided by the 15,897 1st- and 2nd-prize games in that period gives ₩1.15 billion each. Almost exactly the theory.

## Why you can't just divide

So is it just each retailer's 1st and 2nd prizes times ₩1.16 billion? Doing that gets three things wrong.

- **Places that got a few extra lucky wins are inflated.** Prize counts are partly luck, so the retailers at the very top of 9,000-odd include some who were lucky (regression to the mean).
- **Places with none come out at zero.** 3,742 retailers had no 1st or 2nd prize in three years, yet of course they sell lotto.
- **Repeat tickets of the same numbers multiply one buyer's luck.** In draw 1057 a single retailer sold 103 2nd-prize games, of which 100 were apparently bought by one person with the same numbers (Lottery Commission explanation).

So we adjusted three things. Per retailer per draw, manual 1st prizes count as one game and 2nd prizes as at most three. We first fit the distribution of sales across 9,516 retailers, then start from that distribution and adjust each retailer by its own count (a method statisticians call **empirical Bayes**). And the answer is not one number but a **95% range**: a 95% chance that actual sales lie inside it.

{{figure store-sales-flow}}

## How much did they sell, given the prize count?

How the estimated annual sales change with the number of 1st and 2nd prizes in the last three years. The horizontal axis is a log scale, so each step multiplies.

{{figure store-sales-range}}

Try **Bell curves** above the chart. It shows what the bars really were: each curve is the probability distribution of where annual sales lie at a retailer with that many 1st and 2nd prizes, and the bar is the middle 95% of that curve seen from above. The horizontal axis is annual sales (the same log scale as the bars); the vertical axis is **the chance that sales lie within ±10% of that amount**. The peak of 58% on the 74-prize curve, for example, means "a 58% chance of ₩27 billion ±10% a year". Every curve starts from the same floor (0%) and falls back to 0 at both ends, and every curve has the same area (total probability) — so the more prizes and the more narrowly sales are known, the higher the peak. The grey curve is the distribution of all retailers; the zero-prize curve is just as low and wide, which means zero prizes on their own tell you little. Pick a curve with the buttons above to see its 95% range (shaded) and middle value (vertical line).

| 1st + 2nd prizes, 3 yrs | Est. annual sales (95% range) | Middle | Annual commission (5% of middle) |
|---|---|---|---|
| 0 | ₩0.04–0.79B | ₩0.19B | about ₩10M |
| 1 | ₩0.07–1.2B | ₩0.34B | about ₩17M |
| 2 | ₩0.13–1.6B | ₩0.54B | about ₩27M |
| 3 | ₩0.22–2.1B | ₩0.77B | about ₩38M |
| 5 | ₩0.47–3.0B | ₩1.3B | about ₩66M |
| 10 | ₩1.4–5.3B | ₩2.9B | about ₩0.15B |
| 20 | ₩3.9–9.9B | ₩6.4B | about ₩0.32B |
| 40 | ₩9.8–19B | ₩14B | about ₩0.69B |

A retailer sells ₩0.61 billion a year on average, with a middle value of ₩0.37 billion; the top 10% sell over ₩1.3 billion and the top 1% over ₩3.7 billion. But 6,280 retailers — two thirds — had zero or one 1st or 2nd prize in three years, and for them the range is wide enough to cover most retailers. Only the few with many prizes can be pinned down individually.

## Top 10 retailers by estimated sales

| Rank | Retailer (area) | 1st + 2nd, 3 yrs | Est. annual sales (95% range) | Annual commission (95% range) |
|---|---|---|---|---|
| 1 | Buil Car Service (Dong-gu, Busan) | 74 | ₩21–33B | ₩1.04–1.66B |
| 2 | Spa (Nowon-gu, Seoul) | 53 | ₩14–24B | ₩0.69–1.21B |
| 3 | Ildeung Lottery Store (Dalseo-gu, Daegu) | 52 | ₩14–24B | ₩0.68–1.19B |
| 4 | Lotto King (Yeongdeungpo-gu, Seoul) | 51 | ₩13–23B | ₩0.66–1.17B |
| 5 | Lotto Myeongdang Inju (Asan, South Chungcheong) | 50 | ₩13–23B | ₩0.65–1.15B |
| 6 | Ocheoneok Lottery Shop (Seo-gu, Gwangju) | 49 | ₩13–23B | ₩0.63–1.13B |
| 7 | Lotto Rest Stop (Yongin, Gyeonggi) | 49 | ₩13–23B | ₩0.63–1.13B |
| 8 | Jamsil Kiosk (Songpa-gu, Seoul) | 43 | ₩11–20B | ₩0.54–1.00B |
| 9 | Daebak Cheonha Mart (Bupyeong-gu, Incheon) | 43 | ₩11–20B | ₩0.54–1.00B |
| 10 | Alibi (Gwangsan-gu, Gwangju) | 35 | ₩8.2–16B | ₩0.41–0.82B |

Retailers with the same count get the same range (name and area play no part). Dividing the #1 straight through gives 74 × ₩0.39 billion = ₩28.7 billion; the middle value of ₩26.4 billion is a little lower because the share of extra luck has been taken out. The 1st-prize ranking is in [1st-prize retailer statistics](/statistics-stores.html) and the locations are on the [retailer map](/store-map.html).

## So how much do they get? Commission

A retailer keeps **5.5%** of lotto sales (VAT included) — 5% before VAT, or ₩50 on a ₩1,000 game. The rest of the money is not the shop's; it is passed on.

- **Top-selling retailer**: sales of ₩21–33 billion a year → commission of **about ₩1.0–1.7 billion a year** (middle ₩1.3 billion)
- **Top 10**: commission of about ₩0.4–1.7 billion a year
- **Average retailer**: sales of ₩0.61 billion a year → commission of **about ₩31 million a year**, close to the 2021 average of ₩31.02 million reported in the press.
- **Middle retailer**: sales of ₩0.37 billion a year → commission of about ₩18 million a year

## Why net profit cannot be known

Commission is closer to gross profit. Net profit needs rent, wages, power, phone and other costs taken off, and those differ from shop to shop and are not published. Most lotto is also sold inside convenience stores, marts and kiosks rather than lotto-only shops, so what the whole shop earns depends heavily on its main business. Commission on other lotteries such as the pension lottery or scratch cards is not in this count either.

So this article can go as far as "how much a retailer gets in lotto commission". If you see a single figure for a retailer's net profit, check first how the costs were worked out.

## Are the ranges really right 95% of the time? A check

To call it a "95% range", it has to be right close to 95% of the time. So we split the same three years into odd and even draws and checked, for all 9,516 retailers, whether the range built from odd draws alone contained the actual 1st- and 2nd-prize count in the even draws.

{{figure store-sales-check}}

- The 95% ranges were right **97.8%** of the time and the 80% ranges **91.4%**. Counts are whole numbers, so the ranges are drawn slightly generously and come out a little above target.
- The 31 retailers with 10+ in the odd draws would have had 17.4 each in the even draws if their counts carried over unchanged; they actually had 14.6, and this method expected 14.3. That is why the luck has to come out.
- Using the previous three years (draws 936–1091) to cover these three, the 95% ranges were right 97.1% of the time. Sales still change from year to year, so these figures are the average of the past three years, not a forecast.

## In short

- One 1st or 2nd prize means about ₩1.16 billion was sold, on average.
- Over the last three years the top-selling retailer sold about ₩26 billion a year (₩21–33 billion) and earned about ₩1.0–1.7 billion a year in commission.
- The average retailer sold ₩0.61 billion a year and earned about ₩30 million a year in commission.
- Net profit cannot be worked out because costs are not published.
- Wherever you buy, the chance of a 1st prize is the same 1 in 8,145,060. Places with many winners are simply places that sell a lot.

Data used: Dong-haeng Lottery's winning-retailer search (from draw 262), sales per draw, and its retailer search (the 9,000-odd places selling lotto now). Commission is taken as 5.5% of sales, VAT included.
