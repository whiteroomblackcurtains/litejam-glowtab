#!/usr/bin/env python3
"""LiteJam tab-chart local server.

In addition to serving the web app, it handles two tasks browsers cannot:
  POST /api/analyze?name=…   Upload audio → detect chords automatically
  POST /api/youtube          Accept a YouTube link → download audio → detect chords
  GET  /api/job/<id>         Check progress (analysis and downloads run in background threads)

Bound only to 127.0.0.1; not exposed externally.
"""

import hashlib
import hmac
import json
import mimetypes
import os
import re
import subprocess
import sys
import threading
import time
import traceback
import uuid
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse, urlsplit

from scale_store import (
    create_oauth_state,
    create_session,
    delete_session,
    get_session_user,
    google_identity,
    init_db,
    list_scales,
    list_tunings,
    save_scales,
    save_tuning,
    upsert_google_user,
    consume_oauth_state,
)

ROOT = Path(__file__).resolve().parent
MEDIA = ROOT / 'media'
MEDIA.mkdir(exist_ok=True)

sys.path.insert(0, str(ROOT / 'chords'))
_chord_analyzer = None

# The frontend compares this with its own constant. Increment it when adding an API
# so a version mismatch ("new web app, old server") is reported clearly instead of
# producing an incomprehensible error.
API_VERSION = 9

PORT = int(os.environ.get('PORT', '8123'))
HOST = os.environ.get('HOST', '127.0.0.1')
CONFIGURED_BASE_URL = os.environ.get('BASE_URL')
BASE_URL = (CONFIGURED_BASE_URL or f'http://localhost:{PORT}').rstrip('/')
GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', '')
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET', '')
SESSION_COOKIE = 'litejam_session'
OAUTH_STATE_COOKIE = 'litejam_oauth_state'
COOKIE_SECURE = urlsplit(BASE_URL).scheme == 'https'
MAX_UPLOAD = 200 * 1024 * 1024  # 200MB
JOB_TTL = 3600  # Remove old jobs after one hour

_jobs = {}
_jobs_lock = threading.Lock()


def chord_analyzer():
    global _chord_analyzer
    if _chord_analyzer is None:
        import importlib
        _chord_analyzer = importlib.import_module('analyze')
    return _chord_analyzer


def new_job():
    job_id = uuid.uuid4().hex[:12]
    with _jobs_lock:
        now = time.time()
        for k, v in list(_jobs.items()):
            if now - v.get('created', now) > JOB_TTL:
                _jobs.pop(k, None)
        _jobs[job_id] = {'state': 'pending', 'progress': 0, 'message': 'Queued', 'created': now}
    return job_id


def set_job(job_id, **fields):
    with _jobs_lock:
        if job_id in _jobs:
            _jobs[job_id].update(fields)


def get_job(job_id):
    with _jobs_lock:
        job = _jobs.get(job_id)
        return dict(job) if job else None


# ---------------------------------------------------------------- YouTube

YOUTUBE_RE = re.compile(
    r'^https?://(?:www\.|m\.|music\.)?(?:youtube\.com/(?:watch\?|shorts/|live/|embed/)|youtu\.be/)',
    re.I,
)


def find_ytdlp():
    """Find yt-dlp, preferring the bundled macOS executable on macOS.

    The bundled executable is a macOS binary; Linux hosts should use the
    installed command or the Python package instead.
    """
    local = ROOT / 'bin' / 'yt-dlp'
    if sys.platform == 'darwin' and local.exists() and os.access(local, os.X_OK):
        return [str(local)]

    from shutil import which
    found = which('yt-dlp')
    if found:
        return [found]

    try:
        import yt_dlp  # noqa: F401
        return [sys.executable, '-m', 'yt_dlp']
    except ImportError:
        return None


