# SGA Activity and Behavior Analysis

**Generated:** 2026-03-16
**Data Source:** savvy-gtm-analytics BigQuery (90-day window: Dec 16 2025 to Mar 16 2026)
**Queries Run:** 6 of 7 successful (Q7 blocked by schema gap)

---

## Query 1: Activity Volume Profile (Last 90 Days)

**Source:** vw_sga_activity_performance (active SGAs only)

| SGA | Active Days | Avg Daily SMS Out | Avg Daily Cold Calls | Total SMS 90d | Total Calls 90d | SMS:Call Ratio |
|-----|-------------|-------------------|---------------------|---------------|-----------------|----------------|
| Ryan Crandall | 80 | 88.2 | 0.5 | 7052 | 36 | 195.9 |
| Craig Suchodolski | 64 | 104.1 | 1.3 | 6665 | 85 | 78.4 |
| Russell Armitage | 67 | 95.7 | 2.1 | 6412 | 140 | 45.8 |
| Brian O'Hara | 61 | 99.9 | 2.1 | 6095 | 130 | 46.9 |
| Holly Huffman | 50 | 101.9 | 1.2 | 5097 | 62 | 82.2 |
| Jason Ainsworth | 62 | 81.2 | 8.4 | 5033 | 523 | 9.6 |
| Eleni Stefanopoulos | 61 | 75.9 | 2.7 | 4630 | 165 | 28.1 |
| Channing Guyer | 52 | 88.2 | 0.9 | 4587 | 49 | 93.6 |
| Marisa Saucedo | 65 | 68.8 | 3.8 | 4473 | 245 | 18.3 |
| Helen Kamens | 65 | 68.7 | 2.9 | 4468 | 188 | 23.8 |
| Perry Kalmeta | 62 | 59.6 | 2 | 3696 | 124 | 29.8 |
| Lauren George | 54 | 53.8 | 0.6 | 2904 | 31 | 93.7 |
| Katie Bassford | 25 | 90.3 | 3.3 | 2258 | 83 | 27.2 |
| Amy Waller | 57 | 38.2 | 1 | 2180 | 58 | 37.6 |
| Chris Morgan | 20 | 70.4 | 0.3 | 1408 | 6 | 234.7 |
| Savvy Marketing | 47 | 2.4 | 0 | 115 | 0 | N/A |
| Bre McDaniel | 11 | 0.1 | 0 | 1 | 0 | N/A |
| Corey Marcello | 3 | 0.3 | 0 | 1 | 0 | N/A |

**Zero-activity SGAs (90d):** Arianna Butler, Erin Pearson, Tim Mackey, Savvy Operations, Bryan Belville, Lexi Harrison, David Eubanks, Lena Allouche, Jed Entin, Clayton Kennamer, GinaRose Galli, David Hipperson, Jacqueline Tully, Jade Bingham


**Q1 Findings:**
- **Top volume SGAs (90d):** Ryan Crandall (7,052 SMS), Craig Suchodolski (6,665), Russell Armitage (6,412), Brian O'Hara (6,095)
- **Highest avg daily SMS:** Craig Suchodolski (104.1/day), Brian O'Hara (99.9/day), Holly Huffman (101.9/day)
- **Most call-active SGAs:** Jason Ainsworth (523 cold calls, 8.4/day avg -- outlier vs peers), Marisa Saucedo (245), Helen Kamens (188)
- **SMS-heavy / call-light:** Chris Morgan (ratio 234.7), Ryan Crandall (195.9), Channing Guyer (93.6), Lauren George (93.7)
- **Balanced multi-channel:** Jason Ainsworth (ratio 9.6), Marisa Saucedo (18.3), Eleni Stefanopoulos (28.1)
- **FLAG -- Low activity days:** Chris Morgan only 20 active days of 90 -- reduced engagement
- **FLAG -- Zero-activity:** 17 SGAs in dataset show 0 SMS and 0 calls -- likely inactive/new/non-SGA accounts passing the IsActive filter


---

## Query 2: SMS Behavior Patterns per SGA

