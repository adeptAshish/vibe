"""
Prompt registry — treat prompts as versioned code artifacts, not inline strings.

WHY THIS EXISTS
  Inline prompt strings (like `"You are a helpful assistant"`) can't be reviewed,
  diffed, versioned, rolled back, or tested. Here prompts live as files named
  `<name>.<version>.txt` under prompts/. This module loads them, validates their
  template variables, and renders them with TRUSTED values only.

KEY SAFETY RULE
  Template variables ({{var}}) are for TRUSTED config values (company name, tone).
  End-user input is NEVER a template variable — it goes through the injection
  guard and into a separate, delimited user message. Mixing user text into the
  instruction body is how prompt injection happens.
"""

from __future__ import annotations

import re
from pathlib import Path

from pydantic import BaseModel

_VAR_RE = re.compile(r"\{\{\s*(\w+)\s*\}\}")


class PromptTemplate(BaseModel):
    name: str
    version: str
    text: str

    @property
    def required_vars(self) -> set[str]:
        """The {{variables}} this template expects — parsed from the file."""
        return set(_VAR_RE.findall(self.text))

    def render(self, **values: str) -> str:
        """Fill template variables with TRUSTED values.

        Strict on purpose: missing OR unexpected variables raise, so a prompt can
        never be shipped half-filled or with typo'd placeholders left in.
        """
        required = self.required_vars
        provided = set(values)
        missing = required - provided
        if missing:
            raise ValueError(f"missing prompt variables: {sorted(missing)}")
        extra = provided - required
        if extra:
            raise ValueError(f"unexpected prompt variables: {sorted(extra)}")
        return _VAR_RE.sub(lambda m: str(values[m.group(1)]), self.text)


class PromptRegistry:
    """Discovers and serves versioned prompt files from a directory."""

    def __init__(self, directory: Path) -> None:
        self._dir = directory
        self._prompts: dict[str, dict[str, PromptTemplate]] = {}
        self._load()

    def _load(self) -> None:
        for path in sorted(self._dir.glob("*.txt")):
            # filename convention: <name>.<version>.txt  e.g. support_agent.v2.txt
            stem = path.stem
            if "." not in stem:
                continue
            name, version = stem.rsplit(".", 1)
            self._prompts.setdefault(name, {})[version] = PromptTemplate(
                name=name, version=version, text=path.read_text(encoding="utf-8")
            )

    def versions(self, name: str) -> list[str]:
        return sorted(self._prompts.get(name, {}))

    def catalog(self) -> dict[str, list[str]]:
        return {name: sorted(v) for name, v in self._prompts.items()}

    def get(self, name: str, version: str | None = None) -> PromptTemplate:
        versions = self._prompts.get(name)
        if not versions:
            raise KeyError(f"unknown prompt '{name}'")
        if version is None:
            version = sorted(versions)[-1]  # latest by default
        if version not in versions:
            raise KeyError(f"unknown version '{version}' for prompt '{name}'")
        return versions[version]


def build_registry(directory: str | Path | None = None) -> PromptRegistry:
    d = Path(directory) if directory else Path(__file__).resolve().parent.parent / "prompts"
    return PromptRegistry(d)
