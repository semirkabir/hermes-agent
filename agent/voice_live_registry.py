"""Live voice engine registry.

Plugin engines registered via :meth:`PluginContext.register_voice_live_engine`, consulted by
:mod:`tools.voice_live` when ``voice.voice_chat_mode`` names something other than a built-in.
Built-ins always win: a colliding name is rejected with a warning.
"""

from __future__ import annotations

import logging

from agent.provider_registry import ProviderRegistry, lower_key
from agent.voice_live_engine import VoiceLiveEngine

logger = logging.getLogger(__name__)


# ``chained`` is the non-live loop; ``gpt-live`` is ``tools.voice_live.GPT_LIVE_ENGINE``. Kept in
# sync with ``BUILTIN_MODES`` there (importing it would be a circular import).
_BUILTIN_NAMES = frozenset({"chained", "gpt-live"})


def _warn_builtin_collision(key: str) -> None:
    logger.warning(
        "Voice live engine '%s' shadows a built-in voice chat mode; registration ignored. "
        "Built-in modes (%s) always win — pick a different name.",
        key, ", ".join(sorted(_BUILTIN_NAMES)),
    )


_registry: ProviderRegistry[VoiceLiveEngine] = ProviderRegistry(
    label="Voice live", provider_cls=VoiceLiveEngine, logger=logger, normalize=lower_key,
    builtin_names=_BUILTIN_NAMES, on_builtin_collision=_warn_builtin_collision,
)
_registry.export(globals())
