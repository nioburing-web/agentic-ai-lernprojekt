# Claude Code Prompt – prompt_tageslimit.md
Fuege in tag15_bautraeger_agent.py ein tägliches E-Mail-Limit ein.


Der Wert soll aus der .env kommen:
MAX_EMAILS_PRO_TAG = int(os.environ.get("MAX_EMAILS_PRO_TAG", "10"))


Im Haupt-Loop soll ein Zaehler mitzählen wie viele E-Mails
heute bereits gesendet wurden.


Wenn das Limit erreicht ist:
- Loop stoppen
- Ins Log schreiben: "Tageslimit von X E-Mails erreicht."
- Google Sheet NICHT mehr aktualisieren für übersprungene Bauträger


Trage MAX_EMAILS_PRO_TAG=10 in die .env ein.
Alle Werte aus os.environ.get().
Zeige mir den Unterschied bevor du die Änderung machst.

