# Claude Code Prompt – prompt_website_signatur.md
Aktualisiere die Signatur in tag15_bautraeger_agent.py.


Fuege ABSENDER_WEBSITE = os.environ.get("ABSENDER_WEBSITE")
zur sende_email() Funktion hinzu.


Die neue Signatur soll so aussehen:
Mit freundlichen Grüßen
{ABSENDER_NAME}
{ABSENDER_EMAIL}
{ABSENDER_WEBSITE}


Alle Werte aus os.environ.get() – nichts direkt im Code.
Trage ABSENDER_WEBSITE=https://nio-automation.de in .env ein.
Zeige mir den Unterschied bevor du die Änderung machst.