**Source:** vw_sga_sms_timing_analysis_v2 (leads with received_any_sms=1, min 50 leads)

| SGA | SMS Leads | Same Day % | Reply Rate % | Double Tap % | Link Rate % | Avg Response Min | Fast (<1hr) % |
|-----|-----------|-----------|-------------|-------------|------------|-----------------|---------------|
| Anett Diaz | 57 | 86% | 78.9% | 7% | 0% | 197 | 29.8% |
| Lauren George | 1552 | 97.5% | 21.5% | 42.8% | 0% | 27 | 16.4% |
| Craig Suchodolski | 2702 | 97.7% | 20.3% | 1.7% | 0% | 223 | 9% |
| Eleni Stefanopoulos | 2294 | 97.7% | 18.9% | 62% | 0.6% | 483 | 8.5% |
| Russell Armitage | 2949 | 84.2% | 17.9% | 36.1% | 0.4% | 906 | 8.7% |
| Perry Kalmeta | 1426 | 38.6% | 16.2% | 70.3% | 5% | 110 | 12.1% |
| Amy Waller | 1117 | 56.8% | 15.1% | 34.6% | 0.1% | 184 | 5% |
| Brian O'Hara | 1827 | 68.4% | 14.2% | 61.2% | 0% | 73 | 8.9% |
| Katie Bassford | 1289 | 98.7% | 13.7% | 50.2% | 0.1% | 202 | 8.5% |
| Jason Ainsworth | 1987 | 98.7% | 13.3% | 5% | 0.2% | 225 | 3.7% |
| Holly Huffman | 1845 | 81.8% | 12.7% | 17.6% | 0% | 96 | 6% |
| Channing Guyer | 1981 | 99.1% | 12.4% | 62.4% | 0% | 180 | 1.5% |
| Helen Kamens | 1567 | 68.5% | 11.6% | 37.7% | 0% | 298 | 3.8% |
| Ryan Crandall | 1939 | 54.8% | 11.4% | 12.5% | 0.1% | 309 | 3.6% |
| Marisa Saucedo | 2002 | 28.1% | 9.5% | 45.7% | 0.6% | 60 | 5.9% |


**Q2 Findings:**
- **Top reply rate:** Anett Diaz (78.9%) -- outstanding outlier, 2.0x the next best
- **Second tier reply rates:** Lauren George (21.5%), Craig Suchodolski (20.3%), Eleni Stefanopoulos (18.9%), Russell Armitage (17.9%)
- **Lowest reply rates:** Marisa Saucedo (9.5%), Ryan Crandall (11.4%), Helen Kamens (11.6%), Channing Guyer (12.4%)
- **Same-day SMS leaders:** Channing Guyer (99.1%), Katie Bassford (98.7%), Jason Ainsworth (98.7%), Craig Suchodolski (97.7%)
- **Same-day laggards:** Marisa Saucedo (28.1%), Perry Kalmeta (38.6%) -- significant gap from peers
- **Double-tap leaders:** Perry Kalmeta (70.3%), Eleni Stefanopoulos (62.0%), Channing Guyer (62.4%), Brian O'Hara (61.2%)
- **Link rate:** Almost all SGAs are at 0% link inclusion. Perry Kalmeta highest at 5.0%. Playbook compliance note: links in first SMS are a violation per Q6 data.
- **Fastest responders:** Marisa Saucedo (60 min avg), Brian O'Hara (73 min), Holly Huffman (96 min)
- **Slowest responders:** Russell Armitage (906 min avg -- 15+ hrs), Eleni Stefanopoulos (483 min -- 8 hrs), Helen Kamens (298 min)
- **FLAG -- Anett Diaz:** 78.9% reply rate is a massive outlier (only 57 leads -- small sample but striking). Needs validation against larger sample.
- **FLAG -- Russell Armitage:** 906 min avg response time vs best of 60 min -- despite being top SMS volume SGA. Quality vs quantity tension.


---

## Query 3: First SMS Time-of-Day Distribution per SGA

**Source:** vw_sga_sms_timing_analysis_v2

