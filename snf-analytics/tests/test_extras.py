import unittest

from pipeline import changes, extras, history, notify, risk, validate
from pipeline.history import F
from pipeline.sources import CCN


def row(**kw):
    r = [3, 3, 3, 3, 0, 0, 0, 20.0, 0, 0, 0, 0, 0, 100, 0, 0, 0, 0, 0, 0, 0, None, 0.0, 0.0, 0.0, 0, 0, 0]
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


class SharedPortfolios(unittest.TestCase):
    def _load(self, obj):
        import json, os, tempfile
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "portfolios.json")
            json.dump(obj, open(p, "w"))
            return extras.load_shared_portfolios(p)

    def test_valid_file(self):
        got = self._load([{"name": " Deal A 2026 ", "ccns": ["235357", "235357", "23539a"]}])
        self.assertEqual(got, [{"id": "deal-a-2026", "name": "Deal A 2026", "ccns": ["235357", "23539A"]}])
        self.assertEqual(extras.load_shared_portfolios("/nonexistent/portfolios.json"), [])

    def test_malformed_file_stops_the_refresh(self):
        for bad in ({"name": "x"}, [{"name": "", "ccns": ["235357"]}], [{"name": "x", "ccns": []}],
                    [{"name": "x", "ccns": ["35357"]}], [{"name": "x", "ccns": ["235357"]}, {"name": "X", "ccns": ["235357"]}]):
            with self.assertRaises(ValueError):
                self._load(bad)


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
        p["Total nursing staff turnover"] = "41.8"
        mk = lambda code, cycle, tag: {CCN: "1", "Scope Severity Code": code, "Inspection Cycle": cycle,
                                       "Deficiency Prefix": "F", "Deficiency Tag Number": tag}
        defs = [mk("J", "1", "0600"), mk("K", "2", "0600"), mk("D", "1", "0880"), mk("D", "2", "0880"),
                mk("G", "3", "0689"), mk("G", "3", "0700"), mk("", "1", "0999")]
        p["Processing Date"] = "2026-10-01"
        pen = lambda date, kind, amt: {CCN: "1", "Penalty Date": date, "Penalty Type": kind, "Fine Amount": amt}
        pens = [pen("2026-03-01", "Fine", "1000"), pen("2025-10-01", "Fine", "500"), pen("2025-09-30", "Fine", "250"),
                pen("2023-11-30", "Fine", "198188"), pen("2023-11-30", "Payment Denial", "")]
        snap = history.snapshot([p], defs, pens)["1"]
        self.assertEqual((snap[F["fine1"]], snap[F["fine2"]], snap[F["fine3"]]), (1000.0, 750.0, 198188.0))
        self.assertEqual((snap[F["den1"]], snap[F["den2"]], snap[F["den3"]]), (0, 0, 1))
        self.assertEqual(snap[F["ij"]], 2)
        self.assertEqual(snap[F["harm"]], 2)
        self.assertEqual((snap[F["ij1"]], snap[F["ij2"]], snap[F["ij3"]]), (1, 1, 0))
        self.assertEqual((snap[F["harm1"]], snap[F["harm2"]], snap[F["harm3"]]), (0, 0, 2))
        self.assertEqual(snap[F["repeat_severe"]], 1)      # F0600 at J then K; F0880 repeats only at D
        self.assertEqual(snap[F["turnover"]], 41.8)
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

    def test_old_history_layout_falls_back(self):
        import gzip, json, os, tempfile
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "h.json.gz")
            with gzip.open(path, "wt") as f:
                json.dump({"fields": ["overall"], "snapshots": {}}, f)
            self.assertIsNone(history.load(path))
            history.save(history.empty(), path)
            self.assertEqual(history.load(path)["fields"], history.FIELDS)

    def test_no_change_is_empty_and_decreases_are_not_events(self):
        self.assertEqual(changes.diff({"a": row()}, {"a": row()}), [])
        self.assertEqual(changes.diff({"a": row(ij=3, fines=2, denials=1, chow=1)}, {"a": row()}), [])


