import os
import subprocess
import sys
import pandas as pd
import streamlit as st
from dotenv import load_dotenv

load_dotenv()

st.set_page_config(page_title="NIO Automation – Bauträger Agent", layout="wide")
st.title("NIO Automation – Bauträger Agent Dashboard")


def schreibe_env_wert(key: str, value: str):
    """Aktualisiert oder fügt einen Wert in die .env Datei ein."""
    env_pfad = ".env"
    zeilen = []
    gefunden = False
    if os.path.exists(env_pfad):
        with open(env_pfad, "r", encoding="utf-8") as f:
            zeilen = f.readlines()
    neue_zeilen = []
    for zeile in zeilen:
        if zeile.startswith(f"{key}="):
            neue_zeilen.append(f"{key}={value}\n")
            gefunden = True
        else:
            neue_zeilen.append(zeile)
    if not gefunden:
        neue_zeilen.append(f"\n{key}={value}\n")
    with open(env_pfad, "w", encoding="utf-8") as f:
        f.writelines(neue_zeilen)


# ── BEREICH 1: SUCHKRITERIEN ──────────────────────────────
st.header("Suchkriterien")

# Defaults aus .env laden
_budget_default        = int(os.environ.get("BUDGET_MAX", "400000"))
_zimmer_default        = int(os.environ.get("ZIMMER_MIN", "3"))
_wfl_min_default       = int(os.environ.get("WOHNFLAECHE_MIN", "70"))
_wfl_max_default       = int(os.environ.get("WOHNFLAECHE_MAX", "100"))
_nur_neubau_default    = os.environ.get("NUR_NEUBAU", "True") == "True"
_regionen_gespeichert  = os.environ.get("REGIONEN", "Hamburg,Nordsee,Ostsee,Mallorca").split(",")

col1, col2, col3 = st.columns(3)
with col1:
    budget          = st.number_input("Budget (€)", min_value=0, value=_budget_default, step=10000)
    zimmer          = st.number_input("Zimmeranzahl", min_value=1, value=_zimmer_default, step=1)
with col2:
    wohnflaeche_min = st.number_input("Wohnfläche min (qm)", min_value=0, value=_wfl_min_default, step=5)
    wohnflaeche_max = st.number_input("Wohnfläche max (qm)", min_value=0, value=_wfl_max_default, step=5)
with col3:
    st.markdown("**Regionen**")
    reg_hamburg  = st.checkbox("Hamburg",  value="Hamburg"  in _regionen_gespeichert)
    reg_nordsee  = st.checkbox("Nordsee",  value="Nordsee"  in _regionen_gespeichert)
    reg_ostsee   = st.checkbox("Ostsee",   value="Ostsee"   in _regionen_gespeichert)
    reg_mallorca = st.checkbox("Mallorca", value="Mallorca" in _regionen_gespeichert)
    nur_neubau   = st.checkbox("Nur Neubau", value=_nur_neubau_default)

regionen = [r for r, aktiv in [
    ("Hamburg", reg_hamburg), ("Nordsee", reg_nordsee),
    ("Ostsee", reg_ostsee),  ("Mallorca", reg_mallorca)
] if aktiv]

if st.button("Einstellungen speichern"):
    schreibe_env_wert("BUDGET_MAX",      str(budget))
    schreibe_env_wert("ZIMMER_MIN",      str(zimmer))
    schreibe_env_wert("WOHNFLAECHE_MIN", str(wohnflaeche_min))
    schreibe_env_wert("WOHNFLAECHE_MAX", str(wohnflaeche_max))
    schreibe_env_wert("REGIONEN",        ",".join(regionen))
    schreibe_env_wert("NUR_NEUBAU",      str(nur_neubau))
    st.success("Einstellungen gespeichert – werden beim nächsten Start übernommen")


# ── BEREICH 2: AGENT STEUERN ─────────────────────────────
st.header("Agent steuern")

_max_emails_default = int(os.environ.get("MAX_EMAILS_PRO_TAG", "10"))
_test_modus_default = os.environ.get("TEST_MODUS", "True") == "True"