| SGA | Top Time Bucket | Pct | 2nd Bucket | Pct | 3rd Bucket | Pct |
|-----|----------------|-----|-----------|-----|-----------|-----|
| Amy Waller | Morning (9-11am) | 52.5% | Lunch (12-1pm) | 26.2% | Afternoon (2-4pm) | 15% |
| Brian O'Hara | Morning (9-11am) | 63.8% | Lunch (12-1pm) | 26.3% | Afternoon (2-4pm) | 8.3% |
| Channing Guyer | Morning (9-11am) | 56.7% | Lunch (12-1pm) | 38.6% | Afternoon (2-4pm) | 3.4% |
| Craig Suchodolski | Lunch (12-1pm) | 55.6% | Afternoon (2-4pm) | 27.8% | Morning (9-11am) | 16.3% |
| Eleni Stefanopoulos | Lunch (12-1pm) | 47.1% | Morning (9-11am) | 39.1% | Afternoon (2-4pm) | 6.8% |
| Helen Kamens | Lunch (12-1pm) | 47.5% | Afternoon (2-4pm) | 24.7% | Evening (5-7pm) | 17.4% |
| Holly Huffman | Morning (9-11am) | 55% | Lunch (12-1pm) | 19.2% | Afternoon (2-4pm) | 18.5% |
| Jason Ainsworth | Morning (9-11am) | 56.6% | Afternoon (2-4pm) | 25.6% | Lunch (12-1pm) | 16.5% |
| Katie Bassford | Lunch (12-1pm) | 59.2% | Afternoon (2-4pm) | 23% | Morning (9-11am) | 10.9% |
| Lauren George | Lunch (12-1pm) | 82.5% | Morning (9-11am) | 11% | Afternoon (2-4pm) | 4.5% |
| Marisa Saucedo | Lunch (12-1pm) | 71.4% | Afternoon (2-4pm) | 12.4% | Morning (9-11am) | 10.1% |
| Perry Kalmeta | Lunch (12-1pm) | 66.3% | Morning (9-11am) | 22.9% | Afternoon (2-4pm) | 7.2% |
| Russell Armitage | Morning (9-11am) | 70.9% | Lunch (12-1pm) | 21% | Afternoon (2-4pm) | 6.9% |
| Ryan Crandall | Lunch (12-1pm) | 44.4% | Afternoon (2-4pm) | 27.5% | Morning (9-11am) | 16.3% |


**Q3 Findings:**
- **Morning-dominant SGAs (9-11am top bucket):** Amy Waller (52.5% morning), Brian O'Hara (63.8%), Holly Huffman (55%), Jason Ainsworth (56.6%), Russell Armitage (70.9%)
- **Lunch-dominant SGAs (12-1pm top bucket):** Craig Suchodolski (55.6%), Eleni Stefanopoulos (47.1%), Helen Kamens (47.5%), Katie Bassford (59.2%), Lauren George (82.5%), Marisa Saucedo (71.4%), Perry Kalmeta (66.3%), Ryan Crandall (44.4%)
- **Channing Guyer:** 56.7% morning + 38.6% lunch -- tightly concentrated in first half of business day
- **Lauren George outlier:** 82.5% of first SMS sent during Lunch (12-1pm) -- the most concentrated timing distribution among active SGAs
- **Russell Armitage:** 70.9% Morning -- most morning-concentrated large-volume SGA
- **Evening SMS (5-7pm):** Ryan Crandall 10.7% evening, Helen Kamens 17.4%, Marisa Saucedo 5.6% -- suggests after-hours outreach pattern
- **Off-Hours / Early Morning activity:** Holly Huffman notable with 5.9% Early Morning (6-8am). Helen Kamens 0.1% Early Morning.
- **FLAG:** Lauren George 82.5% Lunch concentration is unusual -- could indicate batch-sending or automation pattern. Warrants investigation.


---

## Query 4: Response Speed Distribution per SGA

**Source:** vw_sga_sms_timing_analysis_v2 (replies received only)

