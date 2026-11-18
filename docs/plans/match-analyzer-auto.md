# Wolf Vision: automatic hits and identity

How Wolf Vision (`/profile/wolf-vision`) tracks a doubles game with no operator taps: the four
players' identities, every hit and who made it, plus an estimate of the hits
it missed. Code: `lib/ma/`. Tests: `tests/match-analyzer-auto.test.ts`.

## Pipeline (per frame)

1. **Frame in**: phone camera (1080p, 30–60 fps), an uploaded video, or the
   simulator. Only newly presented frames are analysed
   (`requestVideoFrameCallback`): a repeated frame looks like "nothing moved"
   to the motion detectors. Analysis copy: 640 px wide, greyscale. Repeated
   pictures inside the video itself (frame-rate conversion: the broadcast test
   clip repeats every 5th frame) are skipped for motion too: fewer than 0.05 %
   of sampled pixels changing by more than 3 grey levels.
2. **Camera shake**: integer shift between frames from row/column gradient
   projections (`imaging.ts`), compensated before frame differencing; its
   size feeds the stability factor.
3. **People**: MediaPipe EfficientDet-Lite0 "person" boxes every other frame
   (live: never more than half the main thread; uploads: always, and playback
   slows down instead). Each box gets a 3-part colour fingerprint
   (shirt / shorts / legs, 11 hue-sat-value bins each) and a standing height
   in metres from the 3D camera (the height at which a point above the feet
   meets the box top). A browser whose WebGL is a software rasteriser runs the
   model on the CPU (measured 120 ms vs 850 ms a frame).
4. **Court and lens** (`lens.ts`): 4+ tapped court points → homography by
   normalised DLT. With 6+ points the radial distortion of the lens is fitted
   too (division model, λ by golden-section search; priors 0 for 1×,
   −0.12 for 0.5× ultra-wide), within [prior − 0.25, prior + 0.05] so a tap
   off its line cannot be explained away as a strong distortion. With 5+
   points a fit error over 6 px (at 1920 wide) warns the assistant and names
   the worst point (the commonest slip: the court mat's edge instead of the
   outer line). A 3D camera is recovered from the homography with the iPhone
   field of view as prior (1×: 66°, 0.5×: 104°, ±20 %).
5. **Identity** (`identity.ts`): constant-velocity Kalman filter per player in
   court metres; Hungarian assignment each detection frame with a "stay
   unmatched" column per player. Cost = Mahalanobis distance + colour distance
   (Hellinger, 3 parts) + height (3D standing height, lower third quantile
   so a raised racket arm doesn't count). Velocity fades while a player is
   unseen (τ 0.6 s) and re-acquisition after 1 s searches around where they
   were last seen (1.5 m + 3.5 m/s), so a hidden player is not carried off
   court by their last step. Hard rules: nobody crosses the net; a match must
   be at least 60 % of the players' median height (seated people beside the
   court are about 55 %), a (re)acquisition 72 %; where one pixel covers more
   than 3 cm of floor (the far half from a low or side-on camera), only
   confident detections inside the lines count (bench spectators project
   into the margins there).
   When partners overlap, their looks stop updating; after they part, "keep"
   vs "swap" is decided from position momentum, colour and height, with a
   margin that grows as the two look more alike (identical kit → it takes
   strong evidence to swap). Start-up: people inside the court lines are
   picked up on their slots (left/right as the camera sees it, using the
   centre line when only one of a pair is visible), once the same spot has
   been seen 4 times (3 when detection is slow). People cut off by the side
   of the frame are never picked up.
