# Wolf Vision: automatic hits and identity

How `/match-analyzer` tracks a doubles game with no operator taps: the four
players' identities, every hit and who made it, plus an estimate of the hits
it missed. Code: `lib/ma/`. Tests: `tests/match-analyzer-auto.test.ts`.

## Pipeline (per frame)

1. **Frame in**: phone camera (1080p, 30–60 fps), an uploaded video, or the
   simulator. Only newly presented frames are analysed
   (`requestVideoFrameCallback`): a repeated frame looks like "nothing moved"
   to the motion detectors. Analysis copy: 640 px wide, greyscale.
2. **Camera shake**: integer shift between frames from row/column gradient
   projections (`imaging.ts`), compensated before frame differencing; its
   size feeds the stability factor.
3. **People**: MediaPipe EfficientDet-Lite0 "person" boxes every other frame
   (live: never more than half the main thread; uploads: always, and playback
   slows down instead). Each box gets a 3-part colour fingerprint
   (shirt / shorts / legs, 11 hue-sat-value bins each).
4. **Court and lens** (`lens.ts`): 4+ tapped court points → homography by
   normalised DLT. With 6+ points the radial distortion of the lens is fitted
   too (division model, λ by golden-section search; priors 0 for 1×,
   −0.12 for 0.5× ultra-wide). A 3D camera is recovered from the homography
   with the iPhone field of view as prior (1×: 66°, 0.5×: 104°, ±20 %).
5. **Identity** (`identity.ts`): constant-velocity Kalman filter per player in
   court metres; Hungarian assignment each detection frame with a "stay
   unmatched" column per player. Cost = Mahalanobis distance + colour distance
   (Hellinger, 3 parts) + height (box height × metres-per-pixel, lower
   third quantile so a raised racket arm doesn't count). Hard rules: nobody
   crosses the net; gates widen only after a player has been lost for 1 s.
   When partners overlap, their looks stop updating; after they part, "keep"
   vs "swap" is decided from position momentum, colour and height, with a
   margin that grows as the two look more alike (identical kit → it takes
   strong evidence to swap). Start-up: people inside the court lines are
   picked up on their slots (left/right as the camera sees it, using the
   centre line when only one of a pair is visible), once the same spot has
   been seen 4 times (3 when detection is slow).
6. **Shuttle** (`shuttle.ts`): three-frame difference with an edge-gain
   threshold, small blobs outside every person's body, linked into flight
   tracks. A track must leave the players' reach and span ≥ 0.8 × a player's
   height. Cues: a *turn* (direction reversal), a *relaunch* (closest
   approach to a player then away), a *launch* (back-dated start).
   Each cue is checked in 3D against every player (drag ballistics through a
   point near the player, Levenberg–Marquardt): `playerFit` tells near/far
   and front/back apart, which the flat image cannot.
7. **Swing**: motion energy in the upper body minus 0.8 × the legs (a split
   step moves the legs, a swing moves the arm), z-scored peaks per player.
8. **Sound** (`audio.ts`): spectral flux in 1.5–7 kHz, adaptive median +
   MAD threshold; racket impacts are sharp and 2–5 ms long. Live from the mic
   (echo cancellation, noise suppression and auto gain off), or decoded from
   an uploaded file. If the mic fails or the file has no sound, the engine
   switches to visual-only mode.

## Hit fusion and the acceptance threshold (`hits.ts`)

Each impact sound anchors a candidate and claims the swings in
[−0.15, +0.3] s and trajectory cues in ±0.25 s; visual cues with no sound
nearby form their own candidates. For every player *i*:

    z_i = −4.2 + 5.0·traj_i + 3.2·swing_i + 3.6·audio + 1.2·reach_i
          + 0.6·rhythm + 1.1·alternation_i + s

    s = −2.2  mic on, no impact heard
    s = +1.0  no sound available at all (visual-only mode)
    p = sigmoid(max_i z_i)

Visual cues are weighted by how well they line up with the sound
(Gaussian, σ 0.1 s; swings peak ~0.07 s after contact).

A candidate is **accepted** when p ≥ τ(Q), with the threshold rising as the
capture quality Q drops:

    τ(Q) = 0.5 + 0.25·(1 − Q)

### Capture quality Q

    Q = L^0.25 · S^0.25 · C^0.2 · I^0.2 · Rz^0.1

- L light: smoothstep(20, 75) of mean brightness × √smoothstep(6, 28) of
  contrast × exp(−max(0, noise − 3)/6)
- S stability: exp(−shake² / (2·1.5²)), RMS shake in px of a 640-wide frame
- C court: exp(−(rms / 14)²) × (1 for 6+ points, 0.95 for 5, 0.9 for 4),
  rms = tap reprojection error in px of a 1920-wide frame
- I identity: share of players tracked confidently
- Rz resolution: smoothstep(0.12, 1.2) of shuttle size in pixels at the far
  baseline

## Rally decoding and missed hits

Within a rally, hits must alternate across the net. A Viterbi pass over each
rally picks hitters using every candidate's per-player scores, with a
same-side transition cost of −8 for gaps under 0.8 s (no time for a shot and
a reply) and ln(1 − R) otherwise (a missed hit in between). Then:

- two hits on one side < 0.8 s apart: the weaker is dropped;
- two on one side with nothing seen on the other, one weak (p < 0.85) and the
  gap < 1.6 s: the weaker is dropped (likelier a false hit than two misses);
- otherwise a hit is **inferred** from the best rejected candidate on the
  other side (p ≥ 0.2), or **predicted** at the midpoint, given to the
  partner with the stronger swing.

### Expected recall, precision and the true total

Fitted on the simulator (3 seeds × 60 s per condition):

| | recall R(Q) | precision P(Q) |
|---|---|---|
| with sound | 0.79·Q^0.12 | 0.6 + 0.35·Q |
| visual only | 0.56·Q^0.12 | 0.4 + 0.2·Q |

The summary reports detected, inferred and predicted hits and

    N̂ = N_seen · P(Q) / R(Q)      ± √(N̂·(1 − R)) / R

## Measured on the simulator

The simulator (`sim.ts`) renders a doubles game in pixels through a pinhole
camera with the lens's distortion, drag physics for the shuttle (terminal
velocity 6.8 m/s), planned serves, swings, interception, camera shake,
sensor noise, a walking spectator, detector misses and merged boxes, impact
sounds and hall noise. Hits count as found within ±0.25 s. 3 seeds × 60 s,
640×360 analysis (run: `node <harness>/evalmulti.mts 60`):

