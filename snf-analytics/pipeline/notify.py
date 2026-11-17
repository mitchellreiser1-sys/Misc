"""Email a summary of what changed when a new CMS release is published.

  python -m pipeline.notify --site dist --site-url https://example.github.io/Misc/ [--preview out.html]

Configuration comes from environment variables (GitHub Actions secrets):
  ALERT_TO          recipient address, or several separated by commas
  MAIL_FROM         sender, for example  Bravo Capital <noreply@bravocapital.com>
  RESEND_API_KEY    send through Resend, the service the Bravo portal uses
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS   or send through SMTP instead
  WATCHLIST_CCNS    optional. CCNs to report on, separated by commas or spaces

The tracked list and the recipients are never written to the log. If email is
not configured the step does nothing and the refresh still succeeds."""
import argparse
import html
import json
import os
import re
import smtplib
import sys
import urllib.request
from email.message import EmailMessage

LABELS = {
    "overall": "Overall rating", "health": "Health inspection rating", "staffing": "Staffing rating",
    "qm": "Quality measure rating", "sff": "Special Focus status", "abuse": "Abuse icon",
    "ij": "New immediate jeopardy citations", "fines": "New fines", "denials": "New payment denials",
    "chow": "Change of ownership", "added": "Added to CMS list", "dropped": "Removed from CMS list",
}
ORDER = list(LABELS)


def us_date(d):
    return f"{int(d[5:7])}/{int(d[8:10])}/{d[:4]}"


def stars(v):
    return "not rated" if v is None else f"{v} star" + ("" if v == 1 else "s")


def describe(kind, old, new):
    if kind in ("overall", "health", "staffing", "qm"):
        return f"{LABELS[kind]}: {stars(old)} to {stars(new)}"
    if kind == "sff":
        return f"Special Focus status: {old} to {new}"
    if kind == "abuse":
        return "Abuse icon added" if new else "Abuse icon removed"
    if kind == "ij":
        return f"Immediate jeopardy citations in the last 3 cycles: {old} to {new}"
    if kind == "fines":
        return f"New fine. Fine total: ${old:,.0f} to ${new:,.0f}"
    if kind == "denials":
        return f"Payment denials: {old} to {new}"
    if kind == "chow":
        return "Newly flagged as changed ownership in the last 12 months"
    if kind == "added":
        return "New in this CMS release"
    return "No longer in the CMS list"


def parse_watchlist(text):
    out = []
    for t in re.split(r"[^0-9A-Za-z]+", text or ""):
        t = t.upper()
        if re.fullmatch(r"\d{1,5}", t):
            t = t.zfill(6)
        if re.fullmatch(r"[0-9A-Z]{6}", t) and t not in out:
            out.append(t)
    return out


def compose(changes, facilities, watchlist, site_url):
    """Return (subject, html, text). facilities: {ccn: (name, city, state)}."""
    frm, to = us_date(changes["from"]), us_date(changes["to"])
    s = changes["summary"]
    national = [
        ("Overall rating upgrades", s.get("up", 0)), ("Overall rating downgrades", s.get("down", 0)),
        ("Facilities with new immediate jeopardy citations", s.get("ij", 0)), ("Special Focus status changes", s.get("sff", 0)),
        ("Facilities with new fines", s.get("fines", 0)), ("Facilities with new payment denials", s.get("denials", 0)),
    ]
    tracked = {}
    watch = set(watchlist)
    for ccn, kind, old, new in changes["items"]:
        if ccn in watch:
            tracked.setdefault(ccn, []).append((kind, old, new))
    for v in tracked.values():
        v.sort(key=lambda x: ORDER.index(x[0]))
    ordered = sorted(tracked, key=lambda c: (facilities.get(c, ("", "", ""))[0], c))
    link = site_url.rstrip("/") + "/#/changes"

    if watchlist:
        subject = f"Bravo SNF Analytics: new CMS data ({to}), {len(tracked)} of {len(watchlist)} tracked facilities changed"
    else:
        subject = f"Bravo SNF Analytics: new CMS data ({to})"

    e = html.escape
    rows = "".join(f'<tr><td style="padding:4px 0;color:#4a5468">{e(k)}</td><td style="padding:4px 0 4px 24px;text-align:right;font-weight:600">{v:,}</td></tr>' for k, v in national)
    blocks = ""
    for ccn in ordered:
        name, city, state = facilities.get(ccn, (f"CCN {ccn}", "", ""))
        where = ", ".join(x for x in (city, state) if x)
        items = "".join(f'<li style="margin:2px 0">{e(describe(*c))}</li>' for c in tracked[ccn])
        blocks += (f'<div style="border-top:1px solid #e3e6ec;padding:12px 0"><div style="font-weight:600">'
                   f'<a href="{e(site_url.rstrip("/"))}/#/f/{e(ccn)}" style="color:#256abf;text-decoration:none">{e(name)}</a></div>'
                   f'<div style="font-size:12px;color:#727c8f">CCN {e(ccn)}{" · " + e(where) if where else ""}</div>'
                   f'<ul style="margin:6px 0 0;padding-left:18px">{items}</ul></div>')
    if watchlist and not tracked:
        blocks = '<p style="margin:12px 0">None of the tracked facilities changed in this release.</p>'
    missing = [c for c in watchlist if c not in facilities]
    tracked_section = ""
    if watchlist:
        tracked_section = (f'<h2 style="font-size:15px;margin:24px 0 4px">Tracked facilities</h2>'
                           f'<div style="font-size:12px;color:#727c8f">{len(tracked)} of {len(watchlist)} tracked facilities changed</div>{blocks}')
        if missing:
            tracked_section += (f'<p style="font-size:12px;color:#8a5a00;border-top:1px solid #e3e6ec;padding-top:12px">'
                                f'{len(missing)} tracked CCN{"s are" if len(missing) > 1 else " is"} not in the current CMS release: {e(", ".join(missing))}</p>')
    body = f"""<!doctype html><html><body style="margin:0;background:#f5f6f8;font-family:Segoe UI,Arial,sans-serif;color:#141a26;font-size:14px;line-height:1.5">
<div style="max-width:640px;margin:0 auto;padding:24px 16px"><div style="background:#ffffff;border:1px solid #e3e6ec;border-radius:10px;padding:24px">
<img src="{e(site_url.rstrip("/"))}/vendor/bravo-logo.png" alt="Bravo Capital" height="30" style="height:30px;width:auto;display:block;margin-bottom:10px">
<div style="font-size:12px;color:#727c8f">SNF Analytics</div>
<h1 style="font-size:20px;margin:2px 0 4px">New CMS data: {e(to)}</h1>
<div style="color:#4a5468">Compared with the prior release of {e(frm)}. All checks passed before this release was published.</div>
{tracked_section}
<h2 style="font-size:15px;margin:24px 0 6px">All facilities nationally</h2>
<table style="border-collapse:collapse;font-size:14px">{rows}</table>
<p style="margin:24px 0 0"><a href="{e(link)}" style="display:inline-block;background:#256abf;color:#ffffff;text-decoration:none;padding:9px 16px;border-radius:8px;font-weight:600">Open What changed</a></p>
</div><div style="font-size:11px;color:#727c8f;padding:12px 4px">Changes compare published values in two consecutive CMS releases. Source: CMS Provider Data Catalog. This is an automated message.</div></div></body></html>"""

    lines = [f"New CMS data: {to} (compared with {frm})", ""]
    if watchlist:
        lines.append(f"Tracked facilities: {len(tracked)} of {len(watchlist)} changed")
        for ccn in ordered:
            name, city, state = facilities.get(ccn, (f"CCN {ccn}", "", ""))
            lines.append(f"\n{name} (CCN {ccn}{', ' + city if city else ''}{', ' + state if state else ''})")
            lines += [f"  - {describe(*c)}" for c in tracked[ccn]]
        if missing:
            lines.append(f"\nNot in the current CMS release: {', '.join(missing)}")
        lines.append("")
    lines.append("All facilities nationally")
    lines += [f"  {k}: {v:,}" for k, v in national]
    lines += ["", f"Details: {link}"]
    return subject, body, "\n".join(lines)


