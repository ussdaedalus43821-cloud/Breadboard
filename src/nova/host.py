"""Breadboard's NovaLang host: the board/sim globals and the script runner.

Runs inside Pyodide in the nova worker (and under Pyodide in Node for tests).
NovaLang itself is vendored, unmodified, at /nova/novalang.py.

Isolation (docs/NOVALANG_ISOLATION.md, D-032): a script sees exactly two
Breadboard globals, `board` and `sim`. Each is a plain dict whose values are
host functions, one per bridge call in docs/NOVALANG_BRIDGE.md. A function is
opaque to NovaLang (it can be called, never indexed or inspected), and the dict
is copied into the script, so there is no Python object for a script to walk.
That is deliberate: NovaLang's live object proxy (expose_global with an
object) resolves any attribute, underscores and dunders included, and its
python.* namespace can reach dunder attributes of allowlisted modules. So
Breadboard binds no objects, and removes `python` from every engine it creates.
Each call becomes one JSON request through `transport` (a JS function: request
text -> response text). Results come back as fresh plain dicts and lists.
"""

import json
import sys

if "/nova" not in sys.path:
    sys.path.insert(0, "/nova")

# NovaLang raises the recursion limit to 20000 on import, far past what
# Pyodide's WebAssembly stack holds: a runaway recursive script would then crash
# Pyodide itself instead of raising RecursionError. Keep Pyodide's own limit.
_SAFE_RECURSION_LIMIT = sys.getrecursionlimit()
from novalang import Nova, NovaLangError  # noqa: E402

sys.setrecursionlimit(_SAFE_RECURSION_LIMIT)

BRIDGE_VERSION = 3
MAX_BRIDGE_CALLS = 100_000


class BoardError(Exception):
    """A refused bridge call. str() is "<CODE>: <message>"."""


class _Bridge:
    def __init__(self, transport, max_calls):
        self._transport = transport
        self._max_calls = max_calls
        self._calls = 0
        self._next_id = 1

    def call(self, op, args):
        self._calls += 1
        if self._calls > self._max_calls:
            raise BoardError(
                "LIMIT: a script may make at most {} bridge calls per run".format(self._max_calls)
            )
        request_id = self._next_id
        self._next_id += 1
        request = json.dumps(
            {"v": BRIDGE_VERSION, "id": request_id, "op": op, "args": list(args)}
        )
        reply = json.loads(str(self._transport(request)))
        if reply.get("ok"):
            return reply.get("result")
        error = reply.get("error") or {}
        raise BoardError("{}: {}".format(error.get("code", "INTERNAL"), error.get("message", "")))


BOARD_CALLS = (
    "new", "switch", "led", "chip", "wire", "power", "ground", "set", "run", "step", "resistor",
    "display", "clock",
)
SIM_CALLS = ("get", "snapshot", "time")


def _calls(bridge, namespace, names):
    """A plain dict of functions, one per bridge op. Arguments are forwarded as
    given; the sim side checks count and types (BAD_ARGS), so validation has one home."""

    def make(name):
        op = namespace + "." + name

        def call(*args):
            return bridge.call(op, args)

        call.__name__ = name
        return call

    return {name: make(name) for name in names}


def public_api():
    """The names a script can reach on each global, for the isolation tests."""
    bridge = _Bridge(lambda request: "{}", 0)
    return json.dumps(
        {
            "board": sorted(_calls(bridge, "board", BOARD_CALLS)),
            "sim": sorted(_calls(bridge, "sim", SIM_CALLS)),
        }
    )


def run_script(source, transport, max_calls=MAX_BRIDGE_CALLS):
    """Run one script in a fresh Nova engine. Returns a JSON outcome:
    {"ok": true} or {"ok": false, "kind": "error" | "timeout" | "internal", "message": ...}.
    """
    bridge = _Bridge(transport, int(max_calls))
    engine = Nova()
    # No python.*: see the module docstring. Imported .nova modules start from
    # fresh, empty globals, so they never see it either.
    del engine.interpreter.globals.values["python"]
    engine.expose_global("board", _calls(bridge, "board", BOARD_CALLS))
    engine.expose_global("sim", _calls(bridge, "sim", SIM_CALLS))
    try:
        engine.exec(str(source))
        outcome = {"ok": True}
    except NovaLangError as error:
        outcome = {"ok": False, "kind": "error", "message": str(error)}
    except KeyboardInterrupt:
        outcome = {"ok": False, "kind": "timeout", "message": "TIMEOUT: the script ran too long and was stopped"}
    except SystemExit as stop:
        code = stop.code if isinstance(stop.code, int) else 0
        outcome = {"ok": code == 0} if code == 0 else {
            "ok": False,
            "kind": "error",
            "message": "the script called exit({})".format(code),
        }
    except RecursionError:
        outcome = {"ok": False, "kind": "error", "message": "RecursionError: the script recursed too deeply"}
    except Exception as error:  # a bug in the host, not the script
        outcome = {"ok": False, "kind": "internal", "message": "{}: {}".format(type(error).__name__, error)}
    finally:
        sys.stdout.flush()
        sys.stderr.flush()
    return json.dumps(outcome)
