In dashboard.py sollen die Suchkriterien nicht nur angezeigt werden
sondern auch in die .env Datei geschrieben werden wenn der Nutzer
auf "Speichern" klickt.

Folgende Felder sollen in .env geschrieben werden:
- BUDGET_MAX (aus dem Budget-Eingabefeld)
- ZIMMER_MIN (aus dem Zimmeranzahl-Feld)
- WOHNFLAECHE_MIN (aus dem Wohnfläche-von-Feld)
- WOHNFLAECHE_MAX (aus dem Wohnfläche-bis-Feld)
- REGIONEN (aus den Checkboxen, kommasepariert)
- NUR_NEUBAU (True/False aus der Checkbox)
- MAX_EMAILS_PRO_TAG (aus dem Tageslimit-Feld)
- TEST_MODUS (True/False aus dem Toggle)

Füge einen "Einstellungen speichern" Button hinzu.
Wenn geklickt: Werte in .env schreiben und Bestätigung anzeigen:
st.success("Einstellungen gespeichert – werden beim nächsten Start übernommen")

In tag15_bautraeger_agent.py sollen alle diese Werte
aus os.environ.get() gelesen werden statt hardcoded zu sein.

Zeige mir den Unterschied bevor du die Aenderung machst.
Alle privaten Daten bleiben in .env – nichts direkt im Code.