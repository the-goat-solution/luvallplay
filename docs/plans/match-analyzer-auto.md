# Wolf Vision: automatic hits and identity

How `/match-analyzer` tracks a doubles game with no operator taps: the four
players' identities, every hit and who made it, plus an estimate of the hits
it missed, from a phone anywhere around the court. Code: `lib/ma/`. Tests:
`tests/match-analyzer-auto.test.ts`, `tests/wolf-vision.test.ts`. Stress test:
`scripts/wolf-vision-eval.mts`; test videos: `scripts/wolf-vision-render.mts`.

## Pipeline (per frame)

1. **Frame in**: phone camera (1080p, 30–60 fps), an uploaded video, or the
   simulator. Only newly presented frames are analysed
   (`requestVideoFrameCallback`): a repeated frame looks like "nothing moved"
   to the motion detectors. Analysis copy: 640 px wide, greyscale. Motion
   (shuttle, swings, shake) is analysed at ~30 fps whatever the camera rate:
   at 60 fps the detectors, tuned on 30 fps frame gaps, lost a fifth of the
   hits (recall 73 % → 60 %); people and sounds still use every frame.
2. **Camera shake**: integer shift between frames from row/column gradient
   projections (`imaging.ts`), compensated before frame differencing; its
   size feeds the stability factor. The court mapping follows it too
   (re-anchored on the calibration frame every half second, frame-to-frame in
   between), so a wobbling phone does not move the players' feet: before
   this, 2.5 px of shake added 22–37 % to every distance.
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

## Camera positions

The phone can stand anywhere the whole court is in shot (the setup asks
where): **behind a baseline** (tripod, fence; low on a chair or high on a
balcony), **side-on** at the net, or **in a corner**. Nothing in the engine
assumes a view:

- Player slots are in **court coordinates** (which half × which side of the
  centre line), not "left/right on screen". With a side camera both partners
  of a half sit at the same screen x; ordering them by screen x mixed them up
  half the time (identity 50 % → 100 % after the change).
- The resolution factor uses the court point farthest from the camera (any
  corner), not the far baseline.
- The calibration asks for the four corners in on-screen order for the
  chosen view (near-left… or nearest/right/farthest/left from a corner), and
  the court diagram is drawn the way the phone sees it. The court is
  symmetric, so a mirrored or rotated labelling changes nothing.
- The simulator renders all six positions × both lenses (`CAMERA_VIEWS` in
  `sim.ts`), with people drawn facing the camera and the floor ray-cast.

## Distance covered

Detector boxes wobble by a few pixels; far from the camera that is tens of
centimetres on the floor, and summing every wobble counted standing still as
running (measured ÷ true distance 1.8× behind a baseline, 3.3× from a low
camera). Now each track is cleaned and smoothed before distance is summed:

1. A point farther than 1.5 m from the median of its ±2 neighbours is a
   detector glitch (a box on the wrong person) and is dropped; the gap is
   bridged.
2. Gaussian-weighted centred average over ±4 samples.
3. Each step counts only what it moved beyond 0.2 × the local wobble (median
   distance of the raw points from the smooth path over ±7 samples).

Result: 0.90–0.95 × the true distance in every view and lens, 0.91 with a
shaky phone (slightly under: a little real movement is inside the wobble).

## Measured on the simulator

### Every camera position (40 s × 3 seeds, 640×360, same shirts, with sound)

`node --experimental-strip-types scripts/wolf-vision-eval.mts 40 views`

| condition | Q | precision | recall | right hitter | right side | identity | distance (measured ÷ true) |
|---|---|---|---|---|---|---|---|
| baseline 1× | 0.82 |   95% |   73% |   79% |   81% |  100% | ×0.91 |
| low 1× | 0.65 |   89% |   78% |   62% |   66% |   92% | ×0.97 |
| balcony 1× | 0.97 |   78% |   77% |   93% |   95% |  100% | ×0.92 |
| offcentre 1× | 0.78 |   89% |   67% |   64% |   69% |  100% | ×0.90 |
| side 1× | 0.89 |   97% |   88% |   59% |   95% |  100% | ×0.91 |
| corner 1× | 0.77 |   93% |   78% |   81% |   97% |  100% | ×0.90 |
| baseline 0.5× | 0.70 |   80% |   68% |   78% |   82% |   93% | ×0.91 |
| low 0.5× | 0.65 |   86% |   70% |   57% |   66% |   94% | ×0.95 |
| balcony 0.5× | 0.85 |   76% |   81% |   71% |   76% |  100% | ×0.94 |
| offcentre 0.5× | 0.64 |   93% |   72% |   82% |   90% |  100% | ×0.91 |
| side 0.5× | 0.84 |   96% |   72% |   67% |   95% |  100% | ×0.91 |
| corner 0.5× | 0.63 |   89% |   65% |   83% |   92% |  100% | ×0.91 |

