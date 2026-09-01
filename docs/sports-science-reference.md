# Sports-Science Knowledge Base for a Running Coaching App

## TL;DR
- A rich per-run/per-week coaching engine can be built almost entirely from Strava/Garmin streams (HR, pace, elevation/grade, cadence, GPS, duration) by combining a small set of well-validated models: TRIMP/session-RPE for load, Coggan-style CTL/ATL/TSB (Banister fitness–fatigue) for the weekly cycle, rTSS/NGP (Minetti grade adjustment) for per-run stress, Efficiency Factor + aerobic decoupling for aerobic durability, VDOT/Critical Speed for pace zones, and Seiler's 80/20 intensity distribution for weekly balance.
- The highest-value, genuinely computable per-run insights are: intensity-distribution/zone audits ("was your easy run actually easy?"), aerobic decoupling on steady runs (>5% flag), Efficiency Factor trend, grade-adjusted pace, interval execution/fade analysis, and CTL/ATL/TSB + ACWR load context — each tied to a specific chart.
- Treat lab-only constructs honestly: true VO2max, lactate threshold, HRV/DFA-a1 thresholds, and wearable "readiness" scores require data you may not have (gas exchange, blood lactate, R-R intervals, nocturnal HRV); flag these as estimates/optional, and note the real scientific debates (ACWR validity, Firstbeat VO2max error, unvalidated recovery scores) rather than overclaiming.

## Key Findings
1. Nearly every major training-monitoring construct reduces to one of three families: **internal-load models** (HR-based TRIMP, session-RPE, hrTSS), **external-load models** (rTSS from pace/NGP, running power), and **response models** (Banister fitness–fatigue → CTL/ATL/TSB, ACWR).
2. The single most defensible weekly framework is the **Coggan Performance Management Chart** (CTL 42-day, ATL 7-day, TSB = CTL − ATL), which is a simplification of the **Banister impulse-response model** (Banister 1975; Morton, Fitz-Clarke & Banister 1990).
3. Seiler's **polarized / 80-20** intensity-distribution model is the best-supported organizing principle for the *weekly* summary; it is directly computable as time-in-zone.
4. **Aerobic decoupling** (Pw:Hr / Pa:Hr) and **Efficiency Factor** are the most practically useful per-run aerobic-fitness signals available from HR + pace, with a well-established ~5% decoupling threshold.
5. **Grade-adjusted pace** via the Minetti (2002) energy-cost polynomial is essential to make pace-based insights valid on hilly terrain and is the same model Strava/TrainingPeaks use.
6. Several headline constructs are **estimates with meaningful error or active scientific controversy** — ACWR validity (mathematical coupling critiques), Firstbeat VO2max (95% accuracy / ~5% MAPE best-case; underestimates highly trained runners by ~6 ml/kg/min), and wearable recovery/readiness scores (largely unvalidated black boxes) — and the app should present them with appropriate caveats.

## Details

### 1. BOOKS (concrete, encodable frameworks)

**Jack Daniels — *Daniels' Running Formula* (4th ed., 2021, Human Kinetics; ISBN 978-1-4925-7443-2).** Contributes the **VDOT system** — a single "effective VO2max" number derived from a race result that folds in running economy. Two Daniels–Gilbert equations (from *Oxygen Power*, 1979) are directly encodable:
- Oxygen cost of velocity: VO2 = −4.60 + 0.182258·v + 0.000104·v² (v in m/min)
- Sustainable fraction: %VO2max = 0.8 + 0.1894393·e^(−0.012778·t) + 0.2989558·e^(−0.1932605·t) (t in minutes)
- VDOT = VO2(v) ÷ %VO2max(t). From VDOT you generate 5 training-pace zones: **E (Easy, ~65–79% HRmax / ~59–74% VO2max), M (Marathon), T (Threshold, ~88% VO2max, "comfortably hard" ~1hr pace), I (Interval, ~VO2max), R (Repetition)**. This is the backbone of any pace-zone prescription and race-equivalency engine.

**Joe Friel — *The Triathlete's Training Bible* / *The Cyclist's Training Bible* (and running equivalents).** Popularized the **CTL/ATL/TSB / Performance Management Chart** approach for age-group athletes and the concept of setting zones off **threshold** (functional threshold HR/pace) rather than max HR. Encodable: threshold-anchored zones, periodization blocks, and the fitness/fatigue/form dashboard. Friel also authored TrainingPeaks' operational EF/decoupling definitions used below.

