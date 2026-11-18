"""Startdatei für Windows: Doppelklick startet das Ticket-Board ohne Konsolenfenster.

Beenden in der App über ⋯ → Beenden. Ordner und Port wie bei
``python -m ticket_board`` als Argumente möglich.
"""

import sys

from ticket_board.__main__ import main

sys.exit(main())
