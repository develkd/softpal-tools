import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ticket_board.speicher import Arbeitsbereich  # noqa: E402


@pytest.fixture
def arbeitsbereich(tmp_path):
    return Arbeitsbereich(tmp_path / "tickets")


@pytest.fixture
def projekt(arbeitsbereich):
    info = arbeitsbereich.projekt_anlegen("Ticket Board", "TB")
    return arbeitsbereich.projekt(info["id"])