**Andrew Coggan & Hunter Allen — *Training and Racing with a Power Meter* (VeloPress).** Source of **TSS, Normalized Power (NP), Intensity Factor (IF)**, and the **7-zone power model** (% of FTP): Z1 <55%, Z2 56–75%, Z3 76–90%, Z4 91–105%, Z5 106–120%, Z6 121–150%, Z7 >150%. Adapts directly to running via rTSS and running power (Stryd). Encodable core: TSS = (duration_s × NP × IF) ÷ (FTP × 3600) × 100; 1 hr at threshold = 100 TSS exactly.

**Steve Magness — *The Science of Running* (2014).** Bridges physiology and practice; frameworks for individualizing intensity, interpreting workout "responders," and avoiding the mid-intensity "black hole." Useful for insight *narrative* logic rather than a single formula.

**Phil Maffetone — *The Big Book of Endurance Training and Racing*.** The **MAF 180 Formula**: max aerobic HR = 180 − age, with modifiers (−10 major illness/meds/overtrained; −5 injured/ill/inconsistent/returning; +0 training 2 yr consistently; +5 for 2+ yr and progressing). Plus the **MAF Test** (repeat a fixed distance/route at MAF HR and track pace improvement over time) — trivially computable and a strong per-week signal.

**Pete Pfitzinger & Scott Douglas — *Advanced Marathoning* (and *Faster Road Racing*).** Encodable **run taxonomy** with pace/HR anchors: Recovery, General Aerobic, Endurance (long runs), Medium-long runs, **Lactate Threshold** (tempo ≈ 15K–half-marathon pace, ~82–91% HRmax, ≥20 min continuous or LT cruise intervals), VO2max intervals, and progression long runs to marathon pace. Field LT test: 30-min TT, average HR of final 20 min ≈ LT HR. This taxonomy maps cleanly onto per-run-type insight logic.

**Steve House & Scott Johnston — *Training for the New Alpinism* / *Training for the Uphill Athlete* (Uphill Athlete).** Popularized the **Aerobic Threshold (AeT) heart-rate-drift test** (aerobic decoupling <5% over a steady effort as evidence of aerobic base) and the aerobic/anaerobic threshold framing for mountain athletes. Directly encodable as the decoupling metric.

**Matt Fitzgerald — *80/20 Running* (2014).** Practitioner translation of Seiler's polarized model into runner-facing zones and the "run slow to run fast" prescription (~80% easy below VT1, ~20% moderate/hard). Encodable as a weekly intensity-distribution target and "easy day too hard" flag.

**Tim Noakes — *Lore of Running* (4th ed.).** Encyclopedic reference; source of the **Central Governor Model** of fatigue and extensive discussion of physiological testing. More reference than formula, but valuable for narrative and caveats.

**Brad Stulberg & Steve Magness — *Peak Performance* (2017).** Stress + rest = growth framing (the conceptual basis for load/recovery cycling). Narrative logic rather than formula.

**Other significant titles:** **Daniels & Gilbert — *Oxygen Power* (1979)** (the original VDOT tables); **David Epstein — *The Sports Gene*** (individual response/trainability); **Alex Hutchinson — *Endure* (2018)** (limits of fatigue, Central Governor, critical-power context); **Fitzgerald — *How Bad Do You Want It?*** (RPE/perception); **Magness & Stulberg — *The Passion Paradox***; **Jason Koop — *Training Essentials for Ultrarunning*** (ultra/vert, GAP, fueling); **Renato Canova**'s marathon methodology (percentage-based race-pace training, mostly in article form); **Stephen Seiler**'s work (no single book, but foundational papers below).

### 2. RESEARCH PAPERS / ACADEMIC LITERATURE

**Banister TRIMP & fitness–fatigue (impulse-response) model.** Banister EW et al. (1975) introduced TRIMP; **Morton RH, Fitz-Clarke JR, Banister EW (1990), "Modeling human performance in running," *J Appl Physiol* 69(3):1171–1177** is the key running paper. Model: Performance(t) = fitness − fatigue, each an exponentially-decaying sum of training impulses with magnitude constants k1, k2 and time constants τ1 (fitness, slow), τ2 (fatigue, fast). TRIMP = duration × ΔHR-ratio × weighting factor (weighting is exponential, derived from the lactate-HR curve — 0.64·e^(1.92x) for men, 0.86·e^(1.67x) for women, where x = fractional HR reserve). **Variants:** Edwards' TRIMP (summed time in 5 HR zones × zone weight 1–5); Lucia's TRIMP (time in 3 zones anchored to ventilatory thresholds). **Critiques:** Busso (modified nonlinear model accounting for training monotony); the fundamental limitation that HR cannot capture very short/intermittent efforts ("Assessing the limitations of the Banister model," PMC1974899).

