# LiteJam GlowTab

A self-built alternative to GlowTab (glowtab.litejam.com), with three ways to use it:

1. **Read sheet music**: Open a Guitar Pro file → view and play the score on screen while Web Bluetooth sends each beat's notes to light up the fretboard on a LiteJam LED guitar.
2. **Detect chords**: Drop in an audio file or paste a YouTube link → automatically detect chords and generate a chord chart; during playback, the fretboard lights up the chord to play.
3. **Chord picker**: Choose chords yourself and see **voicings at every position** on the neck; click any voicing to light it up.

There's also a 9:16 vertical Instagram layout for recording short videos.

## Getting started

Double-click the launcher command. It starts a small local server and opens the app in Chrome.

> ⚠️ Don't double-click `index.html` directly. There are two reasons: Web Bluetooth only works on `https` or `localhost`,
> and chord detection requires a local backend. Safari does not support Web Bluetooth at all; use **Chrome / Edge / Opera**.

Requirements: `ffmpeg` (`brew install ffmpeg`), `numpy`, and `pypinyin`
(`pip3 install --user numpy pypinyin`; `pypinyin` is only used for lyric romanization).
macOS uses the bundled `bin/yt-dlp`; Linux installs `yt-dlp` from `requirements.txt`.

### Scale presets and Google sign-in

Built-in scales and each signed-in user's custom scales are stored in a single SQLite database file. SQLite is included with Python; no database server is required. The database defaults to `~/.litejam-glowtab/scales.sqlite3` and should live on persistent storage when hosted.

#### Create the Google OAuth client

You need a normal Google Cloud project; there is no special project template and you do not need to enable a Google API for sign-in. The OAuth client type for this app is **Web application**.