Before the changes above, side-on identity was 50 % and distances were
×1.8–×3.3; hit numbers are unchanged. Reading the table: **side-on and
corner** cameras are best for which *side* hit (the net runs across the
picture: 90–97 %); **balcony and behind-baseline** are best for which
*partner* (78–93 %). A low camera (a chair) is the weakest: the near pair
hides the far pair.

### Hard conditions (40 s × 3 seeds)

`node --experimental-strip-types scripts/wolf-vision-eval.mts 40 stress`

| condition | Q | precision | recall | right hitter | right side | identity | distance (measured ÷ true) |
|---|---|---|---|---|---|---|---|
| baseline, no sound | 0.82 |   52% |   48% |   69% |   69% |  100% | ×0.91 |
| side, no sound | 0.89 |   68% |   42% |   76% |   94% |  100% | ×0.91 |
| dim + noisy | 0.40 |   82% |   64% |   68% |   77% |  100% | ×0.93 |
| side, dim + noisy | 0.41 |   95% |   73% |   75% |   96% |   91% | ×0.95 |
| shaky 2.5 px | 0.75 |   68% |   79% |   44% |   62% |  100% | ×0.91 |
| corner, shaky 2.5 px | 0.71 |   73% |   71% |   60% |   78% |  100% | ×0.90 |
| same shirts + shorts | 0.81 |   95% |   73% |   78% |   81% |  100% | ×0.91 |
| side, same shirts + shorts | 0.89 |   96% |   80% |   56% |   94% |   88% | ×0.91 |
| loud hall (2 false sounds/s) | 0.82 |   78% |   79% |   72% |   77% |  100% | ×0.90 |
| detector misses 20 % | 0.82 |   86% |   77% |   67% |   74% |  100% | ×0.99 |
| 24 fps phone | 0.83 |   86% |   76% |   78% |   89% |  100% | ×0.91 |
| 60 fps phone | 0.83 |   86% |   76% |   65% |   66% |  100% | ×0.90 |
| low res 480×270 | 0.82 |   90% |   71% |   79% |   84% |  100% | ×0.91 |
| everything bad, baseline | 0.44 |   65% |   57% |   50% |   57% |  100% | ×0.98 |
| everything bad, side | 0.45 |   68% |   66% |   74% |   87% |   84% | ×0.97 |
| long dropouts (1–4 s, 6/min/player) | 0.83 | 83% | 73% | 45% | 73% | 60% | ×0.97 |
| side, long dropouts | 0.89 | 88% | 67% | 65% | 93% | 77% | ×0.89 |
| corner, long dropouts | 0.78 | 84% | 60% | 61% | 89% | 77% | ×0.92 |

What the stress run found and fixed:

- **60 fps** lost a fifth of the hits (recall 60 %): motion is now analysed
  at ~30 fps (recall 76 %).
- **Shake** added 22–37 % to distances: the court mapping now follows the
  shake frame to frame (×0.90–0.91).
- **Long detector dropouts** (a far player under the score cut, hidden by a
  partner; seen with the real detector) let a player's predicted position
  coast on at full speed, off court and through the net, and out of reach of
  re-acquisition for the rest of the game. A player unseen for over a second
  now slows to a stop and stays on their own half; gaps up to 3 s are bridged
  for distance when the pace is possible. Same seeds without → with: recall
  76/55/47 % → 73/67/60 % (baseline/side/corner), distance ×0.80/0.87/0.65
  → ×0.97/0.89/0.92, identity 53/83/79 % → 60/77/77 %. Identity under long
  dropouts is the weakest number left.