| SGA | Fast (<1hr) | Medium (1-4hr) | Slow (4-24hr) | Very Slow (>24hr) | No Response |
|-----|------------|---------------|--------------|------------------|-------------|
| Amy Waller | 33% | 12% | 6% | 1% | 48% |
| Brian O'Hara | 63% | 7% | 4% | 0% | 27% |
| Channing Guyer | 12% | 1% | 3% | 0% | 84% |
| Craig Suchodolski | 44% | 5% | 5% | 1% | 45% |
| Eleni Stefanopoulos | 45% | 12% | 7% | 2% | 34% |
| Helen Kamens | 32% | 4% | 5% | 1% | 57% |
| Holly Huffman | 47% | 5% | 3% | 1% | 44% |
| Jason Ainsworth | 28% | 6% | 8% | 1% | 58% |
| Katie Bassford | 62% | 14% | 7% | 2% | 16% |
| Lauren George | 76% | 5% | 1% | 0% | 17% |
| Marisa Saucedo | 62% | 4% | 3% | 1% | 31% |
| Perry Kalmeta | 74% | 8% | 5% | 1% | 12% |
| Russell Armitage | 49% | 9% | 4% | 1% | 38% |
| Ryan Crandall | 31% | 5% | 2% | 4% | 57% |


**Q4 Findings:**
- **Fastest responders (% Fast <1hr from raw counts):** Lauren George (76%), Katie Bassford (62%), Perry Kalmeta (74%), Eleni Stefanopoulos (46%), Brian O'Hara (63%)
- **Lauren George:** 254 Fast / 333 total = 76% fast, 58 no-response (17%) -- best fast-response rate among high-volume SGAs
- **Perry Kalmeta:** 172 Fast / 231 total = 74% fast
- **Katie Bassford:** 109 Fast / 177 total = 62% fast
- **Brian O'Hara:** 163 Fast / 260 total = 63% fast, 73 no-response (28%)
- **Channing Guyer:** 30 Fast / 246 total = 12% fast -- outlier low. 84% no-response among the bucket. Likely most replies are not getting recorded or SGA is not responding at all.
- **Ryan Crandall:** 69 Fast / 221 total = 31% fast, 127 no-response (57%) -- very high no-response rate
- **Craig Suchodolski:** 242 Fast / 549 total = 44% fast, 246 no-response (45%)
- **Russell Armitage:** 257 Fast / 528 total = 49% fast, 198 no-response (37%)
- **FLAG -- Channing Guyer:** 84% no-response among reply-trackers. When leads DO reply, Channing is not responding fast. Root cause unclear -- possible volume overwhelm.
- **FLAG -- Ryan Crandall:** 57% of contacts with any response bucket show No Response. Highest no-response rate among top-volume SGAs.


---

## Query 5: Call Behavior -- Cold Calls and Meaningful Connects (Last 90 Days)

**Source:** vw_sga_activity_performance (active SGAs, channel IN Call/SMS)
**Note:** connect_rate_pct > 100% indicates meaningful_connects counts inbound calls/callbacks not in cold_call denominator

| SGA | Cold Calls | True Cold Calls | Meaningful Connects | Connect Rate % | Avg Connect Duration (sec) |
|-----|-----------|----------------|--------------------|--------------|--------------------------|
| Jason Ainsworth | 523 | 3 | 844 | 161.4% | 58 |
| Marisa Saucedo | 245 | 30 | 538 | 219.6% | 98 |
| Helen Kamens | 188 | 4 | 535 | 284.6% | 249 |
| Eleni Stefanopoulos | 165 | 1 | 816 | 494.5% | 293 |
| Russell Armitage | 140 | 4 | 1009 | 720.7% | 453 |
| Brian O'Hara | 130 | 5 | 719 | 553.1% | 357 |
| Perry Kalmeta | 124 | 5 | 541 | 436.3% | 314 |
| Craig Suchodolski | 85 | 2 | 644 | 757.6% | 52 |
| Katie Bassford | 83 | 4 | 303 | 365.1% | 221 |
| Holly Huffman | 62 | 20 | 431 | 695.2% | 448 |
| Amy Waller | 58 | 1 | 305 | 525.9% | 328 |
| Channing Guyer | 49 | 2 | 324 | 661.2% | 168 |
| Ryan Crandall | 36 | 1 | 510 | 1416.7% | 493 |
| Lauren George | 31 | 1 | 391 | 1261.3% | 346 |
| Chris Morgan | 6 | 0 | 93 | 1550% | 331 |