**Foster session-RPE.** **Foster C et al. (2001), "A new approach to monitoring exercise training," *J Strength Cond Res* 15(1):109–115.** Session load (AU) = **session RPE (CR-10 scale) × duration (min)**. Weekly derived metrics: **monotony** = mean daily load ÷ SD of daily load; **strain** = weekly load × monotony. Validated in 950+ studies (review: Haddad et al. 2017, *Front Neurosci* 11:612). Requires a subjective RPE input the app would need to collect, but is the cheapest, most robust internal-load method.

**Seiler polarized training / intensity distribution.** **Seiler S & Kjerland GØ (2006), "Quantifying training intensity distribution in elite endurance athletes," *Scand J Med Sci Sports*** — the empirical origin of ~80/20 (≈80% below VT1, ≈20% above, minimal "grey zone"). **Stöggl T & Sperlich B (2014), "Polarized training has greater impact on key endurance variables than threshold, high intensity or high volume training," *Front Physiol*** — a 9-week RCT in 48 well-trained athletes (baseline VO2peak 62.6 ± 7.1 ml/kg/min): the polarized group (68/6/26 distribution) improved VO2peak by +11.7%, time-to-exhaustion by +17.4%, and peak velocity/power by +5.1%, whereas the threshold and high-volume groups produced essentially zero significant further improvements. Systematic review: PMC11679080 (2024) — polarized (≈75–80% LIT, 15–20% HIT) effective for VO2max/economy short-term. Seiler frames 80/20 as a "population optimum," not a universal law.

**Gabbett ACWR & the training-injury prevention paradox.** **Gabbett TJ (2016), "The training–injury prevention paradox: should athletes be training smarter and harder?" *Br J Sports Med* 50(5):273–280.** ACWR = acute load (most recent 7 days) ÷ chronic load (rolling 28 days). "Sweet spot" ≈ **0.8–1.3**; "danger zone" >1.5 (some cite ~2.0). Higher chronic load is protective. **Supporting:** Blanch & Gabbett (2016, *BJSM* 50:471–475) return-to-play application.
**ACWR critiques (important — present with balance):**
- **Impellizzeri FM, Tenan MS, Kempton T, Novak A, Coutts AJ (2020), "Acute:Chronic Workload Ratio: Conceptual Issues and Fundamental Pitfalls," *Int J Sports Physiol Perform* 15(6):907–913** — ACWR never validated as a causal factor; manipulating it to change injury risk is "conjecture and an overinterpretation of the available data." Follow-up: Impellizzeri et al. (2021), "What Role Do Chronic Workloads Play…? Time to Dismiss ACWR and Its Underlying Theory," *Sports Med* 51:581–592. The same group formally requested correction/retraction of the Blanch & Gabbett "sweet spot" figure (which was labeled illustrative yet treated as validated, including in the 2016 IOC consensus).
- **Lolli L, Batterham AM, Hawkins R, et al. (2019), "Mathematical coupling causes spurious correlation within the conventional acute-to-chronic workload ratio," *Br J Sports Med* 53(15):921–922** — because the acute week is *inside* the chronic denominator, a spurious ~r=0.5 correlation arises irrespective of any biological association. **Fix: "uncoupled" ACWR** (acute = last 7 days; chronic = *preceding* 21 days, disjoint).
- **Wang C, Vargas JT, Stokes T, Steele R, Shrier I (2020), "Analyzing Activity and Injury: Lessons Learned from the Acute:Chronic Workload Ratio," *Sports Med* 50(7):1243–1254** — broad statistical critique; limitations "should discourage its use" (ratios discard information; a given ACWR arises from many absolute-load combinations; arbitrary thresholds).
- **EWMA vs rolling average:** Williams S et al. (2017, *BJSM* 51:209–210) proposed the **exponentially weighted moving average (EWMA)** ACWR; Murray NB et al. (2017, *BJSM* 51:749–754) found EWMA more sensitive (EWMA_today = Load_today·λ + (1−λ)·EWMA_yesterday, λ = 2/(N+1)); Menaspà (2017, *BJSM* 51:618) critiqued rolling averages for ignoring load timing/decay. (Counterpoint: Coyne et al. 2020 and Windt/Gabbett argue coupling has little practical effect — coupled vs uncoupled ACWR r=.88–.99.)

