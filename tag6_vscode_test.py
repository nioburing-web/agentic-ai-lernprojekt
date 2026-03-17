from dotenv import load_dotenv
import os
from openai import OpenAI

load_dotenv()

client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

# Mein erstes Python-Skript auf dem PC
# Gespeichert als echte Datei – nicht mehr in Colab

print("Hallo PC! VS Code funktioniert.")
print()

# Test: Kann Python rechnen?
ergebnis = 7 * 6
print(f"7 × 6 = {ergebnis}")

# Test: Läuft Python 3.11?
import sys
print(f"Python-Version: {sys.version}")
