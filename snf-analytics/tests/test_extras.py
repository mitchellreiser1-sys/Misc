import unittest

from pipeline import changes, extras, history, notify, risk, validate
from pipeline.history import F
from pipeline.sources import CCN


def row(**kw):
    r = [3, 3, 3, 3, 0, 0, 0, 20.0, 0, 0, 0, 0, 0, 100]
    for k, v in kw.items():
        r[F[k]] = v
    return r


class Extras(unittest.TestCase):
    def test_repeat_tags_need_two_cycles(self):
        rows = [("F0880", "1"), ("F0880", "2"), ("F0689", "1"), ("F0689", "1"), ("F0600", "3")]
        self.assertEqual(extras.repeat_tags(rows), ["F0880"])
        self.assertEqual(extras.repeat_tags([]), [])

    def test_cut_point_band(self):
        t = [3.0, 12.0, 23.0, 46.0]
        self.assertEqual(extras.cut_point_band(0, t), 5)
        self.assertEqual(extras.cut_point_band(3.0, t), 5)
        self.assertEqual(extras.cut_point_band(3.001, t), 4)
        self.assertEqual(extras.cut_point_band(46.0, t), 2)
        self.assertEqual(extras.cut_point_band(46.5, t), 1)
        self.assertIsNone(extras.cut_point_band(None, t))
        self.assertEqual(extras.parse_cut_points([{"State": "AL", "5 Stars": "0.000-3.000", "4 Stars": "3.001-12.000",
                                                   "3 Stars": "12.001-23.000", "2 Stars": "23.001-46.000", "1 Star": ">46.000"}]),
                         {"AL": t})

    def test_band_position(self):
        t = [3.0, 12.0, 23.0, 46.0]
        p = extras.band_position(44.0, t)                      # 2-star band runs 23 to 46
        self.assertEqual((p["band"], p["lower"], p["upper"]), (2, 23.0, 46.0))
        self.assertEqual((p["to_better"], p["to_worse"], p["label"]), (21.0, 2.0, "Low"))
        self.assertEqual(extras.band_position(24.0, t)["label"], "High")
        self.assertEqual(extras.band_position(34.0, t)["label"], "Mid")
        five = extras.band_position(1.0, t)
        self.assertEqual((five["band"], five["to_better"], five["to_worse"], five["label"]), (5, None, 2.0, "High"))
        one = extras.band_position(60.0, t)
        self.assertEqual((one["band"], one["to_better"], one["to_worse"], one["label"]), (1, 14.0, None, None))
        edge = extras.band_position(46.0, t)                   # exactly on a cut point stays in the better band
        self.assertEqual((edge["band"], edge["to_worse"]), (2, 0.0))
        self.assertIsNone(extras.band_position(None, t))

    def test_pbj_metrics(self):
        a = {"census": 100.0, "hours": 400.0, "rn": 50.0, "contract": 40.0, "days": 2, "zero_rn_days": 1}
        m = extras.pbj_metrics(a)
        self.assertEqual(m["hprd"], 4.0)
        self.assertEqual(m["contract_share"], 0.1)
        self.assertEqual(m["zero_rn_days"], 1)
        self.assertIsNone(extras.pbj_metrics(None))
        self.assertIsNone(extras.pbj_metrics(dict(a, hours=0)))

    def test_owner_index(self):
        rows = [{CCN: "000002", "Owner Name": "SMITH, A", "Owner Type": "Individual", "Ownership Percentage": "5%",
                 "Role played by Owner or Manager in Facility": "DIRECT"},
                {CCN: "000001", "Owner Name": "SMITH, A", "Owner Type": "Individual", "Ownership Percentage": "NOT APPLICABLE",
                 "Role played by Owner or Manager in Facility": "OFFICER"},
                {CCN: "000001", "Owner Name": "", "Owner Type": "", "Ownership Percentage": "",
                 "Role played by Owner or Manager in Facility": "Ownership Data Not Available"}]
        ix = extras.owner_index(rows, {"000001": 0, "000002": 1})
        self.assertEqual(ix["names"], ["SMITH, A"])
        self.assertEqual(ix["links"], [[[1, 0, "5%"], [0, 1, ""]]])
        self.assertEqual(ix["roles"], ["DIRECT", "OFFICER"])