**Q5 Findings:**
- **connect_rate_pct > 100% across the board** -- this metric is meaningful_connects / cold_calls. The denominator (is_cold_call=1) is much smaller than the numerator (is_meaningful_connect=1) for most SGAs, suggesting the definitions differ. Cold calls are outbound first-touch calls; meaningful connects likely include all qualifying calls (inbound, callbacks, etc.)
- **Highest meaningful connects (absolute):** Russell Armitage (1,009), Eleni Stefanopoulos (816), Brian O'Hara (719), Craig Suchodolski (644), Holly Huffman (431)
- **Jason Ainsworth:** Highest cold call volume (523) but only 3 true cold calls -- suggests most calls are reclassified as non-cold (warm outreach, callbacks)
- **Longest avg connect duration:** Ryan Crandall (493 sec = 8.2 min), Russell Armitage (453 sec = 7.6 min), Holly Huffman (448 sec = 7.5 min) -- indicating deep engagement when they do connect
- **Shortest avg connect duration:** Craig Suchodolski (52 sec), Jason Ainsworth (58 sec) -- high-volume brief contacts, different engagement style
- **True cold call leaders:** Holly Huffman (20 true cold calls), Marisa Saucedo (30) -- willingness to cold prospect
- **FLAG -- Craig Suchodolski:** 52 sec avg connect duration vs 493 sec for Ryan Crandall. Craig makes more cold calls but engages much more briefly -- volume vs depth tradeoff.
- **FLAG -- connect_rate_pct calculation:** All values > 100% suggests the denominator (is_cold_call) may be a poor proxy for total call outreach. The SGA performance feature should compute connect_rate differently (meaningful_connects / total calls including callbacks).


---

## Query 6: Weekly Playbook Adherence (Latest Week Report)

**Source:** sms_weekly_metrics_daily (most recent report_generated_date)

| SGA | SMS Last 7d | Hist Weekly Avg | vs Avg % | Link Violations | Bookend Count | Bookend Adherence | Golden Window % | Self-Sourced Coverage | Provided List Coverage |
|-----|------------|----------------|---------|----------------|--------------|------------------|-----------------|----------------------|----------------------|
| Russell Armitage | 448 | 211 | 213% | 39 | 29 | 83% | 61% | 99% | 100% |
| Marisa Saucedo | 382 | 124 | 309% | 20 | 0 | 0% | 42% | 43% | 32% |
| Channing Guyer | 342 | 138 | 248% | 1 | 0 | 0% | 37% | 99% | 100% |
| Ryan Crandall | 317 | 204 | 155% | 204 | 0 | 0% | 14% | 0% | 0% |
| Jason Ainsworth | 293 | 187 | 157% | 0 | 0 | null | 43% | 100% | 99% |
| Holly Huffman | 280 | 204 | 137% | 0 | 0 | null | 41% | 100% | 94% |
| Katie Bassford | 278 | 234 | 119% | 3 | 0 | 0% | 24% | 96% | 95% |
| Lauren George | 229 | 104 | 221% | 2 | 0 | 0% | 22% | 87% | 82% |
| Helen Kamens | 192 | 146 | 131% | 0 | 0 | 0% | 15% | 0% | 0% |
| Amy Waller | 128 | 85 | 150% | 0 | 18 | 64% | 60% | 69% | 96% |
| Eleni Stefanopoulos | 97 | 148 | 65% | 0 | 0 | 0% | 13% | 98% | 98% |
| Craig Suchodolski | 73 | 190 | 38% | 1 | 0 | 0% | 8% | null | 81% |
| Perry Kalmeta | 7 | 111 | 6% | 0 | 0 | null | 0% | 0% | 0% |
| Brian O'Hara | 4 | 166 | 2% | 0 | 0 | null | 0% | null | null |
| Jacqueline Tully | 0 | 1 | 0% | 0 | 0 | null | null | null | null |
| Rashard Wade | 0 | 0 | null% | 0 | 0 | null | null | null | null |


