"""Live voice chat modes: a full-duplex voice frontend that delegates to Hermes.

``voice.voice_chat_mode`` picks the desktop voice engine: ``chained`` (STT → turn → TTS) or a live
engine (:class:`agent.voice_live_engine.VoiceLiveEngine`). This module resolves the selected engine
(built-in GPT-Live below, or a plugin engine from :mod:`agent.voice_live_registry`) for the
status/session routes, and owns the per-turn note every live engine's delegations carry.

``voice.voice_chat_mode: gpt-live`` replaces the chained STT → turn → TTS loop with ONE
full-duplex voice model (OpenAI ``gpt-live-1``) that owns the microphone and the speaker and
delegates every real request to Hermes as its *client-delegation* backend. Hermes stays the
agent: whatever model/provider the session has selected answers, with the full toolset.

Division of labour (the Live API has no tools of its own in client mode):

* the desktop renderer holds the WebRTC media session (mic in, speech out) and the data channel;
* this module resolves WHICH credentials/voice/persona to use and performs the one server-side
  step the API requires — exchanging the browser's SDP offer for an answer with the project key
  (``POST /v1/live/sessions``), so the key never reaches the client;
* the renderer turns each ``session.delegation.created`` into a normal ``prompt.submit`` on the
  active session (surface ``voice-live``) and streams the reply back as
  ``session.commentary.append`` — Hermes' answer is what the voice speaks.

Vendor contract: https://developers.openai.com/api/docs/guides/live (+ live-delegation,
voice-webrtc). Billing is $0.05/min of session time on the OpenAI key, separate from the
Hermes turn.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from typing import Any, Dict, Optional

from agent.voice_live_engine import (
    VoiceLiveBadRequest, VoiceLiveEngine, VoiceLiveNotConfigured, VoiceLiveUpstreamError)

logger = logging.getLogger(__name__)

GPT_LIVE_MODE = "gpt-live"
CHAINED_MODE = "chained"
BUILTIN_MODES = frozenset({CHAINED_MODE, GPT_LIVE_MODE})  # agent.voice_live_registry._BUILTIN_NAMES
DEFAULT_LIVE_MODEL = "gpt-live-1"
DEFAULT_LIVE_VOICE = "marin"
DEFAULT_LIVE_BASE_URL = "https://api.openai.com/v1"
# Voices the vendor lists for gpt-live-1 (live-conversations guide) plus the realtime defaults it
# accepts; free text stays allowed for custom voices.
GPT_LIVE_VOICES = (
    "marin", "cedar", "quartz", "ripple", "vesper", "willow", "stone", "gleam", "meridian",
    "bossa", "tempo", "beacon", "delta", "cinder",
)

# Persona for the voice layer. Short on purpose: the live model has a small context window and
# the vendor guide asks for role + style + a labelled delegation policy, nothing more. The
# backend (Hermes) carries the real instructions, tools and memory.
LIVE_PERSONA = (
    "You are Hermes, a calm and friendly voice assistant. Speak naturally at an unhurried pace. "
    "Be clear and direct, not overly cheerful. If the user is frustrated, acknowledge it briefly "
    "and focus on the next helpful step.\n\n"
    "Backchannel policy: Use moderate backchannels. Acknowledge naturally without competing with "
    "the main response.\n\n"
    "Interruption policy: Stop speaking when the user interrupts. Listen to what they say.\n\n"
    "Delegation policy:\n"
    "Backend tools:\n"
    "- Hermes agent: a full AI agent with tools — it can run commands, read and edit files, "
    "browse the web, search, remember things across sessions, schedule tasks, and reason "
    "carefully about anything. It is the one who actually does work and knows facts.\n\n"
    "Delegate to the backend when:\n"
    "- The user asks a question that needs facts, current information, or careful reasoning.\n"
    "- The user asks you to do, check, find, make, fix, run or remember anything.\n"
    "- A correction changes work already requested.\n\n"
    "Do not delegate to the backend when:\n"
    "- The user greets you, makes small talk, or asks you to repeat a result already provided.\n"
    "- You need a brief clarification to understand the request.\n\n"
    "Delegate before giving an answer that depends on backend work. Do not guess the result "
    "while waiting; say briefly that you are checking, then wait for the result."
)

# Per-turn note prepended to the MODEL INPUT (never the byte-stable system prompt) when a turn
# arrives from the live voice layer. Same seam as the HUD note.
VOICE_LIVE_TURN_NOTE = (
    "[Note: this message is a delegation from a live spoken conversation. The text is a voice "
    "transcript (it may contain mis-hearings, hesitations and later corrections; use the latest "
    "intent). Your reply will be spoken aloud by a voice model that paraphrases it: answer in plain "
    "conversational sentences, keep it short (a few sentences unless the user asked for detail), no "
    "markdown, no lists, no code blocks, no URLs read out character by character. Do the work with "
    "your tools as usual; only the final facts need to be spoken. Do not claim an action succeeded "
    "before it actually did.]"
)


def voice_live_turn_note(context: str = "") -> str:
    """The per-turn note plus, when the client sent one, the recent spoken exchange the delegation
    refers to (the user's last words alone are often "yes" or "Thursday, not Friday")."""
    context = context.strip()
    if not context:
        return VOICE_LIVE_TURN_NOTE
    return f"{VOICE_LIVE_TURN_NOTE}\n[Recent spoken conversation, newest last:\n{context}]"


def _voice_section() -> dict[str, Any]:
    try:
        from hermes_cli.config import load_config
        voice = load_config().get("voice")
    except Exception:
        return {}
    return voice if isinstance(voice, dict) else {}


def _engine_section(voice: dict[str, Any], key: str) -> dict[str, Any]:
    section = voice.get(key)
    return section if isinstance(section, dict) else {}


def _live_section(voice: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    return _engine_section(voice if voice is not None else _voice_section(), "gpt_live")


def voice_chat_mode(voice: Optional[dict[str, Any]] = None) -> str:
    """``chained`` (default), ``gpt-live``, or a plugin engine name, normalized. Accepts the
    underscore spelling too. Whether a plugin engine is installed is the status probe's question."""
    raw = (voice if voice is not None else _voice_section()).get("voice_chat_mode")
    mode = str(raw or CHAINED_MODE).strip().lower().replace("_", "-")
    if mode in {GPT_LIVE_MODE, "gptlive", "live"}:
        return GPT_LIVE_MODE
    return mode or CHAINED_MODE


def _resolve_credentials(live: dict[str, Any]) -> tuple[str, str]:
    """``(api_key, base_url)`` — ``voice.gpt_live.api_key`` first, else the same OpenAI audio
    chain the STT/TTS providers use (``VOICE_TOOLS_OPENAI_KEY`` → ``OPENAI_API_KEY`` → pool).

    The Nous-managed audio proxy does not carry ``/live/sessions``; this mode is direct-key only.
    """
    from tools.tool_backend_helpers import resolve_openai_audio_api_key
    api_key = str(live.get("api_key") or "").strip() or resolve_openai_audio_api_key()
    base_url = str(live.get("base_url") or DEFAULT_LIVE_BASE_URL).strip().rstrip("/")
    return api_key, base_url


def live_instructions(live: Optional[dict[str, Any]] = None) -> str:
    """:data:`LIVE_PERSONA` plus the section's ``instructions``; plugin engines reuse it."""
    extra = str((live if live is not None else _live_section()).get("instructions") or "").strip()
    return f"{LIVE_PERSONA}\n\n{extra}" if extra else LIVE_PERSONA


def resolve_gpt_live_status() -> dict[str, Any]:
    """Non-secret readiness verdict for the client: which mode is selected and whether GPT-Live
    can start (a key resolves). Never returns the key."""
    voice = _voice_section()
    return {"mode": voice_chat_mode(voice), **GPT_LIVE_ENGINE.status(_live_section(voice))}


def build_session_config(history: Optional[list] = None, live: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """The ``session`` object for ``POST /v1/live/sessions`` (client delegation, WebRTC — the
    transport negotiates the audio format, so none is set)."""
    live = live if live is not None else _live_section()
    config: dict[str, Any] = {
        "model": str(live.get("model") or DEFAULT_LIVE_MODEL),
        "instructions": live_instructions(live),
        "audio": {"output": {"voice": str(live.get("voice") or DEFAULT_LIVE_VOICE)}},
        "delegation": {"type": "client"},
    }
    if history:
        config["input"] = history
    return config


def create_webrtc_session(sdp_offer: str, history: Optional[list] = None) -> dict[str, Any]:
    """Exchange the renderer's SDP offer for the GPT-Live session answer.

    Returns the vendor response ``{"session": {"id": ...}, "transport": {"type": "webrtc",
    "sdp": ...}}``. Raises ``ValueError`` for a missing key and ``RuntimeError`` (with the vendor
    status/detail) for a rejected request.
    """
    return GPT_LIVE_ENGINE.create_session(_live_section(), {"sdp": sdp_offer}, history)


class GptLiveEngine(VoiceLiveEngine):
    """Built-in engine: OpenAI ``gpt-live-1`` over WebRTC with client delegation."""

    @property
    def name(self) -> str:
        return GPT_LIVE_MODE

    @property
    def display_name(self) -> str:
        return "GPT-Live"

    def settings_schema(self) -> dict[str, dict[str, Any]]:
        return {
            "voice": {"type": "select", "description": "GPT-Live voice", "options": list(GPT_LIVE_VOICES)},
            "instructions": {"type": "text", "description": "Extra persona sentences (tone, pace, language)"},
        }

    def status(self, section: dict[str, Any]) -> dict[str, Any]:
        api_key, _base = _resolve_credentials(section)
        return {
            "available": bool(api_key),
            "reason": None if api_key else "no OpenAI API key (set OPENAI_API_KEY or voice.gpt_live.api_key)",
            "model": str(section.get("model") or DEFAULT_LIVE_MODEL),
            "voice": str(section.get("voice") or DEFAULT_LIVE_VOICE),
        }

    def create_session(self, section, request, history=None):
        api_key, base_url = _resolve_credentials(section)
        if not api_key:
            raise VoiceLiveNotConfigured(
                "GPT-Live needs an OpenAI API key (OPENAI_API_KEY or voice.gpt_live.api_key)")
        # The vendor's SDP parser needs the offer byte-exact, including the trailing CRLF.
        sdp = request.get("sdp") if isinstance(request.get("sdp"), str) else ""
        if not sdp.strip():
            raise VoiceLiveBadRequest("An SDP offer is required")
        body = json.dumps({
            "session": build_session_config(history, section),
            "transport": {"type": "webrtc", "sdp": sdp},
        }).encode("utf-8")
        req = urllib.request.Request(
            f"{base_url}/live/sessions", data=body, method="POST",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:600]
            logger.warning("GPT-Live session creation failed: %s %s", exc.code, detail)
            raise VoiceLiveUpstreamError(f"GPT-Live session creation failed ({exc.code}): {detail}") from exc


GPT_LIVE_ENGINE = GptLiveEngine()


def resolve_engine(mode: str) -> Optional[VoiceLiveEngine]:
    """The engine serving ``mode`` in the active profile: the built-in, else a plugin engine
    (discovering plugins first, so a fresh install answers without a restart). ``None`` for
    ``chained`` or a name no installed plugin registers."""
    if mode == GPT_LIVE_MODE:
        return GPT_LIVE_ENGINE
    if mode == CHAINED_MODE:
        return None
    from agent.voice_live_registry import get_provider
    from hermes_cli.plugins import _ensure_plugins_discovered
    _ensure_plugins_discovered()
    return get_provider(mode)


def _engine_verdict(engine: VoiceLiveEngine, voice: dict[str, Any]) -> dict[str, Any]:
    """``engine.status`` for its own section; a raising engine reads as unavailable."""
    try:
        return engine.status(_engine_section(voice, engine.config_key))
    except Exception:  # plugin code: any failure is "not ready", never a broken probe
        logger.warning("Voice live engine %r status failed", engine.name, exc_info=True)
        return {"available": False, "reason": f"{engine.name} status failed", "model": "", "voice": ""}


def _plugin_engines() -> list[VoiceLiveEngine]:
    from agent.voice_live_registry import list_providers
    return list_providers()


def known_voice_chat_modes() -> frozenset[str]:
    """Every value ``voice.voice_chat_mode`` may be set to here: the built-ins plus installed engines."""
    from hermes_cli.plugins import _ensure_plugins_discovered
    _ensure_plugins_discovered()
    return BUILTIN_MODES | {engine.name.strip().lower() for engine in _plugin_engines()}


def resolve_voice_live_status() -> dict[str, Any]:
    """What the desktop mounts next. Non-secret.

    ``engines`` lists every live engine (built-in first) with its own readiness, for the engine
    menu. The top-level ``available``/``reason``/``model``/``voice`` describe the selected live
    engine, or GPT-Live while ``chained`` is selected (the shape desktops predating plugin engines
    read for their GPT-Live row). A mode no installed engine serves reads as unavailable, so the
    desktop falls back to chained instead of failing.
    """
    from hermes_cli.plugins import _ensure_plugins_discovered
    _ensure_plugins_discovered()
    voice = _voice_section()
    mode = voice_chat_mode(voice)
    engines = [GPT_LIVE_ENGINE, *_plugin_engines()]
    rows = [{"name": e.name, "label": e.display_name, **_engine_verdict(e, voice)} for e in engines]
    selected = next((row for row in rows if row["name"].strip().lower() == mode), None)
    if selected is None and mode == CHAINED_MODE:
        selected = rows[0]
    if selected is None:
        verdict = {"available": False, "reason": f"no voice engine named {mode!r} is installed",
                   "model": "", "voice": ""}
    else:
        verdict = {k: selected[k] for k in ("available", "reason", "model", "voice")}
    return {"mode": mode, **verdict, "engines": rows}


def voice_settings_schema() -> dict[str, dict[str, Any]]:
    """Config-schema entries for Settings → Voice: ``voice.voice_chat_mode`` as a select over every
    installed mode, plus each live engine's own ``voice.<config_key>.<leaf>`` fields tagged with
    ``engine`` (the desktop shows only the selected engine's)."""
    from hermes_cli.plugins import _ensure_plugins_discovered
    _ensure_plugins_discovered()
    engines = [GPT_LIVE_ENGINE, *_plugin_engines()]
    fields: dict[str, dict[str, Any]] = {"voice.voice_chat_mode": {
        "type": "select", "category": "voice",
        "description": "Desktop voice conversation engine: chained (speech-to-text + Hermes voice) or a "
                       "full-duplex live engine that delegates to Hermes",
        "options": [CHAINED_MODE, *(e.name.strip().lower() for e in engines)],
        "labels": {CHAINED_MODE: "Speech-to-text + Hermes voice",
                   **{e.name.strip().lower(): e.display_name for e in engines}},
    }}
    for engine in engines:
        try:
            schema = engine.settings_schema()
        except Exception:  # plugin code: a broken schema hides its fields, never the page
            logger.warning("Voice live engine %r settings_schema failed", engine.name, exc_info=True)
            continue
        for leaf, field in schema.items():
            fields[f"voice.{engine.config_key}.{leaf}"] = {
                **field, "category": "voice", "engine": engine.name.strip().lower()}
    return fields


def create_live_session(request: dict[str, Any], history: Optional[list] = None) -> dict[str, Any]:
    """Run the selected engine's server-side session step for the renderer half."""
    voice = _voice_section()
    mode = voice_chat_mode(voice)
    engine = resolve_engine(mode)
    if engine is None:
        raise VoiceLiveNotConfigured(f"voice chat mode {mode!r} is not a live engine")
    return engine.create_session(_engine_section(voice, engine.config_key), request, history)