class History(unittest.TestCase):
    def test_add_release_replaces_and_orders(self):
        h = history.empty()
        history.add_release(h, "2026-02-01", {"a": row()})
        history.add_release(h, "2026-01-01", {"a": row(overall=4)})
        history.add_release(h, "2026-02-01", {"a": row(overall=5)})
        self.assertEqual(history.dates(h), ["2026-01-01", "2026-02-01"])
        self.assertEqual(history.previous_date(h, "2026-02-01"), "2026-01-01")
        self.assertIsNone(history.previous_date(h, "2026-01-01"))
        self.assertEqual(history.series(h, "a")["overall"], [4, 5])
        self.assertEqual(history.series(h, "missing")["overall"], [None, None])

    def test_snapshot_counts_severity(self):
        p = {CCN: "1", "Overall Rating": "2", "Health Inspection Rating": "", "Staffing Rating": "4", "QM Rating": "4",
             "Special Focus Status": "SFF Candidate", "Abuse Icon": "Y", "Provider Changed Ownership in Last 12 Months": "N",
             "Total Weighted Health Survey Score": "44.000", "Number of Fines": "2", "Total Amount of Fines in Dollars": "650.00",
             "Number of Payment Denials": "", "Number of Certified Beds": "57"}
        defs = [{CCN: "1", "Scope Severity Code": c} for c in "JKDGG"]
        snap = history.snapshot([p], defs)["1"]
        self.assertEqual(snap[F["ij"]], 2)
        self.assertEqual(snap[F["harm"]], 2)
        self.assertEqual(snap[F["sff"]], 1)
        self.assertIsNone(snap[F["health"]])
        self.assertEqual(snap[F["denials"]], 0)


class Changes(unittest.TestCase):
    def test_diff(self):
        prev = {"a": row(), "b": row(overall=None), "gone": row()}
        cur = {"a": row(overall=2, sff=2, abuse=1, chow=1, ij=1, fines=1, fine_total=500, denials=1),
               "b": row(overall=4), "new": row()}
        got = {(c, k): (o, n) for c, k, o, n in changes.diff(prev, cur)}
        self.assertEqual(got[("a", "overall")], (3, 2))
        self.assertEqual(got[("a", "sff")], ("None", "SFF"))
        self.assertEqual(got[("a", "abuse")], (False, True))
        self.assertEqual(got[("a", "ij")], (0, 1))
        self.assertEqual(got[("a", "fines")], (0, 500))
        self.assertEqual(got[("b", "overall")], (None, 4))
        self.assertIn(("new", "added"), got)
        self.assertIn(("gone", "dropped"), got)
        self.assertIn(("a", "chow"), got)
        s = changes.summarize(changes.diff(prev, cur))
        self.assertEqual((s["up"], s["down"]), (0, 1))

    def test_no_change_is_empty_and_decreases_are_not_events(self):
        self.assertEqual(changes.diff({"a": row()}, {"a": row()}), [])
        self.assertEqual(changes.diff({"a": row(ij=3, fines=2, denials=1, chow=1)}, {"a": row()}), [])


class Risk(unittest.TestCase):
    def test_clean_facility_scores_zero(self):
        self.assertEqual(risk.score(health=4, staffing=4)[0], 0)

    def test_components_and_caps(self):
        total, p = risk.score(ij=5, harm=9, repeat=9, sff=2, abuse=True, health=1, staffing=1, turnover=61,
                              contract_share=0.21, fine_total=150000, denials=1, overall_now=1, overall_year_ago=3)
        self.assertEqual(p, {"ij": 24, "harm": 12, "repeat": 10, "sff": 15, "abuse": 8, "health": 10, "staffing": 8,
                             "turnover": 4, "contract": 3, "penalties": 10, "trend": 5})
        self.assertEqual(total, 100)
        self.assertEqual(risk.score(ij=1)[0], 8)
        self.assertEqual(risk.score(sff=1)[1]["sff"], 10)
        self.assertEqual(risk.score(fine_total=25000)[1]["penalties"], 3)
        self.assertEqual(risk.score(turnover=60, contract_share=0.20)[0], 0)
        self.assertEqual(risk.score(overall_now=3, overall_year_ago=None)[1]["trend"], 0)
        self.assertEqual(risk.score(overall_now=4, overall_year_ago=3)[1]["trend"], 0)

    def test_every_component_is_documented(self):
        self.assertEqual({c[0] for c in risk.COMPONENTS}, set(risk.score()[1]))

    def test_percentiles(self):
        self.assertEqual(risk.percentiles([0, 0, 10, 20]), {0: 0, 10: 50, 20: 75})


