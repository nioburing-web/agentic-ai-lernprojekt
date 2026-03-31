In dashboard.py soll der "Agent starten" Button den Output 
von main.py live Zeile fuer Zeile im Browser anzeigen.

Benutze subprocess.Popen so:

import subprocess
import streamlit as st

if st.button("Agent starten"):
    with st.spinner("Agent laeuft..."):
        process = subprocess.Popen(
            ["python", "main.py"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True
        )
        output_box = st.empty()
        output = ""
        for line in process.stdout:
            output += line
            output_box.code(output)
        st.success("Agent fertig!")

Zusaetzlich:
- Wenn TEST_MODUS aktiv ist soll oben ein gelbes Banner erscheinen:
  st.warning("TEST-MODUS aktiv – keine echten E-Mails werden gesendet")
- Wenn TEST_MODUS inaktiv ist soll ein rotes Banner erscheinen:
  st.error("LIVE-MODUS – echte E-Mails werden gesendet!")

Alle Werte aus os.environ.get() – nichts direkt im Code.
Zeige mir den Unterschied bevor du die Aenderung machst.