6. **Shuttle** (`shuttle.ts`): three-frame difference with an edge-gain
   threshold; small compact blobs, with bodies masked whole (feet included:
   a moving shoe is the commonest false shuttle) except the racket zone (upper
   half out to the sides, above the head). Blobs with other motion close by
   score lower (a body breaking into fragments), and so do places that keep
   moving with no player there (`BackgroundActivity`: crowd, LED boards; a
   32×18 grid decaying over ~10 s). Linked into flight tracks; a track is a
   flight once it leaves racket reach, spans ≥ 0.8 × a player's height, is
   fast enough and smooth (a parabola per image axis within 8 px at 1920
   wide). A confirmed flight follows a narrow gate around its prediction and
   ends when it stops travelling (it must not slide onto an arm). Cues: a *turn* (direction reversal), a *relaunch* (closest
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
| with sound | 0.76·Q^0.12 | 0.8 + 0.18·Q |
| visual only | 0.43·Q^0.12 | 0.45 + 0.18·Q |

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
| 1×, partners in the same shirt | 0.83 | 0.97 | 0.73 | 0.84 | 0.89 | 1.00 |
| 0.5× ultra-wide | 0.71 | 0.88 | 0.69 | 0.68 | 0.72 | 1.00 |
| dim + noisy | 0.47 | 0.95 | 0.65 | 0.67 | 0.74 | 1.00 |
| shaky (2.5 px) | 0.76 | 0.85 | 0.56 | 0.62 | 0.65 | 0.98 |
| same shirts **and** shorts | 0.83 | 0.97 | 0.71 | 0.82 | 0.88 | 1.00 |
| 1×, no sound | 0.83 | 0.60 | 0.42 | 0.65 | 0.69 | 1.00 |
| 0.5×, no sound | 0.71 | 0.60 | 0.44 | 0.68 | 0.74 | 1.00 |

Recall counts inferred and predicted hits that land within ±0.25 s of a real
one. A tripod matters: shake costs the most (the camera's own movement hides
the shuttle's, so more hits are missed).

The browser test scenario (`?demo=1`, 30 s, with sound) typically reads
precision ~85 %, recall ~85 %, right hitter ~70–85 %, identity 100 %.

## Measured on real footage

Four clips replayed frame by frame through the engine exactly as the upload
path runs it (640 px analysis, detections every other frame, audio onsets):

- **Broadcast, behind the baseline** (All England 2026, mixed doubles, grey
  court, 1080p, 30 fps with every 5th frame repeated): calibration 1.4 px
  with 9 points, no lens curve. Before: repeated frames blanked the motion
  detector, body fragments (mostly feet) were tracked as the shuttle, and a
  confirmed track jumped onto a racket arm and stayed there; near partners
  swapped after crossing and a hidden player was not picked up again. After:
  flight arcs player to player are tracked (smashes, lifts, drives; the long
  lifts leave the frame at the top), and the near pair keeps its identities
  through the crossings in both clips. The far pair (behind the net, often
  one hiding the other) is detected less reliably by the person detector.
- **Club phone, court level near a net post** (green court, 1080p 60 fps):
  calibration 2.9 px from 7 line crossings. The far half is compressed into
  a strip a few pixels deep, so spectators on the bench behind the far court
  projected into it and were taken as far players; a person seated beside
  the post too. After: neither is picked up (confidence-inside-the-lines rule
  where positions are uncertain, height check against the players), and the
  near pair keeps its identity through the clip (told apart by shorts
  colour). High clears and the exchanges at the net are tracked as arcs.
  Sound: many onsets come from other courts and between rallies, so sound
  alone is never accepted as a hit.

For a phone set-up, behind a baseline and at least 2 m high with the whole
court in frame gives far better far-side positions than court level at the
side: every metre of the far half then spans tens of pixels, not a few.

## AI layers and auto-training (2026-11)

- **Two-pass person detection**: the detector runs on the whole frame and on
  a crop of the far half of the court up to head height (`farRoi`), mapped
  back and merged (`lib/ma/detections.ts`). On the club open-play clips
  (iPhone 0.5×, behind the baseline, purple court) far players went from
  50–74 % / 7–74 % of frames tracked to 75–89 % / 74–82 %.
- **Pose** (`components/match-analyzer/pose.ts`, MediaPipe Pose Landmarker
  lite): two players per detector frame in turn. Wrist speed in torso lengths
  per second gives swing cues (≥ 6 torso/s peak; walking stays under ~4), and
  the distance from the shuttle to the wrist / racket head replaces the box
  ellipse as "reach" when a pose is available.
- **Shuttle checker** (`lib/ma/checker.ts`): 151 inputs (7×7 patches of the
  two frame differences and the picture, normalised by the frame's motion
  threshold, plus blob measures) → 16 → 1. Trained on 82 k candidates
  (simulated games with exact labels, six real matches with self-labels at
  half weight): AUC 0.96 on unseen simulated games. It does not remove
  candidates (at a contact the shuttle overlaps the racket and those points
  make the hit cue); a track's flight points must average ≥ 0.15, which is
  neutral on the simulator and drops tracks that clearly are not a shuttle
  on real footage. Its benefit on real hit counts is not yet measured: that
  needs the labelling set.
- **Self-labels** (tracker → checker): points on a confirmed flight outside
  racket reach are positives, candidates of tracks that die unconfirmed are
  negatives. On the simulator they are right 57 % (positives) and 98 %
  (negatives) of the time, so online steps are small (lr 0.002), positives
  weigh 0.6, and weights are pulled back towards the shared model (L2 0.02).
- **Federated averaging** (`lib/wolf-vision-db.ts`): sessions with ≥ 200
  trained samples send their weights; each counts for at most 3,000 samples;
  updates more than 50 % (relative) away from the shared weights are not
  merged; every 3 updates the shared model is re-averaged.

## Limits

- Accuracy above is on simulated games. Real halls add things the simulator
  does not: other courts' shuttles and sounds, white walls behind a white
  shuttle, motion blur at 30 fps. Use 60 fps and good light where possible.
- Visual-only (no sound) finds under half the hits with ~60 % precision;
  keep the mic on unless the hall is very loud.
- Right hitter between partners is the hardest call (~70 %): side of the
  net is right ~75–85 % of the time.
- Same shirts **and** same shorts: identity held in all three simulated
  games (it fell to 0.86 in one before the height and re-acquisition
  changes); real partners in identical kit crossing repeatedly remain the
  hardest case.
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