def send(subject, body_html, body_text, env):
    to = [a.strip() for a in env["ALERT_TO"].split(",") if a.strip()]
    sender = env.get("MAIL_FROM") or "Bravo Capital <noreply@bravocapital.com>"
    if env.get("RESEND_API_KEY"):
        req = urllib.request.Request(
            "https://api.resend.com/emails", method="POST",
            data=json.dumps({"from": sender, "to": to, "subject": subject, "html": body_html, "text": body_text}).encode(),
            headers={"Authorization": "Bearer " + env["RESEND_API_KEY"], "Content-Type": "application/json", "User-Agent": "snf-analytics/1.0"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status
    msg = EmailMessage()
    msg["Subject"], msg["From"], msg["To"] = subject, sender, ", ".join(to)
    msg.set_content(body_text)
    msg.add_alternative(body_html, subtype="html")
    port = int(env.get("SMTP_PORT") or 587)
    cls = smtplib.SMTP_SSL if port == 465 else smtplib.SMTP
    with cls(env["SMTP_HOST"], port, timeout=60) as smtp:
        if port != 465:
            smtp.starttls()
        if env.get("SMTP_USER"):
            smtp.login(env["SMTP_USER"], env.get("SMTP_PASS", ""))
        smtp.send_message(msg)
    return 200


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", required=True)
    ap.add_argument("--site-url", required=True)
    ap.add_argument("--preview", help="write the email HTML here instead of sending")
    args = ap.parse_args(argv)
    path = os.path.join(args.site, "data", "changes.json")
    if not os.path.exists(path):
        print("No earlier release to compare with. No email sent.")
        return 0
    with open(path) as f:
        changes = json.load(f)
    with open(os.path.join(args.site, "data", "index.json")) as f:
        facilities = {r[0]: (r[1], r[2], r[3]) for r in json.load(f)}
    env = os.environ
    watchlist = parse_watchlist(env.get("WATCHLIST_CCNS", ""))
    # Portfolios published with the site are tracked automatically
    shared_path = os.path.join(args.site, "data", "portfolios.json")
    if os.path.exists(shared_path):
        with open(shared_path) as f:
            for p in json.load(f):
                watchlist += [c for c in p["ccns"] if c not in watchlist]
    subject, body_html, body_text = compose(changes, facilities, watchlist, args.site_url)
    if args.preview:
        with open(args.preview, "w", encoding="utf-8") as f:
            f.write(body_html)
        print("Preview written.")
        return 0
    if not env.get("ALERT_TO") or not (env.get("RESEND_API_KEY") or env.get("SMTP_HOST")):
        print("Email is not configured (ALERT_TO plus RESEND_API_KEY or SMTP_HOST). No email sent.")
        return 0
    try:
        send(subject, body_html, body_text, env)
        print(f"Email sent. Tracked list: {'configured' if watchlist else 'not configured'}.")
        return 0
    except Exception as e:  # report without leaking addresses or keys
        print(f"EMAIL FAILED: {type(e).__name__}: {getattr(e, 'code', '')} {getattr(e, 'reason', '')}".strip(), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
