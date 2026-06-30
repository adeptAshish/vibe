"""
Tool registry — the security boundary for tool calling.

KEY PRINCIPLE: the LLM never executes anything. It only *requests* a tool by
name with arguments. This registry is the ONLY place tools actually run, and it:
  * allow-lists tools (a model can't invoke something not registered)
  * validates arguments against a Pydantic schema BEFORE running (untrusted input)
  * returns a safe string result back to the loop

Each tool = (Pydantic arg schema, handler fn, description, JSON schema for the LLM).
"""

from __future__ import annotations

from typing import Callable

from pydantic import BaseModel, Field, ValidationError


# ----- Tool argument schemas (validation = untrusted-input firewall) -----
class WeatherArgs(BaseModel):
    city: str = Field(..., min_length=1, max_length=100)


class CalculateArgs(BaseModel):
    # Restrict to a safe arithmetic expression; we evaluate it ourselves
    # (never eval()) to avoid code injection.
    expression: str = Field(..., min_length=1, max_length=100)


class SearchOrdersArgs(BaseModel):
    order_id: str = Field(..., min_length=1, max_length=50)


# ----- Tool handlers (the "kitchen stations") ---------------------------
_FAKE_WEATHER = {"paris": "18C, rainy", "tokyo": "27C, clear", "delhi": "34C, hazy"}
_FAKE_ORDERS = {"A100": "shipped", "A200": "processing", "A300": "delivered"}


def _weather(args: WeatherArgs) -> str:
    return _FAKE_WEATHER.get(args.city.lower(), "weather unavailable for that city")


def _safe_calc(expr: str) -> float:
    """Evaluate a simple +-*/ expression without eval(). Shunting-yard-lite via
    Python's ast in eval-free mode."""
    import ast
    import operator

    ops = {
        ast.Add: operator.add, ast.Sub: operator.sub,
        ast.Mult: operator.mul, ast.Div: operator.truediv,
        ast.USub: operator.neg,
    }

    def _ev(node):
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return node.value
        if isinstance(node, ast.BinOp) and type(node.op) in ops:
            return ops[type(node.op)](_ev(node.left), _ev(node.right))
        if isinstance(node, ast.UnaryOp) and type(node.op) in ops:
            return ops[type(node.op)](_ev(node.operand))
        raise ValueError("unsupported expression")

    return _ev(ast.parse(expr, mode="eval").body)


def _calculate(args: CalculateArgs) -> str:
    try:
        return str(_safe_calc(args.expression))
    except Exception:
        return "could not evaluate expression"


def _search_orders(args: SearchOrdersArgs) -> str:
    return _FAKE_ORDERS.get(args.order_id.upper(), "order not found")


# ----- Registry ----------------------------------------------------------
class Tool(BaseModel):
    name: str
    description: str
    args_model: type[BaseModel]
    handler: Callable[[BaseModel], str]

    model_config = {"arbitrary_types_allowed": True}

    def json_schema(self) -> dict:
        """The shape we advertise to the LLM (OpenAI function-calling format)."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.args_model.model_json_schema(),
            },
        }


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        self._tools[tool.name] = tool

    def names(self) -> list[str]:
        return list(self._tools)

    def specs(self) -> list[dict]:
        return [t.json_schema() for t in self._tools.values()]

    def execute(self, name: str, raw_args: dict) -> str:
        """Run a tool by name. This is the ONLY execution path."""
        tool = self._tools.get(name)
        if tool is None:
            # Model hallucinated a tool that doesn't exist — refuse safely.
            return f"error: unknown tool '{name}'"
        try:
            validated = tool.args_model(**raw_args)  # firewall: bad args rejected
        except ValidationError as e:
            return f"error: invalid arguments ({e.error_count()} problems)"
        return tool.handler(validated)


def build_default_registry() -> ToolRegistry:
    reg = ToolRegistry()
    reg.register(Tool(name="get_weather", description="Get current weather for a city.",
                      args_model=WeatherArgs, handler=_weather))
    reg.register(Tool(name="calculate", description="Evaluate a simple arithmetic expression.",
                      args_model=CalculateArgs, handler=_calculate))
    reg.register(Tool(name="search_orders", description="Look up an order status by order_id.",
                      args_model=SearchOrdersArgs, handler=_search_orders))
    return reg