**Critical Power / Critical Speed.** **Jones AM & Vanhatalo A (2017), "The 'Critical Power' Concept: Applications to Sports Performance…," *Sports Med* 47(Suppl 1):S65–S78**; **Poole DC, Burnley M, Vanhatalo A, Rossiter HB, Jones AM (2016), "Critical Power: An Important Fatigue Threshold in Exercise Physiology," *Med Sci Sports Exerc* 48(11):2320–2334.** For running, **Critical Speed (CS)** and **D′** (distance runnable above CS) come from the hyperbolic speed–time relationship (linear form: distance = CS·t + D′), fit from ≥2 maximal time trials (e.g., 1200 m + 2400 m, or 3-min + 9-min). CS demarcates heavy/severe intensity domains. In Jones & Vanhatalo's analysis of 12 male world-class marathoners (2:03–2:08), best marathon performance was achieved at **~96% of critical speed**; by contrast recreational runners (Smyth & Muniz-Pumares 2020) average ~85% of CS in the marathon — a directly usable durability benchmark. Historical running roots: Hughson et al. (1984), Housh et al. (1991); original two-parameter model Monod & Scherrer (1965).

**Aerobic decoupling / cardiac drift / Efficiency Factor.** TrainingPeaks (Coggan/Friel) operational definitions, quoted from the TrainingPeaks Help Center: **"Efficiency factor (EF) is the ratio of Normalized Power to heart rate (cycling) or Normalized Graded Pace to heart rate (running) for a given activity"** — rising EF over time = improving aerobic fitness. **Decoupling (Pa:Hr)** = % change in EF between first and second half of a steady aerobic effort; per Friel/TrainingPeaks, **"a smaller change in EF (less than 5%) … may indicate improving aerobic endurance,"** whereas **">10% decoupling: the effort was likely above aerobic threshold"** or the athlete is under-conditioned; heat/dehydration are common confounds. Physiology: cardiovascular drift = progressive HR rise at constant workload due to falling stroke volume (see PMC12271085, 2025, ML on CV drift as a training-response marker).

**HRV & readiness/recovery.** **HRV-guided training meta-analyses:** Manresa-Rocamora A, Sarabia JM, Javaloyes A, Flatt AA, Moya-Ramón M (2021), *Int J Environ Res Public Health* 18(19):10299 — HRV-guided training superior for vagal HRV (SMD+ = 0.50, 95% CI 0.09–0.91) but only small/non-significant edges for VO2max (SMD+ = 0.20) and endurance performance. Granero-Gallegos et al. (PMC7663087) — small positive effect on VO2max (ES 0.402). A recurring finding: HRV-guided training produces **fewer non-responders**. Requires morning R-R/HRV data (chest strap or ring) the app may not have.

**VO2max estimation from wearables.** **Firstbeat white paper (2017), "Automated Fitness Level (VO2max) Estimation with Heart Rate and Speed Data"** — analyzes the HR-vs-speed relationship at multiple points during a run, EPOC-based, error-corrected to use only reliable segments (foundational ref Rusko et al. 1993). Firstbeat reports **95% accuracy for running (MAPE ~5%), based on a database of 2,690 freely performed runs from 79 runners, with error below 3.5 ml/kg/min in the vast majority of measurements.** Independent validation is less rosy: a University of Würzburg study found a mean error of 5.7% across 23 runners, and a Forerunner 245 validation (PMC12881131) reported MAPE 7.2–7.9% overall but 9.4–10.4% in highly trained athletes, **underestimating them by ~6.3 ml·kg⁻¹·min⁻¹**. Ceiling ~85 ml/kg/min. Best used as a *trend*, not an absolute.

**Running economy.** **Barnes KR & Kilding AE (2015), "Running economy: measurement, norms, and determining factors," *Sports Med – Open* 1:8 (DOI 10.1186/s40798-015-0007-y).** RE = O2 (or energy) cost at a given submaximal speed; multifactorial (metabolic, cardiorespiratory, biomechanical, neuromuscular). Also Saunders PU et al. (2004), *Sports Med* 34(7):465–485. True RE needs gas exchange; EF is the field proxy.

**Grade-adjusted pace / energy cost of gradient running.** **Minetti AE et al. (2002), "Energy cost of walking and running at extreme uphill and downhill slopes," *J Appl Physiol* 93(3):1039–1046.** Energy cost polynomial (J/kg/m): C(g) = 155.4·g⁵ − 30.4·g⁴ − 43.3·g³ + 46.3·g² + 19.5·g + 3.6, valid −45%…+45% grade; flat cost ≈ 3.6 J/kg/m. GAP multiplier = C(g)/C(0). Caveat: captures metabolic cost but not eccentric muscle damage on steep descents (CK/soreness spike 3–5× at −10%).