**Q6 Findings:**
- **Volume surge this week:** Russell Armitage (448 SMS, 213% of hist avg), Marisa Saucedo (382, 309%), Channing Guyer (342, 248%), Lauren George (229, 221%) -- all running significantly above their historical averages
- **Volume below historical avg:** Craig Suchodolski (73 SMS, 38% of avg -- major drop), Eleni Stefanopoulos (97, 65%), Perry Kalmeta (7, 6%), Brian O'Hara (4, 2%) -- these SGAs have gone very quiet this week
- **Link violations this week:** Ryan Crandall (204 violations -- severe), Russell Armitage (39), Marisa Saucedo (20), Katie Bassford (3), Craig Suchodolski (1), Lauren George (2). All others at 0.
- **Bookend adherence:** Russell Armitage (83%), Amy Waller (64%) are the only SGAs with meaningful bookend counts this week. Most SGAs have bookend_count=0.
- **Golden window adherence:** Amy Waller (60.2%) and Russell Armitage (60.9%) lead. Ryan Crandall worst at 13.6%. Most SGAs are 14%-43%.
- **Self-sourced coverage:** Jason Ainsworth (100%), Holly Huffman (100%), Russell Armitage (98.8%), Eleni Stefanopoulos (97.5%), Channing Guyer (98.9%) -- top self-sourced compliance
- **Self-sourced gaps:** Helen Kamens (0%), Ryan Crandall (0%), Marisa Saucedo (42.7%), Lauren George (86.5%)
- **FLAG -- Ryan Crandall:** 204 link violations this week -- highest by far. This is a major playbook breach. Also has 0% self-sourced coverage and 0% provided-list coverage.
- **FLAG -- Brian O'Hara:** Only 4 SMS this week vs 166 historical avg (2% volume). Apparent sudden drop -- needs attention or explanation.
- **FLAG -- Perry Kalmeta:** Only 7 SMS this week vs 111 avg (6%). Also apparent disengagement.
- **FLAG -- Helen Kamens:** 0% self-sourced coverage and 0% provided-list coverage despite 192 SMS sent this week. Data issue or coverage metric calculation error?
- **FLAG -- Golden window adherence:** Team average appears to be approximately 25-35%. Only Amy Waller and Russell Armitage are above 60%. Widespread non-compliance with timing playbook.


---

## Query 7: SMS Intent Distribution -- SCHEMA GAP

**Error:** Name first_sms_task_id not found inside s at [1:219]

**Root Cause:** The field first_sms_task_id does not exist in vw_sga_sms_timing_analysis_v2. The view does not expose the task ID of the first SMS, blocking the JOIN to sms_intent_classified.

**VIEW MODIFICATION REQUIRED** to support SMS intent analysis per SGA. Options:
1. Add first_sms_task_id to vw_sga_sms_timing_analysis_v2
2. Join via alternative key (lead_id + first SMS date)
3. New view combining lead-level timing + intent classification

---

## Cross-Dimensional SGA Behavioral Summary

This section synthesizes findings across all 6 queries to identify standout SGAs positively and negatively.

### Positive Standouts

**1. Russell Armitage**
- Top-3 SMS volume (6,412 / 90d), 70.9% of SMS sent in Morning golden window
- 83% bookend adherence rate this week (joint leader)
- 49% fast response rate -- above mid-pack
- 7.6 min avg connect duration on meaningful connects (quality calls)
- Risk: 906 min avg response time in Q2 (contradicts fast-response %); investigate if Q2 and Q4 measure different populations
- This week spiked 213% above historical avg with only 39 link violations

**2. Brian O'Hara**
- Strong meaningful connects (719 in 90d), long avg duration (357 sec = 6 min)
- 63.8% morning SMS distribution
- 63% fast response rate (Q4)
- Risk: This week shows only 4 SMS sent (2% of historical avg) -- possible disruption or Q6 data lag

