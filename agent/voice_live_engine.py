"""Live voice engine ABC: a full-duplex voice model that delegates real work to Hermes.

``voice.voice_chat_mode`` names the engine the desktop voice button mounts. ``chained`` is the
STT → turn → TTS loop; every other value is a *live engine*: one speech-to-speech model owns the
microphone and the speaker and hands each real request to Hermes as a normal turn (surface
``voice-live``), so whatever model the session has selected answers with the full toolset.
``gpt-live`` is the built-in engine (:mod:`tools.voice_live`); plugins add more (xAI Grok voice,
Gemini Live, a self-hosted realtime endpoint) via ``ctx.register_voice_live_engine()``.

An engine has two halves. This class is the gateway half: readiness and the one server-side step
a vendor needs before the renderer can connect (exchanging an SDP offer, minting an ephemeral
client secret), so the API key never reaches the renderer. The renderer half (transport, audio,
mapping vendor events to delegations) is a desktop contribution to the ``voice.liveEngines`` area
under the same ``name``.
"""

from __future__ import annotations

import abc
from typing import Any, Optional

from agent.provider_base import ProviderBase


class VoiceLiveNotConfigured(ValueError):
    """The engine cannot start here (no key, missing dependency). The desktop falls back to chained."""


class VoiceLiveBadRequest(ValueError):
    """The renderer's session request is malformed for this engine."""


class VoiceLiveUpstreamError(RuntimeError):
    """The vendor refused or failed the session request."""


class VoiceLiveEngine(ProviderBase):
    """Gateway half of a live voice engine. ``name`` is the ``voice.voice_chat_mode`` value."""

    @property
    def config_key(self) -> str:
        """Leaf under ``voice`` holding this engine's settings: ``grok-live`` → ``voice.grok_live``."""
        return self.name.strip().lower().replace("-", "_")

    def settings_schema(self) -> dict[str, dict[str, Any]]:
        """Settings fields under ``voice.<config_key>``, keyed by leaf name, in display order.

        Each value is a config-schema field (``{"type": "select" | "string" | "text" | "number" |
        "boolean", "description": ..., "options": [...]}``). Settings → Voice renders them while
        this engine is the selected mode. Default: none.
        """
        return {}

    @abc.abstractmethod
    def status(self, section: dict[str, Any]) -> dict[str, Any]:
        """Non-secret readiness for this engine's ``voice.<config_key>`` ``section``.

        Shape: ``{"available": bool, "reason": str | None, "model": str, "voice": str}``. Called on
        every status probe: it must not raise and must not touch the network.
        """

    def create_session(
        self, section: dict[str, Any], request: dict[str, Any], history: Optional[list] = None,
    ) -> dict[str, Any]:
        """The server-side handshake the renderer half needs, returned to it verbatim.

        ``request`` is the renderer's engine-specific body (an SDP offer, requested voice, …) and
        ``history`` prior text turns to seed the voice model. Return only what the renderer may
        hold (an SDP answer, an ephemeral client secret), never the API key. Raise
        :class:`VoiceLiveNotConfigured`, :class:`VoiceLiveBadRequest` or
        :class:`VoiceLiveUpstreamError`. Engines whose plugin backend owns the vendor socket keep
        the default.
        """
        raise VoiceLiveBadRequest(f"voice engine {self.name!r} has no server-side session step")