class Risk(unittest.TestCase):
    def test_clean_facility_scores_zero(self):
        self.assertEqual(risk.score(survey_pct=0.0, staffing=4, qm=4)[0], 0)
        self.assertEqual(risk.score()[0], 0)

    def test_older_citations_count_less(self):
        self.assertEqual(risk.score(ij_cycles=(1, 0, 0))[1]["ij"], 6)
        self.assertEqual(risk.score(ij_cycles=(0, 1, 0))[1]["ij"], 3)
        self.assertEqual(risk.score(ij_cycles=(0, 0, 1))[1]["ij"], 2)     # 1.5 rounds half up
        self.assertEqual(risk.score(ij_cycles=(0, 0, 2))[1]["ij"], 3)
        self.assertEqual(risk.score(ij_cycles=(9, 9, 9))[1]["ij"], 15)
        self.assertEqual(risk.score(harm_cycles=(1, 0, 0))[1]["harm"], 3)
        self.assertEqual(risk.score(harm_cycles=(0, 1, 0))[1]["harm"], 2)  # 1.5 rounds half up
        self.assertEqual(risk.score(harm_cycles=(0, 0, 1))[1]["harm"], 1)  # 0.75 rounds to 1
        self.assertEqual(risk.score(harm_cycles=(0, 0, 4))[1]["harm"], 3)
        self.assertEqual(risk.score(harm_cycles=(9, 9, 9))[1]["harm"], 7)

    def test_components_add_to_exactly_100(self):
        self.assertEqual(sum(c[3] for c in risk.COMPONENTS), 100)
        total, p = risk.score(survey_pct=1.0, ij_cycles=(5, 0, 0), harm_cycles=(5, 0, 0), repeat_severe=2, sff=2, abuse=True,
                              staffing=1, turnover=61, contract_share=0.21, zero_rn_days=3, denials_by_age=(1, 0, 0),
                              fines_by_age=(25000, 0, 0), qm=2, chow=True)
        self.assertEqual(p, {c[0]: c[3] for c in risk.COMPONENTS})   # every component reaches its stated maximum
        self.assertEqual(total, 100)

    def test_point_values(self):
        self.assertEqual(risk.score(sff=1)[1]["sff"], 10)
        self.assertEqual(risk.score(staffing=2)[1]["staffing"], 5)
        self.assertEqual(risk.score(fines_by_age=(24999, 0, 0))[1]["penalties"], 4)
        self.assertEqual(risk.score(denials_by_age=(1, 0, 0), fines_by_age=(198188, 0, 0))[1]["penalties"], 14)
        self.assertEqual(risk.score(survey_pct=0.5)[1]["survey"], 12)
        self.assertEqual(risk.score(survey_pct=12114 / 14647)[1]["survey"], 20)
        self.assertEqual(risk.score(survey_pct=None)[1]["survey"], 0)
        self.assertEqual(risk.score(turnover=60, contract_share=0.20, zero_rn_days=0, qm=3)[0], 0)
        # a single recent severe citation outweighs the repeat flag
        self.assertGreater(risk.score(harm_cycles=(1, 0, 0))[1]["harm"], risk.score(repeat_severe=1)[1]["repeat"])

    def test_special_focus_status_is_always_top_tier(self):
        self.assertEqual(risk.tier(28, sff=1), "Very High Risk")
        self.assertEqual(risk.tier(0, sff=2), "Very High Risk")
        self.assertEqual(risk.tier(28, sff=0), "Moderate Risk")
        self.assertTrue(risk.tier_set_by_status(28, sff=1))
        self.assertFalse(risk.tier_set_by_status(60, sff=1))     # already top tier on points
        self.assertFalse(risk.tier_set_by_status(28, sff=0))

    def test_penalties_count_less_as_they_age(self):
        pp = risk.penalty_points
        self.assertEqual([pp((0, 0, 0), d) for d in ((1, 0, 0), (0, 1, 0), (0, 0, 1), (0, 0, 0))], [6, 3, 2, 0])   # 1.5 rounds to 2
        self.assertEqual([pp(f, (0, 0, 0)) for f in ((25000, 0, 0), (0, 25000, 0), (0, 0, 25000))], [8, 4, 2])
        self.assertEqual([pp(f, (0, 0, 0)) for f in ((100, 0, 0), (0, 100, 0), (0, 0, 100))], [4, 2, 1])
        self.assertEqual(pp((0, 0, 198188), (0, 0, 1)), 4)            # an old large fine and denial
        self.assertEqual(pp((1000, 0, 198188), (0, 0, 0)), 4)         # a small recent fine outweighs an old large one
        self.assertEqual(pp((10000, 10000, 10000), (0, 0, 0)), 4)     # groups are not added together
        self.assertEqual(pp((30000, 0, 0), (5, 5, 5)), 14)            # the most recent denial sets the denial points

    def test_tiers(self):
        self.assertEqual([risk.tier(s) for s in (0, 14, 15, 29, 30, 44, 45, 100)],
                         ["Low Risk", "Low Risk", "Moderate Risk", "Moderate Risk", "Elevated Risk", "Elevated Risk",
                          "Very High Risk", "Very High Risk"])

    def test_every_component_is_documented(self):
        self.assertEqual({c[0] for c in risk.COMPONENTS}, set(risk.score()[1]))

    def test_percentiles_and_lower_share(self):
        self.assertEqual(risk.percentiles([0, 0, 10, 20]), {0: 0, 10: 50, 20: 75})
        self.assertEqual(risk.lower_share([5.0, 5.0, 9.0, 20.0]), {5.0: 0.0, 9.0: 0.5, 20.0: 0.75})

    def test_scoring_from_history_row(self):
        r = row(staffing=1, sff=1, ij1=1, harm2=1, repeat_severe=1, den1=1, fine1=500.0, chow=1, turnover=70.0, qm=1)
        total, p = risk.score_snapshot_row(r, 0.5)
        self.assertEqual(total, 12 + 10 + 10 + 10 + 6 + 2 + 2 + 4 + 1 + 2)
        self.assertEqual((p["contract"], p["rn"]), (0, 0))

    def test_backtest_runs_on_history(self):
        a = {str(i): row(weighted=float(i), staffing=1 if i % 2 else 4) for i in range(200)}
        b = {k: row(ij=1 if int(k) >= 150 else 0) for k in a}
        bt = risk.backtest({"2025-10-01": a, "2026-10-01": b}, "2025-10-01", "2026-10-01")
        self.assertEqual(bt["facilities"], 200)
        self.assertEqual(len(bt["rows"]), 4)
        self.assertGreater(bt["rows"][3][2], bt["rows"][0][2])
        self.assertIsNone(risk.backtest({"a": {"1": row()}, "b": {"1": row()}}, "a", "b"))


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