def download_audio(url, job_id):
    """Download audio with yt-dlp. Get m4a directly without re-encoding (faster, no extra tools needed)."""
    ytdlp = find_ytdlp()
    if not ytdlp:
        raise RuntimeError(
            'yt-dlp was not found. Download the official standalone executable to bin/yt-dlp:\n'
            'curl -L -o bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos'
            ' && chmod +x bin/yt-dlp'
        )

    key = hashlib.sha1(url.encode()).hexdigest()[:16]
    for existing in MEDIA.glob(f'{key}.*'):
        if existing.suffix != '.json':
            set_job(job_id, progress=35, message='Using previously downloaded audio')
            return existing, _read_title(key) or existing.stem

    set_job(job_id, progress=8, message='Downloading audio')
    cmd = ytdlp + [
        '--no-playlist',
        '--no-warnings',
        '--newline',
        '--progress',  # Progress is not printed by default when not in a terminal; request it explicitly so the progress bar can be parsed
        '--print-json',
        '-f', 'bestaudio[ext=m4a]/bestaudio/best',
        '-o', str(MEDIA / f'{key}.%(ext)s'),
        url,
    ]

    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    info_line = None
    out_lines = []
    for line in proc.stdout:
        line = line.strip()
        if not line:
            continue
        out_lines.append(line)
        if line.startswith('{'):
            info_line = line
        else:
            m = re.search(r'(\d+(?:\.\d+)?)%', line)
            if m:
                pct = float(m.group(1))
                set_job(job_id, progress=8 + pct * 0.27, message=f'Downloading audio {pct:.0f}%')
    stderr = proc.stderr.read()
    proc.wait()

    if proc.returncode != 0:
        detail = (stderr or '\n'.join(out_lines[-3:])).strip()
        detail = re.sub(r'^ERROR:\s*', '', detail.splitlines()[-1] if detail else 'Download failed')
        raise RuntimeError(f'YouTube download failed: {detail}')

    title = key
    if info_line:
        try:
            title = json.loads(info_line).get('title') or key
        except Exception:
            pass

    files = [p for p in MEDIA.glob(f'{key}.*') if p.suffix != '.json']
    if not files:
        raise RuntimeError('Download completed, but the audio file could not be found.')

    (MEDIA / f'{key}.json').write_text(json.dumps({'title': title, 'url': url}, ensure_ascii=False))
    set_job(job_id, progress=35, message='Download complete')
    return files[0], title


