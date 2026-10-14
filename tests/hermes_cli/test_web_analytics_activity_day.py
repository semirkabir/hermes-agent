"""Usage analytics attribute a session's counters to the days it was active, not the day it started.

``sessions.*`` token/cost columns are lifetime totals. Bucketing them on ``started_at`` piled a
multi-day session's entire usage onto its first day and left the later days flat.
"""
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from hermes_cli.web_routers import analytics
from hermes_state import SessionDB


def _local_noon(days_ago: int) -> datetime:
    return (datetime.now() - timedelta(days=days_ago)).replace(hour=12, minute=0, second=0, microsecond=0)


def _day(days_ago: int) -> str:
    return _local_noon(days_ago).strftime("%Y-%m-%d")


@pytest.fixture()
def seed(tmp_path, monkeypatch):
    """Return ``(add_session, get_daily)`` over a throwaway state.db."""
    import hermes_state

    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    db_path = tmp_path / "state.db"
    monkeypatch.setattr(hermes_state, "_default_db_path", lambda: db_path)
    db = SessionDB(db_path=db_path)

    def add_session(sid, started_days_ago, assistant_days_ago, **counters):
        """One session with lifetime ``counters``; one assistant message per entry of ``assistant_days_ago``."""
        db.create_session(session_id=sid, source="cli", model="m")
        started = _local_noon(started_days_ago).timestamp()
        last = max([started] + [_local_noon(d).timestamp() for d in assistant_days_ago])
        sets = ", ".join(f"{k} = ?" for k in counters)
        db._conn.execute(
            f"UPDATE sessions SET started_at = ?, last_activity_at = ?, {sets} WHERE id = ?",
            (started, last, *counters.values(), sid),
        )
        for i, d in enumerate(assistant_days_ago):
            db._conn.execute(
                "INSERT INTO messages (session_id, role, timestamp) VALUES (?, 'assistant', ?)",
                (sid, _local_noon(d).timestamp() + i),
            )
        db._conn.commit()

    app = FastAPI()
    app.include_router(analytics.router)
    client = TestClient(app)

    def get_daily(days=30):
        resp = client.get(f"/api/analytics/usage?days={days}")
        assert resp.status_code == 200
        return {row["day"]: row for row in resp.json()["daily"]}

    yield add_session, get_daily
    db.close()


def test_multi_day_session_is_spread_over_its_active_days(seed):
    add_session, get_daily = seed
    # Started 3 days ago, then 1 / 1 / 2 assistant messages on days -3 / -2 / -1.
    add_session(
        "long", 3, [3, 2, 1, 1],
        input_tokens=1000, output_tokens=400, cache_read_tokens=4000, reasoning_tokens=40,
        estimated_cost_usd=8.0, actual_cost_usd=4.0, api_call_count=8,
    )
    daily = get_daily()

    assert sorted(daily) == [_day(3), _day(2), _day(1)]
    assert [daily[_day(n)]["input_tokens"] for n in (3, 2, 1)] == [250, 250, 500]
    assert [daily[_day(n)]["output_tokens"] for n in (3, 2, 1)] == [100, 100, 200]
    assert [daily[_day(n)]["cache_read_tokens"] for n in (3, 2, 1)] == [1000, 1000, 2000]
    assert [daily[_day(n)]["reasoning_tokens"] for n in (3, 2, 1)] == [10, 10, 20]
    assert [daily[_day(n)]["api_calls"] for n in (3, 2, 1)] == [2, 2, 4]
    assert [daily[_day(n)]["estimated_cost"] for n in (3, 2, 1)] == pytest.approx([2.0, 2.0, 4.0])
    assert [daily[_day(n)]["actual_cost"] for n in (3, 2, 1)] == pytest.approx([1.0, 1.0, 2.0])
    # ``sessions`` counts a session on every day it was active.
    assert [daily[_day(n)]["sessions"] for n in (3, 2, 1)] == [1, 1, 1]
    # Nothing is created or lost.
    assert sum(r["input_tokens"] for r in daily.values()) == 1000


def test_session_without_assistant_messages_stays_on_its_start_day(seed):
    add_session, get_daily = seed
    add_session("quiet", 2, [], input_tokens=500, output_tokens=50, api_call_count=3)
    daily = get_daily()

    assert list(daily) == [_day(2)]
    assert daily[_day(2)]["input_tokens"] == 500
    assert daily[_day(2)]["api_calls"] == 3
    assert daily[_day(2)]["sessions"] == 1


def test_fractions_before_the_window_are_dropped(seed):
    add_session, get_daily = seed
    # Half of the activity is 20 days ago (outside a 7-day window), half is yesterday.
    add_session("old-start", 20, [20, 1], input_tokens=1000, api_call_count=10)
    # Entirely outside the window: must not show up at all.
    add_session("ancient", 20, [20], input_tokens=999, api_call_count=1)
    daily = get_daily(days=7)

    assert list(daily) == [_day(1)]
    assert daily[_day(1)]["input_tokens"] == 500
    assert daily[_day(1)]["api_calls"] == 5
    assert daily[_day(1)]["sessions"] == 1


def test_sessions_sharing_a_day_are_summed(seed):
    add_session, get_daily = seed
    add_session("a", 1, [1], input_tokens=100, api_call_count=1)
    add_session("b", 2, [2, 1], input_tokens=300, api_call_count=2)
    daily = get_daily()

    assert daily[_day(1)]["input_tokens"] == 100 + 150
    assert daily[_day(1)]["sessions"] == 2
    assert daily[_day(2)]["input_tokens"] == 150
    assert daily[_day(2)]["sessions"] == 1