class SupplementaryChecks(unittest.TestCase):
    def test_missing_supplementary_sources_warn_but_do_not_block(self):
        r = [validate.check_pbj([], None, None, None), validate.check_vbp([], None, None)]
        self.assertEqual([x["status"] for x in r], ["warn", "warn"])
        self.assertTrue(validate.passed(r))

    def test_history_gate(self):
        snap = {"a": row()}
        self.assertEqual(validate.check_history_seed(snap, {"a": row()})["status"], "pass")
        self.assertEqual(validate.check_history_seed(snap, {"a": row(overall=1)})["status"], "fail")
        self.assertEqual(validate.check_history_seed(snap, None)["status"], "pass")


class Notify(unittest.TestCase):
    CH = {"from": "2026-09-01", "to": "2026-10-01", "summary": {"up": 2, "down": 1, "ij": 1, "sff": 0},
          "items": [["000001", "overall", 3, 2], ["000001", "ij", 0, 2], ["000002", "overall", 2, 3], ["000009", "fines", 0, 650.0]]}
    FAC = {"000001": ("ALPHA <CARE>", "MOBILE", "AL"), "000002": ("BETA", "TROY", "NY")}

    def test_watchlist_parsing_restores_leading_zeros(self):
        self.assertEqual(notify.parse_watchlist("1, 000002\n01A193 junk 1"), ["000001", "000002", "01A193"])
        self.assertEqual(notify.parse_watchlist(""), [])

    def test_email_reports_only_tracked_facilities(self):
        subject, html_body, text = notify.compose(self.CH, self.FAC, ["000001", "000003"], "https://x.test/Misc/")
        self.assertIn("1 of 2 tracked facilities changed", subject)
        self.assertIn("10/1/2026", subject)
        self.assertIn("ALPHA &lt;CARE&gt;", html_body)            # names are escaped
        self.assertNotIn("BETA", html_body)                       # untracked facility is not listed
        self.assertIn("Overall rating: 3 stars to 2 stars", text)
        self.assertIn("Immediate jeopardy citations in the last 3 cycles: 0 to 2", text)
        self.assertIn("Not in the current CMS release: 000003", text)
        self.assertIn("https://x.test/Misc/#/changes", text)

    def test_email_without_watchlist_is_national_only(self):
        subject, html_body, text = notify.compose(self.CH, self.FAC, [], "https://x.test/Misc")
        self.assertNotIn("tracked", subject)
        self.assertNotIn("ALPHA", html_body)
        self.assertIn("Overall rating upgrades: 2", text)

    def test_describe(self):
        self.assertEqual(notify.describe("overall", None, 1), "Overall rating: not rated to 1 star")
        self.assertEqual(notify.describe("fines", 0, 12500.0), "New fine. Fine total: $0 to $12,500")
        self.assertEqual(notify.describe("abuse", False, True), "Abuse icon added")

    def test_not_configured_sends_nothing(self):
        import os, tempfile, json
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "data"))
            json.dump(self.CH, open(os.path.join(d, "data", "changes.json"), "w"))
            json.dump([["000001", "ALPHA", "MOBILE", "AL"]], open(os.path.join(d, "data", "index.json"), "w"))
            saved = {k: os.environ.pop(k, None) for k in ("ALERT_TO", "RESEND_API_KEY", "SMTP_HOST")}
            try:
                self.assertEqual(notify.main(["--site", d, "--site-url", "https://x.test"]), 0)
            finally:
                for k, v in saved.items():
                    if v is not None:
                        os.environ[k] = v


if __name__ == "__main__":
    unittest.main()