| condition | Q | precision | recall | right hitter | right side | identity |
|---|---|---|---|---|---|---|
| 1×, partners in the same shirt | 0.83 | 0.90 | 0.76 | 0.72 | 0.82 | 1.00 |
| 0.5× ultra-wide | 0.71 | 0.83 | 0.74 | 0.70 | 0.74 | 1.00 |
| dim + noisy | 0.47 | 0.79 | 0.72 | 0.70 | 0.81 | 1.00 |
| shaky (2.5 px) | 0.76 | 0.68 | 0.83 | 0.56 | 0.65 | 0.98 |
| same shirts **and** shorts | 0.83 | 0.91 | 0.76 | 0.63 | 0.84 | 0.86 |
| 1×, no sound | 0.83 | 0.57 | 0.55 | 0.63 | 0.72 | 1.00 |
| 0.5×, no sound | 0.71 | 0.53 | 0.59 | 0.72 | 0.75 | 1.00 |

Recall counts inferred and predicted hits that land within ±0.25 s of a real
one. A tripod matters: shake costs the most (false hits from the camera's own
movement).

The browser test scenario (`?demo=1`, 30 s, with sound) typically reads
precision ~85 %, recall ~85 %, right hitter ~70–85 %, identity 100 %.

## Limits

- Accuracy above is on simulated games. Real halls add things the simulator
  does not: other courts' shuttles and sounds, white walls behind a white
  shuttle, motion blur at 30 fps. Use 60 fps and good light where possible.
- Visual-only (no sound) finds roughly half the hits with ~55 % precision;
  keep the mic on unless the hall is very loud.
- Right hitter between partners is the hardest call (~70 %): side of the
  net is right ~75–85 % of the time.
- Same shirts **and** same shorts lower identity to ~0.86 in the worst
  seed; height and position momentum carry it.
- The phone should be on a tripod behind a baseline, high enough to see
  the far baseline; the 0.5× lens needs 6+ court points.

## References

- MonoTrack (badminton, monocular 3D shuttle): https://arxiv.org/abs/2204.01899
- Shuttle tracking / hit detection: https://arxiv.org/pdf/2308.12645,
  https://arxiv.org/html/2509.05334v1
- SportsMOT (identical-kit multi-object tracking): https://openaccess.thecvf.com/content/ICCV2023/papers/Cui_SportsMOT_A_Large_Multi-Object_Tracking_Dataset_in_Multiple_Sports_Scenes_ICCV_2023_paper.pdf
- OC-SORT for athletes: https://openaccess.thecvf.com/content/WACV2023W/CV4WS/papers/Huang_Observation_Centric_and_Central_Distance_Recovery_for_Athlete_Tracking_WACVW_2023_paper.pdf
- SwingVision (ITF approval report): https://www.itftennis.com/media/15294/pat-25-037-approval-report-swingvision.pdf
- MediaPipe object detector: https://developers.google.com/edge/mediapipe/solutions/vision/object_detector
