"""
Lokales Test-Tool: Kontaktformular ausfüllen (WAT-Pattern)
Verwendung: python tools/fill_contact_form.py --url "https://..." --firma "Mustermann GmbH"
Output: JSON { "success": true/false, "grund": "..." }
"""
import argparse
import json
import os
import sys


def main():
    parser = argparse.ArgumentParser(description="Kontaktformular ausfüllen")
    parser.add_argument("--url", required=True, help="URL des Kontaktformulars")
    parser.add_argument("--firma", required=True, help="Firmenname")
    parser.add_argument("--dry-run", action="store_true", help="Formular nicht absenden")
    args = parser.parse_args()

    absender_name = os.environ.get("ABSENDER_NAME", "NIO Automation")
    absender_email = os.environ.get("ABSENDER_EMAIL")

    if not absender_email:
        print(json.dumps({"success": False, "grund": "ABSENDER_EMAIL fehlt in .env"}))
        sys.exit(1)

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print(json.dumps({"success": False, "grund": "playwright nicht installiert – pip install playwright && playwright install chromium"}))
        sys.exit(1)

    betreff = f"Neue Mandanten für {args.firma} – ohne eigenen Aufwand"
    nachricht = (
        f"Guten Tag {args.firma} Team,\n\n"
        "Mandantengewinnung kostet Zeit – Zeit die man als Buchhalter "
        "eigentlich kaum hat. Ich helfe Kanzleien dabei, neue Mandanten "
        "zu gewinnen ohne selbst Zeit investieren zu müssen. "
        "Ich zeige Ihnen live wie es funktioniert – "
        "Sie entscheiden dann selbst ob es passt.\n\n"
        "Mit freundlichen Grüßen\nNIO Automation"
    )

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page()
            page.goto(args.url, timeout=30000, wait_until="domcontentloaded")

            # CAPTCHA-Erkennung
            captcha = page.locator(".g-recaptcha, [class*='captcha'], iframe[src*='recaptcha']").count()
            if captcha > 0:
                print(json.dumps({"success": False, "grund": "CAPTCHA erkannt"}))
                return

            # Felder ausfüllen
            for sel in ["input[name*='name' i]", "input[placeholder*='Name' i]", "input[id*='name' i]"]:
                if page.locator(sel).count() > 0:
                    page.locator(sel).first.fill(absender_name)
                    break

            for sel in ["input[type='email']", "input[name*='email' i]", "input[name*='mail' i]"]:
                if page.locator(sel).count() > 0:
                    page.locator(sel).first.fill(absender_email)
                    break

            for sel in ["input[name*='subject' i]", "input[name*='betreff' i]", "input[placeholder*='Betreff' i]"]:
                if page.locator(sel).count() > 0:
                    page.locator(sel).first.fill(betreff)
                    break

            textarea_sel = "textarea, input[name*='message' i], input[name*='nachricht' i]"
            if page.locator(textarea_sel).count() == 0:
                print(json.dumps({"success": False, "grund": "Kein Nachrichtenfeld gefunden"}))
                return
            page.locator(textarea_sel).first.fill(nachricht)

            if args.dry_run:
                print(json.dumps({"success": True, "grund": "dry-run – nicht abgesendet"}))
                return

            submit_sel = "button[type='submit'], input[type='submit']"
            if page.locator(submit_sel).count() == 0:
                print(json.dumps({"success": False, "grund": "Kein Submit-Button gefunden"}))
                return

            page.locator(submit_sel).first.click()
            page.wait_for_timeout(3000)

            erfolgs_worte = ["vielen dank", "wurde gesendet", "erfolgreich", "thank you", "message sent"]
            inhalt = page.inner_text("body").lower()
            if any(w in inhalt for w in erfolgs_worte):
                print(json.dumps({"success": True, "grund": "Erfolgstext erkannt"}))
            else:
                print(json.dumps({"success": True, "grund": "Abgesendet – kein Erfolgstext erkannt"}))

        except Exception as e:
            print(json.dumps({"success": False, "grund": str(e)}))
        finally:
            browser.close()


if __name__ == "__main__":
    main()