**Overtraining / non-functional overreaching.** **Meeusen R et al. (2013), "Prevention, diagnosis and treatment of the overtraining syndrome: Joint consensus statement of the ECSS and ACSM," *Med Sci Sports Exerc* 45(1):186–205 / *Eur J Sport Sci* 13(1):1–24.** Spectrum: **Functional Overreaching (FOR, days→supercompensation) → Non-Functional Overreaching (NFOR, weeks–months, performance decrement) → Overtraining Syndrome (OTS, months–years).** No single validated biomarker; diagnosis by exclusion. Computable proxies: suppressed HRV, elevated resting HR, declining EF/performance at fixed HR, chronic negative TSB, high Foster monotony/strain.

**DFA-a1 (nonlinear HRV threshold detection) — emerging thread.** **Rogers B, Giles D, Draper N, Hoos O, Gronwald T (2021), "A New Detection Method Defining the Aerobic Threshold… Based on Fractal Correlation Properties of Heart Rate Variability," *Front Physiol* 11:596567.** The short-term scaling exponent **DFA-a1 ≈ 0.75 marks the aerobic threshold (VT1/HRVT1); ≈ 0.5 marks the anaerobic threshold (VT2/HRVT2).** Follow-ups: Rogers et al. (2021, *J Funct Morphol Kinesiol* 6:38, anaerobic threshold), Gronwald et al. (2020, 2024). Requires clean beat-to-beat R-R data (Bluetooth chest strap, <3% artifacts) — not available from standard Strava streams. Implemented in Runalyze and AI Endurance.

### 3. COMPUTABLE METRICS (from Garmin/Strava streams)

**Fully computable from HR + pace + elevation + duration + cadence + GPS:**
- **hrTSS / TRIMP** — needs HR stream + HRmax + resting HR (+ threshold HR). Banister TRIMP with gender weighting, or Edwards zone-summation. Fully computable.
- **rTSS** — needs pace stream + elevation (for NGP) + threshold pace. rTSS = (duration_s × NGP × IF) ÷ (threshold_pace × 3600) × 100, IF = NGP ÷ threshold pace. Fully computable.
- **Normalized Graded Pace (NGP)** — pace adjusted per Minetti C(g)/C(0) using the grade stream (grade = Δelevation/Δdistance), then apply NP-style 30-s rolling 4th-root smoothing. Fully computable.
- **Grade-Adjusted Pace** — Minetti polynomial on the grade stream. Fully computable (note GPS elevation noise; smooth over ~10–30 m).
- **CTL / ATL / TSB** — CTL = 42-day EWMA of daily TSS; ATL = 7-day EWMA; TSB = yesterday's CTL − ATL. Form bands (intervals.icu convention): >+20 transition, +10..+20 fresh, +10..−5 grey, −5..−30 optimal training, <−30 high risk. Fully computable from any consistent load metric.
- **ACWR** — acute (7-day) ÷ chronic (28-day rolling or preferably uncoupled 7:21, or EWMA). Sweet spot 0.8–1.3. Fully computable; present with validity caveats.
- **Efficiency Factor** — NGP ÷ avg HR on steady aerobic segments. Fully computable; only meaningful on steady sub-threshold runs.
- **Aerobic decoupling** — split steady effort in half, compute EF each half, decoupling = (EF1 − EF2)/EF1 × 100. Threshold ~5% (>10% = above aerobic threshold/under-conditioned). Fully computable.
- **Intensity distribution / time-in-zone** — % of run/week in each HR or pace zone; compute polarization (LIT/MIT/HIT split) vs 80/20 target. Fully computable.
- **Cadence metrics** — mean/variability of cadence stream; compare to self-selected baseline; flag overstriding proxies (low cadence + high vertical oscillation if available). Cadence directly available; vertical oscillation/GCT only from Garmin Running Dynamics pods.
- **Critical Speed / D′** — fit from best efforts across durations in the GPS history (speed-duration curve). Computable from accumulated maximal efforts (like intervals.icu eFTP).
- **VDOT / race-equivalent** — from a race or hard-effort result via Daniels–Gilbert. Computable.
- **Foster session load / monotony / strain** — needs an RPE input (collect post-run) OR approximate with hrTSS. Monotony/strain computable from daily loads.
- **HR recovery (HRR)** — HR drop in 60 s after effort end, if the stream continues past the stop. Sometimes computable.