def search_youtube(query, limit=8):
    """Search for a song by title. Return candidates for the user to choose from; do not choose automatically."""
    ytdlp = find_ytdlp()
    if not ytdlp:
        raise RuntimeError('yt-dlp was not found; search is unavailable.')

    cmd = ytdlp + [
        '--no-warnings',
        '--flat-playlist',
        '--dump-json',
        f'ytsearch{max(1, min(20, limit))}:{query}',
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        detail = (proc.stderr or '').strip().splitlines()
        raise RuntimeError('Search failed: ' + (detail[-1] if detail else 'Unknown error'))

    out = []
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line.startswith('{'):
            continue
        try:
            d = json.loads(line)
        except Exception:
            continue
        if d.get('live_status') == 'is_live':
            continue  # Live streams have no fixed duration and cannot be analyzed
        thumbs = d.get('thumbnails') or []
        out.append({
            'id': d.get('id'),
            'title': d.get('title') or '(Untitled)',
            'uploader': d.get('uploader') or d.get('channel') or '',
            'duration': d.get('duration'),
            'views': d.get('view_count'),
            'url': d.get('webpage_url') or d.get('url'),
            'thumb': thumbs[0]['url'] if thumbs else None,
        })
    return out


def to_pinyin(lines, style='tone'):
    """Convert Chinese lyrics pasted by the user into a line-by-line pinyin guide.

    This only performs a mechanical "text → pronunciation" conversion; it does not
    fetch lyrics from anywhere.
    Polyphonic characters may be converted incorrectly because a character can have
    multiple readings, so the frontend lets users edit the result.
    """
    try:
        from pypinyin import Style, pinyin
    except ImportError:
        raise RuntimeError('pypinyin is not installed. Run: pip3 install --user pypinyin')

    style_map = {
        'tone': Style.TONE,       # mā
        'tone2': Style.TONE2,     # ma1
        'plain': Style.NORMAL,    # ma
    }
    st = style_map.get(style, Style.TONE)

    out = []
    for line in lines:
        text = (line or '').strip()
        if not text:
            out.append('')
            continue
        # heteronym=False: give each character only one pronunciation so the guide stays aligned
        syllables = pinyin(text, style=st, heteronym=False, errors=lambda x: [[c] for c in x])
        out.append(' '.join(s[0] for s in syllables if s and s[0]))
    return out


def _read_title(key):
    meta = MEDIA / f'{key}.json'
    if meta.exists():
        try:
            return json.loads(meta.read_text()).get('title')
        except Exception:
            return None
    return None


# ---------------------------------------------------------------- Background jobs

def run_analysis(job_id, path, title, beats_per_bar, simplify, base_progress=35, video_id=None):
    def progress(pct, msg):
        span = 100 - base_progress
        set_job(job_id, progress=base_progress + pct / 100 * span, message=msg)

    result = chord_analyzer().analyze(str(path), beats_per_bar, simplify, progress)
    result['title'] = title
    result['media'] = f'/media/{path.name}'
    # If there is a video ID, the frontend can embed a YouTube player and sync the chart to the video
    result['videoId'] = video_id
    set_job(job_id, state='done', progress=100, message='Complete', result=result)


def job_upload(job_id, path, title, beats_per_bar, simplify):
    try:
        set_job(job_id, state='running', progress=5, message='Starting analysis')
        run_analysis(job_id, path, title, beats_per_bar, simplify, base_progress=5)
    except Exception as exc:
        traceback.print_exc()
        set_job(job_id, state='error', message=str(exc))


# Demucs's 6-stem model, which maps neatly to a typical band lineup
STEM_LABELS = {
    'vocals': 'Vocals',
    'drums': 'Drums',
    'bass': 'Bass',
    'guitar': 'Guitar',
    'piano': 'Keys',
    'other': 'Other',
}
STEM_ORDER = ['vocals', 'guitar', 'piano', 'bass', 'drums', 'other']
DEMUCS_MODEL = 'htdemucs_6s'


def python_bin():
    return sys.executable


def separate_stems(path, job_id):
    """Split a song into 6 stems with Demucs. Return {stem name: file path}."""
    out_dir = MEDIA / 'stems' / path.stem
    expected = {k: out_dir / DEMUCS_MODEL / path.stem / f'{k}.wav' for k in STEM_LABELS}
    if all(p.exists() for p in expected.values()):
        set_job(job_id, progress=95, message='Using previously separated stems')
        return expected

    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        python_bin(), '-m', 'demucs',
        '-n', DEMUCS_MODEL,
        '-d', 'mps',            # Apple Silicon GPU, much faster than the CPU
        '--out', str(out_dir),
        str(path),
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    tail = []
    for line in proc.stdout:
        line = line.strip()
        if not line:
            continue
        tail.append(line)
        m = re.search(r'(\d+)%', line)
        if m:
            set_job(job_id, progress=5 + int(m.group(1)) * 0.9, message=f'Splitting stems {m.group(1)}%')
    proc.wait()

    if proc.returncode != 0:
        detail = '\n'.join(tail[-4:]) or 'Unknown error'
        low = detail.lower()

        # Report a missing audio-writing backend directly; do not mislead the user
        # into thinking the GPU failed. Stem separation has completed, but torchaudio
        # 2.8 has no usable output backend (this has occurred in practice).
        if 'backend' in low or 'soundfile' in low:
            raise RuntimeError('Stem separation finished, but audio files could not be written. Run: pip3 install --user soundfile')

        # Retry on the CPU (much slower) only if the GPU itself is actually the problem
        if 'mps' in low or 'metal' in low or 'out of memory' in low:
            set_job(job_id, progress=10, message='GPU unavailable; retrying on CPU (this will take longer)')
            cmd[cmd.index('mps')] = 'cpu'
            proc = subprocess.run(cmd, capture_output=True, text=True)
            if proc.returncode != 0:
                raise RuntimeError(f'Stem separation failed on CPU as well: {detail[:250]}')
        else:
            raise RuntimeError(f'Stem separation failed: {detail[:300]}')

    missing = [k for k, p in expected.items() if not p.exists()]
    if missing:
        raise RuntimeError(f'Stem separation completed but these tracks are missing: {", ".join(missing)}')
    return expected


def job_stems(job_id, path):
    try:
        set_job(job_id, state='running', progress=3, message='Loading stem-separation model (first run may download it)')
        files = separate_stems(path, job_id)
        stems = []
        for key in STEM_ORDER:
            f = files.get(key)
            if not f or not f.exists():
                continue
            stems.append({
                'id': key,
                'label': STEM_LABELS[key],
                'url': '/' + f.relative_to(ROOT).as_posix(),
            })
        set_job(job_id, state='done', progress=100, message='Complete', result={'stems': stems})
    except Exception as exc:
        traceback.print_exc()
        set_job(job_id, state='error', message=str(exc))


def vocals_only(path, job_id):
    """Separate vocals only (faster than 6 stems). If 6-stem results already exist, use their vocals stem."""
    six = MEDIA / 'stems' / path.stem / DEMUCS_MODEL / path.stem / 'vocals.wav'
    if six.exists():
        return six

    out_dir = MEDIA / 'vocals' / path.stem
    target = out_dir / 'htdemucs' / path.stem / 'vocals.wav'
    if target.exists():
        return target

    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        python_bin(), '-m', 'demucs',
        '-n', 'htdemucs',
        '--two-stems', 'vocals',
        '-d', 'mps',
        '--out', str(out_dir),
        str(path),
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    tail = []
    for line in proc.stdout:
        line = line.strip()
        if line:
            tail.append(line)
            m = re.search(r'(\d+)%', line)
            if m:
                set_job(job_id, progress=5 + int(m.group(1)) * 0.35, message=f'Isolating vocals {m.group(1)}%')
    proc.wait()
    if proc.returncode != 0 or not target.exists():
        raise RuntimeError('Vocal isolation failed: ' + ('\n'.join(tail[-3:]) or 'Unknown error')[:300])
    return target


_whisper_cache = {}

# If the separated vocal stem's energy is below this ratio, treat the song as having no vocals
VOCAL_PRESENCE_MIN = 0.06


def vocal_presence(vocals_path, mix_path):
    """Energy ratio of the vocal stem relative to the original track.

    Whisper can "confidently make things up" for non-speech audio—in testing, it
    generated 76 lyric lines for an instrumental guitar track.
    Check that someone is actually singing before transcription; otherwise report
    that there are no vocals.
    """
    import numpy as np

    def rms(path):
        cmd = ['ffmpeg', '-v', 'error', '-i', str(path), '-ac', '1', '-ar', '8000', '-f', 'f32le', '-']
        raw = subprocess.run(cmd, capture_output=True).stdout
        x = np.frombuffer(raw, dtype=np.float32)
        return float(np.sqrt(np.mean(x.astype(np.float64) ** 2))) if x.size else 0.0

    mix = rms(mix_path)
    voc = rms(vocals_path)
    return (voc / mix) if mix > 1e-9 else 0.0


def drop_hallucinations(segments):
    """Discard low-confidence segments (Whisper's fabrications usually score poorly on these metrics)."""
    out = []
    for seg in segments:
        if seg.get('no_speech_prob', 0) > 0.6:
            continue
        if seg.get('avg_logprob', 0) < -1.0:
            continue
        # Repeating the same phrase over and over is another typical fabrication
        if seg.get('compression_ratio', 0) > 2.4:
            continue
        out.append(seg)
    return out


def transcribe_vocals(wav_path, job_id, model_name='small', language='zh'):
    """Transcribe the separated vocal stem and return timestamped segments."""
    try:
        import whisper
    except ImportError:
        raise RuntimeError('Whisper is not installed. Run: pip3 install --user openai-whisper')

    set_job(job_id, progress=45, message=f'Loading transcription model {model_name} (first run may download it)')
    if model_name not in _whisper_cache:
        _whisper_cache[model_name] = whisper.load_model(model_name)
    model = _whisper_cache[model_name]

    set_job(job_id, progress=60, message='Transcribing lyrics (this may take a while)')
    result = model.transcribe(
        str(wav_path),
        language=language or None,
        task='transcribe',
        # Ask for Traditional Chinese output; otherwise, zh often produces Simplified Chinese.
        initial_prompt='Transcribe the lyrics of this song in Traditional Chinese.',
        condition_on_previous_text=False,
        temperature=0.0,
        no_speech_threshold=0.5,
    )

    kept = drop_hallucinations(result.get('segments', []))
    segments = []
    for seg in kept:
        text = (seg.get('text') or '').strip()
        if not text:
            continue
        segments.append({
            'start': round(float(seg.get('start', 0)), 3),
            'end': round(float(seg.get('end', 0)), 3),
            'text': text,
        })
    return segments, result.get('language')


def job_auto_lyrics(job_id, path, model_name, language):
    try:
        set_job(job_id, state='running', progress=3, message='Preparing to isolate vocals')
        vocals = vocals_only(path, job_id)

        set_job(job_id, progress=42, message='Checking for vocals')
        ratio = vocal_presence(vocals, path)
        if ratio < VOCAL_PRESENCE_MIN:
            raise RuntimeError(
                f'No vocals were detected (vocal energy is only {ratio * 100:.1f}%). This may be an instrumental track. '
                'Transcription was stopped to avoid producing inaccurate lyrics.'
            )

        segments, lang = transcribe_vocals(vocals, job_id, model_name, language)
        set_job(job_id, state='done', progress=100, message='Complete',
                result={'segments': segments, 'language': lang, 'vocals': '/' + vocals.relative_to(ROOT).as_posix()})
    except Exception as exc:
        traceback.print_exc()
        set_job(job_id, state='error', message=str(exc))


def job_rechord(job_id, path, title, beats_per_bar, simplify, downbeat, video_id):
    """Re-analyze chords from an already downloaded audio file (for example, after manually changing the downbeat).

    The audio file is already local, so this step only analyzes it (about 0.4 seconds
    for a 3-minute song); it does not need to be downloaded again.
    """
    try:
        set_job(job_id, state='running', progress=5, message='Reanalyzing chords')

        def progress(pct, msg):
            set_job(job_id, progress=5 + pct * 0.95, message=msg)

        result = chord_analyzer().analyze(str(path), beats_per_bar, simplify, progress,
                                        downbeat=downbeat)
        result['title'] = title
        result['media'] = f'/media/{path.name}'
        result['videoId'] = video_id
        set_job(job_id, state='done', progress=100, message='Complete', result=result)
    except Exception as exc:
        traceback.print_exc()
        set_job(job_id, state='error', message=str(exc))


def job_melody(job_id, path, title, beats_per_bar):
    try:
        set_job(job_id, state='running', progress=3, message='Starting melody extraction')

        def progress(pct, msg):
            set_job(job_id, progress=3 + pct * 0.97, message=msg)

        result = chord_analyzer().analyze_melody(str(path), beats_per_bar, 4, progress)
        result['title'] = title
        result['media'] = f'/media/{path.name}'
        set_job(job_id, state='done', progress=100, message='Complete', result=result)
    except Exception as exc:
        traceback.print_exc()
        set_job(job_id, state='error', message=str(exc))


VIDEO_ID_RE = re.compile(r'(?:v=|youtu\.be/|shorts/|live/|embed/)([A-Za-z0-9_-]{11})')


def extract_video_id(url):
    m = VIDEO_ID_RE.search(url or '')
    return m.group(1) if m else None


def job_youtube(job_id, url, beats_per_bar, simplify):
    try:
        set_job(job_id, state='running', progress=3, message='Connecting to YouTube')
        path, title = download_audio(url, job_id)
        run_analysis(job_id, path, title, beats_per_bar, simplify,
                     video_id=extract_video_id(url))
    except Exception as exc:
        traceback.print_exc()
        set_job(job_id, state='error', message=str(exc))


# ---------------------------------------------------------------- HTTP

SAFE_NAME = re.compile(r'[^\w.\-]+', re.UNICODE)


def safe_filename(name):
    name = SAFE_NAME.sub('_', (name or 'audio').strip())[:80]
    return name or 'audio'


class Handler(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        if '/api/job/' not in (self.path or ''):  # Avoid flooding the log while polling job progress
            sys.stderr.write(f'  {self.address_string()} {fmt % args}\n')

    def handle_one_request(self):
        self._body_read = False
        super().handle_one_request()

    # ------------------------------------------------------------ Request body

    def content_length(self):
        try:
            return max(0, int(self.headers.get('Content-Length') or 0))
        except ValueError:
            return 0

    def read_body(self, length=None):
        """Read the request body (only once per request)."""
        if getattr(self, '_body_read', False):
            return b''
        self._body_read = True
        remaining = self.content_length() if length is None else length
        chunks = []
        while remaining > 0:
            chunk = self.rfile.read(min(1 << 20, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        return b''.join(chunks)

    def discard_body(self):
        """Discard any unread request body.

        This is essential: the server uses HTTP/1.1 keep-alive. If an error is
        returned and we exit without consuming the body, those bytes remain on the
        connection and are parsed as the "next HTTP request." The server then returns
        an HTML error page, causing the frontend's next res.json() call to fail with
        "Unexpected token '<', "<!DOCTYPE "... is not valid JSON".
        If the body is too large, simply close the connection; consuming hundreds
        of megabytes just to keep it synchronized is not worthwhile.
        """
        if getattr(self, '_body_read', False):
            return
        if self.content_length() > 8 * 1024 * 1024:
            self._body_read = True
            self.close_connection = True
            return
        self.read_body()

    # ------------------------------------------------------------ Response helpers

    def send_json(self, obj, status=200, headers=()):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        for name, value in headers:
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def send_redirect(self, location, headers=()):
        self.send_response(302)
        self.send_header('Location', location)
        self.send_header('Content-Length', '0')
        self.send_header('Cache-Control', 'no-store')
        for name, value in headers:
            self.send_header(name, value)
        self.end_headers()

    def cookie(self, name):
        parsed = SimpleCookie()
        parsed.load(self.headers.get('Cookie', ''))
        morsel = parsed.get(name)
        return morsel.value if morsel else ''

    def cookie_header(self, name, value, max_age):
        secure = '; Secure' if COOKIE_SECURE else ''
        return f'{name}={value}; Path=/; Max-Age={max_age}; HttpOnly; SameSite=Lax{secure}'

    def current_user(self):
        return get_session_user(self.cookie(SESSION_COOKIE))

    def same_origin_request(self):
        origin = self.headers.get('Origin')
        if not origin:
            return False
        actual = urlsplit(origin)
        expected = urlsplit(BASE_URL)
        return actual.scheme == expected.scheme and actual.netloc == expected.netloc

    def google_login(self):
        if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
            return self.send_redirect('/?auth_error=not_configured')
        state, nonce = create_oauth_state()
        callback = f'{BASE_URL}/auth/google/callback'
        query = urlencode({
            'client_id': GOOGLE_CLIENT_ID,
            'redirect_uri': callback,
            'response_type': 'code',
            'scope': 'openid email profile',
            'state': state,
            'nonce': nonce,
        })
        cookie = self.cookie_header(OAUTH_STATE_COOKIE, state, 600)
        return self.send_redirect(
            'https://accounts.google.com/o/oauth2/v2/auth?' + query,
            [('Set-Cookie', cookie)],
        )

    def google_callback(self, query):
        if query.get('error'):
            return self.send_redirect('/?auth_error=cancelled')
        state = query.get('state', [''])[0]
        cookie_state = self.cookie(OAUTH_STATE_COOKIE)
        if not state or not cookie_state or not hmac.compare_digest(state, cookie_state):
            return self.send_redirect('/?auth_error=state')
        nonce = consume_oauth_state(state)
        if not nonce:
            return self.send_redirect('/?auth_error=state')
        code = query.get('code', [''])[0]
        callback = f'{BASE_URL}/auth/google/callback'
        try:
            identity = google_identity(
                code, callback, nonce, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
            )
            user_id = upsert_google_user(identity)
            session = create_session(user_id)
        except Exception:
            traceback.print_exc()
            return self.send_redirect('/?auth_error=signin_failed')

        headers = [
            ('Set-Cookie', self.cookie_header(SESSION_COOKIE, session, 30 * 24 * 60 * 60)),
            ('Set-Cookie', self.cookie_header(OAUTH_STATE_COOKIE, '', 0)),
        ]
        return self.send_redirect('/', headers)

    def fail(self, message, status=400):
        self.discard_body()
        self.send_json({'error': message}, status)

    def resolve_media(self, rel):
        """Resolve a frontend-provided /media/xxx path to its actual file path.

        Allow files inside the media directory (including subdirectories such as
        media/stems/…/guitar.wav), but block paths that escape it, such as ../.
        """
        rel = (rel or '').strip()
        if not rel:
            return None
        sub = rel[len('/media/'):] if rel.startswith('/media/') else rel
        if '..' in sub or sub.startswith('/') or '\\' in sub:
            return None
        path = (MEDIA / sub).resolve()
        root = MEDIA.resolve()
        if not (path == root or root in path.parents):
            return None
        if not path.exists() or not path.is_file():
            return None
        return path

    # ------------------------------------------------------------ GET

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/auth/google':
            return self.google_login()
        if parsed.path == '/auth/google/callback':
            return self.google_callback(parse_qs(parsed.query))
        if parsed.path == '/api/auth':
            user = self.current_user()
            return self.send_json({
                'authenticated': bool(user),
                'user': {'email': user['email'], 'name': user['name']} if user else None,
                'googleConfigured': bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET),
            })
        if parsed.path == '/api/scales':
            user = self.current_user()
            return self.send_json({
                'scales': list_scales(user['id'] if user else None),
                'authenticated': bool(user),
            })
        if parsed.path == '/api/tunings':
            user = self.current_user()
            return self.send_json({
                'tunings': list_tunings(user['id'] if user else None),
                'authenticated': bool(user),
            })
        if parsed.path.startswith('/api/job/'):
            job_id = parsed.path.rsplit('/', 1)[-1]
            job = get_job(job_id)
            if not job:
                return self.fail('Job not found.', 404)
            job.pop('created', None)
            return self.send_json(job)
        if parsed.path == '/api/health':
            return self.send_json({'ok': True, 'api': API_VERSION, 'ytdlp': _has_ytdlp()})
        if parsed.path == '/api/stems-zip':
            return self.serve_stems_zip(parse_qs(parsed.query).get('media', [''])[0])
        return super().do_GET()

    def serve_stems_zip(self, media):
        """Package the 6 separated WAV stems for a song into a ZIP download."""
        src = self.resolve_media(media)
        if src is None:
            return self.fail('Audio file not found.', 404)
        stem = src.stem
        stem_dir = MEDIA / 'stems' / stem / DEMUCS_MODEL / stem
        wavs = sorted(stem_dir.glob('*.wav')) if stem_dir.exists() else []
        if not wavs:
            return self.fail('Stems have not been separated for this track.', 404)

        import io
        import zipfile
        buf = io.BytesIO()
        # WAV files do not compress much, so use STORED to save time
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_STORED) as z:
            for w in wavs:
                label = STEM_LABELS.get(w.stem, w.stem)
                label = label.replace('/', '／').replace('\\', '＿').strip()  # Prevent / from creating subdirectories in the ZIP
                z.write(w, arcname=f'{label}.wav')
        data = buf.getvalue()
        self.send_response(200)
        self.send_header('Content-Type', 'application/zip')
        self.send_header('Content-Disposition', 'attachment; filename="stems.zip"')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def end_headers(self):
        # Prevent the browser from loading stale JS/CSS during development
        if self.path.endswith(('.js', '.css', '.html')) or self.path == '/':
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    # ------------------------------------------------------------ POST

    def do_POST(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        beats_per_bar = int(query.get('bpb', ['4'])[0])
        if beats_per_bar not in (2, 3, 4, 6):
            beats_per_bar = 4
        simplify = query.get('simple', ['0'])[0] in ('1', 'true', 'yes')

        length = self.content_length()

        if parsed.path in ('/api/scales', '/api/tunings', '/auth/logout'):
            if not self.same_origin_request():
                return self.fail('Request origin could not be verified.', 403)

            if parsed.path == '/auth/logout':
                self.discard_body()
                delete_session(self.cookie(SESSION_COOKIE))
                return self.send_json(
                    {'ok': True},
                    headers=[('Set-Cookie', self.cookie_header(SESSION_COOKIE, '', 0))],
                )

            user = self.current_user()
            noun = 'tunings' if parsed.path == '/api/tunings' else 'scales'
            if not user:
                return self.fail(f'Sign in with Google to save personal {noun}.', 401)
            if length <= 0 or length > 16 * 1024:
                return self.fail(f'{noun[:-1].capitalize()} data is missing or too large.')
            try:
                payload = json.loads(self.read_body(length).decode('utf-8'))
            except (UnicodeDecodeError, json.JSONDecodeError):
                return self.fail('Request body is not valid JSON.')
            if not isinstance(payload, dict):
                return self.fail('Request body must be a JSON object.')
            try:
                if parsed.path == '/api/tunings':
                    tuning = save_tuning(user['id'], payload.get('name'), payload.get('notes'))
                    return self.send_json({'tuning': tuning}, 201)
                all_root_notes = payload.get('allRootNotes', False)
                scales = save_scales(
                    user['id'],
                    payload.get('name'),
                    payload.get('rootNote'),
                    payload.get('intervals'),
                    all_root_notes,
                )
            except (AttributeError, ValueError) as exc:
                return self.fail(str(exc))
            if all_root_notes:
                return self.send_json({'scales': scales}, 201)
            return self.send_json({'scale': scales[0]}, 201)

        if parsed.path == '/api/analyze':
            if length <= 0:
                return self.fail('No file data received.')
            if length > MAX_UPLOAD:
                # Do not read hundreds of MB; close the connection directly (fail() handles it) rather than waiting for nothing
                return self.fail(
                    f'File is too large ({length / 1024 / 1024:.0f} MB; limit is '
                    f'{MAX_UPLOAD // 1024 // 1024} MB). Convert it to MP3 with ffmpeg before uploading.',
                    413,
                )

            raw_name = query.get('name', ['audio'])[0]
            stem = safe_filename(Path(raw_name).stem)
            suffix = Path(raw_name).suffix.lower() or '.bin'
            if len(suffix) > 8:
                suffix = '.bin'
            path = MEDIA / f'up_{uuid.uuid4().hex[:8]}_{stem}{suffix}'

            self._body_read = True
            remaining = length
            written = 0
            with open(path, 'wb') as f:
                while remaining > 0:
                    chunk = self.rfile.read(min(1 << 20, remaining))
                    if not chunk:
                        break
                    f.write(chunk)
                    written += len(chunk)
                    remaining -= len(chunk)

            if written < length:
                # The upload was interrupted and the connection state is unreliable; close it and start over
                self.close_connection = True
                path.unlink(missing_ok=True)
                return self.send_json({'error': 'Upload interrupted. Please try again.'}, 400)

            job_id = new_job()
            threading.Thread(
                target=job_upload,
                args=(job_id, path, Path(raw_name).stem, beats_per_bar, simplify),
                daemon=True,
            ).start()
            return self.send_json({'job': job_id})

        # Only upload and save the file, then return its media path; do not analyze
        # chords. Used for "separate stems directly": after receiving the media path,
        # the frontend can call /api/stems to separate the audio without chord detection.
        if parsed.path == '/api/upload-audio':
            if length <= 0:
                return self.fail('No file data received.')
            if length > MAX_UPLOAD:
                return self.fail(
                    f'File is too large ({length / 1024 / 1024:.0f} MB; limit is '
                    f'{MAX_UPLOAD // 1024 // 1024} MB). Convert it to MP3 with ffmpeg before uploading.',
                    413,
                )

            raw_name = query.get('name', ['audio'])[0]
            stem = safe_filename(Path(raw_name).stem)
            suffix = Path(raw_name).suffix.lower() or '.bin'
            if len(suffix) > 8:
                suffix = '.bin'
            path = MEDIA / f'up_{uuid.uuid4().hex[:8]}_{stem}{suffix}'

            self._body_read = True
            remaining = length
            written = 0
            with open(path, 'wb') as f:
                while remaining > 0:
                    chunk = self.rfile.read(min(1 << 20, remaining))
                    if not chunk:
                        break
                    f.write(chunk)
                    written += len(chunk)
                    remaining -= len(chunk)

            if written < length:
                self.close_connection = True
                path.unlink(missing_ok=True)
                return self.send_json({'error': 'Upload interrupted. Please try again.'}, 400)

            return self.send_json({'media': f'/media/{path.name}', 'title': Path(raw_name).stem})

        if parsed.path == '/api/search':
            body = self.read_body(length) or b'{}'
            try:
                payload = json.loads(body.decode('utf-8'))
            except Exception:
                return self.fail('Request body is not valid JSON.')
            q = (payload.get('q') or '').strip()
            if len(q) < 2:
                return self.fail('Search query is too short.')
            try:
                return self.send_json({'results': search_youtube(q, payload.get('limit', 8))})
            except Exception as exc:
                traceback.print_exc()
                return self.fail(str(exc), 500)

        if parsed.path == '/api/pinyin':
            body = self.read_body(length) or b'{}'
            try:
                payload = json.loads(body.decode('utf-8'))
            except Exception:
                return self.fail('Request body is not valid JSON.')
            lines = payload.get('lines')
            if not isinstance(lines, list):
                return self.fail('lines must be an array.')
            if len(lines) > 2000:
                return self.fail('Too many lines.')
            try:
                return self.send_json({'pinyin': to_pinyin(lines, payload.get('style', 'tone'))})
            except Exception as exc:
                return self.fail(str(exc), 500)

        if parsed.path in ('/api/melody', '/api/stems', '/api/lyrics-auto', '/api/rechord'):
            body = self.read_body(length) or b'{}'
            try:
                payload = json.loads(body.decode('utf-8'))
            except Exception:
                return self.fail('Request body is not valid JSON.')

            path = self.resolve_media(payload.get('media'))
            if path is None:
                return self.fail('Audio file not found. Please analyze it again.')

            job_id = new_job()
            if parsed.path == '/api/rechord':
                db = payload.get('downbeat')
                target, args = job_rechord, (
                    job_id, path, payload.get('title') or path.stem, beats_per_bar,
                    simplify, None if db is None else int(db), payload.get('videoId'),
                )
            elif parsed.path == '/api/melody':
                target, args = job_melody, (job_id, path, payload.get('title') or path.stem, beats_per_bar)
            elif parsed.path == '/api/stems':
                target, args = job_stems, (job_id, path)
            else:
                model = payload.get('model') or 'small'
                if model not in ('tiny', 'base', 'small', 'medium', 'large-v3'):
                    return self.fail('Unknown transcription model.')
                target, args = job_auto_lyrics, (job_id, path, model, payload.get('language') or 'zh')

            threading.Thread(target=target, args=args, daemon=True).start()
            return self.send_json({'job': job_id})

        if parsed.path == '/api/youtube':
            body = self.read_body(length) or b'{}'
            try:
                payload = json.loads(body.decode('utf-8'))
            except Exception:
                return self.fail('Request body is not valid JSON.')
            url = (payload.get('url') or '').strip()
            if not YOUTUBE_RE.match(url):
                return self.fail('This does not look like a YouTube URL.')

            job_id = new_job()
            threading.Thread(
                target=job_youtube,
                args=(job_id, url, beats_per_bar, simplify),
                daemon=True,
            ).start()
            return self.send_json({'job': job_id})

        return self.fail('Unknown endpoint.', 404)


def _has_ytdlp():
    return find_ytdlp() is not None


def main():
    mimetypes.add_type('audio/mp4', '.m4a')
    mimetypes.add_type('audio/webm', '.webm')
    mimetypes.add_type('application/json', '.alphatab')
    # Additional MIME types can be added here as needed

    init_db()

    port = PORT
    server = None
    for attempt in range(20):
        try:
            server = ThreadingHTTPServer((HOST, port), Handler)
            break
        except OSError:
            port += 1
    if server is None:
        print('No available port found.', file=sys.stderr)
        return 1

    if not CONFIGURED_BASE_URL:
        global BASE_URL
        BASE_URL = f'http://localhost:{port}'
    print(f'LiteJam GlowTab → {BASE_URL}/')
    print(f'  yt-dlp: {"installed" if _has_ytdlp() else "not installed (YouTube features unavailable)"}')
    print('  Close this window or press Ctrl+C to stop the server.')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nGoodbye.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
