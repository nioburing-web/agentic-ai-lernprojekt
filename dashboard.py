import os
import subprocess
import sys
import pandas as pd
import streamlit as st
from dotenv import load_dotenv

load_dotenv()

st.set_page_config(page_title="NIO Automation – Bauträger Agent", layout="wide")
st.title("NIO Automation – Bauträger Agent Dashboard")

# ── BEREICH 1: SUCHKRITERIEN ──────────────────────────────
st.header("Suchkriterien")

col1, col2, col3 = st.columns(3)
with col1:
    budget = st.number_input("Budget (€)", min_value=0, value=400000, step=10000)
    zimmer = st.number_input("Zimmeranzahl", min_value=1, value=3, step=1)
with col2:
    wohnflaeche_min = st.number_input("Wohnfläche min (qm)", min_value=0, value=70, step=5)
    wohnflaeche_max = st.number_input("Wohnfläche max (qm)", min_value=0, value=100, step=5)
with col3:
    st.markdown("**Regionen**")
    reg_hamburg  = st.checkbox("Hamburg",  value=True)
    reg_nordsee  = st.checkbox("Nordsee",  value=True)
    reg_ostsee   = st.checkbox("Ostsee",   value=True)
    reg_mallorca = st.checkbox("Mallorca", value=True)
    nur_neubau   = st.checkbox("Nur Neubau", value=True)

# ── BEREICH 2: AGENT STEUERN ─────────────────────────────
st.header("Agent steuern")

col4, col5 = st.columns(2)
with col4:
    test_modus      = st.toggle("Test-Modus (keine echten E-Mails)", value=True)
    max_emails      = st.number_input("Max E-Mails pro Tag", min_value=1, value=10, step=1)
    nur_replies     = st.checkbox("Nur Antworten klassifizieren (--nur-replies)", value=False)

if test_modus:
    st.warning("TEST-MODUS aktiv – keine echten E-Mails werden gesendet")
else:
    st.error("LIVE-MODUS – echte E-Mails werden gesendet!")

with col5:
    st.markdown("**Gewählte Einstellungen**")
    regionen = [r for r, aktiv in [
        ("Hamburg", reg_hamburg), ("Nordsee", reg_nordsee),
        ("Ostsee", reg_ostsee),  ("Mallorca", reg_mallorca)
    ] if aktiv]
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

    env = os.environ.copy()
    env["MAX_EMAILS_PRO_TAG"] = str(max_emails)

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