1. Open [Google Cloud Console](https://console.cloud.google.com/), open the project picker, and select **New Project**. Give it a name such as `LiteJam GlowTab` and create it. A personal Google account is enough to create the project.
2. Make sure the new project is selected, then open **APIs & Services → OAuth consent screen**. If prompted, choose **Get started** or **Configure consent screen**. In the newer Console layout this section may instead appear as **Google Auth Platform**.
3. Under **Branding**, enter an app name (for example, `LiteJam GlowTab`), a support email, and your developer contact email. A logo is optional.
4. Under **Audience**, choose **External** if people outside your Google Workspace organization may sign in. While the app is in **Testing**, add your own Google account under **Test users**. For an app restricted to a Workspace organization, choose **Internal** instead.
5. Under **Data Access**, use the basic identity scopes `openid`, `email`, and `profile`. Do not add Drive, YouTube, or other API scopes; this app only uses Google to identify the signed-in user.
6. Open **APIs & Services → Credentials**, choose **Create credentials → OAuth client ID**, and select **Web application**. In the newer Console layout, use **Google Auth Platform → Clients → Create client**. Name it `LiteJam Render` (or similar).
7. In **Authorized JavaScript origins**, add the site origin, for example `https://your-service.onrender.com` (no path or trailing slash).
8. In **Authorized redirect URIs**, add the exact callback URL `https://your-service.onrender.com/auth/google/callback`.
9. Create the client. Copy its **Client ID** and **Client secret** into the Render environment variables below. Keep the secret private and do not commit it.

Direct links also work after selecting your project: [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent) and [Credentials](https://console.cloud.google.com/apis/credentials). In Testing mode, only listed test users can sign in. To allow general public sign-in, switch the audience publishing status to production; Google may require a verified app domain for that step.

To enable per-user scale saving on a public host, create a Google OAuth web client and configure these environment variables in the server's secret/configuration store (never commit credentials):

```sh
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
BASE_URL=https://your-public-domain
HOST=0.0.0.0
LITEJAM_DB_PATH=/var/data/litejam-scales.sqlite3
```

For Render, first attach a Persistent Disk to the web service with mount path `/var/data`, then set `LITEJAM_DB_PATH` to `/var/data/litejam-scales.sqlite3`. Do not use the mount path as a placeholder: the parent directory must be the actual writable disk mount.

Use `pip install -r requirements.txt` as the build command and `python server.py` as the start command. The root `apt.txt` installs `ffmpeg`, which audio analysis requires. Do not use `gunicorn`: this project runs its own HTTP server and does not expose a WSGI application. Render provides `PORT`; `server.py` reads it automatically. Set `HOST=0.0.0.0` so Render can reach the service.

Register `https://your-public-domain/auth/google/callback` as an authorized redirect URI in Google Cloud Console. Serve the app through HTTPS and a trusted reverse proxy. Google accounts identify users; custom scales are private to the signed-in account. Built-in scales remain available to everyone.

### Custom tunings

The **Guitar Tuning** panel lets you pick the open note (B1–B4, including sharps) of each of the six strings. Everything sent to the fretboard then uses that tuning until you change it or choose **Reset to Standard**: score and solo-tab notes are re-placed by pitch, chord shapes are searched again for the new tuning, and scale lighting uses the new open notes. The active tuning is remembered in the browser.

Built-in presets (Standard, Drop D, Half Step Down, DADGAD) are available to everyone. Signed-in users can save their own tunings, which are stored per account in the same SQLite database and appear in the preset dropdown. Notes a tuning cannot reach (below the lowest open string or past the last fret) are not lit. Manual lighting is unaffected, since it lights the frets you click.

Standard tuning keeps the original behaviour: a score's own string and fret numbers are sent unchanged. In a custom tuning, score pitches are normally used to calculate positions so a file written in another tuning still sounds correctly. If the score already encodes its intended tuning, turn off **Use custom tuning for score note positions** to send its original string and fret positions unchanged. This choice is remembered in the browser.

In the **Scale Lighting** panel, enable **Show Scale with Tab Song** to keep the selected scale lit while a Guitar Pro score plays. Current tab notes take visual and LED priority when they overlap scale notes. Choose separate colors for the scale root and its other notes. This option is off by default and disables tab chord analysis while enabled.

The **Scale Preset** dropdown includes 22 built-in scale patterns in all 12 sharp-named keys. Pentatonic scales contain five notes; other presets range from six to eight notes.
When saving a custom scale, **Add this scale for all root notes** is checked by default and saves the same interval pattern under each of the 12 roots in your account. Clear it to save only the selected root.
Select a saved custom scale and choose **Delete Selected Scale** to remove it and its matching root variants from your account. Built-in scales cannot be deleted.

The **Tab Scale Analysis** controls in the Scale Lighting panel work with **Analyse Tab Chords**. **None** is the default and displays no recommended scale; tab notes remain visible. Choose a mood or genre to rank scale suggestions without changing chord detection or display. Recommendations include a range of scale families, showing the best-fitting key for each family. Set the **Minimum chord-note match (%)** to filter out scales below your threshold.

Set how many chord sections to reference (at least two) and whether the recommendation changes as chord groups progress or stays based on the opening group. **Analyze entire song for one scale** instead searches all detected chord sections for a single recommendation. **Also show chord inversions** is off by default; enable it to display the analyzed chord voicings alongside tab notes and any selected scale. Selected scales light alongside the playing tab, and tab notes temporarily take priority on both the fretboard and connected LEDs.

After loading a tablature score, choose **Stems** beside **Tracks** in the sidebar and load up to six aligned audio files. The main view shows each stem's waveform across the song; click or drag on a waveform to seek. Playback uses the stems instead of the score's built-in sound, while the score cursor, tablature notes, and fretboard LEDs stay synchronized to the shared transport. Use the **Tracks** tab to return to the score view.

## Usage

1. Click **Open Score** or drag a Guitar Pro (`.gp` / `.gp3` / `.gp4` / `.gp5` / `.gpx`), MusicXML, or Capella file into the window. MIDI files cannot be imported.
2. Use **Tracks** on the left to choose which track to view.
3. Click **Connect Guitar** → select your LiteJam from the browser's device list. A lighting test runs automatically when it connects.
4. Press ▶ (or Space) to start. The current notes light up in the main color; the next beat lights up in the preview color.

### Layouts

- **Instagram vertical**: Switches to 9:16 and turns the fretboard vertically (sixth string on the left, first string on the right, like a chord diagram), ready for screen recording.
- **Clean view**: Fades out the interface, leaving only the score and fretboard; press `Esc` or move the mouse to the top or bottom edge to restore it.

### Reverse string order

alphaTab's `note.string` numbering is opposite to standard guitar convention (its 1 is the thickest, sixth string). The app converts it to
"1 = first string (thinnest)" before sending it to the guitar. **If the strings that light up on the physical guitar are vertically reversed, enable "Reverse string order."**

## Automatic chord detection

Click **🎵 Detect Chords** at the top. The window has three tabs:

1. **Search by song title** (like Songsterr) → lists 8 candidates (thumbnail, channel, duration, view count) → click one to analyze
2. **YouTube link** → paste the full URL
3. **Local audio file** → mp3 / m4a / wav / flac / aac / ogg; video files (mp4 / mov) also work

> The three sources are separated into tabs for a reason: when they were all shown together, the window grew to 750px tall,
> and on shorter screens "Choose audio file" and the options below it fell off-screen, making the feature look broken.

After analysis, the app switches to the chord chart: bar grid + chord diagrams used + section navigation. During playback, the current bar lights up and the fretboard shows the chord to play.

- **Blue for major, red for minor**: Chord names, diagrams, and **even fretboard lights are color-coded** (major `--major` blue, minor `--minor` red), so you can tell major from minor at a glance. Turn off **Color by major/minor** on the left to use a single color.
- **Nashville numbers**: Set **Display** on the left to scale degrees. For example, G C D in G major appears as 1 4 5.
  Change the **Key** yourself (in C, the same progression becomes 5 1 2); scale degrees stay the same when transposing.
- **Edit chords manually**: Detection is about 80% accurate, so there will be mistakes. Click **✏️ Edit Chords** on the left, then click any chord to change it
  (by default, this changes the whole continuous passage of matching chords; you can also change only one beat). Edited chords have an orange dot below them.
  **Edits are keyed by audio file and stored in the browser**, and are automatically restored the next time you open the same song.
- **Lyrics + pinyin**: Paste in lyrics (one line per bar; you can set the starting bar) to automatically add pinyin.
  Exported text places the chords, lyrics, and pinyin together.
- **Sections A / B / C**: Automatically finds repeated sections and adds navigation buttons to jump between them, making it quick to find your place in the score.
- **Loop a section**: Use `⌥` (or `⌘`)-click on a bar to set the start, then `⇧`-click another bar to set the end; click **Loop** to practice only that passage.
- **Click any bar** to jump there and listen again.
- **Click a chord diagram above** → open that chord in the chord picker and view all its positions.
- **Capo**: Set the fret (0–7) and the score shows **the shape you actually finger**
  (hear G, capo at fret 2 → display F). LEDs light at the actual position: "shape fret + capo fret."
  Click **Suggest capo** to find the fret that makes the most chords easy-to-play open chords.
- **First-beat position**: If bar lines are misplaced (chords all fall on beats 2 and 3), manually shift them forward by 1–3 beats and re-analyze
  (the audio is already local, so this takes about 0.4 seconds). Manual chord edits are stored by beat index and won't be lost when bars are recalculated.
- **Transpose** ±6 semitones (chord names and fretboard shapes change accordingly).
- **Export text**: Export a plain-text chord chart to paste into handouts or messages.
- **Triads only**: On by default. Seventh chords are difficult to detect accurately, so leaving this enabled is recommended for teaching.

### How sections are identified

Only **repeated** sections are identified and labeled A / B / C (in order of first appearance). The app does not guess which is a verse or chorus
— that requires listening or manual transcription, and guessing would be misleading.

Matching is approximate (16- and 8-bar sections may differ by 25% of bars), because a few bars of chords are likely to be misidentified;
requiring an exact match would miss most genuinely repeated sections. **Four-bar sections, however, must match exactly**:
if 3 out of 4 counted as a match, offset looping phrases would also match and sections could be split in the wrong place
(in testing, the second A in an A-B-A pattern was incorrectly identified as starting at bar 12). Sections that occur only once are not labeled.

### Inversions (slash chords)

The detector recognizes inversions such as `G/B`, `C/E`, and `Am/G`. It looks for the strongest bass-range note among the chord tones,
and labels an inversion only if **the same bass note is indicated throughout the whole section**—per-beat decisions can be fooled by a moving bass line.

Inversions also appear as scale degrees in Nashville-number charts (in C major, `G/B` → `5/7`); the bass note transposes along with the chord.

> Adding inversion detection exposed a long-standing issue: the scoring originally rewarded chords whose root was in the bass.
> For inversions, that pulled the answer toward the wrong chord (in testing, chroma alone correctly identified `G/B`; the bonus changed it to `Cmaj7`).
> **Removing the bonus improved both cases**, so bass is now used only to identify inversions, not to determine the chord.

### Accuracy

Beat-by-beat accuracy on a synthetic test set (6 root-position songs + 1 inversion song, known ground truth, with melody and drums):

| Mode | Before | Current |
|---|---|---|
| Triads only (default) | 94.0% | **94.9%** |
| Including seventh chords | 87.2% | 83.8% ↓ |
| Inversion test | 62.5% | **87.5%** (7/8) |

BPM was correct in all 6/6 cases for both modes.

**The seventh-chord mode dropped by 3.4%**—removing the bass bonus made seventh chords harder to distinguish.
The default triad mode and inversion detection both improved, so the overall trade-off is positive. If you mainly use seventh chords,
you can set `bass_root_weight` back to 0.28 in `chords/analyze.py` (at the cost of inversion accuracy).

Real recordings will score lower (mixing, distortion, and embellishments all interfere); think of it as a tool that "gets you about 80% of the way there, then you fix the rest."
**Seventh chords are especially unreliable**: lingering notes from a triad are almost indistinguishable in chroma from a genuine seventh
(measured sustain ratio 0.86 vs. 0.82 for a real seventh chord, with complete overlap). This is a known chord-detection challenge, not a misconfiguration.

### How it works

`chords/analyze.py`, using only numpy + ffmpeg:

```
Decode mono audio at 11kHz with ffmpeg
  → STFT (4096/512) → semitone triangular filter bank → logarithmic compression
  → Frequency-band whitening (suppress drums) + harmonic stacking (strengthen roots)
  → Reduce to 12-dimensional chroma; calculate separate bass-range chroma for root analysis
  → Spectral-flux onset envelope → autocorrelation + log-normal prior to estimate BPM (resolving octave errors)
  → Ellis dynamic programming to find beats → median chroma per beat
  → Score 96 chord templates (bass bonus, extension-strength penalty) → z-normalize
  → Viterbi smoothing (stickiness of 0.30 standard deviations) → find bar starts → segment into bars
```

Analysis takes about 0.4 seconds for a 3-minute song (downloading from YouTube is the slow part).

> Use song search and YouTube downloads only for content you have the right to use (your own work, royalty-free music, or material downloaded for personal practice and study).
>
> For context: Songsterr's library consists of **human-transcribed sheet music** under paid licenses; those scores are not (and should not be) downloaded for use.
> This project follows only its **workflow** of "search by song title → get a score to play along with"; all content is generated by our own analysis engine.

## Stem mixing (Demucs 6 stems)

**Audio source → Stem mixing** uses Demucs `htdemucs_6s` to split a song into **vocals / guitar / KB (piano) / bass / drums / other**,
each with its own volume, **M** (mute), and **S** (solo). The score and fretboard lighting continue to follow playback.

- Runs on the Apple Silicon GPU (`-d mps`); a 3-minute song takes about **40 seconds**. Stems are saved in `media/stems/` and reused next time you use the same song.
- The six WAV stems for one song take about **190MB**, so disk usage will accumulate; delete `media/stems/` when you no longer need them.
- **Two guitars cannot be separated**: no current tool can reliably separate two guitars with the same tone and range, so both are placed in the guitar stem.

Requires `pip3 install --user demucs soundfile`. **`soundfile` is required**—torchaudio 2.8 has no
audio-file writing backend of its own. Without it, stem separation completes but cannot write the files, and the error message misleadingly suggests a GPU problem.

## Playback sources

The chord chart has three **Audio source** options; the score cursor and fretboard lights follow the selected source:

| Source | Use |
|---|---|
| Downloaded audio | Default; uses the fewest resources |
| YouTube video | Embeds the actual video so you can **play along with the music video**. Analysis uses audio downloaded from that same video, so the timelines match |
| Stem mix | Adjust all 6 stems independently: mute vocals to practice guitar, or keep only drums as a metronome |

## Lyrics

### AI lyric detection

Run speech recognition locally on your own audio: **Demucs first separates the vocals → Whisper transcribes them → lyrics are placed in bars by timestamp**.
Separating vocals first is key; running recognition directly on the full mix produces much worse results. Choose small / medium / large-v3 models (larger is more accurate but slower).

No lyrics are retrieved from lyric websites or video subtitles.

**Two important limitations:**

1. **Singing is much harder to recognize than speech**, so always review the output (it is placed directly in the editor below, where you can change it).
2. **Whisper can "confidently make things up" when there are no vocals**—in testing, it generated 76 nonexistent lyric lines for an instrumental guitar piece.
   Before transcription, the app measures energy in the vocal stem; below 6%, it reports that the audio is instrumental rather than running recognition.
   It also discards segments with `no_speech_prob > 0.6`, `avg_logprob < -1.0`, or `compression_ratio > 2.4`.

Requires `pip3 install --user openai-whisper` (`torch` is already installed for Demucs, so this adds only a small amount).

### Add lyrics manually

If you don't want to use AI, or want to proofread the lyrics, edit them directly in the editor. The app handles:

- Aligning **one line per bar** with the chord grid; a blank line means that bar has no lyrics
- Setting the starting bar (the preceding bars are usually an intro)
- **Automatic pinyin** (tone marks mā / numbered ma1 / unmarked ma / no pinyin)
- Placing chords, lyrics, and pinyin together in text exports, ready to print as a handout

Pinyin is generated mechanically by `pypinyin`; **polyphonic characters may be wrong** (for example, the Chinese phrase for "restart" could be rendered as zhòng lái instead of chóng lái),
so check it when proofreading. Pinyin is not useful for a song entirely in Taiwanese Hokkien (that requires Tâi-lô); this feature is more useful for Mandarin songs.

## Solo note detection (render as a GP-style tab)

After detecting chords, click **🎸 Detect Solo Notes** on the left. The app extracts the most prominent monophonic melody, maps it to the fretboard,
then uses alphaTab to render **actual standard notation + guitar tablature**—playback, cursor, and fretboard lighting all work as in score mode.

### Accuracy

Synthetic test (ascending and descending A minor pentatonic scale, with 40 known notes):

| | Note count | Pitch sequence | Beat-by-beat alignment |
|---|---|---|---|
| Lead only | 40 / 40 | **100%** | 35% |
| Lead + drum accompaniment | 41 / 40 | **100%** | 75% |

**Pitch is almost always correct; rhythmic alignment is the weak point.** In other words, "which notes to play and which fret to use" is reliable,
while "which beat each note falls on" is only a guide. Real recordings (especially full-band mixes with vocals) will perform considerably worse—
this feature is most useful for **solo guitar and clear lead parts**.

In testing, one royalty-free guitar piece produced 389 notes across 79 bars, with a median position at fret 3.

### Approach

```
Semitone spectrum (whitening + harmonic stacking)
  → Select the strongest notes in the melody range (E3–D6), with an additional "no melody" state
  → Use Viterbi to keep the melody line coherent (0.055 penalty for a one-semitone jump, suppressing erratic octave jumps)
  → Use the onset envelope to split repeated notes of the same pitch
  → Align to a sixteenth-note grid
  → Use dynamic programming to map notes to the fretboard: minimize movement, penalize string changes, prefer lower positions
  → Generate alphaTex for alphaTab to render
```

Some pitfalls encountered:

- **Repeated notes can be merged**: Melody tracking treats consecutive frames at the same pitch as one note, so C-C becomes one long note.
  The onset envelope splits them, but the decision cannot rely on a threshold alone—normal picking dynamics can exceed it.
  An unaccompanied file once produced 47 false notes (when the true count was 40). Require both a peak "clearly above this note's own median"
  and "a dip before the peak," and leave margin at the end (the tracker lags a few frames when pitches change,
  so the next note's onset may fall within the previous note's tail).
- **Quantization must not drop notes**: If notes collide on the same grid position, move the later one forward; dropping it shifts the entire remaining sequence out of place.
- **Discard notes that cannot be played** instead of assigning a default position—this once produced false data such as "B5 placed on first string, fret 0," where pitch and position did not match.
- **alphaTex tie syntax is `-.string.duration`**; the string number is required. Writing `-.duration` is interpreted as "string 8,"
  then raises `Note string is out of range` and leaves the entire score blank.
- The cost function must **also penalize absolute fret position**; penalizing movement alone makes the melody drift up the neck (it reached frets 12–17 in testing).

## Numbered notation

On the left, **Display → Show numbered notation** adds a numbered-notation staff below the score. It works for both Guitar Pro files and detected solo-note scores.

- `1–7` are scale degrees; add `#` / `b` to notes outside the scale
- An octave above is marked with a dot above the number; an octave below, with a dot below it
- Eighth notes have one underline, sixteenth notes have two; add `-` for sustained notes (half note = `1 -`, whole note = `1 - - -`); rests are `0`
- **Choose the key for "1 ="** (the same score is `1 2 3` in C and `4 5 6` in G)
- For chords, the highest note is used as the melody line

The reference octave is not fixed—the app checks the median pitch range of the whole score and chooses a tonic position that minimizes octave dots.
If C4 were always used as the reference, guitar scores (mostly C3–C5) would have many low-octave dots and be hard to read
(in testing, adaptive positioning reduced them from 53 dots to 3).

## Chord picker (choose chords manually)

Click **🎸 Chord Picker** at the top. Choose a root (12 options) × chord type (major / minor / 7 / m7 / maj7 / sus4 / sus2 / dim / aug / power chord),
and the center displays **voicings for every position on the neck**, with each card showing the position, number of fingers required, and strings to play.

- **Click any voicing** to light it up on the guitar (and on the on-screen fretboard), useful for checking fingerings or teaching.
- **＋ Add to progression**: Add the currently selected voicing to **My Chord Progression** below; it is saved in the browser and remains after closing and reopening.
- Click a chord in the progression to light it up again; hover over a card to reveal ✕ and remove it.
- **Export text**: Output chord names + tablature numbers (such as `x-3-2-0-1-0`), ready to paste into a handout.
- On an automatically generated chord chart, **click a chord diagram above** to open the chord picker and view all positions for that chord.

### How voicings are generated

Common open chords use a lookup table (the familiar standard fingerings); all others are found by search. Within a 4-fret span, it finds combinations that
**cover every chord tone, contain no non-chord tones, put the root in the lowest voice, and can be played with four fingers**, then selects the easiest to play at each position.
This provides fingerings for any key and chord type without maintaining a huge table.

Two useless results are filtered out:

- **High-position shapes mixed with open strings**: technically playable, but no one actually plays shapes like `[0,13,0,10,x,x]`.
- **The same voicing with one extra muted string**: keep the more complete version.

12 roots × 10 types = 120 chords and 770 voicings. The program verifies the pitch classes, root in the bass, span ≤ 3 frets, and ≤ 4 fingers for all of them.

## LiteJam BLE protocol

(Derived by analyzing GlowTab's front-end code; documented at the top of `js/litejam-ble.js`.)

| Service | Characteristic | Content |
|---|---|---|
| `0x00FF` Status | `0xFF01` | LED mode (readable / notify) |
| | `0xFF02` | Battery % (readable / notify) |
| | `0xFF03` | Physical buttons on the guitar (notify) |
| `0x00EE` Control | `0xEE01` | LED mode, 1 byte; write `0` = turn all LEDs off |
| | `0xEE02` | Pattern, 4 bytes |
| | `0xEE03` | Party, 10 bytes |
| | `0xEE04` | **Segment (used for lighting LEDs)**, ≥4 bytes |
| | `0xEE05` | SoundReact, 9 bytes |
| | `0xEE06` | SoundReact data, 1 byte |

Segment packet:

```
[number of groups]
  Each group: [number of LEDs in group] ([fret number][string bitmask]) × N [R][G][B]
[0x45][0x4E][0x44]            ← terminator "END"
```

String bitmask: bit0 = string 1 … bit5 = string 6 (`0x3F` = all six strings). Each group shares one color;
send multiple groups for multiple colors (as this app does: the first group is the current notes, the second is the next-beat preview).

Example: light string 4, fret 2 in cyan →

```
01 01 02 08 00 e5 ff 45 4e 44
│  │  │  │  └──────┘ └──────┘
│  │  │  │   color    "END"
│  │  │  └ bitmask 0x08 = bit3 = string 4
│  │  └ fret 2
│  └ 1 LED in this group
└ 1 group total
```

Two implementation details to note (both are handled in `litejam-ble.js`):

- **Only one GATT operation can run at a time**; parallel writes cause `GATT operation already in progress`.
  Writes therefore use a serialized queue, and only the newest write for each characteristic is kept (the LEDs only care about their current state).
- Packets identical to the previous one are skipped to save Bluetooth bandwidth.

## Files

```
index.html            interface
css/style.css
server.py             local server: static files + song search + upload analysis + YouTube downloads (background jobs + progress polling)
chords/analyze.py     chord analysis (numpy + ffmpeg; can also run standalone from the command line)
js/app.js             alphaTab integration, playback controls, beat-to-light conversion for both modes
js/litejam-ble.js     Web Bluetooth connection and packet encoding (dependency-free; can be used standalone)
js/fretboard.js       on-screen fretboard mirror (Canvas; verify the data flow even without a guitar connected)
js/chords.js          chord names → guitar voicings (open-chord lookup + search for others), voicings at each position, chord-diagram SVGs
js/chordchart.js      chord-chart view, playback cursor, text export
js/chordpicker.js     chord picker: choose chords manually, voicings at each position, and My Chord Progression
js/solotab.js         detected solo notes → alphaTex (rendered by alphaTab as a GP-style score)
vendor/alphatab/      alphaTab 1.8.4 + Bravura font + sonivox sound library (works offline)
bin/yt-dlp            official standalone yt-dlp executable (system Python is 3.9; the pip version is blocked by YouTube)
media/                downloaded or uploaded audio files (a YouTube link is reused rather than downloaded again)
sample/demo.gp        sample score for testing
Launcher command      starts the server + opens Chrome
```

You can also run the analysis standalone from the command line:

```bash
python3 chords/analyze.py some-song.mp3 4 --simple
```

Score rendering and playback use the open-source [alphaTab](https://alphatab.net) (MPL-2.0), the same library used by GlowTab.

## A pitfall: `Unexpected token '<', "<!DOCTYPE "...`

If this error appears again, it means `fetch` received a web page instead of JSON. The cause is almost always
**HTTP/1.1 keep-alive connection desynchronization**:

If the server returns an error without reading the request body, those bytes remain in the connection
and are parsed as "the next HTTP request." The server then returns an HTML error page →
the next front-end `res.json()` call fails. **The error appears on the next request, not the one that caused it**,
which makes it especially difficult to track down.

The issue is handled as follows:

- `fail()` always calls `discard_body()` first; if the body exceeds 8MB, close the connection (it is not worth synchronously reading hundreds of MB just to keep it in sync).
- An interrupted upload (fewer bytes received than `Content-Length`) also closes the connection.
- The front end no longer calls `res.json()` directly; it uses `readJson()`, which reports "the server is older than the page; please restart" if it receives HTML.
- `/api/health` returns an `api` version number; if the front end sees a mismatch, it asks you to restart the server (`API_VERSION` / `NEED_API`; increment both when adding an API).

## If chord detection does not respond

Check these three things first:

1. **Did you start the app with the launcher command?** Chord detection will not work if you double-click `index.html` (`file://`),
   because there is no backend. The window now displays a message in this case.
2. **Force-reload the page (⌘⇧R).** If the browser keeps an old `index.html` but loads a new `app.js`,
   the elements may not match. (This is now guarded: only the affected button breaks and a message appears in the console,
   rather than one error disabling every subsequent button as before.)
3. **Restart the server after changing `chords/analyze.py` or `server.py`**; Python does not reload imported modules.

## Debugging

The console exposes `window.glowtab`:

```js
glowtab.api                    // alphaTab API object
glowtab.mode                   // 'tab' / 'chord' / 'picker'
glowtab.chart.data             // chord analysis results (beats / perBeat / bars)
glowtab.picker.progression     // progression arranged in the chord picker
glowtab.showVoicing({notes: [{string: 5, fret: 3}]})  // manually light a voicing
glowtab.guitar.snapshot()      // Bluetooth status and battery level
glowtab.fretboard.groups       // currently lit LEDs
glowtab.guitar.sendNotes([{string: 4, fret: 2}], {r: 255, g: 0, b: 0})
```