col4, col5 = st.columns(2)
with col4:
    test_modus         = st.toggle("Test-Modus (keine echten E-Mails)", value=_test_modus_default)
    maps_ueberspringen = st.toggle("⏭️ Maps-Recherche überspringen", value=True)
    max_emails         = st.number_input("Max E-Mails pro Tag", min_value=1, value=_max_emails_default, step=1)
    nur_replies        = st.checkbox("Nur Antworten klassifizieren (--nur-replies)", value=False)

if maps_ueberspringen:
    st.info("Maps-Recherche übersprungen – Agent arbeitet nur mit bestehenden Leads")
else:
    st.warning("Maps-Recherche aktiv – neue Bauträger werden gesucht")

if test_modus:
    st.warning("TEST-MODUS aktiv – keine echten E-Mails werden gesendet")
else:
    st.error("LIVE-MODUS – echte E-Mails werden gesendet!")

with col5:
    st.markdown("**Gewählte Einstellungen**")
    st.write(f"Budget: **{budget:,} €**")
    st.write(f"Zimmer: **{zimmer}**  |  Fläche: **{wohnflaeche_min}–{wohnflaeche_max} qm**")
    st.write(f"Regionen: **{', '.join(regionen) if regionen else '–'}**")
    st.write(f"Nur Neubau: **{'Ja' if nur_neubau else 'Nein'}**")
    st.write(f"Test-Modus: **{'Ja' if test_modus else 'Nein'}**")

if st.button("Agent starten", type="primary"):
    cmd = [sys.executable, "main.py"]
    if test_modus:
        cmd.append("--test")
    if nur_replies:
        cmd.append("--nur-replies")
    if maps_ueberspringen:
        cmd.append("--ohne-maps")

    env = os.environ.copy()
    env["MAX_EMAILS_PRO_TAG"] = str(max_emails)
    env["TEST_MODUS"]         = str(test_modus)
    env["BUDGET_MAX"]         = str(budget)
    env["ZIMMER_MIN"]         = str(zimmer)
    env["WOHNFLAECHE_MIN"]    = str(wohnflaeche_min)
    env["WOHNFLAECHE_MAX"]    = str(wohnflaeche_max)
    env["REGIONEN"]           = ",".join(regionen)
    env["NUR_NEUBAU"]         = str(nur_neubau)

    st.info(f"Starte: `{' '.join(cmd)}`")
    output_box = st.empty()
    output = ""
    with st.spinner("Agent läuft..."):
        process = subprocess.Popen(
            [sys.executable, "-u"] + cmd[1:],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env=env,
            encoding="utf-8",
            errors="replace",
            bufsize=1
        )
        for line in process.stdout:
            output += line
            output_box.code(output, language=None)
        process.wait()

    if process.returncode == 0:
        st.success("Agent erfolgreich abgeschlossen.")
    else:
        st.error(f"Agent beendet mit Fehlercode {process.returncode}")

# ── BEREICH 3: ERGEBNISSE ────────────────────────────────
st.header("Ergebnisse")

CSV_PFAD = "bautraeger.csv"

if os.path.exists(CSV_PFAD):
    df = pd.read_csv(CSV_PFAD).fillna("")

    def farbe_zeile(row):
        status = str(row.get("status", "")).upper()
        if status == "KONTAKTIERT":
            return ["background-color: #d4edda"] * len(row)
        elif status in ("ABGELEHNT", "ABLEHNUNG"):
            return ["background-color: #f8d7da"] * len(row)
        else:
            return ["background-color: #f5f5f5"] * len(row)

    spalten = ["firma", "email", "region", "stadt", "status", "kontaktiert_am", "antwort_kategorie"]
    vorhandene = [s for s in spalten if s in df.columns]

    st.dataframe(
        df[vorhandene].style.apply(farbe_zeile, axis=1),
        width="stretch",
        height=500
    )
    st.caption(f"{len(df)} Bauträger gesamt")
else:
    st.warning("bautraeger.csv nicht gefunden.")
