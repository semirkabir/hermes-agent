"""Live voice engines are pluggable: ``voice.voice_chat_mode`` names the built-in GPT-Live or any
engine a plugin registers, and the status/session routes dispatch to whichever is selected.

Contracts pinned here:

* a plugin engine registered through the real plugin loader becomes a selectable mode (status
  lists it, ``config.set`` accepts it, ``create_live_session`` reaches its ``create_session``
  with its own ``voice.<config_key>`` section);
* built-in names cannot be shadowed by a plugin;
* an unknown engine reads as unavailable (the desktop falls back to chained) instead of erroring;
* GPT-Live behaves exactly as before through the engine seam.
"""

from __future__ import annotations

import os
from pathlib import Path

import hermes_yaml as yaml
import pytest

from agent import voice_live_registry
from agent.voice_live_engine import VoiceLiveBadRequest, VoiceLiveEngine, VoiceLiveNotConfigured
from tools import voice_live

_ENGINE_SRC = '''
from agent.voice_live_engine import VoiceLiveEngine

class Grok(VoiceLiveEngine):
    @property
    def name(self):
        return "Grok-Live"

    @property
    def display_name(self):
        return "Grok Voice"

    def status(self, section):
        return {"available": True, "reason": None, "model": "grok-voice", "voice": section.get("voice", "ara")}

    def create_session(self, section, request, history=None):
        return {"client_secret": "eph-123", "voice": section.get("voice"), "echo": request, "turns": len(history or [])}

def register(ctx):
    ctx.register_voice_live_engine(Grok())
'''


@pytest.fixture
def home():
    voice_live_registry._reset_for_tests()
    yield Path(os.environ["HERMES_HOME"])
    voice_live_registry._reset_for_tests()


def _install_plugin(home: Path, name: str, source: str, voice: dict) -> None:
    plugin = home / "plugins" / name
    plugin.mkdir(parents=True)
    (plugin / "plugin.yaml").write_text(yaml.safe_dump({"name": name, "version": "0.1.0", "description": "t"}))
    (plugin / "__init__.py").write_text(source)
    (home / "config.yaml").write_text(yaml.safe_dump({"plugins": {"enabled": [name]}, "voice": voice}))


def _load_plugins() -> None:
    from hermes_cli.plugins import _ensure_plugins_discovered
    _ensure_plugins_discovered(force=True)


def test_plugin_engine_is_selectable_and_receives_its_own_section(home):
    _install_plugin(home, "grok-voice", _ENGINE_SRC,
                    {"voice_chat_mode": "grok-live", "grok_live": {"voice": "rex"}, "gpt_live": {"voice": "marin"}})
    _load_plugins()

    status = voice_live.resolve_voice_live_status()
    assert status["mode"] == "grok-live"
    assert status["available"] is True and status["voice"] == "rex"
    grok = next(row for row in status["engines"] if row["name"] == "Grok-Live")
    assert grok["label"] == "Grok Voice" and grok["available"] is True and grok["voice"] == "rex"
    assert status["engines"][0]["name"] == "gpt-live"
    assert "grok-live" in voice_live.known_voice_chat_modes()

    result = voice_live.create_live_session({"voice": "requested"}, history=[{"role": "user"}])
    assert result == {"client_secret": "eph-123", "voice": "rex", "echo": {"voice": "requested"}, "turns": 1}


def test_builtin_modes_cannot_be_shadowed(home, caplog):
    class Impostor(VoiceLiveEngine):
        @property
        def name(self):
            return "GPT-Live"


        def status(self, section):
            return {"available": True, "reason": None, "model": "", "voice": ""}

    voice_live_registry.register_provider(Impostor())

    assert voice_live_registry.get_provider("gpt-live") is None
    assert voice_live.resolve_engine("gpt-live") is voice_live.GPT_LIVE_ENGINE
    assert "shadows a built-in" in caplog.text


def test_unknown_engine_reads_unavailable_and_refuses_a_session(home):
    (home / "config.yaml").write_text(yaml.safe_dump({"voice": {"voice_chat_mode": "nonexistent-live"}}))

    status = voice_live.resolve_voice_live_status()
    assert status["mode"] == "nonexistent-live"
    assert status["available"] is False and "nonexistent-live" in status["reason"]
    with pytest.raises(VoiceLiveNotConfigured):
        voice_live.create_live_session({"sdp": "v=0\r\n"})


def test_chained_reports_gpt_live_readiness_for_older_desktops(home, monkeypatch):
    """With chained selected the top-level verdict stays GPT-Live's (what a desktop predating
    plugin engines reads for its GPT-Live row); chained itself never opens a live session."""
    (home / "config.yaml").write_text(yaml.safe_dump({"voice": {"voice_chat_mode": "chained"}}))
    monkeypatch.setattr(voice_live, "_resolve_credentials", lambda live: ("", voice_live.DEFAULT_LIVE_BASE_URL))

    status = voice_live.resolve_voice_live_status()
    assert status["mode"] == "chained"
    assert status["available"] is False and "OpenAI" in status["reason"]
    with pytest.raises(VoiceLiveNotConfigured):
        voice_live.create_live_session({"sdp": "v=0\r\n"})


def test_engine_status_failure_is_contained(home):
    class Broken(VoiceLiveEngine):
        @property
        def name(self):
            return "broken-live"


        def status(self, section):
            raise RuntimeError("boom")

    voice_live_registry.register_provider(Broken())
    (home / "config.yaml").write_text(yaml.safe_dump({"voice": {"voice_chat_mode": "broken-live"}}))

    status = voice_live.resolve_voice_live_status()
    assert status["available"] is False and status["mode"] == "broken-live"


def test_gpt_live_through_the_seam_needs_an_sdp_offer(home, monkeypatch):
    (home / "config.yaml").write_text(yaml.safe_dump({"voice": {"voice_chat_mode": "gpt-live"}}))
    monkeypatch.setattr(voice_live, "_resolve_credentials", lambda live: ("sk-test", "https://api.example/v1"))
    monkeypatch.setattr(voice_live.urllib.request, "urlopen", lambda *a, **k: pytest.fail("must not call the vendor"))

    with pytest.raises(VoiceLiveBadRequest):
        voice_live.create_live_session({})


def test_engine_without_a_session_step_refuses_cleanly():
    class SocketOwned(VoiceLiveEngine):
        @property
        def name(self):
            return "socket-live"


        def status(self, section):
            return {"available": True, "reason": None, "model": "", "voice": ""}

    assert SocketOwned().config_key == "socket_live"
    with pytest.raises(VoiceLiveBadRequest):
        SocketOwned().create_session({}, {})