**3. Jason Ainsworth**
- Highest call volume by far (523 cold calls, 8.4/day)
- 98.7% same-day SMS rate
- 100% self-sourced coverage in latest week
- 293 SMS this week at 157% of hist avg
- Risk: 58 sec avg connect duration -- very brief calls, possible low-quality connects

**4. Lauren George**
- Highest fast-response rate (76% Fast <1hr, Q4) among analyzed SGAs
- 21.5% reply rate (second best after Anett Diaz)
- 221% above historical SMS avg this week
- Risk: 82.5% of SMS sent during Lunch hour -- extremely concentrated timing, possible automation pattern

**5. Perry Kalmeta**
- 74% fast response rate (Q4) -- top responder
- 70.3% double-tap rate -- persistent follow-up
- Risk: Only 7 SMS this week (6% of hist avg) -- major drop. Reply rate 16.2% is mid-pack.

### Negative Standouts

**1. Ryan Crandall**
- 204 link violations this week -- worst in team by large margin
- 0% self-sourced coverage, 0% provided-list coverage this week
- 13.6% golden window adherence (worst on team)
- 57% no-response rate (Q4)
- 11.4% reply rate (lowest among active volume SGAs)
- Despite being highest total SMS volume SGA (7,052 / 90d), playbook adherence is critically low

**2. Channing Guyer**
- 84% of reply interactions show No Response (Q4) -- critical engagement gap
- Only 12% fast response rate
- 62.4% double-tap rate but 12.4% reply rate -- the double-taps are not converting to engagement
- 37.1% golden window adherence this week

**3. Marisa Saucedo**
- 28.1% same-day SMS rate (lowest in cohort)
- 9.5% reply rate (lowest in cohort)
- 0% bookend adherence despite high volume
- 42.7% self-sourced coverage
- This week 309% above historical avg -- surge without quality

**4. Helen Kamens**
- 0% self-sourced coverage AND 0% provided-list coverage in latest week (with 192 SMS sent)
- 11.6% reply rate
- 298 min avg response time
- 47.5% of SMS sent at lunch, 24.7% afternoon -- later-day heavy

---

## Data Quality and Schema Flags

### FLAG 1 -- Q5 connect_rate_pct > 100% for all SGAs
The ratio meaningful_connects / cold_calls exceeds 100% for every SGA (range: 161% to 1,550%). The is_cold_call denominator is much narrower than the meaningful_connects numerator. Display as separate counters, not a rate.

### FLAG 2 -- Q7 first_sms_task_id missing from vw_sga_sms_timing_analysis_v2
Cannot join to sms_intent_classified. VIEW MODIFICATION REQUIRED to expose first_sms_task_id.

### FLAG 3 -- Zero-activity SGAs in Q1
17 SGAs with SGA_IsSGA__c=TRUE and SGA_IsActive=TRUE returned 0 activity in 90 days. Likely: new hires pre-ramp, separated staff with stale flags, or system accounts. Filter to >0 activity in the feature.

### FLAG 4 -- Savvy Marketing and Savvy Operations in Q1
System accounts passing the active SGA filter. Exclude by name or add an account-type filter.

### FLAG 5 -- Helen Kamens 0% both coverage rates with 192 SMS
0% self_sourced_coverage AND 0% provided_list_coverage while sending 192 SMS. Possible playbook violation -- texting completely outside both list categories. Investigate before surfacing.

### FLAG 6 -- bookend_adherence_rate = null vs 0%
NULL rate means no qualifying bookend windows, not failed compliance. UI should display as N/A not 0%.

---

## Query Execution Summary

| Query | Status | Rows |
|-------|--------|------|
| Q1: Activity Volume Profile | SUCCESS | 32 |
| Q2: SMS Behavior Patterns | SUCCESS | 15 |
| Q3: First SMS Time-of-Day | SUCCESS | 97 |
| Q4: Response Speed Distribution | SUCCESS | 81 |
| Q5: Call Behavior | SUCCESS | 15 |
| Q6: Weekly Playbook Adherence | SUCCESS | 16 |
| Q7: SMS Intent Distribution | FAILED -- Schema Gap | 0 |

**Raw data:** sga_query_results.json (project root)