- **Order of work per frame**: people are updated before the frame's motion
  is analysed, so swings and shuttle cues are judged against this frame's
  boxes (doing it the other way round cost 15 points of "right side" with the
  0.5× lens).

### In a real browser, end to end

`scripts/wolf-vision-render.mts` writes a simulated game as an MP4 with
sound (racket cracks and hall hiss) and the true hits; Playwright on an
emulated iPhone uploads it through the normal flow (phone position → four
corner taps → players → tracking to the end), with the real MediaPipe
detector and the sound decoded from the file. This also checks the second
upload of a session shows a picture (it used to stay black).

Final engine, 30 s games (one seed each, so ±10 points of noise), headless
Chromium on CPU (~7 min per 30 s video: no GPU; a phone is much faster):

| video | true hits | found | precision | recall | right hitter | right side | picture shown |
|---|---|---|---|---|---|---|---|
| behind baseline, 1× | 22 | 27 | 59% | 73% | 31% | 81% | yes |
| side-on, 1× (2nd upload) | 23 | 25 | 80% | 87% | 55% | 90% | yes |
| corner, 1× | 18 | 21 | 71% | 83% | 33% | 93% | yes |
| balcony, 0.5×, 6 points (2nd upload) | 19 | 23 | 61% | 74% | 71% | 86% | yes |

The real detector finds the simulator's drawn people less reliably than the
simulator's own boxes (1–3 of 4 per frame, scores 0.25–0.45), so precision and
*which partner* are lower here than in the tables above; *which side*, recall
and identity hold up. Two bugs this run found, now fixed: from a high camera
a tap for the next point (a net post) landed within the drag radius of a
placed corner and moved it; and a player the detector lost for seconds coasted
off court and was never picked up again. Before the fixes the corner video
read 43–53 % right side.

## Measured on the simulator (original, behind the baseline only)

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

- Real footage could not be fetched for this round (the sandbox's network
  blocks video sites; Wikimedia Commons rate-limited it). Accuracy above is on
  simulated games, rendered and run through the real browser pipeline. Real halls add things the simulator
  does not: other courts' shuttles and sounds, white walls behind a white
  shuttle, motion blur at 30 fps. Use 60 fps and good light where possible.
- Visual-only (no sound) finds roughly half the hits with ~55 % precision;
  keep the mic on unless the hall is very loud.
- Right hitter between partners is the hardest call (~70 %): side of the
  net is right ~75–85 % of the time.
- Same shirts **and** same shorts lower identity to ~0.86 in the worst
  seed; height and position momentum carry it.
- Any position works if all four corners are in shot. Behind a baseline
  or a balcony for who-hit-it between partners, side-on or a corner for which
  side; avoid a low camera (a chair): the near pair hides the far one. The
  0.5× lens needs 6+ court points (the setup asks for the net posts).
- A shaky phone still costs precision (false hits from its own movement):
  use a tripod or the fence.

## References

- Hsu et al., Sensors 2024 (TrackNet + YOLOv7 swing detection, 69 BWF
  matches; hit detection F1 90.5 %, TrackNet alone 58.8 % accuracy):
  https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11244353/
- Automated hit-frame detection for badminton: https://ar5iv.labs.arxiv.org/html/2307.16000
- Badminton stroke-type transformer (ShuttleSet): https://arxiv.org/pdf/2502.21085v2

- MonoTrack (badminton, monocular 3D shuttle): https://arxiv.org/abs/2204.01899
- Shuttle tracking / hit detection: https://arxiv.org/pdf/2308.12645,
  https://arxiv.org/html/2509.05334v1
- SportsMOT (identical-kit multi-object tracking): https://openaccess.thecvf.com/content/ICCV2023/papers/Cui_SportsMOT_A_Large_Multi-Object_Tracking_Dataset_in_Multiple_Sports_Scenes_ICCV_2023_paper.pdf
- OC-SORT for athletes: https://openaccess.thecvf.com/content/WACV2023W/CV4WS/papers/Huang_Observation_Centric_and_Central_Distance_Recovery_for_Athlete_Tracking_WACVW_2023_paper.pdf
- SwingVision (ITF approval report): https://www.itftennis.com/media/15294/pat-25-037-approval-report-swingvision.pdf
- MediaPipe object detector: https://developers.google.com/edge/mediapipe/solutions/vision/object_detector