**Requires data the app does not have (flag as optional/estimate):**
- **True VO2max / lactate threshold / MLSS** — need gas exchange or blood lactate; use VDOT/CS/EF as proxies.
- **HRV (rMSSD, DFA-a1)** — need beat-to-beat R-R intervals (chest strap/ring nocturnal); not in standard activity streams.
- **Readiness/Recovery scores** (WHOOP/Oura/Garmin Body Battery) — proprietary, need nocturnal HRV/sleep; largely unvalidated.
- **Running power (Stryd)** — needs a foot pod; can be *estimated* but no open standard.

### 4. PER-RUN INSIGHT TAXONOMY (by run type)

**Easy / aerobic / recovery runs:**
- Verify intensity: % of time truly below aerobic threshold / in Z1–2 / below MAF HR. Flag "your easy run drifted into the grey zone — X% above target HR" (Seiler's central message).
- EF for the run and its trend vs recent easy runs (aerobic fitness signal).
- Decoupling should be minimal (<5%); if high on an easy run, flag fatigue/heat/dehydration.
- Cadence vs baseline; recovery-run pace vs prescribed.

**Tempo / threshold runs:**
- Was the working segment within threshold band (~IF 0.95–1.05; ~85–91% HRmax; ≈15K–half pace)? Time-in-threshold-zone.
- Decoupling across the tempo block (durability at threshold).
- NGP of the tempo segment vs threshold pace; compare to prior tempo sessions (rising = improving LT pace).
- HR-to-pace coupling: is HR climbing at fixed pace (drift) → flag.

**Interval / VO2max sessions:**
- Per-rep analysis: pace/GAP consistency across reps, **fade %** (rep 1 vs last rep), time spent at ≥ ~95% VO2max HR or in Z5.
- Work:recovery ratio and whether HR recovered adequately between reps (HRR).
- Total time at VO2max-eliciting intensity (target dose).
- Note HR lag — for short reps pace/power is a better intensity marker than HR.

**Long runs:**
- Aerobic decoupling over the whole run (durability); >5% late = endurance ceiling or fueling/heat.
- Late-run pace/GAP fade and cadence decay (fatigue/form breakdown).
- Time-on-feet, elevation, GAP-normalized effort; carbohydrate/duration context.
- EF trend on the steady portion.

**Race efforts:**
- Pacing evenness (splits, GAP splits, first-half/second-half), % of CS/threshold sustained (benchmark: elites ~96% CS in the marathon, recreational ~85%).
- New VDOT/CS estimate and race-equivalent updates.
- Decoupling as a durability grade.

**Recovery runs:**
- Confirm truly easy (HR cap, cadence relaxed, short); flag if too hard given negative TSB.

**Cross-cutting weekly summary:** intensity distribution vs 80/20; weekly TSS and CTL ramp rate (safe ≈ +3–7 CTL/week; flag jumps >~8–10); ACWR band; monotony/strain; TSB trend and race-readiness; EF/decoupling trend; overreaching flags (rising RHR, falling HRV, EF decline at fixed HR).

### 5. CHART / VISUALIZATION IDEAS

- **HR + pace (or GAP) dual-axis overlay per run** — the core decoupling visual; shade first/second half.
- **Aerobic decoupling callout** — single % with color band (<5% green, >10% red).
- **EF trend line** — EF per steady run over weeks.
- **Grade-adjusted pace chart** — raw pace vs GAP over distance, with elevation profile underlay.
- **CTL/ATL/TSB three-line Performance Management Chart** — the weekly centerpiece; color TSB form bands.
- **ACWR band chart** — ACWR over time with 0.8–1.3 sweet-spot shading (and danger >1.5).
- **Weekly zone-distribution stacked bar** — time-in-zone, compared to an 80/20 reference line.
- **Polarization index / intensity-distribution pie or bar** (LIT/MIT/HIT).
- **Interval bar chart** — per-rep pace/GAP/HR with fade highlighting.
- **Power/speed–duration curve** (mean-max) with CS/D′ fit — intervals.icu style.
- **VDOT/CS trend and race-equivalency table.**
- **HR-vs-pace scatter with regression** — economy/threshold inflection (DFA-a1 or HR-drift style, if data allows).
- **Cadence distribution histogram** and cadence-vs-pace plot.
- **Monotony/strain weekly bars.**
- **"Easy vs hard" compliance dial** — % easy volume actually easy.
- **Calendar heatmap** of daily load (GitHub-style) for consistency.

### 6. ADDITIONAL FRAMEWORKS

**Coggan power zones adapted to running (Stryd).** Stryd uses **Critical Power (CP)** (≈ power sustainable ~30–70 min, ≈ VT2/MLSS) instead of FTP; auto-derived from ~90 days of power-duration data or tested via **3-lap + 6-lap track TTs** or **3-min + 9-min TTs**, yielding CP and W′ (finite work above CP). Alternatively rFTPw = average power of the last 20 min of a 30-min TT. Running power zones set as % CP (schemes vary by coach — Stryd, Palladino Power Project, Jim Vance, 80/20): recovery <~81%, endurance ~81–90%, tempo ~90–100%, threshold ~95–100%, supra-threshold/interval ~101–106%, VO2max ~106–115%+. Two-parameter CP model: P(t) = CP + W′/t. Validation: Dearing & Paton / Cardinale (2022) — CP_STRYD ≈ VT2/OBLA and equivalent to established CP models. Protocol developed with Coggan and Stephen McGregor. Requires a foot pod; the power algorithm is proprietary.

**Daniels cadence / stride research.** Daniels observed at the **1984 LA Olympics** that nearly all elite distance runners ran at **≥180 steps/min** — an elite race-pace *floor*, not a universal target; recreational runners average ~160–170 spm; optimal cadence rises with speed and falls with leg length. **Heiderscheit BC, Chumanov ES, Michalski MP, Wille CM, Ryan MB (2011), "Effects of Step Rate Manipulation on Joint Mechanics during Running," *Med Sci Sports Exerc* 43(2):296–302** (45 runners; preferred cadence 172.6 ± 8.8 spm): increasing step rate **+5% and +10%** significantly reduced energy absorbed at the knee (and at the hip at +10%), reduced vertical COM oscillation, braking impulse, peak knee flexion, and **overstriding** (foot lands closer to the COM); increases **≤10% cost little extra metabolic energy** while >10% raises VO2/RPE. Practical rule: **+5–10% cadence from self-selected** to cut joint loading. Supporting: Lenhart et al. (2014, *JOSPT* 44(10):766–774, hip loads), Willson et al. (2015, *Scand J Med Sci Sports* 25(6):736–743, patellofemoral stress), Anderson et al. (2022, *Sports Med – Open* 8:112, meta-analysis), Cavanagh & Williams (1982) on the U-shaped stride-length/economy relationship. Cadence, vertical oscillation, and ground contact time are running-economy/loading indicators. (Caveat: cadence reliably changes biomechanics, but prospective injury-prevention evidence remains limited; Schmida/Heiderscheit found vertical loading rate not associated with injury.)

**RPE-based zone models.** **Borg 6–20 RPE scale** (original, roughly linear with HR) and **Borg CR-10** (used in Foster session-RPE). Encodable as a 3-zone (easy/moderate/hard) tagging or a Foster CR-10 collection to compute session load without HR — useful backup for treadmill/trail runs where GPS/HR is unreliable.

**Wearable readiness/recovery systems and their basis.**
- **WHOOP Recovery Score (0–100%)** — HRV (rMSSD) + resting HR + sleep + (now) respiratory rate, measured during slow-wave sleep; validated against ECG for HRV (CCC ≈ 0.94; Dial et al. 2025).
- **Oura Readiness** — overnight HRV + resting HR + body temp + sleep balance; best HRV concordance (CCC ≈ 0.99, Dial 2025).
- **Garmin Training Readiness / Body Battery / Training Status** — Firstbeat: HRV status, sleep, recovery time, acute load, load ratio, VO2max trend; Body Battery is a multi-day energy model.
- **Overall caveat:** the underlying HRV signals are reasonably validated, but the *composite scores* are proprietary and largely unvalidated. **Doherty C, Baldwin M, Lambe R, Burke D, Altini M (2025), *Transl Exerc Biomed* 2(2):128–144** evaluated 14 composite health scores across 10 manufacturers (Fitbit, Garmin, Oura, WHOOP, Polar, Samsung, Suunto, Ultrahuman, Coros) and found **"none of the manufacturers disclosed their exact algorithmic formulas, and few provided empirical validation"**; the most common inputs were HRV (86%), resting HR (79%), physical activity (71%), and sleep (71%). The actionable takeaway (Flatt et al.): HRV-guided modulation reduces non-responders.

**Firstbeat EPOC / Training Effect** — aerobic & anaerobic Training Effect (1–5 scale) derived from EPOC accumulation modeling; another encodable per-run "what did this do for me" score if EPOC is modeled from HR.

**Open-source / reference implementations to learn from:** **Runalyze** (implements CTL/ATL/TSB, TRIMP, VO2max, DFA-a1 HRV, monotony), **intervals.icu** (free; CTL/ATL/TSB "Fitness/Fatigue/Form," eFTP, HR-drift/decoupling, power/speed-duration model, per-sport zone analysis), **GoldenCheetah** (open-source; PMC, Banister/Coggan models, power-duration, W′ balance), **Stryd PowerCenter**, and **TrainingPeaks** metric docs. These are the best blueprints for per-run analytics.

## Recommendations

**Stage 1 — Ship the defensible core (data you already have):**
1. Zone engine off **threshold pace/HR** (Daniels VDOT for pace zones; Friel/Coggan threshold anchoring). Compute time-in-zone per run and per week.
2. **rTSS + NGP** (Minetti GAP) as the per-run load; **hrTSS/TRIMP** as fallback when pace is unreliable (treadmill/trail).
3. **CTL/ATL/TSB** weekly dashboard + ramp-rate guardrail (+3–7 CTL/week).
4. **Efficiency Factor + aerobic decoupling** (<5% good / >10% flag) on steady runs; **intensity-distribution vs 80/20** weekly audit ("was easy easy?").
5. Per-run-type insight templates (Section 4) and the Section-5 charts.

**Stage 2 — Add estimated/derived metrics with caveats:**
6. **Critical Speed / D′** and VDOT trend from accumulated best efforts; race-equivalency; durability grade vs the ~96%-CS (elite) / ~85%-CS (recreational) benchmarks.
7. **ACWR** — implement **uncoupled EWMA** (not naive coupled rolling average) and present as *context*, not a hard injury predictor; cite the validity debate.
8. **Overreaching flags** from EF decline at fixed HR, rising RHR, chronic deep-negative TSB, high Foster monotony/strain.
9. Optional **RPE capture** to unlock true session-RPE load and monotony/strain.

**Stage 3 — Integrations (data you don't have):**
10. Optional **HRV ingest** (chest strap/Oura/WHOOP/Garmin) for readiness and, for ramp tests, **DFA-a1** thresholds.
11. Optional **Stryd running power** for power zones and W′-balance.

**Thresholds to encode (quick reference):** decoupling <5% (good aerobic durability) / >10% (above aerobic threshold or under-conditioned); ACWR 0.8–1.3 sweet spot, >1.5 danger; TSB form bands (+25..+5 race-ready, <−30 high risk); CTL ramp +3–7/week safe; 80/20 (or ~75/5/20) LIT/MIT/HIT; MAF HR = 180−age±mod; threshold ≈ 88% VO2max / 90% marathon pace; cadence +5–10% to reduce loading; DFA-a1 0.75 (AeT) / 0.5 (AnT); Firstbeat VO2max ~5% MAPE best case (~6 ml/kg/min low for highly trained); CS durability ~96% (elite) vs ~85% (recreational).

**Benchmarks that should change the logic:** if the runner adds a chest strap/ring → enable HRV readiness and DFA-a1; if they add a foot pod → switch to power zones; if GAP/elevation data is noisy on a run → downweight pace insights and lean on HR; if a run isn't steady (high variability index) → suppress EF/decoupling (only valid on steady efforts).

## Caveats
- **CTL/ATL/TSB, ACWR, TRIMP are models, not measurements** — only as good as zone/threshold accuracy and data completeness; untracked activity corrupts them.
- **ACWR is actively contested** (Impellizzeri 2020/2021, Lolli 2019, Wang 2020): mathematical coupling produces spurious correlation, thresholds are not universal, and it was never validated as causal — use as soft context, and prefer the uncoupled/EWMA form.
- **HR-based metrics drift** with heat, dehydration, stress, caffeine, cardiac lag; decoupling/EF are only valid on **steady, sub-threshold** efforts.
- **Wearable VO2max and recovery/readiness scores are estimates/black boxes** — Firstbeat reports 95% accuracy but independently underestimates highly trained runners by ~6 ml/kg/min; composite recovery scores are largely unvalidated with undisclosed formulas (Doherty et al. 2025).
- **DFA-a1 and HRV** need clean beat-to-beat data (chest strap, <3% artifacts) and are best from dedicated ramp tests — not standard Strava streams.
- **GAP/Minetti** captures metabolic cost but **not eccentric damage** on steep downhills; GPS elevation is noisy and needs smoothing.
- **VDOT/CS assume honest maximal efforts** on accurate courses; heat/altitude/terrain distort them.
- **The 80/20 model is a population optimum**, not a per-athlete law; some respond to slightly different distributions.
- **Overtraining has no single validated biomarker** (Meeusen 2013) — the app can flag *risk patterns*, not diagnose OTS.
- Some cited secondary figures (e.g., exact % joint-load reductions from cadence change; certain vendor accuracy claims) come from coaching/vendor sources and should be treated as indicative pending confirmation against primary tables.